import { decryptConfig } from './crypto.js';

export const EMAIL_MODES = {
  PLATFORM: 'use_platform_email',
  CUSTOM: 'use_custom_smtp'
};

function cleanOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function isMaskedValue(value) {
  const normalized = cleanOptionalText(value);
  return normalized === '********' || normalized === '••••••••' || /^•{4,}$/.test(normalized) || normalized.includes('***');
}

export function normalizeSmtpConfig(configJson = {}) {
  const port = Number.parseInt(configJson.port, 10);

  return {
    host: cleanOptionalText(configJson.host),
    port: Number.isInteger(port) && port > 0 ? port : null,
    secure: configJson.secure === true || String(configJson.secure).toLowerCase() === 'true',
    username: cleanOptionalText(configJson.username),
    password: cleanOptionalText(configJson.password),
    from_email: cleanOptionalText(configJson.from_email || configJson.username),
    from_name: cleanOptionalText(configJson.from_name) || 'Smart Landlord',
    reply_to: cleanOptionalText(configJson.reply_to)
  };
}

export function validateSmtpConfig(config) {
  const missing = [];
  if (!config.host) missing.push('host');
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) missing.push('port');
  if (!config.username) missing.push('username');
  if (!config.password) missing.push('password');
  if (!config.from_email) missing.push('from_email');
  return missing;
}

export function maskSmtpConfig(config) {
  if (!config || typeof config !== 'object') return {};

  const masked = { ...config };
  const sensitiveFields = ['password', 'username', 'from_email', 'reply_to', 'host'];
  for (const field of sensitiveFields) {
    if (masked[field]) {
      const val = String(masked[field]);
      masked[field] = val.length > 4 ? `${val.substring(0, 2)}********` : '********';
    }
  }

  return masked;
}

export function prepareSmtpConfigForStorage({ incomingConfig = {}, existingEncryptedConfig = null } = {}) {
  const normalized = normalizeSmtpConfig(incomingConfig);

  if (existingEncryptedConfig) {
    try {
      const existingConfig = decryptConfig(existingEncryptedConfig);
      const sensitiveFields = ['password', 'username', 'from_email', 'reply_to', 'host'];
      
      for (const field of sensitiveFields) {
        const incomingVal = incomingConfig[field];
        const preserveExisting = !cleanOptionalText(incomingVal) || isMaskedValue(incomingVal);
        if (preserveExisting && existingConfig?.[field]) {
          normalized[field] = cleanOptionalText(existingConfig[field]);
        }
      }
    } catch (_error) {
      // If decryption fails, fall back to whatever was submitted.
    }
  }

  return {
    configForStorage: normalized,
    passwordPreserved: Boolean(normalized.password) && (!cleanOptionalText(incomingConfig.password) || isMaskedValue(incomingConfig.password)) && Boolean(existingEncryptedConfig)
  };
}

export async function resolveEmailDeliveryConfig({ pgDb, organizationId }) {
  const activeDb = pgDb;
  if (!activeDb) {
    throw new Error('Database access is required to resolve email delivery config.');
  }

  const organization = await activeDb.findOne('organizations', { id: organizationId });
  if (!organization) {
    const error = new Error('Organization not found.');
    error.code = 'ORGANIZATION_NOT_FOUND';
    throw error;
  }

  const mode = organization.email_delivery_mode || EMAIL_MODES.PLATFORM;
  const customIntegration = await activeDb.findOne('organization_integrations', {
    organization_id: organizationId,
    provider_type: 'email'
  });
  const platformSettings = await activeDb.findOne('platform_billing_settings', { id: 1 });

  if (mode === EMAIL_MODES.CUSTOM && customIntegration?.config_json_encrypted) {
    const credentials = normalizeSmtpConfig(decryptConfig(customIntegration.config_json_encrypted));
    const missing = validateSmtpConfig(credentials);
    if (missing.length === 0 && ['ready', 'verified', 'active'].includes(customIntegration.status || '')) {
      return {
        source: 'landlord_custom_smtp',
        mode,
        status: customIntegration.status,
        credentials,
        integration: customIntegration,
        organization
      };
    }
  }

  if (platformSettings?.smtp_config_encrypted) {
    const credentials = normalizeSmtpConfig(decryptConfig(platformSettings.smtp_config_encrypted));
    const missing = validateSmtpConfig(credentials);
    if (missing.length === 0 && ['verified', 'active'].includes(platformSettings.smtp_status || '')) {
      return {
        source: 'platform_email',
        mode: EMAIL_MODES.PLATFORM,
        status: platformSettings.smtp_status,
        credentials,
        platformSettings,
        organization
      };
    }
  }

  const error = new Error('Email delivery is not configured.');
  error.code = 'EMAIL_CONFIGURATION_NOT_READY';
  throw error;
}
