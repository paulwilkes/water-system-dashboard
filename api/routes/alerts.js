/**
 * Alert API Routes
 * Send alerts, test messages, and view history
 */

import { Router } from 'express';
import {
  getActiveSubscribers,
  createAlert,
  updateAlertCounts,
  getAlertHistory,
  getAlertById,
  logDelivery,
  getDeliveryLog
} from '../../db/database.js';
import TwilioService from '../../lib/twilio.js';

const router = Router();

/**
 * Get a configured TwilioService instance
 */
function getTwilioService() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return null;
  }
  return new TwilioService(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER);
}

/**
 * POST /api/alerts/send
 * Send an alert to subscribers
 * Body: { type, message }
 */
router.post('/send', async (req, res) => {
  try {
    const { type, message } = req.body;

    // Validate
    if (!type || !['repair', 'outage', 'boil', 'boil_lifted'].includes(type)) {
      return res.status(400).json({ error: 'Invalid alert type. Must be repair, outage, boil, or boil_lifted.' });
    }
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get all active recipients
    const subscribers = getActiveSubscribers();
    if (subscribers.length === 0) {
      return res.status(400).json({ error: 'No active subscribers found' });
    }

    // Estimate cost
    const costEstimate = TwilioService.estimateCost(message.length, subscribers.length);

    // Create alert record
    const alert = createAlert({
      type,
      message,
      zone: 'all',
      recipient_count: subscribers.length,
      cost_estimate: costEstimate.totalCost
    });

    // Check Twilio configuration
    const twilio = getTwilioService();
    if (!twilio) {
      // No Twilio credentials — log the alert but don't actually send
      updateAlertCounts(alert.id, {
        delivered_count: 0,
        failed_count: subscribers.length,
        status: 'failed'
      });

      // Still log each intended recipient
      for (const sub of subscribers) {
        logDelivery({
          alert_id: alert.id,
          subscriber_id: sub.id,
          phone: sub.phone,
          twilio_sid: null,
          status: 'failed',
          error_message: 'Twilio not configured'
        });
      }

      return res.status(503).json({
        error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env',
        alert_id: alert.id,
        recipients: subscribers.length
      });
    }

    // Send messages
    const recipients = subscribers.map(s => ({ id: s.id, phone: s.phone }));
    const results = await twilio.sendBulk(recipients, message);

    // Log each delivery
    let delivered = 0;
    let failed = 0;
    for (const result of results) {
      logDelivery({
        alert_id: alert.id,
        subscriber_id: result.subscriber_id,
        phone: result.phone,
        twilio_sid: result.twilio_sid,
        status: result.status,
        error_message: result.error_message
      });
      if (result.status === 'failed') failed++;
      else delivered++;
    }

    // Update alert record
    updateAlertCounts(alert.id, {
      delivered_count: delivered,
      failed_count: failed,
      status: 'completed'
    });

    res.json({
      alert_id: alert.id,
      type,
      recipient_count: subscribers.length,
      delivered_count: delivered,
      failed_count: failed,
      cost_estimate: costEstimate.totalCost,
      status: 'completed'
    });
  } catch (error) {
    console.error('Error sending alert:', error.message);
    res.status(500).json({ error: 'Failed to send alert' });
  }
});

/**
 * POST /api/alerts/test
 * Send a test message to the admin phone number only
 * Body: { message }
 */
router.post('/test', async (req, res) => {
  try {
    const { message } = req.body;
    const adminPhone = process.env.ADMIN_PHONE_NUMBER;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (!adminPhone) {
      return res.status(503).json({ error: 'ADMIN_PHONE_NUMBER not configured in .env' });
    }

    const twilio = getTwilioService();
    if (!twilio) {
      return res.status(503).json({ error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env' });
    }

    const result = await twilio.sendSMS(adminPhone, `[TEST] ${message}`);

    if (result.error) {
      return res.status(500).json({ error: `Failed to send test: ${result.error}` });
    }

    res.json({ message: 'Test message sent', sid: result.sid, status: result.status });
  } catch (error) {
    console.error('Error sending test alert:', error.message);
    res.status(500).json({ error: 'Failed to send test message' });
  }
});

/**
 * GET /api/alerts/history
 * Get past alerts with delivery stats
 * Query: ?limit=20&offset=0
 */
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const alerts = getAlertHistory(limit, offset);
    res.json(alerts);
  } catch (error) {
    console.error('Error getting alert history:', error.message);
    res.status(500).json({ error: 'Failed to get alert history' });
  }
});

/**
 * GET /api/alerts/:id
 * Get a single alert with its full delivery log
 */
router.get('/:id', (req, res) => {
  try {
    const alert = getAlertById(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const deliveryLog = getDeliveryLog(alert.id);
    res.json({ ...alert, deliveryLog });
  } catch (error) {
    console.error('Error getting alert:', error.message);
    res.status(500).json({ error: 'Failed to get alert' });
  }
});

/**
 * POST /api/alerts/estimate
 * Get cost estimate without sending
 * Body: { message }
 */
router.post('/estimate', (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const subscribers = getActiveSubscribers();
    const estimate = TwilioService.estimateCost(message.length, subscribers.length);

    res.json({
      recipientCount: subscribers.length,
      ...estimate
    });
  } catch (error) {
    console.error('Error calculating estimate:', error.message);
    res.status(500).json({ error: 'Failed to calculate estimate' });
  }
});

export default router;
