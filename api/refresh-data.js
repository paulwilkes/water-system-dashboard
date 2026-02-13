/**
 * Main Data Refresh Function
 * Combines data from YoLink (tanks) and Google Sheets (chlorine, production)
 * Saves to public/data/current.json for the dashboard
 * 
 * Run manually: node api/refresh-data.js
 * Or set up as hourly cron job
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YoLinkClient from '../lib/yolink.js';
import GoogleSheetsClient from '../lib/sheets.js';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Load Google credentials from file or env
 */
function loadGoogleCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_FILE) {
    const credentialsPath = path.join(__dirname, '..', process.env.GOOGLE_CREDENTIALS_FILE);
    const credentialsText = fs.readFileSync(credentialsPath, 'utf8');
    return JSON.parse(credentialsText);
  } else if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } else {
    throw new Error('No Google credentials found in .env');
  }
}

/**
 * Main refresh function
 */
async function refreshData() {
  console.log('='.repeat(60));
  console.log('Water Dashboard Data Refresh');
  console.log(new Date().toISOString());
  console.log('='.repeat(60));
  console.log('');

  const output = {
    timestamp: new Date().toISOString(),
    tanks: [],
    chlorine: {
      latest: null,
      history: []
    },
    production: {
      yearly: [],
      previousMonth: []
    }
  };

  // 1. Fetch Tank Data (YoLink REST API + MQTT readings)
  console.log('1. Fetching tank data...');

  // First, try to load MQTT-based readings (if the MQTT listener is running)
  const mqttReadingsFile = path.join(__dirname, '..', 'public', 'data', 'tank-readings.json');
  let mqttReadings = {};
  try {
    if (fs.existsSync(mqttReadingsFile)) {
      mqttReadings = JSON.parse(fs.readFileSync(mqttReadingsFile, 'utf8'));
      console.log(`✓ Loaded MQTT tank readings (${Object.keys(mqttReadings).length} sensors)`);
    }
  } catch (error) {
    console.log('  No MQTT readings file found (MQTT listener may not be running)');
  }

  try {
    const yolink = new YoLinkClient(
      process.env.YOLINK_CLIENT_ID,
      process.env.YOLINK_CLIENT_SECRET
    );

    const tanks = await yolink.getTankLevels();

    // Tank specifications: 39cm height = 2,500 gallons capacity
    const TANK_HEIGHT_CM = 39;
    const TANK_CAPACITY_GAL = 2500;

    // Transform to dashboard format, merging MQTT readings where available
    output.tanks = [
      {
        id: 'tank1',
        name: 'Tank 1 - Upper Reservoir',
        status: 'no_sensor',
        message: 'Sensor not yet installed',
        level: null,
        percentage: null,
        capacity: 1500
      },
      ...tanks.map(tank => {
        // Check if we have MQTT readings for this device
        const mqttData = mqttReadings[tank.id];
        
        // Get the depth from MQTT or REST API
        const depth = mqttData?.level ?? tank.depth ?? null;
        
        // Calculate percentage and gallons based on depth
        let percentage = null;
        let gallons = null;
        
        if (depth !== null && depth !== undefined) {
          percentage = Math.round((depth / TANK_HEIGHT_CM) * 100);
          gallons = Math.round((depth / TANK_HEIGHT_CM) * TANK_CAPACITY_GAL);
          
          // Ensure percentage doesn't exceed 100%
          if (percentage > 100) percentage = 100;
        }

        return {
          id: tank.id,
          name: tank.name,
          status: tank.online ? 'online' : 'offline',
          // Prefer MQTT readings over REST API (more reliable for tank sensors)
          level: depth,
          depthUnit: mqttData?.levelUnit ?? tank.depthUnit ?? 'cm',
          percentage: percentage,
          battery: mqttData?.battery ?? tank.battery,
          lastUpdate: mqttData?.timestamp ?? tank.lastUpdate,
          temperature: mqttData?.temperature ?? null,
          gallons: gallons,
          capacity: TANK_CAPACITY_GAL,
          dataSource: mqttData ? 'mqtt' : 'rest'
        };
      })
    ];

    console.log(`✓ Found ${tanks.length} YoLink sensors (${tanks.filter(t => t.online).length} online)`);
  } catch (error) {
    console.error('⚠️  Failed to fetch YoLink data:', error.message);

    // Fall back to MQTT readings if REST API fails
    if (Object.keys(mqttReadings).length > 0) {
      console.log('  Using MQTT readings as fallback...');
      
      // Tank specifications
      const TANK_HEIGHT_CM = 39;
      const TANK_CAPACITY_GAL = 2500;
      
      output.tanks = [
        { id: 'tank1', name: 'Tank 1 - Upper Reservoir', status: 'no_sensor', level: null, percentage: null, capacity: 1500 },
        ...Object.values(mqttReadings).map(reading => {
          // Calculate percentage and gallons
          let percentage = null;
          let gallons = null;
          
          if (reading.level !== null && reading.level !== undefined) {
            percentage = Math.round((reading.level / TANK_HEIGHT_CM) * 100);
            gallons = Math.round((reading.level / TANK_HEIGHT_CM) * TANK_CAPACITY_GAL);
            if (percentage > 100) percentage = 100;
          }
          
          return {
            id: reading.deviceId,
            name: reading.name,
            status: 'online',
            level: reading.level,
            depthUnit: reading.levelUnit || 'cm',
            percentage: percentage,
            battery: reading.battery,
            lastUpdate: reading.timestamp,
            temperature: reading.temperature,
            gallons: gallons,
            capacity: TANK_CAPACITY_GAL,
            dataSource: 'mqtt'
          };
        })
      ];
    } else {
      // No MQTT readings, use placeholder data
      output.tanks = [
        { id: 'tank1', name: 'Tank 1 - Upper Reservoir', status: 'no_sensor', level: null, percentage: null, capacity: 1500 },
        { id: 'tank2', name: 'Tank 2 - Storage & Distribution', status: 'offline', level: null, percentage: null, capacity: 2500 },
        { id: 'tank3', name: 'Tank 3 - Storage & Distribution', status: 'offline', level: null, percentage: null, capacity: 2500 }
      ];
    }
  }
  console.log('');

  // 2. Fetch Chlorine Data (Google Sheets)
  console.log('2. Fetching chlorine data from Google Sheets...');
  try {
    const credentials = loadGoogleCredentials();
    const sheets = new GoogleSheetsClient(
      credentials,
      process.env.CHLORINE_SHEET_ID,
      process.env.PRODUCTION_SHEET_ID
    );

    // Get latest reading
    const latest = await sheets.getLatestChlorineReading();
    output.chlorine.latest = latest;
    console.log(`✓ Latest chlorine: ${latest.ppm} ppm (${latest.status})`);

    // Get 30-day history
    const history = await sheets.getRecentChlorineData(30);
    output.chlorine.history = history;
    console.log(`✓ Chlorine history: ${history.length} readings`);

  } catch (error) {
    console.error('⚠️  Failed to fetch chlorine data:', error.message);
  }
  console.log('');

  // 3. Fetch Production Data (Google Sheets)
  console.log('3. Fetching production data from Google Sheets...');
  try {
    const credentials = loadGoogleCredentials();
    const sheets = new GoogleSheetsClient(
      credentials,
      process.env.CHLORINE_SHEET_ID,
      process.env.PRODUCTION_SHEET_ID
    );

    // Get yearly averages for the multi-year chart
    const yearly = await sheets.getYearlyAverages();
    output.production.yearly = yearly;
    console.log(`✓ Yearly data: ${yearly.length} years (${yearly[0]?.year} - ${yearly[yearly.length - 1]?.year})`);

    // Get recent months for monthly chart (last 6 months)
    const recentMonths = await sheets.getRecentMonthsData(6);
    output.production.recentMonths = recentMonths;
    console.log(`✓ Recent months: ${recentMonths.length} months of data`);

  } catch (error) {
    console.error('⚠️  Failed to fetch production data:', error.message);
  }
  console.log('');

  // 4. Save to JSON file
  console.log('4. Saving data to public/data/current.json...');
  try {
    const outputDir = path.join(__dirname, '..', 'public', 'data');
    const outputFile = path.join(outputDir, 'current.json');

    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write JSON file
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log('✓ Data saved successfully');
    console.log(`  File: ${outputFile}`);
    console.log(`  Size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error('❌ Failed to save data:', error.message);
    throw error;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('✅ Data refresh complete!');
  console.log('='.repeat(60));

  return output;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  refreshData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default refreshData;
