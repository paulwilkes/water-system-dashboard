/**
 * Enhanced YoLink MQTT Listener with Offline/Online Event Tracking
 *
 * Features:
 * - Real-time tank sensor readings via MQTT
 * - Offline detection: logs when a sensor stops reporting
 * - Online detection: logs when a sensor comes back
 * - Event history: saves all state changes to a JSON log
 * - Token auto-refresh every 90 minutes
 * - Hub status tracking
 *
 * Files written:
 *   public/data/tank-readings.json    - Latest sensor readings
 *   public/data/sensor-events.json    - Full event log with offline/online/stale history
 *   public/data/sensor-timeline.json  - Hourly status buckets (7-day rolling window)
 *
 * Run standalone: node lib/yolink-mqtt.js
 * Or imported by server.js via startMQTT()
 */

import mqtt from 'mqtt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ─── Configuration ───────────────────────────────────────────────────────────

// How long without a message before we consider a sensor "stale" (in ms)
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// How long without a message before we consider a sensor "offline" (in ms)
const OFFLINE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// How often to check for offline sensors (in ms)
const OFFLINE_CHECK_INTERVAL_MS = 10 * 60 * 1000; // Every 10 minutes

// Max events to keep in the log (oldest get trimmed)
const MAX_EVENT_LOG_SIZE = 500;

// Token refresh interval (YoLink tokens expire after ~2 hours)
const TOKEN_REFRESH_MS = 90 * 60 * 1000; // 90 minutes

// File paths
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const READINGS_FILE = path.join(DATA_DIR, 'tank-readings.json');
const EVENTS_FILE = path.join(DATA_DIR, 'sensor-events.json');
const TIMELINE_FILE = path.join(DATA_DIR, 'sensor-timeline.json');

// Known tank sensors (for naming)
const TANK_DEVICES = {
  'd88b4c010009063b': { name: 'Tank 2 - Distribution', capacity: 6000 },
  'd88b4c01000bf5ee': { name: 'Tank 3 - Distribution', capacity: 5000 }
};

// MQTT broker config
const BROKER_URL = 'mqtt://api.yosmart.com';
const BROKER_PORT = 8003;
const TOKEN_URL = 'https://api.yosmart.com/open/yolink/token';

// ─── State ───────────────────────────────────────────────────────────────────

let accessToken = null;
let tokenExpiry = 0;

// Track the last time we heard from each sensor
const sensorLastSeen = {};  // { deviceId: { timestamp, name, data } }

// Track current known status of each sensor
const sensorStatus = {};    // { deviceId: 'online' | 'stale' | 'offline' }

// Reference to offline check interval (for cleanup)
let offlineCheckInterval = null;
let tokenRefreshInterval = null;
let heartbeatInterval = null;

// Message counter for diagnostics
let messageCount = 0;
let lastMessageAt = null;

// ─── File I/O Helpers ────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadJsonFile(filepath, defaultValue) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filepath}:`, err.message);
  }
  return defaultValue;
}

