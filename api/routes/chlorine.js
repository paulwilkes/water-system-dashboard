/**
 * Chlorine routes
 *
 * POST /submission: receives POSTs from the Google Form Apps Script trigger on
 * chlorine test submissions and emails the board via Resend (branded,
 * DKIM-signed). Authenticated with a shared secret header, no user session.
 *
 * GET /latest: public. The newest reading for the iOS home-screen widget, which
 * can't log in. Only ppm, status and timestamp: never the submitter, notes or
 * tank readings that sit behind login in /data/current.json.
 */

import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendSubmissionEmail } from '../../lib/chlorine-notifier.js';

const router = Router();

const CURRENT_DATA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'data', 'current.json'
);

router.get('/latest', async (req, res) => {
  let latest;
  try {
    const data = JSON.parse(await fs.readFile(CURRENT_DATA_FILE, 'utf8'));
    latest = data?.chlorine?.latest;
  } catch (err) {
    console.error('[chlorine latest] could not read current data:', err.message);
  }
  if (!latest) {
    return res.status(503).json({ error: 'No chlorine reading available' });
  }
  res.json({ ppm: latest.ppm, status: latest.status, timestamp: latest.timestamp });
});

function constantTimeEqual(a, b) {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post('/submission', async (req, res) => {
  const expected = process.env.CHLORINE_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[chlorine webhook] CHLORINE_WEBHOOK_SECRET not set; rejecting');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  const provided = req.header('X-Webhook-Secret');
  if (!constantTimeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { fields, sheetUrl } = req.body || {};
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Missing fields object' });
  }

  // Acknowledge immediately; send async so Apps Script doesn't wait on Resend.
  res.json({ ok: true });

  sendSubmissionEmail({ fields, sheetUrl })
    .catch(err => console.error('[chlorine webhook] send failed:', err.message));
});

export default router;
