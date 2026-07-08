/**
 * Beulah Park Water System — Express Server
 * Serves the dashboard static files and alert system API
 * Protected by Google OAuth with SQLite-backed allowlist
 */

import express from 'express';
import session from 'express-session';
import SqliteStore from 'better-sqlite3-session-store';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getDb } from './db/database.js';
import { configurePassport } from './lib/passport.js';
import { requireAuth, redirectIfAuthenticated } from './lib/auth.js';
import alertRoutes from './api/routes/alerts.js';
import subscriberRoutes from './api/routes/subscribers.js';
import sensorRoutes from './api/routes/sensors.js';
import emailRoutes, { handleUnsubscribe } from './api/routes/emails.js';
import chlorineRoutes from './api/routes/chlorine.js';
import smsRoutes from './api/routes/sms.js';
import refreshData from './api/refresh-data.js';
import { startMQTT } from './lib/yolink-mqtt.js';
import { startStaleCheckScheduler } from './lib/chlorine-notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Initialize database BEFORE session store (needs the db instance)
initDatabase();

const app = express();
app.set('trust proxy', 1);  // Trust Fly.io reverse proxy (fixes https in OAuth callbacks)
const PORT = process.env.PORT || 3000;

// ── Body Parsing ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Sessions (SQLite-backed) ──
const SqliteStoreSession = SqliteStore(session);

app.use(session({
  store: new SqliteStoreSession({
    client: getDb(),
    expired: { clear: true, intervalMs: 900000 }
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  },
  name: 'bpws.sid'
}));

// ── Passport ──
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// ── Hostname-based routing for optin subdomain ──
// This runs BEFORE auth so the optin subdomain is fully public
app.use((req, res, next) => {
  if (req.hostname === 'optin.beulahparkws.org') {
    // Allow the subscriber API (needed for the opt-in form POST)
    if (req.path.startsWith('/api/subscribers')) return next();
    // Allow static assets (CSS, JS, images, data files)
    if (req.path.match(/\.(css|js|png|jpg|svg|ico|json|woff2?)$/)) return next();
    // Allow privacy and terms pages
    if (req.path === '/privacy.html') return res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
    if (req.path === '/terms.html') return res.sendFile(path.join(__dirname, 'public', 'terms.html'));
    // Everything else → serve opt-in page
    return res.sendFile(path.join(__dirname, 'public', 'opt-in.html'));
  }
  next();
});

// ── Hostname-based routing for the public info site ──
// Fully public (runs before auth). The new BPWS public website (Home,
// Contact & Board, Resources) lives under public/site/. Set
// PUBLIC_SITE_HOSTNAME to the staging subdomain while overhauling.
const PUBLIC_SITE_HOSTNAME = process.env.PUBLIC_SITE_HOSTNAME || 'new.beulahparkws.org';
const sitePage = (name) => path.join(__dirname, 'public', 'site', name);
app.use((req, res, next) => {
  if (req.hostname === PUBLIC_SITE_HOSTNAME) {
    // Static assets (CSS, images, fonts, the hosted PDFs) fall through to express.static
    if (req.path.match(/\.(css|js|png|jpg|jpeg|svg|ico|json|woff2?|pdf)$/)) return next();
    // Page routes
    if (req.path === '/' || req.path === '/home') return res.sendFile(sitePage('home.html'));
    if (req.path === '/leak' || req.path === '/leak.html') return res.sendFile(sitePage('leak.html'));
    if (req.path === '/welcome' || req.path === '/welcome.html') return res.sendFile(sitePage('welcome.html'));
    if (req.path === '/contact' || req.path === '/contact.html') return res.sendFile(sitePage('contact.html'));
    if (req.path === '/resources' || req.path === '/resources.html') return res.sendFile(sitePage('resources.html'));
    if (req.path === '/privacy.html') return res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
    if (req.path === '/terms.html') return res.sendFile(path.join(__dirname, 'public', 'terms.html'));
    // Unknown path on the public host → home
    return res.sendFile(sitePage('home.html'));
  }
  next();
});

// ── OAuth Routes (public) ──
app.get('/auth/google',
  redirectIfAuthenticated,
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login.html?error=unauthorized'
  }),
  (req, res) => {
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

app.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect('/login.html');
    });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, email: req.user.email, name: req.user.name });
});

// ── Login page (public, redirect if already authenticated) ──
app.get('/login.html', redirectIfAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Protected HTML pages (BEFORE express.static so these take priority) ──
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', requireAuth, (req, res) => {
  res.redirect('/');
});

app.get('/alerts.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'alerts.html'));
});

app.get('/sensor-health.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sensor-health.html'));
});

app.get('/emails', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'emails.html'));
});

app.get('/emails.html', requireAuth, (req, res) => {
  res.redirect('/emails');
});

// Public unsubscribe page (no auth) — must be before static so our handler runs
app.get('/unsubscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'unsubscribe.html'));
});

// Public unsubscribe API (no auth) — must be registered BEFORE the protected /api/emails mount
app.post('/api/emails/unsubscribe', handleUnsubscribe);

// Chlorine form webhook (no auth — authenticates via X-Webhook-Secret header)
app.use('/api/chlorine', chlorineRoutes);

// Inbound SMS webhook (no auth — authenticates via Twilio request signature)
app.use('/api/sms', smsRoutes);

// ── Static files (CSS, JS, images, opt-in, privacy, terms, data) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Protected API routes ──
app.use('/api/alerts', requireAuth, alertRoutes);
app.use('/api/subscribers', subscriberRoutes);  // mixed auth handled inside router
app.use('/api/sensors', requireAuth, sensorRoutes);
app.use('/api/emails', requireAuth, emailRoutes);

app.get('/api/refresh', requireAuth, async (req, res) => {
  try {
    await refreshData();
    res.json({ message: 'Data refreshed', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Refresh failed: ' + error.message });
  }
});

// ── Start Server ──
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

  // Hourly check for stale chlorine data → branded board alert via Resend
  startStaleCheckScheduler();
});
