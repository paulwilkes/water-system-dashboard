/**
 * Monthly DOH CT6 disinfection report generator
 *
 * On the 1st of each month (checked hourly, days 1-5, after 7am Pacific) this:
 *  1. Pulls last month's chlorine readings from the monitoring sheet
 *     (CHLORINE_SHEET_ID, "Form Responses 1")
 *  2. Copies the CT6 template Google Sheet into the "<YYYY> Reports" Drive
 *     folder (creating the year folder in January), named
 *     "BeulahPark-CT6-<MonthName><YYYY>"
 *  3. Fills the copy's "Monthly Data" tab and sets the Month/Year cell (L2)
 *     on the "Disinfection Report Form" tab — that cell drives all the
 *     day-row formulas; without it the form stays blank
 *  4. Verifies the form populated, then emails Paul a review link with
 *     data-quality flags via Resend
 *
 * Paul reviews, fills in meter readings / tank level / signature, and emails
 * the report to NWS himself (due the 5th). This job never sends anything to DOH.
 *
 * The reports folder must live in a Shared Drive, with the service account
 * added as a Content manager. Service accounts have no Drive storage of their
 * own, so copying the template into a My Drive folder fails with
 * "storage quota has been exceeded". Shared Drive files are owned by the drive.
 *
 * Idempotent: a file this job finished, or one it didn't create (a report built
 * by hand), is a no-op (pass --force / {force:true} to re-fill it anyway). A file
 * this job started but never finished is picked up again on the next run: a Drive
 * app property marks it "building" until the review email has gone out.
 * Scheduled failures email the recipients, once per distinct error per month.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import ResendService from './resend.js';
import { wrapEmail, escapeHtml } from './email-template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The repo is public, so these live in env only. Read at call time: the CLI
// loads dotenv after this module's imports have already run.
const REQUIRED_ENV = ['CHLORINE_SHEET_ID', 'DOH_TEMPLATE_SHEET_ID',
  'DOH_REPORTS_FOLDER_ID', 'DOH_REPORT_RECIPIENTS'];

function missingEnv() {
  return REQUIRED_ENV.filter(name => !process.env[name]);
}

// Drive app property on files this job creates. Only "building" gets resumed,
// so a report built by hand (no property) is never overwritten by a retry.
const STATUS_PROPERTY = 'dohReportStatus';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Monthly Data input rows: 9 through 60 (cleared/padded on every fill)
const DATA_START_ROW = 9;
const DATA_END_ROW = 60;

function loadGoogleCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_FILE) {
    const credentialsPath = path.join(__dirname, '..', process.env.GOOGLE_CREDENTIALS_FILE);
    return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  }
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  throw new Error('No Google credentials configured');
}

async function getClients() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadGoogleCredentials(),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: 'v4', auth: client }),
    drive: google.drive({ version: 'v3', auth: client })
  };
}

function nowInPacific() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
}

/** The month being reported: the calendar month before the given date. */
function previousMonth(from) {
  const year = from.getMonth() === 0 ? from.getFullYear() - 1 : from.getFullYear();
  const month = from.getMonth() === 0 ? 11 : from.getMonth() - 1;
  return { year, month }; // month is 0-based
}

/**
 * Pull and clean last month's readings from the monitoring sheet.
 * Returns { rows, flags } where rows are [date, reading, time, tester, notes]
 * ready for the Monthly Data tab.
 */
