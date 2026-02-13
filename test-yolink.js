/**
 * Test script for YoLink API integration
 * 
 * Usage:
 * 1. Copy .env.example to .env
 * 2. Fill in your YOLINK_CLIENT_ID and YOLINK_CLIENT_SECRET
 * 3. Run: npm run test:yolink
 */

import dotenv from 'dotenv';
import YoLinkClient from './lib/yolink.js';

// Load environment variables
dotenv.config();

async function testYoLink() {
  console.log('='.repeat(60));
  console.log('YoLink API Integration Test');
  console.log('='.repeat(60));
  console.log('');

  // Check for credentials
  if (!process.env.YOLINK_CLIENT_ID || !process.env.YOLINK_CLIENT_SECRET) {
    console.error('❌ Missing YoLink credentials!');
    console.error('Please set YOLINK_CLIENT_ID and YOLINK_CLIENT_SECRET in .env file');
    process.exit(1);
  }

  console.log('✓ Credentials found in .env');
  console.log('');

  try {
    // Initialize client
    const client = new YoLinkClient(
      process.env.YOLINK_CLIENT_ID,
      process.env.YOLINK_CLIENT_SECRET
    );

    // Test 1: Get access token
    console.log('TEST 1: OAuth Authentication');
    console.log('-'.repeat(60));
    const token = await client.getAccessToken();
    console.log(`✓ Access token obtained: ${token.substring(0, 20)}...`);
    console.log('');

    // Test 2: Get device list
    console.log('TEST 2: Fetch Device List');
    console.log('-'.repeat(60));
    const devices = await client.getDeviceList();
    console.log(`✓ Found ${devices.length} devices`);
    console.log('');
    
    console.log('Devices:');
    devices.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.name}`);
      console.log(`     Type: ${device.type}`);
      console.log(`     ID: ${device.deviceId}`);
      console.log(`     Model: ${device.modelName || 'N/A'}`);
      console.log(`     Online: ${device.online !== false ? 'Yes' : 'No'}`);
      
      // Show FULL device object for tank sensors
      if (device.type === 'WaterDepthSensor') {
        console.log('     FULL DEVICE DATA:');
        console.log(JSON.stringify(device, null, 6));
      }
      console.log('');
    });

    // Test 3: Get tank levels
    console.log('TEST 3: Fetch Tank Levels');
    console.log('-'.repeat(60));
    const tanks = await client.getTankLevels();
    console.log(`✓ Found ${tanks.length} tank sensors`);
    console.log('');

    if (tanks.length > 0) {
      console.log('Tank Data:');
      tanks.forEach((tank, index) => {
        console.log(`  ${index + 1}. ${tank.name}`);
        console.log(`     Status: ${tank.online ? '🟢 Online' : '🔴 Offline'}`);
        
        // Show depth data if available (WaterDepthSensor)
        if (tank.depth !== undefined) {
          console.log(`     Depth: ${tank.depth} ${tank.depthUnit || 'cm'}`);
        }
        
        // Show percentage/gallons if available
        console.log(`     Level: ${tank.level || tank.depth || 'N/A'}`);
        console.log(`     Percentage: ${tank.percentage ? tank.percentage + '%' : 'N/A'}`);
        console.log(`     Gallons: ${tank.gallons || 'N/A'}`);
        console.log(`     Capacity: ${tank.capacity || 'N/A'}`);
        console.log(`     Battery: ${tank.battery ? tank.battery + '%' : 'N/A'}`);
        console.log(`     Last Update: ${tank.lastUpdate || 'N/A'}`);
        
        // Show raw state for debugging
        if (tank.rawState) {
          console.log(`     Raw State:`, JSON.stringify(tank.rawState, null, 8));
        }
        
        console.log('');
      });
    } else {
      console.log('⚠️  No tank sensors found');
      console.log('   This might mean:');
      console.log('   - No devices are configured as water level sensors');
      console.log('   - Device type filtering needs adjustment');
      console.log('');
    }

    // Test 4: Get formatted data
    console.log('TEST 4: Get Formatted Dashboard Data');
    console.log('-'.repeat(60));
    const formattedData = await client.getFormattedTankData();
    console.log('✓ Dashboard-ready data:');
    console.log(JSON.stringify(formattedData, null, 2));
    console.log('');

    console.log('='.repeat(60));
    console.log('✅ All tests passed!');
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
testYoLink();
