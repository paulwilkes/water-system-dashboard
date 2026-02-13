/**
 * Seed Script — Populates the database with sample subscribers for development
 * Run with: npm run db:seed
 */

import dotenv from 'dotenv';
import { initDatabase, createSubscriber, createAlert, logDelivery, updateAlertCounts, getDb } from './database.js';

dotenv.config();

initDatabase();
const db = getDb();

console.log('Seeding database...\n');

// Clear existing data
db.exec('DELETE FROM alert_log; DELETE FROM alerts; DELETE FROM subscribers;');

// Sample subscribers
const subscribers = [
  { name: 'Martha Henderson', phone: '(555) 234-5678', zone: 'Zone 1', status: 'active' },
  { name: 'James Whitfield', phone: '(555) 345-6789', zone: 'Zone 2', status: 'active' },
  { name: 'Sarah Mitchell', phone: '(555) 456-7890', zone: 'Zone 1', status: 'pending' },
  { name: 'Robert Chen', phone: '(555) 567-8901', zone: 'Zone 3', status: 'active' },
  { name: 'Linda Blackwood', phone: '(555) 678-9012', zone: 'Zone 2', status: 'opted_out' },
  { name: 'Tom Reardon', phone: '(555) 789-0123', zone: 'Zone 1', status: 'active' },
  { name: 'Nancy Graves', phone: '(555) 890-1234', zone: 'Zone 3', status: 'active' },
  { name: 'Bill Patterson', phone: '(555) 901-2345', zone: 'Zone 2', status: 'active' },
  { name: 'Carol Dunn', phone: '(555) 012-3456', zone: 'Zone 1', status: 'active' },
  { name: 'David Kowalski', phone: '(555) 123-4567', zone: 'Zone 3', status: 'active' },
];

for (const sub of subscribers) {
  const result = createSubscriber(sub);
  console.log(`  Added subscriber: ${sub.name} (${result.phone})`);
}

// Sample alert history — insert directly to set custom timestamps
db.prepare(`
  INSERT INTO alerts (type, message, zone, recipient_count, delivered_count, failed_count, cost_estimate, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'boil',
  'BOIL WATER NOTICE — Beulah Park Water System has issued a precautionary boil water advisory for all zones. Please boil tap water for at least 1 minute before drinking or cooking until further notice.',
  'all', 8, 7, 1, 0.13, 'completed', '2026-01-28T15:42:00.000Z'
);

db.prepare(`
  INSERT INTO alerts (type, message, zone, recipient_count, delivered_count, failed_count, cost_estimate, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'boil',
  'ALL CLEAR — The boil water advisory for Beulah Park has been lifted. Bacteriological test results came back clean. Water is safe to use.',
  'all', 8, 8, 0, 0.06, 'completed', '2026-01-30T10:15:00.000Z'
);

db.prepare(`
  INSERT INTO alerts (type, message, zone, recipient_count, delivered_count, failed_count, cost_estimate, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'repair',
  'WATER MAIN REPAIR — Zone 2 (Hilltop). Scheduled repair to replace aging valve at Hilltop Rd and Pine St. Service interrupted 8am-2pm.',
  'Zone 2', 3, 3, 0, 0.02, 'completed', '2025-12-12T07:01:00.000Z'
);

console.log('\n  Added 3 sample alerts to history');
console.log('\nSeed complete!');