async function fetchMonthReadings(sheets, { year, month }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.CHLORINE_SHEET_ID,
    range: `'Form Responses 1'!A:G`
  });
  const all = res.data.values || [];

  const flags = { high: [], low: [], gaps: [], cleaned: [] };
  const rows = [];

  for (const raw of all) {
    const [, , testDate, reading, testTime, tester, notes] = raw;
    if (!testDate) continue;
    const d = new Date(testDate);
    if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) continue;

    // Reading should be a decimal; testers sometimes type prose around it.
    // Extract the first number and move the rest into the notes.
    let ppm = parseFloat(reading);
    let note = notes || '';
    if (isNaN(ppm) || String(ppm) !== String(reading).trim()) {
      const match = String(reading || '').match(/\d+(?:\.\d+)?/);
      if (!match) continue; // no number at all — nothing to report
      ppm = parseFloat(match[0]);
      const leftover = String(reading)
        .replace(match[0], '')
        .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, '');
      if (leftover) {
        note = note ? `${note} Reading entry also said: ${leftover}` : `Reading entry also said: ${leftover}`;
        flags.cleaned.push(`${testDate}: reading entered as "${String(reading).slice(0, 80)}" — recorded as ${ppm.toFixed(2)}`);
      }
    }

    if (ppm >= 2.0) flags.high.push(`${testDate}: ${ppm.toFixed(2)} mg/L`);
    if (ppm <= 0.01) flags.low.push(`${testDate}: ${ppm.toFixed(2)} mg/L`);

    rows.push({ date: d, values: [testDate, ppm.toFixed(2), testTime || '', tester || '', note] });
  }

  rows.sort((a, b) => a.date - b.date);

  // Flag stretches of 3+ days with no test (including month edges)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const testedDays = [...new Set(rows.map(r => r.date.getDate()))].sort((a, b) => a - b);
  if (testedDays.length > 0) {
    const checkGap = (from, to, label) => {
      if (to - from >= 3) flags.gaps.push(label);
    };
    checkGap(0, testedDays[0], `No tests until the ${testedDays[0]}th`);
    for (let i = 1; i < testedDays.length; i++) {
      checkGap(testedDays[i - 1], testedDays[i],
        `No tests between the ${testedDays[i - 1]}th and the ${testedDays[i]}th`);
    }
    checkGap(testedDays[testedDays.length - 1], daysInMonth + 1,
      `No tests after the ${testedDays[testedDays.length - 1]}th`);
  }

  return { rows: rows.map(r => r.values), flags, testedDayCount: testedDays.length };
}

async function findChildByName(drive, parentId, name, mimeType) {
  const mimeClause = mimeType ? ` and mimeType = '${mimeType}'` : '';
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false${mimeClause}`,
    fields: 'files(id, name, appProperties)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return (res.data.files || [])[0] || null;
}

/** Find or create the "<YYYY> Reports" folder under the reports parent. */
async function getYearFolder(drive, year) {
  const name = `${year} Reports`;
  const existing = await findChildByName(drive, process.env.DOH_REPORTS_FOLDER_ID, name,
    'application/vnd.google-apps.folder');
  if (existing) return existing.id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.DOH_REPORTS_FOLDER_ID]
    },
    fields: 'id',
    supportsAllDrives: true
  });
  console.log(`[doh-report] Created Drive folder "${name}"`);
  return created.data.id;
}

/** Fill Monthly Data rows 9-60 and the Month/Year cell on the report tab. */
async function fillReport(sheets, spreadsheetId, dataRows, { year, month }) {
  const padded = [...dataRows];
  while (padded.length < DATA_END_ROW - DATA_START_ROW + 1) padded.push(['', '', '', '', '']);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `'Monthly Data'!A${DATA_START_ROW}:E${DATA_END_ROW}`, values: padded },
        // L2 is a hardcoded date every day-row formula keys off — not a formula.
        // Stale value = blank form (plus a DATE-overflow artifact on day 31).
        { range: `'Disinfection Report Form'!L2`, values: [[`${month + 1}/1/${year}`]] }
      ]
    }
  });
}

/** Read back the report tab's Total measurements cell (J43) to confirm the formulas populated. */
async function verifyReport(sheets, spreadsheetId, expectedDayCount) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Disinfection Report Form'!J43`
  });
  const total = parseInt(((res.data.values || [])[0] || [])[0], 10);
  return {
    ok: total === expectedDayCount,
    formTotal: isNaN(total) ? null : total,
    expected: expectedDayCount
  };
}

function getResend() {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME } = process.env;
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return null;
  return new ResendService(RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME);
}

function getRecipients() {
  return process.env.DOH_REPORT_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
}

