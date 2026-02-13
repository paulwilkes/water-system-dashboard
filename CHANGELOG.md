# Changelog

All notable changes to the Beulah Park Water System Dashboard.

---

## [0.2.0] — 2026-02-12 — SMS Alert System

Added a full SMS alert system with Twilio integration, SQLite database, and an admin UI for sending emergency notifications to subscribers.

### Added
- **Express server** (`server.js`) — serves the dashboard and alert API on a single port
- **SQLite database** (`db/database.js`) — three tables: subscribers, alerts, alert_log
- **Twilio SMS service** (`lib/twilio.js`) — single send, bulk send with rate limiting, cost estimation
- **Subscriber API** (`/api/subscribers`) — full CRUD, search, filtering, aggregate stats
- **Alert API** (`/api/alerts`) — send to all/zone, send test to admin, history, cost estimates
- **Alert admin page** (`public/alerts.html`) — converted from mockup, fully wired to API
  - Send Alert panel with 3 alert types (repair, outage, boil water notice)
  - Live SMS preview with character count and segment/cost estimation
  - Subscriber directory with search, add, and remove
  - Alert history with delivery stats (sent/delivered/failed)
- **"Alerts" button** on the main dashboard header linking to the admin page
- **Seed script** (`db/seed.js`) — sample subscribers and alert history for development
- New dependencies: `express`, `better-sqlite3`, `twilio`
- New npm scripts: `npm start`, `npm run db:seed`

### Architecture
- Phone numbers stored in E.164 format (+1XXXXXXXXXX), displayed as (XXX) XXX-XXXX
- Graceful degradation when Twilio credentials are not configured
- Database auto-initializes on server start (WAL mode, foreign keys enabled)
- No authentication in Phase 1 (local network deployment)

---

## [0.1.0] — 2026-02-12 — Initial Dashboard

The original water system monitoring dashboard with real-time sensor data, chlorine tracking, and production analytics.

### Features
- **Tank level monitoring** — YoLink IoT water depth sensors (REST API + MQTT real-time)
  - 3 tanks: Upper Reservoir (5,000 gal, no sensor), Tank 2 and Tank 3 (2,500 gal each)
  - Donut chart visualization with percentage, gallons, and status
  - Automatic fallback: REST API → MQTT readings → cached data
- **Chlorine tracking** — Google Sheets integration for manual test results
  - Current PPM reading with good/low/warning status indicator
  - 30-day history line chart
  - Data sourced from Google Form submissions
- **Production analytics** — Google Sheets integration for meter readings
  - Recent 6-month bar chart (production vs usage)
  - Multi-year trend line chart (2018–2025)
  - Stats: average production, usage, safety buffer %, growth %
- **Responsive UI** — single-page dashboard with Chart.js, soft gradient design
- **Data pipeline** — `api/refresh-data.js` aggregates all sources into `public/data/current.json`
- **MQTT listener** — `lib/yolink-mqtt.js` for persistent real-time tank updates

### Tech Stack
- Node.js (ESM modules)
- YoLink REST API + MQTT for IoT sensors
- Google Sheets API for chlorine and production data
- Chart.js 4.4.0 for all visualizations
- Pure HTML/CSS/JS frontend (no framework)
