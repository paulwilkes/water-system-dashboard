/**
 * SQLite Database Layer for Alert System
 * Manages subscribers, alerts, and delivery logs
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'alerts.db');

let db;

/**
 * Initialize the database — create tables if they don't exist
 */
export function initDatabase() {
  // Ensure the directory exists before opening the database
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      phone         TEXT NOT NULL UNIQUE,
      zone          TEXT DEFAULT 'all',
      status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('active','pending','opted_out')),
      alert_types   TEXT DEFAULT 'all',
      opted_in_at   TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
    CREATE INDEX IF NOT EXISTS idx_subscribers_zone ON subscribers(zone);
    CREATE INDEX IF NOT EXISTS idx_subscribers_phone ON subscribers(phone);

    CREATE TABLE IF NOT EXISTS alerts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      type            TEXT NOT NULL CHECK(type IN ('repair','outage','boil')),
      message         TEXT NOT NULL,
      zone            TEXT DEFAULT 'all',
      recipient_count INTEGER DEFAULT 0,
      delivered_count INTEGER DEFAULT 0,
      failed_count    INTEGER DEFAULT 0,
      cost_estimate   REAL DEFAULT 0,
      sent_by         TEXT DEFAULT 'admin',
      status          TEXT DEFAULT 'sending'
                        CHECK(status IN ('sending','completed','failed')),
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id        INTEGER NOT NULL REFERENCES alerts(id),
      subscriber_id   INTEGER NOT NULL REFERENCES subscribers(id),
      phone           TEXT NOT NULL,
      twilio_sid      TEXT,
      status          TEXT DEFAULT 'queued'
                        CHECK(status IN ('queued','sent','delivered','failed','undelivered')),
      error_message   TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_alert_log_alert_id ON alert_log(alert_id);
    CREATE INDEX IF NOT EXISTS idx_alert_log_status ON alert_log(status);
  `);

  console.log('Database initialized at', DB_PATH);
  return db;
}

/**
 * Get the raw database instance
 */
export function getDb() {
  return db;
}

// ─── Subscriber Queries ─────────────────────────────────────

/**
 * Get all subscribers with optional filters
 */
export function getAllSubscribers({ search, zone, status } = {}) {
  let sql = 'SELECT * FROM subscribers WHERE 1=1';
  const params = {};

  if (search) {
    sql += ' AND (name LIKE @search OR phone LIKE @search)';
    params.search = `%${search}%`;
  }
  if (zone && zone !== 'all') {
    sql += ' AND zone = @zone';
    params.zone = zone;
  }
  if (status) {
    sql += ' AND status = @status';
    params.status = status;
  }

  sql += ' ORDER BY name ASC';
  return db.prepare(sql).all(params);
}

/**
 * Get active subscribers, optionally filtered by zone
 */
export function getActiveSubscribers(zone) {
  if (zone && zone !== 'all' && zone !== 'All Zones — System Wide') {
    return db.prepare(
      'SELECT * FROM subscribers WHERE status = ? AND zone = ? ORDER BY name'
    ).all('active', zone);
  }
  return db.prepare(
    'SELECT * FROM subscribers WHERE status = ? ORDER BY name'
  ).all('active');
}

/**
 * Get a single subscriber by ID
 */
export function getSubscriberById(id) {
  return db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id);
}

/**
 * Create a new subscriber
 */
export function createSubscriber({ name, phone, zone, status, alert_types }) {
  const normalized = normalizePhone(phone);
  const stmt = db.prepare(`
    INSERT INTO subscribers (name, phone, zone, status, alert_types, opted_in_at)
    VALUES (@name, @phone, @zone, @status, @alert_types, @opted_in_at)
  `);
  const result = stmt.run({
    name,
    phone: normalized,
    zone: zone || 'all',
    status: status || 'pending',
    alert_types: alert_types || 'all',
    opted_in_at: status === 'active' ? new Date().toISOString() : null
  });
  return { id: result.lastInsertRowid, phone: normalized };
}

/**
 * Update an existing subscriber
 */
export function updateSubscriber(id, { name, phone, zone, status, alert_types }) {
  const fields = [];
  const params = { id };

  if (name !== undefined) { fields.push('name = @name'); params.name = name; }
  if (phone !== undefined) { fields.push('phone = @phone'); params.phone = normalizePhone(phone); }
  if (zone !== undefined) { fields.push('zone = @zone'); params.zone = zone; }
  if (status !== undefined) {
    fields.push('status = @status');
    params.status = status;
    if (status === 'active') {
      fields.push("opted_in_at = datetime('now')");
    }
  }
  if (alert_types !== undefined) { fields.push('alert_types = @alert_types'); params.alert_types = alert_types; }

  if (fields.length === 0) return null;

  fields.push("updated_at = datetime('now')");
  const sql = `UPDATE subscribers SET ${fields.join(', ')} WHERE id = @id`;
  return db.prepare(sql).run(params);
}

/**
 * Delete a subscriber
 */
export function deleteSubscriber(id) {
  return db.prepare('DELETE FROM subscribers WHERE id = ?').run(id);
}

/**
 * Get aggregate subscriber statistics
 */
export function getSubscriberStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM subscribers').get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'active'").get().count;
  const pending = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'pending'").get().count;
  const opted_out = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'opted_out'").get().count;

  const zoneRows = db.prepare(
    "SELECT zone, COUNT(*) as count FROM subscribers WHERE status = 'active' GROUP BY zone"
  ).all();
  const byZone = {};
  for (const row of zoneRows) {
    byZone[row.zone] = row.count;
  }

  return { total, active, pending, opted_out, byZone };
}

// ─── Alert Queries ──────────────────────────────────────────

/**
 * Create a new alert record
 */
export function createAlert({ type, message, zone, recipient_count, cost_estimate }) {
  const result = db.prepare(`
    INSERT INTO alerts (type, message, zone, recipient_count, cost_estimate)
    VALUES (@type, @message, @zone, @recipient_count, @cost_estimate)
  `).run({
    type,
    message,
    zone: zone || 'all',
    recipient_count: recipient_count || 0,
    cost_estimate: cost_estimate || 0
  });
  return { id: result.lastInsertRowid };
}

/**
 * Update alert delivery counts and status
 */
export function updateAlertCounts(id, { delivered_count, failed_count, status }) {
  return db.prepare(`
    UPDATE alerts
    SET delivered_count = @delivered_count,
        failed_count = @failed_count,
        status = @status
    WHERE id = @id
  `).run({ id, delivered_count, failed_count, status });
}

/**
 * Get alert history (most recent first)
 */
export function getAlertHistory(limit = 20, offset = 0) {
  return db.prepare(
    'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

/**
 * Get a single alert by ID
 */
export function getAlertById(id) {
  return db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
}

/**
 * Get count of alerts sent this year
 */
export function getAlertsThisYear() {
  const year = new Date().getFullYear();
  return db.prepare(
    "SELECT COUNT(*) as count FROM alerts WHERE created_at >= ? AND status = 'completed'"
  ).get(`${year}-01-01`).count;
}

// ─── Alert Log Queries ──────────────────────────────────────

/**
 * Log a delivery attempt
 */
export function logDelivery({ alert_id, subscriber_id, phone, twilio_sid, status, error_message }) {
  return db.prepare(`
    INSERT INTO alert_log (alert_id, subscriber_id, phone, twilio_sid, status, error_message)
    VALUES (@alert_id, @subscriber_id, @phone, @twilio_sid, @status, @error_message)
  `).run({ alert_id, subscriber_id, phone, twilio_sid, status, error_message: error_message || null });
}

/**
 * Get delivery log for a specific alert
 */
export function getDeliveryLog(alertId) {
  return db.prepare(`
    SELECT al.*, s.name as subscriber_name
    FROM alert_log al
    LEFT JOIN subscribers s ON al.subscriber_id = s.id
    WHERE al.alert_id = ?
    ORDER BY al.created_at ASC
  `).all(alertId);
}

/**
 * Calculate overall delivery rate from last 30 days
 */
export function getDeliveryRate() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END) as delivered
    FROM alert_log
    WHERE created_at >= ?
  `).get(thirtyDaysAgo);

  if (!stats || stats.total === 0) return 100;
  return Math.round((stats.delivered / stats.total) * 100);
}

// ─── Utilities ──────────────────────────────────────────────

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX)
 */
export function normalizePhone(phone) {
  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');

  // If it starts with 1 and is 11 digits, it already has the country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits;
  }
  // If it's 10 digits, add +1
  if (digits.length === 10) {
    return '+1' + digits;
  }
  // Otherwise return as-is with + prefix
  return '+' + digits;
}
