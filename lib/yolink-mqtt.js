/**
 * YoLink MQTT Client
 * Connects to YoLink's MQTT broker and listens for tank sensor updates
 * Saves readings to a local JSON file for the dashboard to consume
 *
 * Run with: node lib/yolink-mqtt.js
 * Or use PM2/systemd to keep it running persistently on a Raspberry Pi
 */

import mqtt from 'mqtt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Token management
const TOKEN_URL = 'https://api.yosmart.com/open/yolink/token';
let accessToken = null;
let tokenExpiry = 0;

/**
 * Get OAuth access token from YoLink
 * The access token is used as the MQTT username
 */
async function getAccessToken() {
  // Return cached token if still valid (with 5 min buffer)
  if (accessToken && Date.now() < tokenExpiry - 300000) {
    return accessToken;
  }

  console.log('Fetching new access token...');
  const credentials = Buffer.from(
    `${process.env.YOLINK_UAC_ID}:${process.env.YOLINK_UAC_SECRET}`
  ).toString('base64');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();
  if (data.access_token) {
    accessToken = data.access_token;
    // Token typically valid for 2 hours (7200 seconds)
    tokenExpiry = Date.now() + (data.expires_in || 7200) * 1000;
    console.log(`✓ Got access token (expires in ${data.expires_in || 7200}s)`);
    return accessToken;
  }
  throw new Error('Failed to get access token: ' + JSON.stringify(data));
}

// Configuration
const CONFIG = {
  // YoLink MQTT broker
  broker: 'mqtt://api.yosmart.com',
  port: 8003,

  // Your home ID (from YoLink app or API)
  homeId: process.env.YOLINK_HOME_ID,

  // File to store tank readings
  dataFile: path.join(__dirname, '..', 'public', 'data', 'tank-readings.json'),

  // Device IDs for your tank sensors
  tankDevices: {
    'd88b4c010009063b': { name: 'Tank 2', capacity: 6000 },
    'd88b4c01000bf5ee': { name: 'Tank 3', capacity: 5000 }
  }
};

// Store for tank readings
let tankReadings = {};

/**
 * Load existing readings from file
 */
function loadReadings() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const data = fs.readFileSync(CONFIG.dataFile, 'utf8');
      tankReadings = JSON.parse(data);
      console.log('Loaded existing tank readings from file');
    }
  } catch (error) {
    console.error('Error loading readings file:', error.message);
    tankReadings = {};
  }
}

/**
 * Save readings to file
 */
function saveReadings() {
  try {
    const dir = path.dirname(CONFIG.dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(tankReadings, null, 2));
    console.log('Saved tank readings to file');
  } catch (error) {
    console.error('Error saving readings file:', error.message);
  }
}

/**
 * Process incoming tank sensor message
 */
function processTankMessage(deviceId, data) {
  const deviceConfig = CONFIG.tankDevices[deviceId];
  if (!deviceConfig) {
    console.log(`Unknown device: ${deviceId}`);
    return;
  }

  console.log(`\n📊 Tank update from ${deviceConfig.name} (${deviceId})`);
  console.log('Raw data:', JSON.stringify(data, null, 2));

  // YoLink WaterDepthSensor reports in this format:
  // data.data.waterDepth: water depth in mm
  // data.data.battery: battery level (1-4)
  // data.data.devTemperature: device temperature in Celsius

  const reading = {
    deviceId,
    name: deviceConfig.name,
    capacity: deviceConfig.capacity,
    timestamp: new Date().toISOString(),
    raw: data
  };

  // Extract relevant fields based on YoLink's actual data format
  const sensorData = data.data || data.state || data;

  // Water depth - YoLink reports in mm, convert to cm
  if (sensorData.waterDepth !== undefined) {
    reading.level = sensorData.waterDepth / 10; // Convert mm to cm
    reading.levelUnit = 'cm';
  } else if (sensorData.level !== undefined) {
    reading.level = sensorData.level;
    reading.levelUnit = sensorData.unit || 'cm';
  }

  // Battery (YoLink uses 1-4 scale, convert to percentage)
  if (sensorData.battery !== undefined) {
    reading.battery = sensorData.battery * 25; // 1=25%, 2=50%, 3=75%, 4=100%
  }

  // Temperature
  if (sensorData.devTemperature !== undefined) {
    reading.temperature = sensorData.devTemperature;
  } else if (sensorData.temperature !== undefined) {
    reading.temperature = sensorData.temperature;
  }

  // Calculate percentage if we have level and tank dimensions
  // This would need calibration for your specific tanks
  // For now, leave as undefined unless the sensor provides it
  if (sensorData.percent !== undefined) {
    reading.percentage = sensorData.percent;
  }

  // Store the reading
  tankReadings[deviceId] = reading;

  console.log(`  Level: ${reading.level} ${reading.levelUnit}`);
  console.log(`  Battery: ${reading.battery}%`);
  console.log(`  Temperature: ${reading.temperature}°C`);

  // Save to file
  saveReadings();
}

