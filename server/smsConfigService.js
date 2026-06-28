import { decryptConfig } from './crypto.js';
import { getSmsProviderProfile } from './smsProviderService.js';

function cleanOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function isMaskedValue(value) {
  const normalized = cleanOptionalText(value);
  return normalized === '********' || normalized === '••••••••' || /^•{4,}$/.test(normalized) || normalized.includes('***');
}

export function normalizeSmsConfig(configJson = {}) {
  return {
    api_key: cleanOptionalText(configJson.api_key),
    api_key_header_name: cleanOptionalText(configJson.api_key_header_name),
    bearer_token: cleanOptionalText(configJson.bearer_token),
    callback_url: cleanOptionalText(configJson.callback_url),
    client_id: cleanOptionalText(configJson.client_id),
    password: cleanOptionalText(configJson.password),
    service_id: cleanOptionalText(configJson.service_id),
    username: cleanOptionalText(configJson.username)
  };
}

export function validateSmsConfig(config, provider = 'mock') {
  const missing = [];
  const profile = getSmsProviderProfile(provider);
  const requiredCredentials = profile?.required_credentials || ['api_key'];
  const requiredStaticFields = profile?.required_static_fields?.filter(field => !['api_url'].includes(field)) || [];

  for (const field of [...requiredCredentials, ...requiredStaticFields]) {
    if (!cleanOptionalText(config[field])) missing.push(field);
  }

  return missing;
}

export function maskSmsConfig(config) {
  if (!config || typeof config !== 'object') return {};

  const masked = { ...config };
  const sensitiveFields = ['api_key', 'bearer_token', 'client_id', 'password', 'username'];
  for (const field of sensitiveFields) {
    if (masked[field]) {
      const val = String(masked[field]);
      masked[field] = val.length > 4 ? `${val.substring(0, 2)}********` : '********';
    }
  }

  return masked;
}

export function prepareSmsConfigForStorage({ incomingConfig = {}, existingEncryptedConfig = null } = {}) {
  const normalized = normalizeSmsConfig(incomingConfig);

  if (existingEncryptedConfig) {
    try {
      const existingConfig = decryptConfig(existingEncryptedConfig);
      const sensitiveFields = ['api_key', 'bearer_token', 'client_id', 'password', 'username'];
      
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
    configForStorage: normalized
  };
}
