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

### Public Contact / Board Site
- **Contact page** at `info.beulahparkws.org` (configurable via `PUBLIC_SITE_HOSTNAME`)
  — `public/contact.html`, a no-JS static page so it renders even with scripts off
- Tells customers **who to call for a water leak or emergency**: the local 206
  number (click-to-call / click-to-text), the board roster, and the operator's role
- Edit content directly in `public/contact.html` (search for `EDIT:` markers)

### Inbound SMS (Auto-Reply + Forward to Board)
- Customers can **text the 206 number**; the webhook (`POST /api/sms/incoming`):
  1. **Auto-replies** to the sender ("Message received — a board member will contact you shortly")
  2. **Forwards** the text to board cell phones (`BOARD_SMS_RECIPIENTS`) so a local
     member can respond — ideal for a 2am gushing-pipe call
- **STOP/HELP** keywords are honored for compliance and never forwarded
- Authenticated by validating the **Twilio request signature** (no shared secret needed)
- Inbound messages are logged to the `inbound_messages` table

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

### Twilio inbound SMS setup

1. In the [Twilio Console](https://console.twilio.com/) → your 206 number → **Messaging
   Configuration**, set **"A message comes in"** to:
   `https://dashboard.beulahparkws.org/api/sms/incoming` (HTTP POST).
   *(The webhook works on any of the app's hostnames — pick one Twilio can reach.)*
2. Set `TWILIO_PHONE_NUMBER` to the 206 number and `BOARD_SMS_RECIPIENTS` to the board's
   cell numbers (comma-separated, E.164) via `fly secrets set`.
3. If your number is in a **Messaging Service** with Advanced Opt-Out enabled, Twilio
   handles STOP/HELP before the webhook; otherwise this app handles them itself. Both work.
4. Test by texting the number — you should get the auto-reply and the board should get the forward.

### Public contact site DNS

Point `info.beulahparkws.org` (or whatever `PUBLIC_SITE_HOSTNAME` is set to) at the Fly app
and add the hostname as a Fly cert: `fly certs add info.beulahparkws.org`.

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