async function sendReviewEmail({ monthName, year, sheetUrl, flags, verification, readingCount, updatedExisting }) {
  const resend = getResend();
  if (!resend) {
    console.warn('[doh-report] Resend not configured, skipping review email');
    return { sent: 0, skipped: true };
  }

  const flagSection = (title, items) => items.length === 0 ? '' : `
    <p style="margin:16px 0 4px;font-weight:bold;">${escapeHtml(title)}</p>
    <ul style="margin:0;padding-left:20px;color:#2c2c2c;font-size:14px;">
      ${items.map(i => `<li style="margin:2px 0;">${escapeHtml(i)}</li>`).join('')}
    </ul>`;

  const verifyWarning = verification.ok ? '' : `
    <p style="margin:16px 0 0;padding:12px;background:#fdf0ed;border-radius:6px;color:#b3402a;font-size:14px;">
      Heads up: the form's measurement total (${verification.formTotal ?? 'blank'}) doesn't match the
      ${verification.expected} test days pulled from the monitoring sheet. Give the report tab a close look.
    </p>`;

  const subject = `DOH Chlorine Report Ready for Review - ${monthName} ${year}`;
  const bodyHtml = `
    <p style="margin:0 0 12px;">The ${escapeHtml(monthName)} ${year} CT6 disinfection report is
    ${updatedExisting ? 're-filled with the latest data' : 'built and waiting for review'}:
    ${readingCount} readings pulled from the monitoring sheet.</p>
    <p style="margin:0 0 12px;"><a href="${escapeHtml(sheetUrl)}" style="color:#e8927c;">Open the report →</a></p>
    ${flagSection('Readings at or above 2.0 mg/L', flags.high)}
    ${flagSection('Readings at or near zero', flags.low)}
    ${flagSection('Testing gaps (3+ days)', flags.gaps)}
    ${flagSection('Entries that needed cleanup', flags.cleaned)}
    ${verifyWarning}
    <p style="margin:20px 0 4px;font-weight:bold;">Still yours to fill in before sending:</p>
    <ul style="margin:0;padding-left:20px;color:#2c2c2c;font-size:14px;">
      <li style="margin:2px 0;">Source meter readings</li>
      <li style="margin:2px 0;">Chlorine tank level and volume used</li>
      <li style="margin:2px 0;">Report submitted by / signature</li>
      <li style="margin:2px 0;">Water treatment summary box</li>
    </ul>
    <p style="margin:16px 0 0;color:#6b6b6b;font-size:14px;">Due to NWS by the 5th.</p>
  `;

  const html = wrapEmail({
    subject,
    bodyHtml,
    baseUrl: process.env.DASHBOARD_BASE_URL || 'https://dashboard.beulahparkws.org',
    internal: true
  });

  const results = await Promise.all(
    getRecipients().map(to => resend.sendOne({ to, subject, html }))
  );
  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.length - sent;
  if (failed > 0) {
    console.error(`[doh-report] Review email: ${sent} sent, ${failed} failed`,
      results.filter(r => r.status !== 'sent'));
  } else {
    console.log(`[doh-report] Review email sent to ${sent} recipient(s)`);
  }
  return { sent, failed };
}

/** Tell the recipients a scheduled run failed. Returns true if anyone got it. */
async function sendFailureAlert(reportLabel, detail) {
  const resend = getResend();
  if (!resend) {
    console.warn('[doh-report] Resend not configured, skipping failure alert');
    return false;
  }
  const subject = `DOH Chlorine Report Failed - ${reportLabel}`;
  const html = wrapEmail({
    subject,
    bodyHtml: `
      <p style="margin:0 0 12px;">The ${escapeHtml(reportLabel)} CT6 report couldn't be built automatically:</p>
      <p style="margin:0 0 12px;padding:12px;background:#fdf0ed;border-radius:6px;color:#b3402a;font-size:14px;">${escapeHtml(detail)}</p>
      <p style="margin:0 0 12px;">The job tries again every hour through the 5th, and you'll get the usual
      review email if one works. Due to NWS by the 5th, so it may need building by hand.</p>
    `,
    baseUrl: process.env.DASHBOARD_BASE_URL || 'https://dashboard.beulahparkws.org',
    internal: true
  });
  const results = await Promise.all(
    getRecipients().map(to => resend.sendOne({ to, subject, html }))
  );
  return results.some(r => r.status === 'sent');
}

/**
 * Generate last month's report. A finished or hand-built file is a no-op unless
 * force is set, which re-fills it in place. A file this job left unfinished is
 * resumed. Throws if nobody could be emailed, leaving the file to be resumed.
 */
