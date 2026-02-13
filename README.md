# Beulah Park Water System Dashboard

🌊 A modern, real-time monitoring dashboard for the Beulah Park Water System

## Features

✅ **Real-time Tank Monitoring** - YoLink sensors for water levels (when installed)  
✅ **Chlorine Tracking** - Automatic Google Sheets integration for test results  
✅ **Production Analytics** - Multi-year production vs usage trends  
✅ **Beautiful UI** - Modern, responsive design with soft colors  
✅ **Automated Updates** - Hourly data refresh (configurable)

## Current Status

- ✅ Google Sheets integration working (chlorine + production data)
- ✅ YoLink authentication working (sensors detected online)
- ⚠️ Tank sensor data: YoLink WaterDepthSensor readings require MQTT (future enhancement)
- 📊 Dashboard displays real chlorine and production data

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Your `.env` file should have:

```bash
# YoLink (for tank sensors)
YOLINK_CLIENT_ID=your_client_id
YOLINK_CLIENT_SECRET=your_client_secret

# Google Sheets (for chlorine and production data)
GOOGLE_CREDENTIALS_FILE=./google-credentials.json
CHLORINE_SHEET_ID=your_chlorine_sheet_id
PRODUCTION_SHEET_ID=your_production_sheet_id
```

### 3. Test Integrations

```bash
# Test YoLink connection
npm run test:yolink

# Test Google Sheets
npm run test:sheets
```

### 4. Generate Dashboard Data

```bash
npm run refresh
```

This creates `public/data/current.json` with all your latest data.

### 5. View Dashboard

Open `public/index.html` in your browser, or use a simple server:

```bash
# Option 1: Python
python3 -m http.server 8000 --directory public

# Option 2: Node.js http-server
npx http-server public -p 8000
```

Then open: http://localhost:8000

## Scripts

```bash
npm run refresh        # Fetch all data and update dashboard
npm run test:yolink    # Test YoLink API connection
npm run test:sheets    # Test Google Sheets connection
```

## Project Structure

```
water-dashboard-fixed/
├── api/
│   └── refresh-data.js          # Main data fetching script
├── lib/
│   ├── yolink.js                # YoLink API client
│   └── sheets.js                # Google Sheets client (customized)
├── public/
│   ├── index.html               # Dashboard frontend
│   └── data/
│       └── current.json         # Generated data file
├── test-yolink.js               # YoLink test script
├── test-sheets.js               # Sheets test script
├── package.json
├── .env                         # Your configuration
└── google-credentials.json      # Google service account
```

## Troubleshooting

### "Failed to load data"
- Make sure you've run `npm run refresh` first
- Check that `public/data/current.json` exists

### YoLink sensors show offline
- Verify credentials in `.env`
- Check sensors in YoLink app
- Note: Even when "online", WaterDepthSensor data requires MQTT

### Google Sheets errors
- Verify sheet is shared with service account email
- Check sheet ID in `.env`
- Confirm tab names match: "Form Responses 1" and "System Meters"
- Test with: `npm run test:sheets`

## Support

Created for Beulah Park Water System
