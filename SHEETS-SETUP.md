# Google Sheets Setup Guide

## What You Need

1. ✅ Google Cloud service account (you just created this!)
2. ✅ JSON credentials file (you just downloaded this!)
3. Your Chlorine tracking Google Sheet
4. Your Production/Distribution Google Sheet

## Step-by-Step Setup

### 1. Add Credentials to .env

Open your downloaded JSON file (probably in Downloads folder). It looks like:
```json
{
  "type": "service_account",
  "project_id": "beulah-park-water-dash-...",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "water-dashboard@...iam.gserviceaccount.com",
  "client_id": "...",
  ...
}
```

**Copy the ENTIRE contents** of this file.

Edit your `.env` file and add:
```bash
GOOGLE_CREDENTIALS='paste entire JSON here'
```

**Important:** Put the JSON in single quotes and make sure it's all on one line (or properly formatted).

### 2. Share Your Sheets

Find the `client_email` in your JSON file. It looks like:
```
water-dashboard@beulah-park-water-dashboard.iam.gserviceaccount.com
```

**For your Chlorine tracking sheet:**
1. Open the sheet
2. Click "Share"
3. Paste the service account email
4. Give it "Viewer" permission
5. Uncheck "Notify people" (it's a robot, not a person!)
6. Click "Share"

**Repeat for your Production/Distribution sheet**

### 3. Get Sheet IDs

Open each Google Sheet and look at the URL:
```
https://docs.google.com/spreadsheets/d/1a2B3c4D5e6F7g8H9i0J/edit
                                        ^^^^^^^^^^^^^^^^^^^
                                        This is the Sheet ID
```

Copy each Sheet ID.

### 4. Add Sheet IDs to .env

Edit your `.env` file and add:
```bash
CHLORINE_SHEET_ID=1a2B3c4D5e6F7g8H9i0J
PRODUCTION_SHEET_ID=9k8L7m6N5o4P3q2R1s0T
```

### 5. Test It!

```bash
npm run test:sheets
```

## Expected Sheet Formats

### Chlorine Sheet

The code expects columns in this order:
```
Date | Time | Test Result (ppm) | Notes
```

Example:
```
1/15/2026 | 8:30 AM | 0.85 | Normal
1/16/2026 | 9:00 AM | 0.92 | 
1/17/2026 | 8:45 AM | 0.78 | Slightly low
```

- **Date**: Any format (1/15/2026, Jan 15 2026, etc.)
- **Time**: Optional (8:30 AM, 09:00, etc.)
- **Test Result**: Number with or without "ppm" (0.85, 0.85 ppm, etc.)
- **Notes**: Optional text

The first row can be headers or data - the code will detect.

### Production Sheet

**Option A: Yearly Averages** (Best for the multi-year chart)
```
Year | Avg Daily Production | Avg Daily Distribution
2018 | 11500 | 3050
2019 | 11600 | 3100
2020 | 11800 | 3250
```

**Option B: Monthly Data** (Will be averaged to yearly)
```
Year | Month | Production (gal) | Distribution (gal)
2026 | 1 | 365000 | 130000
2026 | 2 | 336000 | 117000
```

## Troubleshooting

### "Failed to parse GOOGLE_CREDENTIALS"
- Make sure the JSON is valid
- Make sure it's wrapped in quotes
- Try putting it all on one line

### "The caller does not have permission"
- Check that you shared the sheet with the service account email
- Check that the Sheet ID is correct
- Make sure you used the email from `client_email` in the JSON

### "Spreadsheet not found"
- Double-check the Sheet ID in your .env
- Make sure you didn't include extra characters

### "No data found"
- Check that your sheet has data in it
- Make sure the data starts in row 1 (with or without headers)
- Try adjusting the range in `lib/sheets.js` if your data is in a different sheet/tab

## What the Test Shows

When you run `npm run test:sheets`, you should see:

```
============================================================
Google Sheets Integration Test
============================================================

✓ Credentials found in .env
✓ Credentials parsed successfully
  Service Account: water-dashboard@...

TEST 1: Latest Chlorine Reading
------------------------------------------------------------
✓ Latest reading:
  Date: 2/2/2026
  Time: 8:30 AM
  Level: 0.85 ppm
  Status: GOOD

TEST 2: Recent Chlorine Data (Last 30 Days)
------------------------------------------------------------
✓ Found 15 readings in the last 30 days
  First 5 readings:
    1. 1/3/2026 - 0.82 ppm (good)
    2. 1/4/2026 - 0.88 ppm (good)
    ...

TEST 3: Production/Distribution Data
------------------------------------------------------------
✓ Found 9 production records
  Sample records:
    1. 2018: 11500 gal/day (production)
    2. 2019: 11600 gal/day (production)
    ...

TEST 4: Yearly Averages (For Dashboard Chart)
------------------------------------------------------------
✓ Found data for 9 years
  Yearly data:
    2018: Production=11500 gal/day, Distribution=3050 gal/day
    2019: Production=11600 gal/day, Distribution=3100 gal/day
    ...

============================================================
✅ All tests completed!
============================================================
```

Once you see this, Google Sheets integration is working!
