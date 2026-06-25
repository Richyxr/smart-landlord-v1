// ---------------------------------------------------------------------------
// Email Template System — Smart Landlord V1.0
// ---------------------------------------------------------------------------
// Pure function module with no I/O dependencies.
// All templates return { subject, html, text } pairs.
//
// Design principles:
//   - Inline CSS only (works in Gmail, Yahoo, Outlook, Apple Mail)
//   - Smart Landlord brand colors: #1C1C1E (charcoal), #6B46C1 (purple)
//   - Inter/Arial font stack
//   - Text fallback for every template
//   - All user-provided data is HTML-escaped before interpolation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent XSS in email templates.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Shared layout wrapper
// ---------------------------------------------------------------------------

function layout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Landlord</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F7;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F4F7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1C1C1E;padding:28px 36px;">
              <p style="margin:0;font-family:Inter,Arial,sans-serif;font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;">Smart Landlord</p>
              <p style="margin:4px 0 0;font-family:Inter,Arial,sans-serif;font-size:13px;color:#A0AEC0;">Property Management Platform</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#F7F7F9;padding:20px 36px;border-top:1px solid #E8E8EE;">
              <p style="margin:0;font-family:Inter,Arial,sans-serif;font-size:12px;color:#9CA3AF;line-height:1.6;">
                This email was sent by Smart Landlord. If you did not request this, please ignore it safely.<br>
                &copy; ${new Date().getFullYear()} Smart Landlord. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * OTP verification email.
 *
 * Data: { otp, context, recipientName, expiryMinutes }
 */
function otpVerification(data) {
  const name = esc(data.recipientName || 'there');
  const otp = esc(data.otp || '------');
  const expiry = parseInt(data.expiryMinutes || 10, 10);
  const contextLabel = esc(
    data.context === 'password_reset' ? 'Password Reset'
      : data.context === 'phone_verify' ? 'Phone Verification'
      : 'Email Verification'
  );

  const subject = `Your Smart Landlord ${contextLabel} Code: ${otp}`;

  const html = layout(`
    <h1 style="margin:0 0 8px;font-family:Inter,Arial,sans-serif;font-size:24px;font-weight:700;color:#1C1C1E;">${contextLabel}</h1>
    <p style="margin:0 0 28px;font-family:Inter,Arial,sans-serif;font-size:15px;color:#4B5563;line-height:1.6;">
      Hi ${name}, use the verification code below to complete your request.
    </p>

    <!-- OTP block -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:28px;">
      <tr>
        <td align="center" style="background-color:#F3F0FF;border:2px dashed #6B46C1;border-radius:10px;padding:24px;">
          <p style="margin:0 0 4px;font-family:Inter,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6B46C1;">Your Verification Code</p>
          <p style="margin:0;font-family:Inter,Arial,monospace;font-size:42px;font-weight:800;letter-spacing:10px;color:#1C1C1E;line-height:1.2;">${otp}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px;font-family:Inter,Arial,sans-serif;font-size:14px;color:#6B7280;line-height:1.6;">
      &#x23F0;&nbsp;This code expires in <strong>${expiry} minutes</strong>. Do not share it with anyone.
    </p>
    <p style="margin:0;font-family:Inter,Arial,sans-serif;font-size:13px;color:#9CA3AF;line-height:1.6;">
      If you did not request this code, you can safely ignore this email.
    </p>
  `);

  const text = [
    `Smart Landlord — ${contextLabel}`,
    '',
    `Hi ${data.recipientName || 'there'},`,
    '',
    `Your verification code is: ${otp}`,
    '',
    `This code expires in ${expiry} minutes. Do not share it with anyone.`,
    '',
    'If you did not request this code, you can safely ignore this email.',
    '',
    '— The Smart Landlord Team'
  ].join('\n');

  return { subject, html, text };
}

/**
 * SMTP connection smoke-test email.
 *
 * Data: { recipientName, host, configuredBy }
 */
