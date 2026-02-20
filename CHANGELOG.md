# Changelog

All notable changes to the Beulah Park Water System Dashboard.

---

## [0.5.1] — 2026-02-20 — Tank Meter Calibration

Updated tank level calibration from a shared height constant to per-tank values so the dashboard percentages match actual fill levels.

### Changed
- **Per-tank calibration** in `api/refresh-data.js` — Tank 2 height calibrated to 32.63 cm, Tank 3 to 34.53 cm (previously both used 39 cm)
- Both tanks now read 95% at current sensor depths (was 79% and 84%)
- Calibration applies to both the main data path and the MQTT fallback path

---

## [0.5.0] — 2026-02-18 — Google OAuth & Distribution Leak Analysis

Added Google OAuth authentication with an email allowlist to secure the dashboard, and a new distribution leak analysis chart to help identify water loss in the system.

### Added
- **Google OAuth login** (`lib/passport.js`) — email-based allowlist stored in SQLite `allowed_users` table
- **Login page** (`public/login.html`) — branded sign-in page with pixel art background
- **Session management** — SQLite-backed sessions with 7-day duration and secure cookies
- **Distribution leak analysis chart** on dashboard — compares distribution meter vs house meter usage quarterly
  - Bar chart (usage comparison) and trend line (loss % over time)
  - Filtered to Oct 2024 onward for relevant data
  - Status indicator and detailed stats grid

### Changed
- All dashboard and alert pages now require authentication
- Send alert buttons temporarily disabled pending Twilio campaign approval

### Fixed
- OAuth redirect URI using `http` instead of `https` behind Fly.io reverse proxy (trust proxy setting)

---

## [0.4.0] — 2026-02-15 — Twilio Compliance & Legal Pages

Added privacy policy and terms pages required for Twilio toll-free number verification.

### Added
- **Privacy Policy page** (`public/privacy.html`) — data collection and usage disclosures
- **SMS Terms & Conditions page** (`public/terms.html`) — message rates, carrier charges, opt-out instructions
- Links from opt-in page to both legal documents

---

## [0.3.0] — 2026-02-13 — Public Opt-In, Branding & Infrastructure

Added a public SMS opt-in page for Twilio toll-free verification, unified the branding across all pages, and hardened the Fly.io deployment for production reliability.

### Added
- **Public SMS opt-in page** (`public/opt-in.html`) — subscriber signup form for Twilio verification
- **Subdomain routing** — `optin.beulahparkws.org` serves the opt-in page, privacy policy, and terms only
- **"Boil Notice Lifted" alert type** — all-clear message option for the alert system
- **BPWS favicon** on all pages
- **BPWS leaf logo** in all page headers (replaced water droplet emoji)
- **Offline/online sensor tracking** in MQTT listener — logs sensor status changes to `sensor-events.json`

### Changed
- Unified dashboard and alerts page design — shared header, navigation tabs, fonts (DM Sans), and color palette
- Tank 1 (Upper Reservoir) capacity corrected to 1,500 gal
- Removed zone selector from opt-in page and alerts page (only 40 connections, zones unnecessary)
- Removed redundant test button from alerts page

### Fixed
- **MQTT token refresh** — disconnect and reconnect to re-authenticate (fixes stale token issue)
- **Fly.io VM memory** bumped to 512MB to prevent OOM crashes

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
