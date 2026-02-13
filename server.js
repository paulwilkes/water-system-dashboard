/**
 * Beulah Park Water System — Express Server
 * Serves the dashboard static files and alert system API
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db/database.js';
import alertRoutes from './api/routes/alerts.js';
import subscriberRoutes from './api/routes/subscribers.js';
import refreshData from './api/refresh-data.js';
import { startMQTT } from './lib/yolink-mqtt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Hostname-based routing for optin subdomain
app.use((req, res, next) => {
  if (req.hostname === 'optin.beulahparkws.org') {
    // Allow the subscriber API (needed for the opt-in form POST)
    if (req.path.startsWith('/api/subscribers')) return next();
    // Allow static assets (CSS, JS, images, data files)
    if (req.path.match(/\.(css|js|png|jpg|svg|ico|json|woff2?)$/)) return next();
    // Everything else → serve opt-in page
    return res.sendFile(path.join(__dirname, 'public', 'opt-in.html'));
  }
  next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/alerts', alertRoutes);
app.use('/api/subscribers', subscriberRoutes);

// API endpoint to trigger a manual refresh
app.get('/api/refresh', async (req, res) => {
  try {
    await refreshData();
    res.json({ message: 'Data refreshed', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Refresh failed: ' + error.message });
  }
});

// Initialize database and start server
initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Water Dashboard server running on port ${PORT}`);

  // Start MQTT listener for real-time tank readings
  console.log('Starting MQTT tank listener...');
  startMQTT().catch(err => console.error('MQTT startup failed:', err.message));

  // Run initial data refresh on startup (with short delay to let MQTT connect)
  setTimeout(() => {
    console.log('Running initial data refresh...');
    refreshData()
      .then(() => console.log('Initial data refresh complete'))
      .catch(err => console.error('Initial data refresh failed:', err.message));
  }, 5000);

  // Refresh data every hour
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    console.log('Running scheduled data refresh...');
    refreshData()
      .then(() => console.log('Scheduled refresh complete'))
      .catch(err => console.error('Scheduled refresh failed:', err.message));
  }, ONE_HOUR);
});
