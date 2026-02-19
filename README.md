# Beulah Park Water System Dashboard

A real-time monitoring dashboard and SMS alert system for the Beulah Park Water System. Built with Node.js, Express, and Chart.js, deployed on Fly.io.

## Features

### Dashboard (Google OAuth protected)
- **Real-Time Tank Monitoring** — YoLink IoT water depth sensors with MQTT live updates
  - 3 tanks with donut chart visualization, percentage, gallons, and online/offline status
  - Automatic fallback: REST API → MQTT readings → cached data
- **Chlorine Tracking** — Google Sheets integration for manual test results
  - Current PPM reading with good/low/warning status indicator
  - 30-day history line chart
- **Production Analytics** — Monthly and multi-year production vs usage trends
  - 6-month bar chart and multi-year trend line (2018–present)
  - Average production, usage, safety buffer %, and growth stats
- **Distribution Leak Analysis** — Quarterly comparison of distribution meter vs house meter usage
  - Bar chart and loss-percentage trend line (Oct 2024 onward)
- **Automated Hourly Refresh** — Data pipeline aggregates YoLink + Google Sheets on a schedule

### SMS Alert System (Admin panel)
- **4 Alert Types** — Repair, Outage, Boil Water Notice, Boil Notice Lifted
- **Bulk SMS via Twilio** — Rate-limited sending with real-time cost estimation
- **Subscriber Management** — Full CRUD with search, status filtering (active/pending/opted out)
- **Delivery Tracking** — Per-recipient delivery log with Twilio SID and error details
- **Alert History** — Paginated history with delivery stats per alert

### Public SMS Opt-In
- **Opt-in page** at `optin.beulahparkws.org` — Public signup form for SMS alerts
- **Privacy Policy & Terms** — Twilio-compliant legal pages

### Security & Authentication
- **Google OAuth 2.0** — Email-based allowlist stored in SQLite
- **Protected routes** — Dashboard and alerts require authentication
- **Session management** — SQLite-backed sessions with 7-day duration

## Tech Stack

- **Backend:** Node.js (ESM), Express, SQLite (better-sqlite3)
- **Frontend:** Vanilla HTML/CSS/JS, Chart.js 4.4.0
- **IoT:** YoLink REST API + MQTT for real-time tank sensors
- **Data:** Google Sheets API for chlorine and production data
- **SMS:** Twilio for subscriber alerts
- **Auth:** Google OAuth 2.0 with Passport.js
- **Hosting:** Fly.io with persistent SQLite storage

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` and fill in your credentials:

```bash
# YoLink IoT sensors
YOLINK_CLIENT_ID=...
YOLINK_CLIENT_SECRET=...
YOLINK_UAC_ID=...
YOLINK_HOME_ID=...

# Google Sheets (chlorine + production data)
GOOGLE_CREDENTIALS_FILE=./google-credentials.json
CHLORINE_SHEET_ID=...
PRODUCTION_SHEET_ID=...

# Google OAuth (dashboard login)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Twilio SMS
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
ADMIN_PHONE_NUMBER=...

# Session & database
SESSION_SECRET=...          # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DB_PATH=./data/alerts.db
PORT=3000
```

### 3. Start the Server

```bash
npm start
```

The server runs on `http://localhost:3000` and will:
- Initialize the SQLite database
- Start the MQTT listener for real-time tank data
- Run an initial data refresh
- Schedule hourly data refreshes

### 4. Test Integrations

```bash
npm run test:yolink    # Test YoLink API connection
npm run test:sheets    # Test Google Sheets connection
```

## Scripts

```bash
npm start              # Start Express server (port 3000)
npm run refresh        # Manually fetch all data and update dashboard
npm run mqtt           # Start standalone MQTT listener
npm run db:seed        # Populate sample data for development
npm run sensor-events  # View MQTT sensor event history
npm run test:yolink    # Test YoLink API connection
npm run test:sheets    # Test Google Sheets connection
```

## Project Structure

```
water-dashboard/
├── server.js                    # Express server with auth, API routes, MQTT
├── api/
│   ├── refresh-data.js          # Data aggregation pipeline (YoLink + Sheets)
│   └── routes/
│       ├── alerts.js            # Alert send/history API endpoints
│       └── subscribers.js       # Subscriber CRUD API endpoints
├── db/
│   ├── database.js              # SQLite schema & query layer
│   └── seed.js                  # Sample data for development
├── lib/
│   ├── auth.js                  # Authentication middleware
│   ├── passport.js              # Google OAuth strategy
│   ├── twilio.js                # Twilio SMS service
│   ├── yolink.js                # YoLink REST API client
│   ├── yolink-mqtt.js           # Real-time MQTT tank listener
│   └── sheets.js                # Google Sheets API client
├── public/
│   ├── index.html               # Dashboard (protected)
│   ├── alerts.html              # Alert admin panel (protected)
│   ├── login.html               # Google OAuth login page
│   ├── opt-in.html              # Public SMS signup form
│   ├── privacy.html             # Privacy policy
│   ├── terms.html               # SMS terms & conditions
│   ├── images/
│   │   └── bpws-logo.png        # System logo
│   └── data/
│       ├── current.json         # Aggregated dashboard data
│       ├── tank-readings.json   # Real-time MQTT tank readings
│       └── sensor-events.json   # Sensor offline/online event log
├── fly.toml                     # Fly.io deployment config
├── .env                         # Environment variables (not committed)
└── google-credentials.json      # Google service account key (not committed)
```

## Deployment

Deployed on Fly.io with:
- Persistent SQLite storage mounted at `/data`
- 512MB RAM, 1 shared CPU
- Force HTTPS with automatic TLS
- Subdomain routing for `optin.beulahparkws.org`

```bash
fly deploy
```

## Troubleshooting

### "Failed to load data"
- Make sure the server is running (`npm start`)
- Check that `public/data/current.json` exists
- Try a manual refresh: `npm run refresh`

### YoLink sensors show offline
- Verify credentials in `.env`
- Check sensors in the YoLink app
- MQTT listener must be running for real-time updates

### Google Sheets errors
- Verify sheet is shared with the service account email
- Check sheet IDs in `.env`
- Confirm tab names match: "Form Responses 1" and "System Meters"
- Test with: `npm run test:sheets`

### OAuth login issues
- Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Verify the redirect URI matches your deployment URL
- Check that the user's email is in the `allowed_users` table

## Support

Created for Beulah Park Water System
