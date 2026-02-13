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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/alerts', alertRoutes);
app.use('/api/subscribers', subscriberRoutes);

// Initialize database and start server
initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Water Dashboard server running on port ${PORT}`);
});