function saveJsonFile(filepath, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing ${filepath}:`, err.message);
  }
}

// ─── Timeline (Hourly Buckets) ──────────────────────────────────────────────

function getHourBucketKey(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function updateTimeline(deviceId, status) {
  const timeline = loadJsonFile(TIMELINE_FILE, {});
  const bucketKey = getHourBucketKey();

  if (!timeline[deviceId]) {
    timeline[deviceId] = {};
  }

  timeline[deviceId][bucketKey] = status;

  // Prune buckets older than 7 days
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  for (const key of Object.keys(timeline[deviceId])) {
    if (new Date(key).getTime() < sevenDaysAgo) {
      delete timeline[deviceId][key];
    }
  }

  saveJsonFile(TIMELINE_FILE, timeline);
}

// ─── Token Management ────────────────────────────────────────────────────────

async function getAccessToken() {
  // Return cached token if still valid (with 5 min buffer)
  if (accessToken && Date.now() < tokenExpiry - 300000) {
    return accessToken;
  }

  console.log('Fetching new access token...');
  const credentials = Buffer.from(
    `${process.env.YOLINK_UAC_ID}:${process.env.YOLINK_UAC_SECRET}`
  ).toString('base64');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();
  if (data.access_token) {
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in || 7200) * 1000;
    console.log(`✓ Got access token (expires in ${data.expires_in || 7200}s)`);
    return accessToken;
  }
  throw new Error('Failed to get access token: ' + JSON.stringify(data));
}

// ─── Event Logging ───────────────────────────────────────────────────────────

function loadEventLog() {
  return loadJsonFile(EVENTS_FILE, { events: [], sensors: {} });
}

function saveEventLog(log) {
  if (log.events.length > MAX_EVENT_LOG_SIZE) {
    log.events = log.events.slice(-MAX_EVENT_LOG_SIZE);
  }
  saveJsonFile(EVENTS_FILE, log);
}

function logEvent(type, deviceId, deviceName, details = {}) {
  const eventLog = loadEventLog();

  const event = {
    timestamp: new Date().toISOString(),
    type,            // 'online', 'offline', 'stale', 'startup', 'system', 'hub_offline', 'hub_online'
    deviceId,
    deviceName,
    details
  };

  eventLog.events.push(event);

  // Update per-sensor summary
  if (deviceId && !eventLog.sensors[deviceId]) {
    eventLog.sensors[deviceId] = {
      name: deviceName,
      firstSeen: event.timestamp,
      totalOfflineEvents: 0,
      totalStaleEvents: 0,
      lastOfflineAt: null,
      lastStaleAt: null,
      lastOnlineAt: null,
      lastReading: null,
      currentStatus: 'unknown'
    };
  }

  if (deviceId) {
    const sensor = eventLog.sensors[deviceId];
    sensor.name = deviceName;

    if (type === 'online') {
      sensor.lastOnlineAt = event.timestamp;
      sensor.currentStatus = 'online';
      // Calculate how long the sensor was down (from offline or stale)
      const downSince = sensor.lastOfflineAt || sensor.lastStaleAt;
      if (downSince) {
        const downDuration = new Date(event.timestamp) - new Date(downSince);
        event.details.offlineDurationMs = downDuration;
        event.details.offlineDurationHuman = formatDuration(downDuration);
      }
    } else if (type === 'offline') {
      sensor.lastOfflineAt = event.timestamp;
      sensor.totalOfflineEvents++;
      sensor.currentStatus = 'offline';
    } else if (type === 'stale') {
      sensor.lastStaleAt = event.timestamp;
      sensor.totalStaleEvents = (sensor.totalStaleEvents || 0) + 1;
      sensor.currentStatus = 'stale';
    } else if (type === 'reading') {
      sensor.lastReading = event.timestamp;
      sensor.currentStatus = 'online';
    }
  }

  saveEventLog(eventLog);

  // Console output
  const icon = type === 'online' ? '🟢' : type === 'offline' ? '🔴' : type === 'stale' ? '🟡' : type === 'reading' ? '📊' : '⚙️';
  console.log(`${icon} [${event.timestamp}] ${type.toUpperCase()}: ${deviceName || 'system'} ${deviceId ? `(${deviceId})` : ''}`);
  if (Object.keys(details).length > 0 && type !== 'reading') {
    console.log(`   Details: ${JSON.stringify(details)}`);
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// ─── Offline Detection ───────────────────────────────────────────────────────

function checkForOfflineSensors() {
  const now = Date.now();

  for (const [deviceId, info] of Object.entries(sensorLastSeen)) {
    const timeSinceLastMessage = now - info.timestamp;
    const currentStatus = sensorStatus[deviceId];

    // Check for offline (2 hours)
    if (timeSinceLastMessage > OFFLINE_THRESHOLD_MS && currentStatus !== 'offline') {
      sensorStatus[deviceId] = 'offline';

      const lastBattery = info.data?.battery;
      const possibleCauses = [];

      if (lastBattery !== undefined && lastBattery !== null) {
        if (lastBattery <= 1) {
          possibleCauses.push('Battery critically low (level ' + lastBattery + '/4)');
        } else if (lastBattery <= 2) {
          possibleCauses.push('Battery low (level ' + lastBattery + '/4)');
        }
      }
      possibleCauses.push('Possible: out of hub range, hub offline, or sensor malfunction');

      logEvent('offline', deviceId, info.name || deviceId, {
        lastMessageAt: new Date(info.timestamp).toISOString(),
        silentForMs: timeSinceLastMessage,
        silentForHuman: formatDuration(timeSinceLastMessage),
        lastBatteryLevel: lastBattery,
        lastDepthCm: info.data?.depth,
        possibleCauses
      });

      // Update tank-readings.json to reflect offline status
      const readings = loadJsonFile(READINGS_FILE, {});
      if (readings[deviceId]) {
        readings[deviceId].status = 'offline';
        readings[deviceId].statusChangedAt = new Date().toISOString();
        saveJsonFile(READINGS_FILE, readings);
      }

    // Check for stale (30 minutes) — only if currently online
    } else if (timeSinceLastMessage > STALE_THRESHOLD_MS && currentStatus === 'online') {
      sensorStatus[deviceId] = 'stale';

      logEvent('stale', deviceId, info.name || deviceId, {
        lastMessageAt: new Date(info.timestamp).toISOString(),
        silentForMs: timeSinceLastMessage,
        silentForHuman: formatDuration(timeSinceLastMessage)
      });

      // Update tank-readings.json to reflect stale status
      const readings = loadJsonFile(READINGS_FILE, {});
      if (readings[deviceId]) {
        readings[deviceId].status = 'stale';
        readings[deviceId].statusChangedAt = new Date().toISOString();
        saveJsonFile(READINGS_FILE, readings);
      }
    }

    // Update timeline for this sensor
    updateTimeline(deviceId, sensorStatus[deviceId] || 'unknown');
  }
}

// ─── MQTT Message Processing ─────────────────────────────────────────────────

function processMessage(topic, payload) {
  try {
    const data = JSON.parse(payload.toString());

    // Extract device ID from topic: yl-home/{homeId}/{deviceId}/report
    const topicParts = topic.split('/');
    const deviceId = topicParts[2];

    if (!deviceId) return;

    // Get device name from config or message
    const knownDevice = TANK_DEVICES[deviceId];
    const deviceName = knownDevice?.name || data.data?.name || sensorLastSeen[deviceId]?.name || deviceId;
    const deviceEvent = data.event || '';

    // Track that we heard from this sensor
    const previousStatus = sensorStatus[deviceId];
    const wasDown = previousStatus === 'offline' || previousStatus === 'stale';
    const isFirstMessage = !sensorLastSeen[deviceId];

    sensorLastSeen[deviceId] = {
      timestamp: Date.now(),
      name: deviceName,
      data: data.data || {}
    };
    sensorStatus[deviceId] = 'online';

    // Update timeline to record online status
    updateTimeline(deviceId, 'online');

    // Log state transitions
    if (wasDown) {
      logEvent('online', deviceId, deviceName, {
        previousState: previousStatus,
        battery: data.data?.battery,
        depth: data.data?.depth,
        temperature: data.data?.temperature
      });
    } else if (isFirstMessage) {
      logEvent('startup', deviceId, deviceName, {
        battery: data.data?.battery,
        message: 'First message received since listener started'
      });
    }

    // Process tank sensor readings (WaterDepthSensor)
    if (knownDevice || deviceEvent.includes('WaterDepthSensor') ||
        data.data?.depth !== undefined || data.data?.waterDepth !== undefined) {

      const sensorData = data.data || {};

      // Build the reading object
      const reading = {
        deviceId,
        name: deviceName,
        capacity: knownDevice?.capacity,
        timestamp: new Date().toISOString(),
        status: 'online',
        raw: data
      };

      // Water depth — YoLink may report in mm (waterDepth) or cm (depth)
      if (sensorData.waterDepth !== undefined) {
        reading.level = sensorData.waterDepth / 10; // mm to cm
        reading.levelUnit = 'cm';
      } else if (sensorData.depth !== undefined) {
        reading.level = sensorData.depth;
        reading.levelUnit = 'cm';
      } else if (sensorData.level !== undefined) {
        reading.level = sensorData.level;
        reading.levelUnit = sensorData.unit || 'cm';
      }

      // Battery (YoLink uses 1-4 scale)
      if (sensorData.battery !== undefined) {
        reading.battery = sensorData.battery * 25; // 1=25%, 2=50%, 3=75%, 4=100%
      }

      // Temperature
      if (sensorData.devTemperature !== undefined) {
        reading.temperature = sensorData.devTemperature;
      } else if (sensorData.temperature !== undefined) {
        reading.temperature = sensorData.temperature;
      }

      // Percentage if sensor provides it
      if (sensorData.percent !== undefined) {
        reading.percentage = sensorData.percent;
      }

      // Save to tank-readings.json
      const readings = loadJsonFile(READINGS_FILE, {});
      readings[deviceId] = reading;
      saveJsonFile(READINGS_FILE, readings);

      console.log(`📏 ${deviceName}: depth=${reading.level}cm battery=${reading.battery}%`);
    }

    // Track hub status
    if (deviceEvent.includes('Hub') || data.data?.type === 'Hub') {
      const hubOnline = data.data?.online !== false;
      if (!hubOnline) {
        logEvent('hub_offline', deviceId, deviceName, {
          message: 'Hub reported offline — all sensors may be affected'
        });
      }
    }

  } catch (err) {
    console.error('Error processing MQTT message:', err.message);
  }
}

// ─── Main Connect Function ───────────────────────────────────────────────────

async function connect() {
  console.log('='.repeat(60));
  console.log('YoLink MQTT Tank Monitor (with Offline Tracking)');
  console.log(new Date().toISOString());
  console.log('='.repeat(60));
  console.log(`Stale threshold: ${formatDuration(STALE_THRESHOLD_MS)}`);
  console.log(`Offline threshold: ${formatDuration(OFFLINE_THRESHOLD_MS)}`);
  console.log(`Check interval: ${formatDuration(OFFLINE_CHECK_INTERVAL_MS)}`);
  console.log('');

  // Validate configuration
  if (!process.env.YOLINK_UAC_ID || !process.env.YOLINK_UAC_SECRET) {
    console.error('MQTT: YOLINK_UAC_ID and YOLINK_UAC_SECRET not set — skipping MQTT');
    return;
  }

  if (!process.env.YOLINK_HOME_ID) {
    console.error('MQTT: YOLINK_HOME_ID not set — skipping MQTT');
    return;
  }

  ensureDataDir();

  // Log startup event
  logEvent('system', null, null, { message: 'MQTT listener started' });

  // Get access token
  let token;
  try {
    token = await getAccessToken();
  } catch (error) {
    console.error('MQTT: Failed to get access token:', error.message);
    return;
  }

  const homeId = process.env.YOLINK_HOME_ID;
  const clientId = `water-dashboard-${Date.now()}`;

  console.log(`Connecting to ${BROKER_URL}:${BROKER_PORT}...`);
  console.log(`Client ID: ${clientId}`);
  console.log(`Home ID: ${homeId}`);
  console.log('');

  const client = mqtt.connect(BROKER_URL, {
    port: BROKER_PORT,
    clientId,
    username: token,
    password: '',
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    keepalive: 60
  });

  const topic = `yl-home/${homeId}/+/report`;

  client.on('connect', () => {
    console.log('✅ Connected to YoLink MQTT broker');

    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error('Subscribe error:', err);
      } else {
        console.log(`✅ Subscribed to: ${topic}`);
        console.log('Waiting for tank sensor updates...');
        console.log('(Tank sensors typically report every few minutes or on level change)');
        console.log('');
      }
    });
  });

  client.on('message', (topic, payload) => {
    messageCount++;
    lastMessageAt = new Date().toISOString();
    processMessage(topic, payload);
  });

  client.on('error', (error) => {
    console.error('MQTT Error:', error.message);
  });

  client.on('close', () => {
    console.log('⚠️  MQTT connection closed. Will reconnect...');
  });

  client.on('reconnect', async () => {
    console.log('Reconnecting to MQTT broker...');
    // Always get a fresh token before reconnecting
    try {
      accessToken = null; // Force fresh fetch
      const freshToken = await getAccessToken();
      client.options.username = freshToken;
      console.log('✓ Refreshed token for reconnect');
    } catch (err) {
      console.error('Failed to refresh token for reconnect:', err.message);
    }
  });

  client.on('offline', () => {
    console.log('Client offline');
  });

  // Start offline checking loop
  offlineCheckInterval = setInterval(checkForOfflineSensors, OFFLINE_CHECK_INTERVAL_MS);
  console.log(`Offline checker running every ${formatDuration(OFFLINE_CHECK_INTERVAL_MS)}`);

  // Heartbeat: log connection status every 30 minutes for diagnostics
  heartbeatInterval = setInterval(() => {
    const connected = client.connected;
    const uptime = formatDuration(Date.now() - startTime);
    console.log(`💓 MQTT heartbeat: connected=${connected}, messages=${messageCount}, lastMsg=${lastMessageAt || 'none'}, uptime=${uptime}`);
  }, 30 * 60 * 1000);
  const startTime = Date.now();

  // Token refresh loop — force disconnect/reconnect to re-authenticate
  tokenRefreshInterval = setInterval(async () => {
    try {
      console.log('Token refresh: disconnecting to re-authenticate...');
      accessToken = null; // Force fresh fetch
      const newToken = await getAccessToken();
      client.options.username = newToken;
      // Force a clean disconnect + reconnect so the new token is sent in the CONNECT packet
      client.end(true, {}, () => {
        console.log('✓ Disconnected, reconnecting with fresh token...');
        client.reconnect();
      });
    } catch (err) {
      console.error('Token refresh failed:', err.message);
    }
  }, TOKEN_REFRESH_MS);

  // Graceful shutdown (only register when running standalone)
  const isMainModule = import.meta.url === `file://${process.argv[1]}`;
  if (isMainModule) {
    const shutdown = (signal) => {
      console.log(`\nShutting down MQTT listener (${signal})...`);
      logEvent('system', null, null, { message: `MQTT listener stopped (${signal})` });
      clearInterval(offlineCheckInterval);
      clearInterval(tokenRefreshInterval);
      clearInterval(heartbeatInterval);
      client.end();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Export for use by server.js
export { connect as startMQTT };

// Run standalone if called directly (npm run mqtt)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  connect();
}
