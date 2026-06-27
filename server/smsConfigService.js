import { decryptConfig } from './crypto.js';

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
    client_id: cleanOptionalText(configJson.client_id)
  };
}

export function validateSmsConfig(config) {
  const missing = [];
  if (!config.api_key) missing.push('api_key');
  return missing;
}

export function maskSmsConfig(config) {
  if (!config || typeof config !== 'object') return {};

  const masked = { ...config };
  const sensitiveFields = ['api_key', 'client_id'];
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
      const sensitiveFields = ['api_key', 'client_id'];
      
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
