/**
 * Subscriber API Routes
 * CRUD operations for SMS alert subscribers
 */

import { Router } from 'express';
import {
  getAllSubscribers,
  getSubscriberById,
  createSubscriber,
  updateSubscriber,
  deleteSubscriber,
  getSubscriberStats,
  getDeliveryRate,
  getAlertsThisYear
} from '../../db/database.js';
import { requireAuth } from '../../lib/auth.js';
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

const OPT_IN_CONFIRMATION = 'BEULAH PARK WATER SYSTEM: You\'re now subscribed to water service alerts. You\'ll be notified of outages, repairs, and boil water notices. Reply STOP to unsubscribe, HELP for info. Msg & data rates may apply.';

// POST / (opt-in signup) is public; all other routes require auth
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/') return next();
  return requireAuth(req, res, next);
});

/**
 * GET /api/subscribers
 * List subscribers with optional filters: ?search=, ?zone=, ?status=
 */
router.get('/', (req, res) => {
  try {
    const { search, zone, status } = req.query;
    const subscribers = getAllSubscribers({ search, zone, status });
    res.json(subscribers);
  } catch (error) {
    console.error('Error listing subscribers:', error.message);
    res.status(500).json({ error: 'Failed to list subscribers' });
  }
});

/**
 * GET /api/subscribers/stats
 * Aggregate stats for the dashboard stat cards
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getSubscriberStats();
    const deliveryRate = getDeliveryRate();
    const alertsThisYear = getAlertsThisYear();

    // Estimate monthly cost: Twilio number ($1.15/mo) + no per-message cost when idle
    const monthlyCost = 1.15;

    res.json({
      ...stats,
      deliveryRate,
      alertsThisYear,
      monthlyCost
    });
  } catch (error) {
    console.error('Error getting subscriber stats:', error.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/subscribers/:id
 * Get a single subscriber
 */
router.get('/:id', (req, res) => {
  try {
    const subscriber = getSubscriberById(req.params.id);
    if (!subscriber) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }
    res.json(subscriber);
  } catch (error) {
    console.error('Error getting subscriber:', error.message);
    res.status(500).json({ error: 'Failed to get subscriber' });
  }
});

/**
 * POST /api/subscribers
 * Add a new subscriber
 * Body: { name, phone, zone, status }
 */
router.post('/', (req, res) => {
  try {
    const { name, phone, zone, status } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const result = createSubscriber({ name, phone, zone, status });

    // Send opt-in confirmation SMS only if subscriber consented (non-blocking)
    const twilio = getTwilioService();
    if (twilio && status === 'active') {
      twilio.sendSMS(result.phone, OPT_IN_CONFIRMATION)
        .then(smsResult => {
          if (smsResult.error) console.error('Opt-in confirmation SMS failed:', smsResult.error);
          else console.log('Opt-in confirmation SMS sent to', result.phone);
        })
        .catch(err => console.error('Opt-in confirmation SMS error:', err.message));
    }

    res.status(201).json({ id: result.id, phone: result.phone, message: 'Subscriber added' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A subscriber with that phone number already exists' });
    }
    console.error('Error creating subscriber:', error.message);
    res.status(500).json({ error: 'Failed to add subscriber' });
  }
});

/**
 * PUT /api/subscribers/:id
 * Update a subscriber
 * Body: any of { name, phone, zone, status, alert_types }
 */
router.put('/:id', (req, res) => {
  try {
    const existing = getSubscriberById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    updateSubscriber(req.params.id, req.body);
    const updated = getSubscriberById(req.params.id);
    res.json(updated);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A subscriber with that phone number already exists' });
    }
    console.error('Error updating subscriber:', error.message);
    res.status(500).json({ error: 'Failed to update subscriber' });
  }
});

/**
 * DELETE /api/subscribers/:id
 * Remove a subscriber
 */
router.delete('/:id', (req, res) => {
  try {
    const existing = getSubscriberById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    deleteSubscriber(req.params.id);
    res.json({ message: 'Subscriber removed' });
  } catch (error) {
    console.error('Error deleting subscriber:', error.message);
    res.status(500).json({ error: 'Failed to remove subscriber' });
  }
});

export default router;
