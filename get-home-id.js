/**
 * Utility script to get YoLink Home ID
 * The home ID is needed for MQTT subscriptions
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const API_URL = 'https://api.yosmart.com/open/yolink/v2/api';
const TOKEN_URL = 'https://api.yosmart.com/open/yolink/token';

async function getAccessToken() {
  const credentials = Buffer.from(
    `${process.env.YOLINK_CLIENT_ID}:${process.env.YOLINK_CLIENT_SECRET}`
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
    return data.access_token;
  }
  throw new Error('Failed to get access token: ' + JSON.stringify(data));
}

async function getHomeInfo() {
  console.log('Getting access token...');
  const token = await getAccessToken();
  console.log('✓ Got access token\n');

  console.log('Fetching home info...');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      method: 'Home.getGeneralInfo',
      time: Date.now()
    })
  });

  const data = await response.json();
  console.log('\nFull response:');
  console.log(JSON.stringify(data, null, 2));

  if (data.data) {
    console.log('\n' + '='.repeat(50));
    console.log('HOME INFORMATION:');
    console.log('='.repeat(50));
    console.log(`Home ID: ${data.data.id}`);
    console.log(`Home Name: ${data.data.name}`);
    console.log('');
    console.log('Add this to your .env file:');
    console.log(`YOLINK_HOME_ID=${data.data.id}`);
  }
}

getHomeInfo().catch(console.error);
