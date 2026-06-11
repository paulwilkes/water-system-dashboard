/**
 * Inbound SMS webhook (Twilio)
 *
 * When a customer texts the water system's number, this endpoint:
 *   1. Auto-replies to the sender ("Message received — a board member will
 *      contact you shortly") via TwiML, so they get an instant acknowledgement.
 *   2. Forwards the message to the board members' cell phones via SMS so a
 *      local person can respond — ideal for the 2am gushing-pipe case.
 *
 * STOP / HELP keywords are handled for SMS compliance and are NOT forwarded.
 *
 * The endpoint is public (Twilio has no session) but is authenticated by
 * validating Twilio's request signature against the account auth token.
 */

import { Router } from 'express';
import Twilio from 'twilio';
import { createTwilioServiceFromEnv } from '../../lib/twilio.js';
import { logInboundMessage, optOutByPhone } from '../../db/database.js';

const router = Router();

// SMS-compliance keywords. Twilio also enforces STOP/HELP at its own layer;
// we mirror it here so opt-outs are recorded and never relayed to the board.
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit']);
const HELP_KEYWORDS = new Set(['help', 'info']);

const AUTO_REPLY =
  'Beulah Park Water: Message received — a board member will contact you shortly. ' +
  'For a life-threatening emergency, call 911.';

const HELP_REPLY =
  'Beulah Park Water System. Text this number to reach the board about water leaks ' +
  'or service issues. For a life-threatening emergency, call 911. Reply STOP to unsubscribe.';

/**
 * Build a TwiML response. With no message, returns an empty (silent) response.
 */
function twiml(message) {
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  if (!message) return `${head}<Response></Response>`;
  const esc = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `${head}<Response><Message>${esc}</Message></Response>`;
}

/**
 * Board cell numbers that receive forwarded texts (comma-separated in env).
 */
function getBoardRecipients() {
  return (process.env.BOARD_SMS_RECIPIENTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Verify the request actually came from Twilio by validating the signature.
 * Can be bypassed for local testing with TWILIO_VALIDATE_SIGNATURE=false.
 */
function isValidTwilioRequest(req) {
  if (process.env.TWILIO_VALIDATE_SIGNATURE === 'false') return true;

  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.header('X-Twilio-Signature');
  if (!token || !signature) return false;

  // Twilio signs the full public URL it POSTed to. Behind Fly's proxy,
  // the original host/proto are preserved (app.set('trust proxy', 1)).
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return Twilio.validateRequest(token, signature, url, req.body || {});
}

/**
 * POST /api/sms/incoming — Twilio inbound message webhook
 */
router.post('/incoming', (req, res) => {
  if (!isValidTwilioRequest(req)) {
    console.warn('[sms] rejected inbound request: invalid Twilio signature');
    return res.status(403).type('text/xml').send(twiml());
  }

  const from = (req.body.From || '').trim();
  const to = (req.body.To || '').trim();
  const body = (req.body.Body || '').trim();
  const messageSid = req.body.MessageSid || null;
  const keyword = body.toLowerCase();

  // ── STOP: honor opt-out, never forward. Twilio sends its own confirmation. ──
  if (STOP_KEYWORDS.has(keyword)) {
    try {
      optOutByPhone(from);
    } catch (err) {
      console.error('[sms] opt-out update failed:', err.message);
    }
    logInboundMessage({ from_number: from, to_number: to, body, message_sid: messageSid, forwarded_count: 0, kind: 'stop' });
    return res.type('text/xml').send(twiml());
  }

  // ── HELP: informational reply, never forward. ──
  if (HELP_KEYWORDS.has(keyword)) {
    logInboundMessage({ from_number: from, to_number: to, body, message_sid: messageSid, forwarded_count: 0, kind: 'help' });
    return res.type('text/xml').send(twiml(HELP_REPLY));
  }

  // ── Everything else: forward to the board + auto-reply to the sender. ──
  const recipients = getBoardRecipients();
  const twilioSvc = createTwilioServiceFromEnv();
  const truncated = body.length > 300 ? body.slice(0, 297) + '…' : body;
  const forwardText =
    `📨 Beulah Park Water — incoming text from ${from}:\n"${truncated}"\n` +
    `Reply directly to that number to respond.`;

  let forwardedCount = 0;
  if (twilioSvc && recipients.length > 0) {
    forwardedCount = recipients.length;
    // Fire-and-forget: don't make the sender wait on board delivery.
    twilioSvc
      .sendBulk(recipients.map((phone, i) => ({ id: i, phone })), forwardText)
      .then(results => {
        const failed = results.filter(r => r.status === 'failed');
        if (failed.length) {
          console.error(`[sms] ${failed.length}/${results.length} board forwards failed`);
        }
      })
      .catch(err => console.error('[sms] board forward failed:', err.message));
  } else {
    console.warn('[sms] inbound not forwarded — no board recipients or Twilio not configured');
  }

  logInboundMessage({ from_number: from, to_number: to, body, message_sid: messageSid, forwarded_count: forwardedCount, kind: 'forward' });

  return res.type('text/xml').send(twiml(AUTO_REPLY));
});

export default router;