function smtpTest(data) {
  const name = esc(data.recipientName || 'there');
  const host = esc(data.host || 'your SMTP server');
  const configuredBy = esc(data.configuredBy || 'the system administrator');
  const timestamp = new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', hour12: false });

  const subject = 'Smart Landlord — SMTP Connection Test Successful';

  const html = layout(`
    <h1 style="margin:0 0 8px;font-family:Inter,Arial,sans-serif;font-size:24px;font-weight:700;color:#1C1C1E;">&#x2705; SMTP Test Passed</h1>
    <p style="margin:0 0 24px;font-family:Inter,Arial,sans-serif;font-size:15px;color:#4B5563;line-height:1.6;">
      Hi ${name}, this is a confirmation that your SMTP email configuration is working correctly.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:24px;border-radius:8px;overflow:hidden;border:1px solid #E8E8EE;">
      <tr style="background-color:#F9FAFB;">
        <td style="padding:10px 16px;font-family:Inter,Arial,sans-serif;font-size:13px;font-weight:600;color:#374151;width:40%;border-bottom:1px solid #E8E8EE;">SMTP Host</td>
        <td style="padding:10px 16px;font-family:monospace,Arial,sans-serif;font-size:13px;color:#1C1C1E;border-bottom:1px solid #E8E8EE;">${host}</td>
      </tr>
      <tr style="background-color:#FFFFFF;">
        <td style="padding:10px 16px;font-family:Inter,Arial,sans-serif;font-size:13px;font-weight:600;color:#374151;border-bottom:1px solid #E8E8EE;">Configured By</td>
        <td style="padding:10px 16px;font-family:Inter,Arial,sans-serif;font-size:13px;color:#1C1C1E;border-bottom:1px solid #E8E8EE;">${configuredBy}</td>
      </tr>
      <tr style="background-color:#F9FAFB;">
        <td style="padding:10px 16px;font-family:Inter,Arial,sans-serif;font-size:13px;font-weight:600;color:#374151;">Tested At</td>
        <td style="padding:10px 16px;font-family:Inter,Arial,sans-serif;font-size:13px;color:#1C1C1E;">${esc(timestamp)} (EAT)</td>
      </tr>
    </table>

    <p style="margin:0;font-family:Inter,Arial,sans-serif;font-size:14px;color:#6B7280;line-height:1.6;">
      Email delivery is now enabled for your Smart Landlord organisation. OTP codes and notifications will be sent via this mailbox.
    </p>
  `);

  const text = [
    'Smart Landlord — SMTP Test Passed',
    '',
    `Hi ${data.recipientName || 'there'},`,
    '',
    'Your SMTP email configuration is working correctly.',
    '',
    `  SMTP Host:      ${data.host || 'configured'}`,
    `  Configured By:  ${data.configuredBy || 'system'}`,
    `  Tested At:      ${timestamp} (EAT)`,
    '',
    'Email delivery is now enabled for your Smart Landlord organisation.',
    '',
    '— The Smart Landlord Team'
  ].join('\n');

  return { subject, html, text };
}

/**
 * Welcome email placeholder — wired to registration in a future slice.
 *
 * Data: { recipientName, loginUrl }
 */
function welcome(data) {
  const name = esc(data.recipientName || 'there');
  const loginUrl = esc(data.loginUrl || 'https://smart-landlord-1e526.web.app');

  const subject = 'Welcome to Smart Landlord';

  const html = layout(`
    <h1 style="margin:0 0 8px;font-family:Inter,Arial,sans-serif;font-size:24px;font-weight:700;color:#1C1C1E;">Welcome, ${name}! &#x1F44B;</h1>
    <p style="margin:0 0 24px;font-family:Inter,Arial,sans-serif;font-size:15px;color:#4B5563;line-height:1.6;">
      Your Smart Landlord account is ready. Start managing your properties, tenants, and payments in one place.
    </p>
    <a href="${loginUrl}" style="display:inline-block;padding:14px 28px;background-color:#6B46C1;color:#FFFFFF;font-family:Inter,Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
      Go to Dashboard
    </a>
  `);

  const text = [
    `Welcome to Smart Landlord, ${data.recipientName || 'there'}!`,
    '',
    'Your account is ready. Start managing your properties, tenants, and payments.',
    '',
    `Log in: ${data.loginUrl || 'https://smart-landlord-1e526.web.app'}`,
    '',
    '— The Smart Landlord Team'
  ].join('\n');

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const TEMPLATES = {
  otp_verification: otpVerification,
  smtp_test: smtpTest,
  welcome
};

/**
 * Render an email template by type.
 *
 * @param {string} type — template name key
 * @param {object} data — template-specific data (all values are HTML-escaped internally)
 * @returns {{ subject: string, html: string, text: string }}
 * @throws {Error} if the template type is unknown
 */
export function renderTemplate(type, data = {}) {
  const templateFn = TEMPLATES[type];
  if (!templateFn) {
    throw new Error(`Unknown email template type: "${type}". Available: ${Object.keys(TEMPLATES).join(', ')}`);
  }
  return templateFn(data);
}

/**
 * List available template types.
 * @returns {string[]}
 */
export function availableTemplates() {
  return Object.keys(TEMPLATES);
}
