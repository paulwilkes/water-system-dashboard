# YoLink Integration - Quick Start Guide

## What We Just Built

✅ **YoLink OAuth Client** (`lib/yolink.js`)
- Handles authentication with YoLink API
- Caches access tokens (valid for 2 hours)
- Fetches device list
- Retrieves tank sensor data
- Formats data for dashboard

✅ **Test Script** (`test-yolink.js`)
- Tests OAuth authentication
- Lists all your YoLink devices
- Fetches tank levels
- Shows dashboard-ready data format

✅ **Project Structure**
- Clean separation of concerns
- Ready for Google Sheets integration
- Set up for serverless deployment

## What You Need to Do Now

### Step 1: Get YoLink Credentials (10 minutes)

You need to get OAuth credentials from YoLink. Try these methods:

**Method 1: YoLink Website**
1. Go to https://www.yosmart.com/
2. Log in with your YoLink account
3. Look for "Developer" or "API" section
4. Create an application / get OAuth credentials
5. Copy your Client ID and Client Secret

**Method 2: YoLink App**
- Some users report finding API access in the mobile app
- Check Settings → Advanced → Developer Options

**Method 3: Contact Support**
- Email: support@yosmart.com
- Say: "I need OAuth 2.0 credentials for server-to-server API access"
- Mention you're building a monitoring dashboard

### Step 2: Install & Configure (5 minutes)

```bash
# Navigate to project folder
cd water-dashboard

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your credentials
nano .env
# or
code .env
```

In `.env`:
```
YOLINK_CLIENT_ID=your_actual_client_id_here
YOLINK_CLIENT_SECRET=your_actual_secret_here
```

### Step 3: Test Connection (2 minutes)

```bash
npm run test:yolink
```

**If it works, you'll see:**
- ✅ Access token obtained
- ✅ Device list (your tanks and sensors)
- ✅ Tank levels with percentages
- ✅ Formatted JSON data

**If it fails:**
- Check README.md troubleshooting section
- Verify credentials are correct
- Make sure devices are online in YoLink app

## What's Next

Once YoLink is working, we'll build:

1. **Google Sheets Integration** - Read chlorine & production data
2. **Main Data Refresh Function** - Combine all data sources
3. **Dashboard Frontend** - Apply that beautiful design we made
4. **Automated Refresh** - Schedule hourly updates
5. **Deployment** - Put it live on Vercel

## Tank Sensor Notes

The code currently filters for devices with:
- Type = `WaterMeterController`
- Type = `LeakSensor`  
- Name contains "tank"

If your sensors don't show up, you may need to adjust the filter in `lib/yolink.js` line 106-109 based on what device types you see in the test output.

## File Overview

```
water-dashboard/
├── lib/yolink.js          # YoLink OAuth + API client
├── test-yolink.js         # Test script (run this first!)
├── package.json           # Dependencies
├── .env.example           # Template for credentials
├── .env                   # Your actual credentials (create this!)
├── .gitignore            # Keeps secrets safe
└── README.md             # Full documentation
```

## Questions?

Common issues:
- **401 Unauthorized**: Wrong credentials
- **No tanks found**: Check device type filter
- **Network error**: Check internet connection / firewall

Everything in the README.md file!

---

Ready to test? Run: `npm run test:yolink`
