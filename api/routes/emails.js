/**
 * Email Broadcast API Routes
 * - Bidirectional sync with Google Workspace group (customers@beulahparkws.org)
 * - Rich-HTML sends via Resend with branded template
 * - Send history + per-recipient unsubscribe tokens
 */

import { Router } from 'express';
import crypto from 'crypto';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import {
  getGroupMembers,
  replaceGroupMembers,
  upsertGroupMember,
  deleteGroupMember,
  getLastMemberSyncAt,
  createEmailSend,
  updateEmailSendCounts,
  logEmailDelivery,
  getEmailSendHistory,
  createUnsubscribeToken,
  getUnsubscribeToken,
  markUnsubscribeTokenUsed
} from '../../db/database.js';
import GoogleGroupsService from '../../lib/google-groups.js';
import ResendService from '../../lib/resend.js';
import { wrapEmail } from '../../lib/email-template.js';

const router = Router();

// DOMPurify instance for server-side sanitization of Quill HTML
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Quill outputs a constrained set of tags — allow only these
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'a', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote'];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

function sanitize(html) {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false
  });
}

// ── Service getters ────────────────────────────────────────

function getGoogleGroupsService() {
  const {
    GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_WORKSPACE_ADMIN_EMAIL,
    GOOGLE_GROUP_EMAIL
  } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_JSON || !GOOGLE_WORKSPACE_ADMIN_EMAIL || !GOOGLE_GROUP_EMAIL) {
    return null;
  }
  try {
    return new GoogleGroupsService(
      GOOGLE_SERVICE_ACCOUNT_JSON,
      GOOGLE_WORKSPACE_ADMIN_EMAIL,
      GOOGLE_GROUP_EMAIL
    );
  } catch (err) {
    console.error('Failed to init GoogleGroupsService:', err.message);
    return null;
  }
}

function getResendService() {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME } = process.env;
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return null;
  return new ResendService(RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME);
}