export async function generateDohReport({ force = false } = {}) {
  const missing = missingEnv();
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(', ')}`);
  }

  const reportMonth = previousMonth(nowInPacific());
  const monthName = MONTH_NAMES[reportMonth.month];
  const title = `BeulahPark-CT6-${monthName}${reportMonth.year}`;

  const { sheets, drive } = await getClients();
  const yearFolderId = await getYearFolder(drive, reportMonth.year);

  const existing = await findChildByName(drive, yearFolderId, title,
    'application/vnd.google-apps.spreadsheet');
  const unfinished = existing?.appProperties?.[STATUS_PROPERTY] === 'building';
  if (existing && !force && !unfinished) {
    console.log(`[doh-report] ${title} already exists — nothing to do`);
    return { skipped: true, title };
  }

  const { rows, flags, testedDayCount } = await fetchMonthReadings(sheets, reportMonth);
  if (rows.length === 0) {
    console.warn(`[doh-report] No readings found for ${monthName} ${reportMonth.year}, not generating`);
    return { skipped: true, title, reason: 'no readings' };
  }
  if (rows.length > DATA_END_ROW - DATA_START_ROW + 1) {
    throw new Error(`${rows.length} readings won't fit in Monthly Data rows ${DATA_START_ROW}-${DATA_END_ROW}`);
  }

  let spreadsheetId;
  const updatedExisting = Boolean(existing && force);
  if (existing) {
    spreadsheetId = existing.id;
    console.log(`[doh-report] ${force ? 'Re-filling existing' : 'Resuming unfinished'} ${title}`);
  } else {
    const copy = await drive.files.copy({
      fileId: process.env.DOH_TEMPLATE_SHEET_ID,
      requestBody: {
        name: title,
        parents: [yearFolderId],
        appProperties: { [STATUS_PROPERTY]: 'building' }
      },
      fields: 'id',
      supportsAllDrives: true
    }).catch(err => {
      if (err.errors?.some(e => e.reason === 'storageQuotaExceeded')) {
        throw new Error('Service account has no Drive storage: move the reports folder '
          + 'into a Shared Drive and set DOH_REPORTS_FOLDER_ID (see header comment)');
      }
      throw err;
    });
    spreadsheetId = copy.data.id;
    console.log(`[doh-report] Created ${title}`);
  }

  await fillReport(sheets, spreadsheetId, rows, reportMonth);
  const verification = await verifyReport(sheets, spreadsheetId, testedDayCount);
  if (!verification.ok) {
    console.warn(`[doh-report] Verification mismatch: form total ${verification.formTotal}, expected ${verification.expected}`);
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const emailed = await sendReviewEmail({
    monthName,
    year: reportMonth.year,
    sheetUrl,
    flags,
    verification,
    readingCount: rows.length,
    updatedExisting
  });
  if (!emailed.sent) {
    throw new Error(`${title} is built but the review email didn't go out: ${sheetUrl}`);
  }

  await drive.files.update({
    fileId: spreadsheetId,
    requestBody: { appProperties: { [STATUS_PROPERTY]: 'complete' } },
    supportsAllDrives: true
  });

  return { title, spreadsheetId, sheetUrl, readings: rows.length, verification, updatedExisting };
}

/**
 * Hourly scheduler: during the 1st-5th of the month (report due the 5th),
 * after 7am Pacific, generate last month's report if it isn't finished yet.
 * A missed or failed hour just means the next tick picks it up. Each distinct
 * problem is emailed once per report month (per process, so a restart can repeat
 * one), and stays unmarked if the alert itself fails so the next tick tries again.
 */
const alertsSent = new Set();

async function alertOnce(detail) {
  const { year, month } = previousMonth(nowInPacific());
  const reportLabel = `${MONTH_NAMES[month]} ${year}`;
  const key = `${reportLabel}: ${detail}`;
  if (alertsSent.has(key)) return;
  if (await sendFailureAlert(reportLabel, detail)) {
    alertsSent.add(key);
  } else {
    console.error('[doh-report] Failure alert could not be sent');
  }
}

async function runScheduledReport() {
  try {
    const result = await generateDohReport();
    if (result.reason === 'no readings') {
      await alertOnce('No chlorine readings were found in the monitoring sheet for that month.');
    }
  } catch (err) {
    console.error('[doh-report] Scheduled generation failed:', err.message);
    await alertOnce(err.message);
  }
}

export function startDohReportScheduler() {
  if (process.env.DOH_REPORT_DISABLED === 'true') {
    console.log('[doh-report] Scheduler disabled via DOH_REPORT_DISABLED');
    return;
  }
  const missing = missingEnv();
  if (missing.length > 0) {
    console.warn(`[doh-report] Scheduler not started, missing env: ${missing.join(', ')}`);
    return;
  }
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    const now = nowInPacific();
    if (now.getDate() > 5 || now.getHours() < 7) return;
    runScheduledReport().catch(err =>
      console.error('[doh-report] Failure alert errored:', err.message));
  }, ONE_HOUR);
  console.log('[doh-report] Monthly report scheduler started (1st-5th, after 7am Pacific)');
}

// CLI: node lib/doh-report.js [--force]
if (process.argv[1] === __filename) {
  const dotenv = await import('dotenv');
  dotenv.config();
  generateDohReport({ force: process.argv.includes('--force') })
    .then(result => {
      console.log('[doh-report] Done:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[doh-report] Failed:', err);
      process.exit(1);
    });
}
