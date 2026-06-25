import nodemailer from 'nodemailer';

const REQUIRED_SMTP_ENV = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'APP_PUBLIC_URL'
];

let cachedTransporter = null;
let cachedConfigKey = null;

export class EmailNotConfiguredError extends Error {
  constructor(missingVars) {
    super('email_not_configured');
    this.code = 'email_not_configured';
    this.missingVars = missingVars;
  }
}

function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

function getMissingEmailConfig() {
  return REQUIRED_SMTP_ENV.filter(name => !process.env[name]);
}

function getSmtpConfig() {
  const missing = getMissingEmailConfig();
  if (missing.length > 0) {
    return { configured: false, missing };
  }

  const port = Number.parseInt(process.env.SMTP_PORT, 10);
  if (!Number.isInteger(port) || port <= 0) {
    return { configured: false, missing: ['SMTP_PORT'] };
  }

  return {
    configured: true,
    host: process.env.SMTP_HOST,
    port,
    secure: parseBoolean(process.env.SMTP_SECURE),
    username: process.env.SMTP_USERNAME,
    password: process.env.SMTP_PASSWORD,
    fromEmail: process.env.EMAIL_FROM,
    fromName: process.env.EMAIL_FROM_NAME,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    appPublicUrl: process.env.APP_PUBLIC_URL
  };
}

function getConfigKey(config) {
  return [
    config.host,
    config.port,
    config.secure,
    config.username,
    config.fromEmail,
    config.fromName,
    config.replyTo || ''
  ].join('|');
}

function getTransporter(config) {
  const key = getConfigKey(config);
  if (cachedTransporter && cachedConfigKey === key) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password
    }
  });
  cachedConfigKey = key;
  return cachedTransporter;
}

export function getMailerStatus() {
  const config = getSmtpConfig();
  if (!config.configured) {
    return {
      configured: false,
      missing: config.missing
    };
  }

  return {
    configured: true,
    host: config.host,
    port: config.port,
    secure: config.secure,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    replyToConfigured: Boolean(config.replyTo),
    appPublicUrl: config.appPublicUrl
  };
}

export async function sendEmail({ to, subject, html, text }) {
  const config = getSmtpConfig();
  if (!config.configured) {
    throw new EmailNotConfiguredError(config.missing);
  }

  if (!to || !subject || (!html && !text)) {
    const error = new Error('email_payload_invalid');
    error.code = 'email_payload_invalid';
    throw error;
  }

  const transporter = getTransporter(config);
  const info = await transporter.sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to,
    subject,
    text,
    html,
    replyTo: config.replyTo
  });

  return {
    sent: true,
    messageId: info.messageId || null
  };
}

// ---------------------------------------------------------------------------
// Per-organisation SMTP utilities
// ---------------------------------------------------------------------------
// The functions below operate on explicitly-supplied credentials rather than
// reading from environment variables.  Use these when an organisation has
// configured their own Truehost (or other) mailbox via the integrations UI.
// They do NOT touch the global transporter cache used by sendEmail().
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
