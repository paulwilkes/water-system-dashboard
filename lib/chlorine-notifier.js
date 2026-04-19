/**
 * Chlorine test notifications
 *
 * Two behaviors:
 *  1. sendSubmissionEmail() — called by the /api/chlorine/submission webhook
 *     when the Google Form Apps Script posts a new chlorine test. Sends a
 *     branded internal email to CHLORINE_ALERT_RECIPIENTS via Resend.
 *
 *  2. checkStaleChlorine() — called hourly from server.js. Reads the latest
 *     chlorine row from the Google Sheet and sends a branded stale-data
 *     alert if the newest reading is older than STALE_THRESHOLD_HOURS.
 *     Deduped via chlorine_alert_state so we only send once per stale period.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import GoogleSheetsClient from './sheets.js';
import ResendService from './resend.js';
import { wrapEmail, escapeHtml } from './email-template.js';
import { getLastStaleAlertAt, markStaleAlertSent } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STALE_THRESHOLD_HOURS = 24;
// Suppress repeat stale alerts within this window so we only notify once per
// stale period, not every hour the data remains stale.
const STALE_ALERT_COOLDOWN_HOURS = 24;

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

function getResend() {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME } = process.env;
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return null;
  return new ResendService(RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME);
}

function getRecipients() {
  const raw = process.env.CHLORINE_ALERT_RECIPIENTS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function getBaseUrl() {
  return process.env.DASHBOARD_BASE_URL || 'https://dashboard.beulahparkws.org';
}

/**
 * Render a clean definition list of submitted form fields.
 * `fields` is an object like { "Timestamp": "...", "Email Address": "...", ... }
 */
function renderFieldsList(fields) {
  const rows = Object.entries(fields || {}).map(([label, value]) => `
    <tr>
      <td style="padding:8px 16px 8px 0;vertical-align:top;color:#6b6b6b;font-size:14px;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;vertical-align:top;color:#2c2c2c;font-size:15px;">${escapeHtml(String(value ?? ''))}</td>
    </tr>
  `).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0 20px;">${rows}</table>`;
}

/**
 * Send the branded "new chlorination report submitted" email.
 * Called from the webhook handler.
 */
export async function sendSubmissionEmail({ fields, sheetUrl }) {
  const resend = getResend();
  if (!resend) {
    console.warn('[chlorine-notifier] Resend not configured, skipping submission email');
    return { sent: 0, skipped: true };
  }
  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.warn('[chlorine-notifier] CHLORINE_ALERT_RECIPIENTS empty, skipping submission email');
    return { sent: 0, skipped: true };
  }

  const subject = 'New Chlorination Report Submitted';
  const sheetLinkHtml = sheetUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(sheetUrl)}" style="color:#e8927c;">View the spreadsheet →</a></p>`
    : '';
  const bodyHtml = `
    <p style="margin:0 0 4px;">A new chlorination report was just submitted.</p>
    ${renderFieldsList(fields)}
    ${sheetLinkHtml}
  `;

  const html = wrapEmail({ subject, bodyHtml, baseUrl: getBaseUrl(), internal: true });

  const results = await Promise.all(
    recipients.map(to => resend.sendOne({ to, subject: `${subject} - Beulah Park`, html }))
  );
  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.length - sent;
  if (failed > 0) {
    console.error(`[chlorine-notifier] Submission email: ${sent} sent, ${failed} failed`,
      results.filter(r => r.status !== 'sent'));
  } else {
    console.log(`[chlorine-notifier] Submission email sent to ${sent} recipient(s)`);
  }
  return { sent, failed };
}

/**
 * Check the chlorine sheet for stale data and email an alert if the latest
 * reading is older than STALE_THRESHOLD_HOURS. Deduped so we don't re-send
 * every hour while the data remains stale.
 */
export async function checkStaleChlorine() {
  if (!process.env.CHLORINE_SHEET_ID) return;

  let latest;
  try {
    const credentials = loadGoogleCredentials();
    const sheets = new GoogleSheetsClient(
      credentials,
      process.env.CHLORINE_SHEET_ID,
      process.env.PRODUCTION_SHEET_ID
    );
    latest = await sheets.getLatestChlorineReading();
  } catch (err) {
    console.error('[chlorine-notifier] Stale check failed to read sheet:', err.message);
    return;
  }

  if (!latest || !latest.timestamp) {
    console.warn('[chlorine-notifier] Stale check: no readings in sheet');
    return;
  }

  const lastTs = new Date(latest.timestamp);
  const hoursSince = (Date.now() - lastTs.getTime()) / (1000 * 60 * 60);

  if (hoursSince <= STALE_THRESHOLD_HOURS) return;

  // Dedupe: don't re-alert within the cooldown window
  const lastAlertRaw = getLastStaleAlertAt();
  if (lastAlertRaw) {
    const hoursSinceAlert = (Date.now() - new Date(lastAlertRaw + 'Z').getTime()) / (1000 * 60 * 60);
    if (hoursSinceAlert < STALE_ALERT_COOLDOWN_HOURS) return;
  }

  const resend = getResend();
  if (!resend) {
    console.warn('[chlorine-notifier] Resend not configured, skipping stale alert');
    return;
  }
  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.warn('[chlorine-notifier] CHLORINE_ALERT_RECIPIENTS empty, skipping stale alert');
    return;
  }

  const subject = 'Chlorination Report Not Updated';
  const bodyHtml = `
    <p style="margin:0 0 12px;">The chlorination reporting spreadsheet hasn't been updated in <strong>${Math.round(hoursSince)} hours</strong>.</p>
    <p style="margin:0;color:#6b6b6b;font-size:14px;">Last update: ${escapeHtml(lastTs.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }))}</p>
  `;
  const html = wrapEmail({ subject, bodyHtml, baseUrl: getBaseUrl(), internal: true });

  const results = await Promise.all(
    recipients.map(to => resend.sendOne({ to, subject: `${subject} - Beulah Park`, html }))
  );
  const sent = results.filter(r => r.status === 'sent').length;
  if (sent > 0) {
    markStaleAlertSent();
    console.log(`[chlorine-notifier] Stale alert sent (${Math.round(hoursSince)}h since last reading)`);
  } else {
    console.error('[chlorine-notifier] Stale alert failed to send:', results);
  }
}

/**
 * Start the hourly stale-check scheduler.
 * First run happens one hour after boot — deploying doesn't trigger a
 * fresh alert as a side effect if the sheet happens to be stale.
 */
export function startStaleCheckScheduler() {
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    checkStaleChlorine().catch(err =>
      console.error('[chlorine-notifier] Scheduled stale check failed:', err.message));
  }, ONE_HOUR);
  console.log('[chlorine-notifier] Hourly stale-check scheduler started');
}