/**
 * Connect to YoLink MQTT broker
 */
async function connect() {
  console.log('='.repeat(60));
  console.log('YoLink MQTT Tank Monitor');
  console.log(new Date().toISOString());
  console.log('='.repeat(60));
  console.log('');

  // Validate configuration
  if (!process.env.YOLINK_UAC_ID || !process.env.YOLINK_UAC_SECRET) {
    console.error('Error: YOLINK_UAC_ID and YOLINK_UAC_SECRET must be set in .env');
    console.error('');
    console.error('Add these to your .env file:');
    console.error('  YOLINK_UAC_ID=your_uac_id');
    console.error('  YOLINK_UAC_SECRET=your_uac_secret');
    console.error('  YOLINK_HOME_ID=your_home_id');
    process.exit(1);
  }

  if (!CONFIG.homeId) {
    console.error('Error: YOLINK_HOME_ID must be set in .env');
    process.exit(1);
  }

  // Load existing readings
  loadReadings();

  // Get access token for MQTT authentication
  // YoLink MQTT uses the access token as username, no password
  let token;
  try {
    token = await getAccessToken();
  } catch (error) {
    console.error('Failed to get access token:', error.message);
    process.exit(1);
  }

  // Connect to MQTT broker
  const clientId = `water-dashboard-${Date.now()}`;
  console.log(`Connecting to ${CONFIG.broker}:${CONFIG.port}...`);
  console.log(`Client ID: ${clientId}`);
  console.log(`Home ID: ${CONFIG.homeId}`);
  console.log('');

  const client = mqtt.connect(CONFIG.broker, {
    port: CONFIG.port,
    clientId,
    username: token,  // Access token as username
    password: '',     // No password needed
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000
  });

  client.on('connect', () => {
    console.log('✅ Connected to YoLink MQTT broker');
    console.log('');

    // Subscribe to device topics
    // YoLink topic format: yl-home/{homeId}/+/report
    const topic = `yl-home/${CONFIG.homeId}/+/report`;
    console.log(`Subscribing to: ${topic}`);

    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error('Subscribe error:', err);
      } else {
        console.log('✅ Subscribed successfully');
        console.log('');
        console.log('Waiting for tank sensor updates...');
        console.log('(Tank sensors typically report every few minutes or on level change)');
        console.log('');
      }
    });
  });

  client.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());

      // Extract device ID from topic
      // Topic format: yl-home/{homeId}/{deviceId}/report
      const topicParts = topic.split('/');
      const deviceId = topicParts[2];

      console.log(`\n📨 Message received on topic: ${topic}`);

      // Check if this is one of our tank sensors
      if (CONFIG.tankDevices[deviceId]) {
        processTankMessage(deviceId, data);
      } else {
        console.log(`  Device ${deviceId} is not a monitored tank sensor`);
      }
    } catch (error) {
      console.error('Error processing message:', error.message);
    }
  });

  client.on('error', (error) => {
    console.error('MQTT Error:', error.message);
  });

  client.on('close', () => {
    console.log('Connection closed');
  });

  client.on('reconnect', () => {
    console.log('Reconnecting...');
  });

  client.on('offline', () => {
    console.log('Client offline');
  });

  // Handle shutdown gracefully
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    saveReadings();
    client.end();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    saveReadings();
    client.end();
    process.exit(0);
  });
}

// Start the client
connect();