function getBaseUrl(req) {
  return process.env.DASHBOARD_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ── Validation ─────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

// ═══════════════════════════════════════════════════════════
// Member routes
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/emails/members
 * Returns the cached member list + last sync timestamp
 */
router.get('/members', (req, res) => {
  try {
    const members = getGroupMembers();
    res.json({
      members,
      count: members.length,
      lastSyncAt: getLastMemberSyncAt()
    });
  } catch (err) {
    console.error('Error listing group members:', err.message);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

/**
 * POST /api/emails/members/sync
 * Fetch fresh list from Google, replace local cache.
 */
router.post('/members/sync', async (req, res) => {
  const google = getGoogleGroupsService();
  if (!google) {
    return res.status(503).json({
      error: 'Google Groups is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_WORKSPACE_ADMIN_EMAIL, and GOOGLE_GROUP_EMAIL in .env'
    });
  }

  try {
    const remote = await google.listMembers();
    replaceGroupMembers(remote);
    res.json({
      members: getGroupMembers(),
      count: remote.length,
      lastSyncAt: getLastMemberSyncAt()
    });
  } catch (err) {
    console.error('Group sync failed:', err.message);
    res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

/**
 * POST /api/emails/members
 * Body: { email }
 * Adds to Google Group, then upserts locally.
 */
router.post('/members', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const google = getGoogleGroupsService();
  if (!google) {
    return res.status(503).json({ error: 'Google Groups is not configured' });
  }

  try {
    const added = await google.addMember(email);
    upsertGroupMember({ email: added.email, role: added.role, google_id: added.id });
    res.json({ member: added });
  } catch (err) {
    console.error(`Failed to add ${email}:`, err.message);
    const msg = err.errors?.[0]?.message || err.message || 'Failed to add member';
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/emails/members/:email
 * Removes from Google Group, then deletes locally.
 */
router.delete('/members/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const google = getGoogleGroupsService();
  if (!google) {
    return res.status(503).json({ error: 'Google Groups is not configured' });
  }

  try {
    await google.removeMember(email);
    deleteGroupMember(email);
    res.json({ email });
  } catch (err) {
    console.error(`Failed to remove ${email}:`, err.message);
    const msg = err.errors?.[0]?.message || err.message || 'Failed to remove member';
    res.status(500).json({ error: msg });
  }
});

// ═══════════════════════════════════════════════════════════
// Compose / send routes
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/emails/preview
 * Body: { subject, bodyHtml }
 * Returns the fully wrapped HTML (for iframe preview). Does NOT send.
 */
router.post('/preview', (req, res) => {
  try {
    const { subject, bodyHtml } = req.body || {};
    if (!subject || !bodyHtml) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }
    const html = wrapEmail({
      subject,
      bodyHtml: sanitize(bodyHtml),
      baseUrl: getBaseUrl(req)
    });
    res.json({ html: html.replaceAll('{{UNSUBSCRIBE_URL}}', '#preview') });
  } catch (err) {
    console.error('Preview failed:', err.message);
    res.status(500).json({ error: 'Failed to build preview' });
  }
});

/**
 * POST /api/emails/test
 * Body: { subject, bodyHtml }
 * Sends only to the currently signed-in admin.
 */
router.post('/test', async (req, res) => {
  try {
    const { subject, bodyHtml } = req.body || {};
    if (!subject?.trim() || !bodyHtml?.trim()) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }
    const resend = getResendService();
    if (!resend) {
      return res.status(503).json({ error: 'Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL in .env' });
    }

    const toEmail = req.user?.email;
    if (!toEmail) {
      return res.status(400).json({ error: 'No signed-in user to send test to' });
    }

    const baseUrl = getBaseUrl(req);
    const token = crypto.randomBytes(24).toString('hex');
    createUnsubscribeToken({ token, email: toEmail, send_id: null });

    const wrapped = wrapEmail({
      subject: `[TEST] ${subject}`,
      bodyHtml: sanitize(bodyHtml),
      baseUrl
    }).replaceAll('{{UNSUBSCRIBE_URL}}', `${baseUrl}/unsubscribe?token=${token}`);

    const result = await resend.sendOne({
      to: toEmail,
      subject: `[TEST] ${subject}`,
      html: wrapped
    });

    if (result.status === 'failed') {
      return res.status(500).json({ error: result.error || 'Send failed' });
    }
    res.json({ message: 'Test email sent', to: toEmail, id: result.id });
  } catch (err) {
    console.error('Test send failed:', err.message);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});

/**
 * POST /api/emails/send
 * Body: { subject, bodyHtml }
 * Sends to every cached group member with per-recipient unsubscribe tokens.
 */
router.post('/send', async (req, res) => {
  try {
    const { subject, bodyHtml } = req.body || {};
    if (!subject?.trim() || !bodyHtml?.trim()) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }

    const members = getGroupMembers();
    if (members.length === 0) {
      return res.status(400).json({ error: 'No group members found. Sync from Google Group first.' });
    }

    const resend = getResendService();
    if (!resend) {
      return res.status(503).json({ error: 'Resend is not configured' });
    }

    const baseUrl = getBaseUrl(req);
    const cleanBody = sanitize(bodyHtml);
    const htmlTemplate = wrapEmail({ subject, bodyHtml: cleanBody, baseUrl });

    // Create send record
    const send = createEmailSend({
      sent_by: req.user?.email || 'unknown',
      subject,
      body_html: cleanBody,
      recipient_count: members.length
    });

    // Generate a unique token per recipient and build the recipient list
    const recipients = members.map(m => {
      const token = crypto.randomBytes(24).toString('hex');
      createUnsubscribeToken({ token, email: m.email, send_id: send.id });
      return {
        email: m.email,
        unsubscribeUrl: `${baseUrl}/unsubscribe?token=${token}`
      };
    });

    const results = await resend.sendBulk({ subject, htmlTemplate, recipients });

    let delivered = 0;
    let failed = 0;
    for (const r of results) {
      logEmailDelivery({
        send_id: send.id,
        email: r.email,
        resend_id: r.id,
        status: r.status,
        error_message: r.error
      });
      if (r.status === 'failed') failed++;
      else delivered++;
    }

    updateEmailSendCounts(send.id, {
      delivered_count: delivered,
      failed_count: failed,
      status: failed === members.length ? 'failed' : 'completed'
    });

    res.json({
      send_id: send.id,
      subject,
      recipient_count: members.length,
      delivered_count: delivered,
      failed_count: failed,
      status: failed === members.length ? 'failed' : 'completed'
    });
  } catch (err) {
    console.error('Email send failed:', err.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

/**
 * GET /api/emails/history?limit=20&offset=0
 */
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    res.json(getEmailSendHistory(limit, offset));
  } catch (err) {
    console.error('Error loading email history:', err.message);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// ═══════════════════════════════════════════════════════════
// Unsubscribe (mounted separately as a public endpoint in server.js)
// ═══════════════════════════════════════════════════════════

/**
 * Public handler: POST /api/emails/unsubscribe
 * Body: { token }
 * Removes the member from the Google Group and marks the token used.
 */
export async function handleUnsubscribe(req, res) {
  try {
    const token = (req.body?.token || req.query?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }
    const row = getUnsubscribeToken(token);
    if (!row) {
      return res.status(404).json({ error: 'Invalid or expired link' });
    }
    if (row.used_at) {
      return res.json({ email: row.email, alreadyUnsubscribed: true });
    }

    const google = getGoogleGroupsService();
    if (google) {
      try {
        await google.removeMember(row.email);
      } catch (err) {
        // If the member was already removed, treat as success
        const msg = err.errors?.[0]?.message || err.message || '';
        if (!/not.*found|does not exist/i.test(msg)) {
          console.error(`Unsubscribe removal failed for ${row.email}:`, msg);
          return res.status(500).json({ error: 'Failed to unsubscribe. Please contact us directly.' });
        }
      }
    }

    deleteGroupMember(row.email);
    markUnsubscribeTokenUsed(token);
    res.json({ email: row.email, unsubscribed: true });
  } catch (err) {
    console.error('Unsubscribe error:', err.message);
    res.status(500).json({ error: 'Unsubscribe failed' });
  }
}

export default router;
