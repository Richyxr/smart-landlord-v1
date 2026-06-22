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
