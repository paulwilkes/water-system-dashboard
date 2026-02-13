/**
 * Test script for Google Sheets integration
 * 
 * Usage:
 * 1. Add GOOGLE_CREDENTIALS to .env (the JSON file contents)
 * 2. Add CHLORINE_SHEET_ID and PRODUCTION_SHEET_ID to .env
 * 3. Share both sheets with the service account email
 * 4. Run: npm run test:sheets
 */

import dotenv from 'dotenv';
import GoogleSheetsClient from './lib/sheets.js';

// Load environment variables
dotenv.config();

async function testGoogleSheets() {
  console.log('='.repeat(60));
  console.log('Google Sheets Integration Test');
  console.log('='.repeat(60));
  console.log('');

  // Check for credentials
  if (!process.env.GOOGLE_CREDENTIALS && !process.env.GOOGLE_CREDENTIALS_FILE) {
    console.error('❌ Missing Google credentials!');
    console.error('Please set GOOGLE_CREDENTIALS or GOOGLE_CREDENTIALS_FILE in .env file');
    console.error('');
    console.error('Option 1 - File path:');
    console.error('  GOOGLE_CREDENTIALS_FILE=./google-credentials.json');
    console.error('');
    console.error('Option 2 - Inline JSON:');
    console.error('  GOOGLE_CREDENTIALS=\'{"type":"service_account",...}\'');
    process.exit(1);
  }

  if (!process.env.CHLORINE_SHEET_ID) {
    console.error('❌ Missing CHLORINE_SHEET_ID!');
    console.error('Please set CHLORINE_SHEET_ID in .env file');
    console.error('');
    console.error('To find the Sheet ID:');
    console.error('1. Open your chlorine tracking sheet');
    console.error('2. Look at the URL: .../spreadsheets/d/SHEET_ID/edit');
    console.error('3. Copy the SHEET_ID part');
    process.exit(1);
  }

  if (!process.env.PRODUCTION_SHEET_ID) {
    console.error('❌ Missing PRODUCTION_SHEET_ID!');
    console.error('Please set PRODUCTION_SHEET_ID in .env file');
    console.error('(Same process as CHLORINE_SHEET_ID)');
    process.exit(1);
  }

  console.log('✓ Credentials found in .env');
  console.log('');

  // Parse credentials
  let credentials;
  try {
    // Try to load from file first
    if (process.env.GOOGLE_CREDENTIALS_FILE) {
      const fs = await import('fs');
      const credentialsText = fs.readFileSync(process.env.GOOGLE_CREDENTIALS_FILE, 'utf8');
      credentials = JSON.parse(credentialsText);
    } else {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    }
  } catch (error) {
    console.error('❌ Failed to parse GOOGLE_CREDENTIALS');
    console.error('Make sure the JSON is valid and properly formatted');
    console.error('Error:', error.message);
    process.exit(1);
  }

  try {
    console.log('✓ Credentials parsed successfully');
    console.log(`  Service Account: ${credentials.client_email}`);
    console.log('');
    console.log('⚠️  Make sure you shared both sheets with this email!');
    console.log('');

    // Initialize client
    const client = new GoogleSheetsClient(
      credentials,
      process.env.CHLORINE_SHEET_ID,
      process.env.PRODUCTION_SHEET_ID
    );

    // Test 1: Get latest chlorine reading
    console.log('TEST 1: Latest Chlorine Reading');
    console.log('-'.repeat(60));
    try {
      const latest = await client.getLatestChlorineReading();
      if (latest) {
        console.log('✓ Latest reading:');
        console.log(`  Date: ${latest.date}`);
        console.log(`  Time: ${latest.time}`);
        console.log(`  Level: ${latest.ppm} ppm`);
        console.log(`  Status: ${latest.status.toUpperCase()}`);
        if (latest.notes) {
          console.log(`  Notes: ${latest.notes}`);
        }
      } else {
        console.log('⚠️  No chlorine data found');
        console.log('   Check that your sheet has data and is shared correctly');
      }
    } catch (error) {
      console.error('❌ Failed to fetch chlorine data');
      console.error('   Error:', error.message);
      if (error.message.includes('permission')) {
        console.error('   → Did you share the sheet with the service account?');
      }
      if (error.message.includes('not found')) {
        console.error('   → Is the CHLORINE_SHEET_ID correct?');
      }
    }
    console.log('');

    // Test 2: Get recent chlorine data (last 30 days)
    console.log('TEST 2: Recent Chlorine Data (Last 30 Days)');
    console.log('-'.repeat(60));
    try {
      const recent = await client.getRecentChlorineData(30);
      console.log(`✓ Found ${recent.length} readings in the last 30 days`);
      if (recent.length > 0) {
        console.log('  First 5 readings:');
        recent.slice(0, 5).forEach((reading, i) => {
          console.log(`    ${i + 1}. ${reading.date} - ${reading.ppm} ppm (${reading.status})`);
        });
      }
    } catch (error) {
      console.error('❌ Failed to fetch recent chlorine data');
      console.error('   Error:', error.message);
    }
    console.log('');

    // Test 3: Get production data
    console.log('TEST 3: Production/Distribution Data');
    console.log('-'.repeat(60));
    try {
      const production = await client.getProductionData();
      console.log(`✓ Found ${production.length} production records`);
      if (production.length > 0) {
        console.log('  Sample records:');
        production.slice(0, 5).forEach((record, i) => {
          console.log(`    ${i + 1}. ${record.year} ${record.monthName}: ${record.production.toLocaleString()} gal produced, ${record.usage?.toLocaleString() || 'N/A'} gal used`);
        });
      }
    } catch (error) {
      console.error('❌ Failed to fetch production data');
      console.error('   Error:', error.message);
      if (error.message.includes('permission')) {
        console.error('   → Did you share the sheet with the service account?');
      }
      if (error.message.includes('not found')) {
        console.error('   → Is the PRODUCTION_SHEET_ID correct?');
      }
    }
    console.log('');

    // Test 4: Get yearly averages (for multi-year chart)
    console.log('TEST 4: Yearly Averages (For Dashboard Chart)');
    console.log('-'.repeat(60));
    try {
      const yearly = await client.getYearlyAverages();
      console.log(`✓ Found data for ${yearly.length} years`);
      if (yearly.length > 0) {
        console.log('  Yearly averages (gal/day):');
        yearly.forEach(item => {
          console.log(`    ${item.year}: Production=${item.production.toFixed(0)}, Usage=${item.usage.toFixed(0)}, Loss=${item.loss.toFixed(0)}`);
        });
      }
    } catch (error) {
      console.error('❌ Failed to calculate yearly averages');
      console.error('   Error:', error.message);
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Test failed:');
    console.error(error.message);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

// Run tests
testGoogleSheets();
