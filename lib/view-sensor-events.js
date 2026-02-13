/**
 * View Sensor Event Log
 *
 * Quick CLI tool to view offline/online history for your tank sensors.
 *
 * Usage:
 *   node lib/view-sensor-events.js              # Show last 20 events
 *   node lib/view-sensor-events.js --all         # Show all events
 *   node lib/view-sensor-events.js --offline     # Show only offline events
 *   node lib/view-sensor-events.js --summary     # Show per-sensor summary
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVENTS_FILE = path.join(__dirname, '..', 'public', 'data', 'sensor-events.json');

function loadEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading events file:', err.message);
  }
  return { events: [], sensors: {} };
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const offlineOnly = args.includes('--offline');
const summaryOnly = args.includes('--summary');

const data = loadEvents();

if (data.events.length === 0) {
  console.log('No events recorded yet. Make sure the MQTT listener is running.');
  console.log('  npm run mqtt');
  process.exit(0);
}

// ─── Summary View ────────────────────────────────────────────────────────────

if (summaryOnly) {
  console.log('');
  console.log('='.repeat(60));
  console.log('SENSOR STATUS SUMMARY');
  console.log('='.repeat(60));

  for (const [deviceId, sensor] of Object.entries(data.sensors)) {
    const statusIcon = sensor.currentStatus === 'online' ? '🟢' :
                       sensor.currentStatus === 'offline' ? '🔴' : '⚪';

    console.log('');
    console.log(`${statusIcon} ${sensor.name} (${deviceId})`);
    console.log(`   Status:          ${sensor.currentStatus}`);
    console.log(`   First seen:      ${formatDate(sensor.firstSeen)}`);
    console.log(`   Last reading:    ${sensor.lastReading ? formatDate(sensor.lastReading) : 'N/A'}`);
    console.log(`   Total offline:   ${sensor.totalOfflineEvents} events`);

    if (sensor.lastOfflineAt) {
      console.log(`   Last offline:    ${formatDate(sensor.lastOfflineAt)}`);
    }
    if (sensor.lastOnlineAt) {
      console.log(`   Last online:     ${formatDate(sensor.lastOnlineAt)}`);
    }
  }

  console.log('');
  console.log(`Total events logged: ${data.events.length}`);
  console.log('');
  process.exit(0);
}

// ─── Event List View ─────────────────────────────────────────────────────────

let events = data.events;

if (offlineOnly) {
  events = events.filter(e => e.type === 'offline' || e.type === 'online');
}

if (!showAll) {
  events = events.slice(-20);
}

console.log('');
console.log('='.repeat(60));
console.log(offlineOnly ? 'OFFLINE/ONLINE EVENTS' : 'SENSOR EVENT LOG');
console.log('='.repeat(60));
console.log('');

for (const event of events) {
  const icon = {
    online: '🟢',
    offline: '🔴',
    reading: '📊',
    startup: '🚀',
    system: '⚙️',
    hub_offline: '📡🔴',
    hub_online: '📡🟢'
  }[event.type] || '❓';

  const name = event.deviceName || event.deviceId || 'system';
  console.log(`${icon} ${formatDate(event.timestamp)} | ${event.type.toUpperCase().padEnd(10)} | ${name}`);

  // Show relevant details for offline/online events
  if (event.type === 'offline' && event.details) {
    if (event.details.silentForHuman) {
      console.log(`   Silent for: ${event.details.silentForHuman}`);
    }
    if (event.details.lastBatteryLevel !== undefined) {
      console.log(`   Last battery: ${event.details.lastBatteryLevel}/4`);
    }
    if (event.details.possibleCauses) {
      event.details.possibleCauses.forEach(c => console.log(`   ⚠️  ${c}`));
    }
  }
  if (event.type === 'online' && event.details?.offlineDurationHuman) {
    console.log(`   Was offline for: ${event.details.offlineDurationHuman}`);
  }
}

console.log('');
console.log(`Showing ${events.length} of ${data.events.length} total events`);
if (!showAll && !offlineOnly) {
  console.log('Use --all for full history, --offline for offline events only, --summary for per-sensor summary');
}
console.log('');
