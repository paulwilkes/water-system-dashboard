/**
 * Branded HTML email template for Beulah Park Water System.
 * Inline CSS only (external stylesheets don't work in most email clients).
 * Uses the dashboard's logo, Fraunces serif for the header, and coral/mint
 * accent colors matching the dashboard UI.
 *
 * The returned HTML contains a `{{UNSUBSCRIBE_URL}}` placeholder that the
 * Resend wrapper substitutes per recipient.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap user-composed body HTML in the branded shell.
 * @param {object} opts
 * @param {string} opts.subject - plain-text subject line (used as H1)
 * @param {string} opts.bodyHtml - sanitized body HTML from the Quill editor
 * @param {string} opts.baseUrl - absolute dashboard URL for the logo (e.g. https://water-system-dashboard.fly.dev)
 * @param {boolean} [opts.internal=false] - if true, swap the customer footer for an internal ops footer (no unsubscribe).
 */
export function wrapEmail({ subject, bodyHtml, baseUrl, internal = false }) {
  const logoUrl = `${baseUrl}/images/bpws-logo.png`;
  const safeSubject = escapeHtml(subject || '');

  const footer = internal
    ? `<div>Sent automatically from the Beulah Park Water System dashboard.</div>`
    : `<div>This message was sent to customers of Beulah Park Water System.</div>
              <div style="margin-top:10px;">
                <a href="{{UNSUBSCRIBE_URL}}" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe from these notices</a>
              </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeSubject}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:wght@600;700&display=swap');
  body { margin: 0; padding: 0; background: #f4f1eb; font-family: 'DM Sans', Arial, sans-serif; color: #2c2c2c; }
  a { color: #e8927c; }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:'DM Sans',Arial,sans-serif;color:#2c2c2c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1eb;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <!-- Brand header: logo + wordmark -->
          <tr>
            <td align="center" style="padding:0 16px 28px;">
              <img src="${logoUrl}" alt="Beulah Park Water System" width="72" height="72" style="display:block;margin:0 auto 16px;border:0;outline:none;text-decoration:none;">
              <div style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:600;color:#2c2c2c;line-height:1.25;letter-spacing:0.2px;">
                Beulah Park<br>Water System
              </div>
            </td>
          </tr>

          <!-- White card with rounded corners -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:36px 36px 32px;">
              <h1 style="margin:0 0 18px;font-family:'Fraunces',Georgia,serif;font-size:26px;font-weight:700;color:#2c2c2c;line-height:1.25;">${safeSubject}</h1>
              <div style="font-family:'DM Sans',Arial,sans-serif;font-size:16px;line-height:1.65;color:#2c2c2c;">
                ${bodyHtml}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 16px 0;font-family:'DM Sans',Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a;">
              ${footer}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export { escapeHtml };
