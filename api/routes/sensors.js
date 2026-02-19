/**
 * Sensor Health API Routes
 * Returns sensor status, 7-day timeline, and uptime statistics
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'public', 'data');

// Known tank sensors (mirrors yolink-mqtt.js)
const TANK_DEVICES = {
  'd88b4c010009063b': { name: 'Tank 2 - Distribution', capacity: 6000 },
  'd88b4c01000bf5ee': { name: 'Tank 3 - Distribution', capacity: 5000 }
};

function loadJson(filepath, defaultValue) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (err) { /* ignore */ }
  return defaultValue;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return 'N/A';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function calculateStats(timeline, events, deviceId) {
  const buckets = Object.entries(timeline);
  const totalBuckets = buckets.length;
  const onlineBuckets = buckets.filter(([, status]) => status === 'online').length;

  const uptimePercent = totalBuckets > 0
    ? Math.round((onlineBuckets / totalBuckets) * 1000) / 10
    : null;

  // Count offline events from the event log
  const sensorOfflineEvents = events.filter(
    e => e.deviceId === deviceId && e.type === 'offline'
  );

  // Get outage durations from online events (which record how long the sensor was down)
  const recoveryEvents = events.filter(
    e => e.deviceId === deviceId && e.type === 'online' && e.details?.offlineDurationMs
  );

  const longestOutageMs = recoveryEvents.length > 0
    ? Math.max(...recoveryEvents.map(e => e.details.offlineDurationMs))
    : 0;

  const avgOutageMs = recoveryEvents.length > 0
    ? recoveryEvents.reduce((sum, e) => sum + e.details.offlineDurationMs, 0) / recoveryEvents.length
    : 0;

  // Count stale events
  const staleEvents = events.filter(
    e => e.deviceId === deviceId && e.type === 'stale'
  );

  return {
    uptimePercent,
    totalOfflineEvents: sensorOfflineEvents.length,
    totalStaleEvents: staleEvents.length,
    longestOutageMs,
    longestOutageHuman: formatDuration(longestOutageMs),
    avgOutageMs,
    avgOutageHuman: formatDuration(avgOutageMs),
    totalBuckets,
    onlineBuckets
  };
}

/**
 * GET /api/sensors/health
 * Returns combined sensor health data: current status, timeline, and stats
 */
router.get('/health', (req, res) => {
  const tankReadings = loadJson(path.join(DATA_DIR, 'tank-readings.json'), {});
  const sensorEvents = loadJson(path.join(DATA_DIR, 'sensor-events.json'), { events: [], sensors: {} });
  const timeline = loadJson(path.join(DATA_DIR, 'sensor-timeline.json'), {});

  const sensors = {};

  for (const [deviceId, config] of Object.entries(TANK_DEVICES)) {
    const reading = tankReadings[deviceId] || {};
    const sensorSummary = sensorEvents.sensors[deviceId] || {};
    const sensorTimeline = timeline[deviceId] || {};

    const stats = calculateStats(sensorTimeline, sensorEvents.events, deviceId);

    sensors[deviceId] = {
      name: config.name,
      deviceId,
      currentStatus: sensorSummary.currentStatus || reading.status || 'unknown',
      battery: reading.battery ?? null,
      temperature: reading.temperature ?? null,
      lastUpdate: reading.timestamp || sensorSummary.lastReading || null,
      level: reading.level ?? null,
      levelUnit: reading.levelUnit || 'cm',
      timeline: sensorTimeline,
      stats
    };
  }

  res.json({
    timestamp: new Date().toISOString(),
    sensors
  });
});

export default router;
