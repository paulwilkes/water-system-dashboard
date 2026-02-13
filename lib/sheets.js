/**
 * Google Sheets Client
 * Reads chlorine test data and production/distribution data
 * 
 * Setup:
 * 1. Create service account in Google Cloud Console
 * 2. Download JSON credentials
 * 3. Share your sheets with the service account email
 * 4. Add credentials and sheet IDs to .env
 */

import { google } from 'googleapis';

class GoogleSheetsClient {
  constructor(credentials, chlorineSheetId, productionSheetId, options = {}) {
    this.credentials = credentials;
    this.chlorineSheetId = chlorineSheetId;
    this.productionSheetId = productionSheetId;
    this.sheets = google.sheets('v4');

    // Tab names - configurable via options
    this.chlorineTab = options.chlorineTab || 'Form Responses 1';
    this.productionTab = options.productionTab || 'System Meters';
    this.historicalTab = options.historicalTab || 'Service Meters (Summary)';
  }

  /**
   * Get authenticated client
   */
  async getAuthClient() {
    const auth = new google.auth.GoogleAuth({
      credentials: this.credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    return auth.getClient();
  }

  /**
   * Get sheet metadata including tab names
   */
  async getSheetInfo(sheetId) {
    try {
      const auth = await this.getAuthClient();
      const response = await this.sheets.spreadsheets.get({
        auth,
        spreadsheetId: sheetId,
        fields: 'sheets.properties.title'
      });
      return response.data.sheets.map(s => s.properties.title);
    } catch (error) {
      console.error(`Error getting sheet info for ${sheetId}:`, error.message);
      throw error;
    }
  }

  /**
   * Read data from a sheet
   */
  async readSheet(sheetId, range) {
    try {
      const auth = await this.getAuthClient();
      const response = await this.sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: sheetId,
        range: range
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Error reading sheet ${sheetId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get chlorine test data
   * Actual format from Google Form: Timestamp | Email | Test Date | ppm | Test Time | Who | Notes
   */
  async getChlorineData() {
    console.log('Fetching chlorine data...');

    try {
      // Read columns A through G from the chlorine sheet
      const rows = await this.readSheet(this.chlorineSheetId, `'${this.chlorineTab}'!A:G`);

      if (rows.length === 0) {
        console.log('No chlorine data found');
        return [];
      }

      // Skip header row (check if first row contains 'Timestamp')
      const hasHeader = rows[0][0]?.toLowerCase().includes('timestamp');
      const dataRows = hasHeader ? rows.slice(1) : rows;

      // Parse the data
      // Columns: A=Timestamp, B=Email, C=Test Date, D=ppm, E=Test Time, F=Who, G=Notes
      const chlorineData = dataRows.map(row => {
        const [formTimestamp, email, testDate, testResult, testTime, submitter, notes] = row;

        // Parse the test result
        const ppm = parseFloat(String(testResult).replace(/[^\d.]/g, ''));

        // Parse the date and time
        let timestamp;
        try {
          // Try combining test date and time
          if (testDate && testTime) {
            timestamp = new Date(`${testDate} ${testTime}`).toISOString();
          } else if (testDate) {
            timestamp = new Date(testDate).toISOString();
          } else {
            // Fall back to form submission timestamp
            timestamp = new Date(formTimestamp).toISOString();
          }
        } catch (e) {
          // If all else fails, use current time
          timestamp = new Date().toISOString();
        }

        // Determine status based on chlorine levels
        // Green: 0.25-4.0, Yellow: 0.20-0.24, Red: <0.19 or >4.0
        let status;
        if (ppm >= 0.25 && ppm <= 4.0) {
          status = 'good';
        } else if (ppm >= 0.20 && ppm < 0.25) {
          status = 'low';
        } else {
          status = 'warning';
        }

        return {
          timestamp,
          date: testDate || '',
          time: testTime || '',
          ppm,
          status,
          submitter: submitter || '',
          notes: notes || ''
        };
      }).filter(item => !isNaN(item.ppm)); // Filter out invalid readings

      console.log(`✓ Found ${chlorineData.length} chlorine readings`);
      return chlorineData;

    } catch (error) {
      console.error('Error fetching chlorine data:', error.message);
      throw error;
    }
  }

  /**
   * Get the latest chlorine reading
   */
  async getLatestChlorineReading() {
    const data = await this.getChlorineData();
    if (data.length === 0) return null;
    
    // Sort by timestamp and get the most recent
    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return data[0];
  }

  /**
   * Get chlorine data for last N days
   */
  async getRecentChlorineData(days = 30) {
    const data = await this.getChlorineData();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return data.filter(item => 
      new Date(item.timestamp) >= cutoffDate
    ).sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
  }

  /**
   * Get production/distribution data
   * Actual format from System Meters:
   * A: Month | B: Source Meter | C: Production (Gal) | D: Production (Gal/day) |
   * E-F: Quarterly | G: Distribution Meter | H: Usage (Gal) | I: Usage (Gal/day) |
   * J-K: Quarterly | L: Loss (Gal) | M: Loss (Gal/day)
   */
  async getProductionData() {
    console.log('Fetching production data...');

    try {
      // Read columns A through M from the production sheet
      const rows = await this.readSheet(this.productionSheetId, `'${this.productionTab}'!A:M`);

      if (rows.length === 0) {
        console.log('No production data found');
        return [];
      }

      // Skip header rows (first 2 rows are headers)
      const dataRows = rows.slice(2);

      // Month name to number mapping
      const monthMap = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
      };

      // Parse number helper (handles commas)
      const parseNum = (val) => {
        if (!val) return null;
        return parseFloat(String(val).replace(/,/g, ''));
      };

      // Track year - data starts in 2023 based on the sheet
      let currentYear = 2023;
      let lastMonth = 0;

      // Parse the data
      const productionData = dataRows.map(row => {
        const [month, sourceMeter, production, productionPerDay, , , distMeter, usage, usagePerDay, , , loss, lossPerDay] = row;

        // Skip rows without a valid month
        const monthNum = monthMap[month];
        if (!monthNum) return null;

        // Detect year rollover (Jan after Dec)
        if (monthNum < lastMonth) {
          currentYear++;
        }
        lastMonth = monthNum;

        // Skip rows without production data
        const prod = parseNum(production);
        if (prod === null) return null;

        return {
          year: currentYear,
          month: monthNum,
          monthName: month,
          sourceMeterReading: parseNum(sourceMeter),
          production: prod,
          productionPerDay: parseNum(productionPerDay),
          distributionMeterReading: parseNum(distMeter),
          usage: parseNum(usage),
          usagePerDay: parseNum(usagePerDay),
          loss: parseNum(loss),
          lossPerDay: parseNum(lossPerDay)
        };
      }).filter(item => item !== null);

      console.log(`✓ Found ${productionData.length} production records`);
      return productionData;

    } catch (error) {
      console.error('Error fetching production data:', error.message);
      throw error;
    }
  }

  /**
   * Get historical yearly data from the "Service Meters (Summary)" tab
   * Format: Column A = Year, Columns B-E = Q1-Q4 quarterly totals
   * Note: Historical tab currently only contains distribution/usage data, not production
   * The data is in quarterly totals (gallons per quarter)
   */
  async getHistoricalYearlyData() {
    console.log('Fetching historical yearly data...');

    try {
      const rows = await this.readSheet(this.productionSheetId, `'${this.historicalTab}'!A:M`);

      if (rows.length === 0) {
        console.log('No historical data found');
        return [];
      }

      // Parse number helper (handles commas)
      const parseNum = (val) => {
        if (!val) return null;
        return parseFloat(String(val).replace(/,/g, ''));
      };

      // Find rows with year data and quarterly values
      const yearlyData = {};

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Check if first column is a year (4 digit number between 2010-2030)
        const yearVal = parseNum(row[0]);
        if (yearVal && yearVal >= 2010 && yearVal <= 2030) {
          // Sum quarterly values from columns B, C, D, E (indices 1, 2, 3, 4)
          const q1 = parseNum(row[1]) || 0;
          const q2 = parseNum(row[2]) || 0;
          const q3 = parseNum(row[3]) || 0;
          const q4 = parseNum(row[4]) || 0;
          const yearlyTotal = q1 + q2 + q3 + q4;

          if (yearlyTotal > 0) {
            if (!yearlyData[yearVal]) {
              yearlyData[yearVal] = { year: yearVal, usage: 0 };
            }
            // Historical data is distribution/usage only
            yearlyData[yearVal].usage = yearlyTotal;
          }
        }
      }

      // Convert yearly totals to daily averages (divide by 365)
      // Note: production is null for historical years (data not available)
      const result = Object.values(yearlyData).map(item => ({
        year: item.year,
        production: null, // Production data not available in historical records
        usage: item.usage / 365,
        loss: 0,
        fromHistorical: true
      }));

      console.log(`✓ Found ${result.length} historical yearly records (usage only)`);
      return result;

    } catch (error) {
      console.error('Error fetching historical data:', error.message);
      return [];
    }
  }

  /**
   * Get yearly averages (for the multi-year chart)
   * Combines current data with historical data for longer time range
   */
  async getYearlyAverages() {
    const data = await this.getProductionData();

    // Group by year and calculate averages from current data
    const yearlyData = {};

    data.forEach(item => {
      if (!yearlyData[item.year]) {
        yearlyData[item.year] = {
          year: item.year,
          productionSum: 0,
          usageSum: 0,
          lossSum: 0,
          count: 0
        };
      }

      yearlyData[item.year].productionSum += item.productionPerDay || 0;
      yearlyData[item.year].usageSum += item.usagePerDay || 0;
      yearlyData[item.year].lossSum += item.lossPerDay || 0;
      yearlyData[item.year].count += 1;
    });

    // Calculate averages from current data
    const currentYearly = Object.values(yearlyData).map(item => ({
      year: item.year,
      production: item.count > 0 ? item.productionSum / item.count : 0,
      usage: item.count > 0 ? item.usageSum / item.count : 0,
      loss: item.count > 0 ? item.lossSum / item.count : 0
    }));

    // Try to get historical data
    let historicalData = [];
    try {
      historicalData = await this.getHistoricalYearlyData();
    } catch (error) {
      console.error('Could not fetch historical data:', error.message);
    }

    // Merge: prefer current data over historical for overlapping years
    const currentYears = new Set(currentYearly.map(y => y.year));
    const filteredHistorical = historicalData.filter(h => !currentYears.has(h.year));

    // Combine and sort
    const combined = [...filteredHistorical, ...currentYearly];
    return combined.sort((a, b) => a.year - b.year);
  }

  /**
   * Get previous month's data (for the monthly chart)
   */
  async getPreviousMonthData() {
    const data = await this.getProductionData();
    const now = new Date();
    const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    // Filter for last month's data
    const monthData = data.filter(item => 
      item.year === lastMonthYear && 
      item.month && 
      parseInt(item.month) === lastMonth
    );

    return monthData;
  }

  /**
   * Get recent months data (for monthly chart)
   * @param {number} months - Number of recent months to retrieve (default: 6)
   */
  async getRecentMonthsData(months = 6) {
    const data = await this.getProductionData();
    
    // Sort by year and month (most recent first)
    const sorted = data.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

    // Get the last N months
    return sorted.slice(0, months).reverse();
  }
}

export default GoogleSheetsClient;
