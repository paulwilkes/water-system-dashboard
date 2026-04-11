/**
 * Resend Email Service
 * Wraps the Resend SDK for single + bulk branded HTML sends.
 * Per-recipient HTML is built by substituting an {{UNSUBSCRIBE_URL}}
 * placeholder so each recipient gets a unique one-click unsubscribe link.
 */

import { Resend } from 'resend';

const BATCH_SIZE = 100;

class ResendService {
  constructor(apiKey, fromEmail, fromName) {
    this.client = new Resend(apiKey);
    this.fromEmail = fromEmail;
    this.fromName = fromName || 'Beulah Park Water System';
  }

  get from() {
    return `${this.fromName} <${this.fromEmail}>`;
  }

  /**
   * Send a single email (used by /test endpoint)
   * Returns { id, status } on success or { error, status: 'failed' }.
   */
  async sendOne({ to, subject, html }) {
    try {
      const res = await this.client.emails.send({
        from: this.from,
        to,
        subject,
        html
      });
      if (res.error) {
        return { error: res.error.message || String(res.error), status: 'failed' };
      }
      return { id: res.data?.id || null, status: 'sent' };
    } catch (err) {
      console.error(`Resend send failed to ${to}:`, err.message);
      return { error: err.message, status: 'failed' };
    }
  }

  /**
   * Send to many recipients. Each recipient gets a personalized copy of the
   * HTML (with their unique unsubscribe URL substituted). We use Resend's
   * batch API in chunks of 100 for efficiency.
   *
   * @param {object} opts
   * @param {string} opts.subject
   * @param {string} opts.htmlTemplate - HTML containing the `{{UNSUBSCRIBE_URL}}` placeholder
   * @param {Array<{email: string, unsubscribeUrl: string}>} opts.recipients
   * @returns {Array<{email, id, status, error}>}
   */
  async sendBulk({ subject, htmlTemplate, recipients }) {
    const results = [];

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      const emails = chunk.map(r => ({
        from: this.from,
        to: r.email,
        subject,
        html: htmlTemplate.replaceAll('{{UNSUBSCRIBE_URL}}', r.unsubscribeUrl)
      }));

      try {
        const res = await this.client.batch.send(emails);
        // Resend batch returns { data: [{ id }, ...], error? }
        if (res.error) {
          for (const r of chunk) {
            results.push({
              email: r.email,
              id: null,
              status: 'failed',
              error: res.error.message || String(res.error)
            });
          }
          continue;
        }
        const data = res.data?.data || res.data || [];
        chunk.forEach((r, idx) => {
          const item = Array.isArray(data) ? data[idx] : null;
          results.push({
            email: r.email,
            id: item?.id || null,
            status: 'sent',
            error: null
          });
        });
      } catch (err) {
        console.error('Resend batch send failed:', err.message);
        for (const r of chunk) {
          results.push({
            email: r.email,
            id: null,
            status: 'failed',
            error: err.message
          });
        }
      }
    }

    return results;
  }
}

export default ResendService;
