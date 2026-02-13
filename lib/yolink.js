/**
 * YoLink API Client
 * Handles OAuth authentication and device data fetching
 * 
 * YoLink API Documentation: https://www.yosmart.com/doc
 */

import fetch from 'node-fetch';

class YoLinkClient {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.tokenExpiry = null;
    
    // YoLink API endpoints
    this.authUrl = 'https://api.yosmart.com/open/yolink/token';
    this.apiUrl = 'https://api.yosmart.com/open/yolink/v2/api';
  }

  /**
   * Get access token using OAuth 2.0 client credentials flow
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('Using cached access token');
      return this.accessToken;
    }

    console.log('Fetching new access token from YoLink...');

    try {
      const response = await fetch(this.authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`YoLink auth failed: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      if (!data.access_token) {
        throw new Error('No access token in response');
      }

      // Cache the token (typically valid for 2 hours)
      this.accessToken = data.access_token;
      // Set expiry to 5 minutes before actual expiry for safety
      this.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000);
      
      console.log('✓ Access token obtained');
      return this.accessToken;

    } catch (error) {
      console.error('Error getting access token:', error.message);
      throw error;
    }
  }

  /**
   * Make an authenticated API call to YoLink
   */
  async apiCall(method, params = {}) {
    const token = await this.getAccessToken();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: method,
          time: Date.now(),
          params: params
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`YoLink API call failed: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      // YoLink returns error codes in the response body
      if (data.code !== '000000') {
        throw new Error(`YoLink API error: ${data.code} - ${data.desc || 'Unknown error'}`);
      }

      return data.data;

    } catch (error) {
      console.error(`Error calling ${method}:`, error.message);
      throw error;
    }
  }

  /**
   * Get list of all devices (tanks)
   * Request with state data included
   */
  async getDeviceList() {
    console.log('Fetching device list...');
    const data = await this.apiCall('Home.getDeviceList');
    
    // Log raw response for debugging
    console.log('Device list response keys:', Object.keys(data));
    
    return data.devices || [];
  }

  /**
   * Get state of a specific device
   * Note: Different device types support different methods
   */
  async getDeviceState(deviceId) {
    console.log(`Fetching state for device ${deviceId}...`);
    
    // Try Device.getState first (works for most devices)
    try {
      const data = await this.apiCall('Device.getState', {
        targetDevice: deviceId
      });
      return data;
    } catch (error) {
      // If method not supported, try alternative methods
      if (error.message.includes('010203') || error.message.includes('not supported')) {
        console.log(`  Device.getState not supported for ${deviceId}`);
        
        // Try to get latest report
        try {
          console.log(`  Trying Device.getLatestReport...`);
          const reportData = await this.apiCall('Device.getLatestReport', {
            targetDevice: deviceId
          });
          return reportData;
        } catch (reportError) {
          console.log(`  Device.getLatestReport also not supported`);
          
          // Try to get data history (might return recent readings)
          try {
            console.log(`  Trying Device.getDataHistory...`);
            const historyData = await this.apiCall('Device.getDataHistory', {
              targetDevice: deviceId,
              limit: 1  // Just get the most recent reading
            });
            return historyData;
          } catch (historyError) {
            console.log(`  Device.getDataHistory also not supported`);
            return null;
          }
        }
      }
      throw error;
    }
  }

  /**
   * Get tank levels from all water level sensors
   * Returns simplified array of tank data
   */
  async getTankLevels() {
    try {
      const devices = await this.getDeviceList();
      
      // Filter for water level sensors
      // WaterDepthSensor is the type for YoLink water depth sensors
      const tankSensors = devices.filter(device => 
        device.type === 'WaterDepthSensor' ||
        device.type === 'WaterMeterController' || 
        device.type === 'LeakSensor' ||
        device.name.toLowerCase().includes('tank')
      );

      console.log(`Found ${tankSensors.length} tank sensors`);

      // Fetch current state for each tank
      const tankData = await Promise.all(
        tankSensors.map(async (sensor) => {
          try {
            // Try to get detailed state
            const state = await this.getDeviceState(sensor.deviceId);
            
            // If getDeviceState worked, use that data
            if (state) {
              return {
                id: sensor.deviceId,
                name: sensor.name,
                level: state.state?.water?.percent || state.state?.level || 0,
                gallons: state.state?.water?.volume || null,
                capacity: state.state?.water?.capacity || null,
                percentage: state.state?.water?.percent || null,
                online: state.online || false,
                lastUpdate: state.reportAt || state.state?.reportAt || new Date().toISOString(),
                battery: state.state?.battery || null
              };
            }
            
            // If getDeviceState didn't work, use data from device list
            // WaterDepthSensor devices often include state in the device list
            const deviceState = sensor.state || {};
            const depth = deviceState.depth || {};
            const alert = deviceState.alert || {};
            
            return {
              id: sensor.deviceId,
              name: sensor.name,
              // WaterDepthSensor reports depth in cm/inches
              depth: depth.distance,
              depthUnit: depth.unit || 'cm',
              // Some sensors report percentage if configured
              percentage: depth.percent || null,
              // Battery level
              battery: deviceState.battery,
              // Device status
              online: sensor.online !== false, // Default to true if not specified
              lastUpdate: deviceState.reportAt || sensor.deviceUdid || new Date().toISOString(),
              // Alert status
              alertStatus: alert.state,
              // Raw state for debugging
              rawState: deviceState
            };
            
          } catch (error) {
            console.error(`Error fetching tank ${sensor.name}:`, error.message);
            return {
              id: sensor.deviceId,
              name: sensor.name,
              level: 0,
              online: false,
              error: error.message
            };
          }
        })
      );

      return tankData;

    } catch (error) {
      console.error('Error getting tank levels:', error.message);
      throw error;
    }
  }

  /**
   * Get formatted tank data for dashboard display
   */
  async getFormattedTankData() {
    const tanks = await this.getTankLevels();
    
    return tanks.map(tank => ({
      name: tank.name,
      level: tank.level,
      percentage: tank.percentage || (tank.level && tank.capacity ? (tank.level / tank.capacity * 100) : 0),
      gallons: tank.gallons || tank.level,
      capacity: tank.capacity,
      status: tank.online ? 'online' : 'offline',
      lastUpdate: tank.lastUpdate,
      battery: tank.battery
    }));
  }
}

export default YoLinkClient;
