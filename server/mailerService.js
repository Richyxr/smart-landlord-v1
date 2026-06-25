import nodemailer from 'nodemailer';

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function normalizeSmtpCredentials(input = {}) {
  const port = parsePort(input.port);
  return {
    host: String(input.host || '').trim(),
    port,
    secure: input.secure === true || String(input.secure || '').toLowerCase() === 'true' || port === 465,
    username: String(input.username || '').trim(),
    password: String(input.password || '').trim(),
    from_email: String(input.from_email || input.username || '').trim(),
    from_name: String(input.from_name || 'Smart Landlord').trim() || 'Smart Landlord',
    reply_to: String(input.reply_to || '').trim()
  };
}

export function validateSmtpCredentials(credentials) {
  const missing = [];

  if (!credentials.host) missing.push('host');
  if (!Number.isInteger(credentials.port) || credentials.port <= 0 || credentials.port > 65535) missing.push('port');
  if (!credentials.username) missing.push('username');
  if (!credentials.password) missing.push('password');
  if (!credentials.from_email) missing.push('from_email');

  return missing;
}

export function maskSmtpCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') return {};

  const masked = { ...credentials };
  if (masked.password) {
    const value = String(masked.password);
    masked.password = value.length > 4 ? `${value.slice(0, 2)}********` : '********';
  }

  return masked;
}

export async function testSmtpCredentials(credentials) {
  const normalized = normalizeSmtpCredentials(credentials);
  const missing = validateSmtpCredentials(normalized);

  if (missing.length > 0) {
    return {
      success: false,
      status: 'needs_credentials',
      summary: `SMTP configuration is incomplete (${missing.join(', ')} missing).`,
      errorMessage: 'Missing required SMTP fields.'
    };
  }

  const verification = await verifySmtpConfig(normalized);
  return {
    ...verification,
    status: verification.success ? 'verified' : 'test_failed'
  };
}

// ---------------------------------------------------------------------------
// Per-organisation SMTP utilities
// ---------------------------------------------------------------------------
// The functions below operate on explicitly-supplied credentials rather than
// reading from runtime environment variables. Use these when an organisation
// or the platform has configured SMTP via the dashboard.
// ---------------------------------------------------------------------------

/**
 * Build a nodemailer transporter from an explicit credentials object.
 * Does not cache — a new transporter is created on every call.
 *
 * @param {object} credentials
 * @param {string} credentials.host
 * @param {number|string} credentials.port
 * @param {boolean|string} [credentials.secure]
 * @param {string} credentials.username
 * @param {string} credentials.password
 */
function buildTransporter(credentials) {
  const port = Number.parseInt(credentials.port, 10);
  const secure = String(credentials.secure || '').toLowerCase() === 'true'
    || credentials.secure === true
    || port === 465;

  return nodemailer.createTransport({
    host: credentials.host,
    port,
    secure,
    auth: {
      user: credentials.username,
      pass: credentials.password
    },
    // Reasonable timeout for connection tests
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 10000
  });
}

/**
 * Verify an SMTP configuration by opening a real SMTP socket.
 * Use this to validate credentials before persisting them.
 *
 * @param {object} credentials
 * @returns {Promise<{ success: boolean, summary: string, errorMessage: string|null }>}
 */
export async function verifySmtpConfig(credentials) {
  if (!credentials?.host || !credentials?.port || !credentials?.username || !credentials?.password) {
    return {
      success: false,
      summary: 'SMTP configuration is incomplete (host, port, username, password are required).',
      errorMessage: 'Missing required SMTP fields.'
    };
  }

  try {
    const transporter = buildTransporter(credentials);
    await transporter.verify();
    transporter.close();

    return {
      success: true,
      summary: `SMTP connection to ${credentials.host}:${credentials.port} verified successfully.`,
      errorMessage: null
    };
  } catch (err) {
    // Extract a user-friendly message from the nodemailer/net error
    let friendly = err.message || 'Unknown error.';
    if (err.code === 'ECONNREFUSED') {
      friendly = `Connection refused on ${credentials.host}:${credentials.port}. Check the host and port.`;
    } else if (err.code === 'ENOTFOUND') {
      friendly = `Hostname "${credentials.host}" could not be resolved. Check the SMTP host.`;
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKET') {
      friendly = `Connection timed out to ${credentials.host}:${credentials.port}. Check firewall rules and port.`;
    } else if (/authentication|535|534/i.test(friendly)) {
      friendly = `Authentication failed. Check the SMTP username and password.`;
    } else if (/certificate|ssl|tls/i.test(friendly)) {
      friendly = `TLS/SSL error. Try toggling the Secure (SSL) setting or check port (465 = SSL, 587 = STARTTLS).`;
    }

    return {
      success: false,
      summary: `SMTP connection to ${credentials.host}:${credentials.port} failed: ${friendly}`,
      errorMessage: friendly
    };
  }
}

/**
 * Send an email using explicitly-supplied SMTP credentials.
 * Used for per-organisation email sends (integration test emails, OTP delivery).
 * Does NOT use or modify the global env-var transporter cache.
 *
 * @param {object} credentials — decrypted SMTP credentials from organisation_integrations
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @returns {Promise<{ sent: boolean, messageId: string|null }>}
 */
export async function sendEmailWithConfig(credentials, { to, subject, html, text }) {
  if (!credentials?.host || !credentials?.username || !credentials?.password) {
    const error = new Error('email_not_configured');
    error.code = 'email_not_configured';
    throw error;
  }

  if (!to || !subject || (!html && !text)) {
    const error = new Error('email_payload_invalid');
    error.code = 'email_payload_invalid';
    throw error;
  }

  const transporter = buildTransporter(credentials);
  const fromEmail = credentials.from_email || credentials.username;
  const fromName = credentials.from_name || 'Smart Landlord';

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html,
    replyTo: credentials.reply_to || undefined
  });

  transporter.close();

  return {
    sent: true,
    messageId: info.messageId || null
  };
}
