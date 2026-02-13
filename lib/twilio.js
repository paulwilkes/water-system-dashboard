/**
 * Twilio SMS Service
 * Handles sending single and bulk SMS messages
 */

import Twilio from 'twilio';

class TwilioService {
  constructor(accountSid, authToken, fromNumber) {
    this.client = new Twilio(accountSid, authToken);
    this.fromNumber = fromNumber;
  }

  /**
   * Send a single SMS message
   * Returns { sid, status } on success or { error } on failure
   */
  async sendSMS(toNumber, body) {
    try {
      const message = await this.client.messages.create({
        body,
        from: this.fromNumber,
        to: toNumber
      });
      return { sid: message.sid, status: message.status };
    } catch (error) {
      console.error(`SMS send failed to ${toNumber}:`, error.message);
      return { error: error.message, status: 'failed' };
    }
  }

  /**
   * Send SMS to multiple recipients sequentially
   * Twilio standard accounts allow ~1 msg/sec
   * @param {Array} recipients - Array of { id, phone } objects
   * @param {string} body - Message text
   * @param {Function} onProgress - Callback with { sent, delivered, failed, total }
   * @returns {Array} results - Array of { subscriber_id, phone, sid, status, error }
   */
  async sendBulk(recipients, body, onProgress) {
    const results = [];
    let delivered = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i++) {
      const { id, phone } = recipients[i];
      const result = await this.sendSMS(phone, body);

      if (result.error) {
        failed++;
        results.push({
          subscriber_id: id,
          phone,
          twilio_sid: null,
          status: 'failed',
          error_message: result.error
        });
      } else {
        delivered++;
        results.push({
          subscriber_id: id,
          phone,
          twilio_sid: result.sid,
          status: 'sent',
          error_message: null
        });
      }

      if (onProgress) {
        onProgress({ sent: i + 1, delivered, failed, total: recipients.length });
      }

      // Small delay between messages to respect rate limits
      if (i < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }

    return results;
  }

  /**
   * Estimate cost for sending an SMS to N recipients
   * Standard Twilio rate: ~$0.0079 per SMS segment
   * @param {number} messageLength - Character count of the message
   * @param {number} recipientCount - Number of recipients
   * @returns {{ segments, costPerRecipient, totalCost }}
   */
  static estimateCost(messageLength, recipientCount) {
    const COST_PER_SEGMENT = 0.0079;
    const segments = Math.ceil(messageLength / 160) || 1;
    const costPerRecipient = segments * COST_PER_SEGMENT;
    const totalCost = costPerRecipient * recipientCount;

    return {
      segments,
      costPerRecipient: Math.round(costPerRecipient * 10000) / 10000,
      totalCost: Math.round(totalCost * 100) / 100
    };
  }
}

export default TwilioService;
