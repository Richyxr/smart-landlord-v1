import crypto from 'node:crypto';

const SENSITIVE_ERROR_PATTERN = /(key|token|password|pass|secret|auth|apikey|api_key)\s*[=:]\s*[^\s&;,\"]+/gi;

export const SMS_PROVIDER_PROFILES = {
  mock: {
    provider_key: 'mock',
    provider_display_name: 'Mock SMS Gateway',
    auth_type: 'body_api_key',
    required_credentials: ['api_key'],
    optional_credentials: ['client_id'],
    required_sender_fields: ['sender_id'],
    required_static_fields: [],
    supports_delivery_callback: false,
    supports_delivery_polling: false,
    supports_balance_check: false,
    supports_bulk_send: false,
    success_response_mapping: {
      provider_message_id: 'messageId',
      status: 'sent'
    },
    failure_response_mapping: {
      sanitized_error: 'error',
      status: 'failed'
    }
  },
  mobitech_official: {
    provider_key: 'mobitech_official',
    provider_display_name: 'Mobitech Official',
    auth_type: 'api_key_header',
    required_credentials: ['api_key'],
    optional_credentials: ['api_key_header_name', 'callback_url'],
    required_sender_fields: ['sender_id'],
    required_static_fields: ['api_url', 'service_id'],
    supports_delivery_callback: true,
    supports_delivery_polling: false,
    supports_balance_check: false,
    supports_bulk_send: false,
    success_response_mapping: {
      provider_message_id: 'message_id',
      status: 'accepted'
    },
    failure_response_mapping: {
      sanitized_error: 'message',
      status: 'failed'
    }
  },
  textsms_compatible: {
    provider_key: 'textsms_compatible',
    provider_display_name: 'TextSMS-Compatible Gateway',
    auth_type: 'body_api_key',
    required_credentials: ['api_key', 'client_id'],
    optional_credentials: [],
    required_sender_fields: ['sender_id', 'default_country_code'],
    required_static_fields: ['api_url'],
    supports_delivery_callback: false,
    supports_delivery_polling: false,
    supports_balance_check: false,
    supports_bulk_send: false,
    success_response_mapping: {
      provider_message_id: 'responses[0].messageid',
      status: 'sent'
    },
    failure_response_mapping: {
      sanitized_error: 'response-description',
      status: 'failed'
    }
  }
};

const LEGACY_PROVIDER_ALIASES = {
  mobitech: 'textsms_compatible',
  mobifour: 'textsms_compatible',
  textsms: 'textsms_compatible',
  textsms_compatible: 'textsms_compatible',
  mobitech_official: 'mobitech_official',
  mock: 'mock'
};

const FIELD_LABELS = {
  api_url: 'API Base URL',
  api_key: 'API Key',
  api_key_header_name: 'API Key Header Name',
  bearer_token: 'Bearer Token',
  callback_url: 'Callback URL',
  client_id: 'Partner ID / Client ID',
  default_country_code: 'Default Country Code',
  password: 'Password',
  sender_id: 'Sender ID',
  service_id: 'Service ID',
  username: 'Username'
};

export function normalizeProviderKey(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  return LEGACY_PROVIDER_ALIASES[normalized] || normalized;
}

export function getSmsProviderProfile(provider) {
  return SMS_PROVIDER_PROFILES[normalizeProviderKey(provider)] || null;
}

export function listSmsProviderProfiles() {
  return Object.values(SMS_PROVIDER_PROFILES).map(profile => ({
    ...profile,
    field_labels: FIELD_LABELS
  }));
}

export function sanitizeSmsProviderError(message, sensitiveValues = []) {
  if (!message) return '';
  let sanitized = String(message);

  for (const value of sensitiveValues) {
    if (value && typeof value === 'string' && value.length > 2) {
      const escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      sanitized = sanitized.replace(new RegExp(escaped, 'gi'), '********');
    }
  }

  return sanitized
    .replace(SENSITIVE_ERROR_PATTERN, '$1=********')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function normalizeKenyanPhoneNumber(phone) {
  if (!phone) {
    throw new Error('Phone number is required.');
  }
  let cleaned = String(phone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+254')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.startsWith('07') && cleaned.length === 10) {
    cleaned = '254' + cleaned.slice(1);
  } else if (cleaned.startsWith('01') && cleaned.length === 10) {
    cleaned = '254' + cleaned.slice(1);
  }

  if (/^254[71]\d{8}$/.test(cleaned)) {
    return cleaned;
  }

  throw new Error(`Invalid Kenyan phone number format: "${phone}". Expected 07XXXXXXXX, 01XXXXXXXX, or 2547XXXXXXXX.`);
}

export function validateSmsProviderConfig({
  provider,
  api_url,
  api_key,
  client_id,
  sender_id,
  default_country_code,
  service_id,
  bearer_token,
  username,
  password
} = {}) {
  const profile = getSmsProviderProfile(provider);
  if (!profile) {
    return { profile: null, missing: ['provider'], error: `Unsupported SMS provider: "${provider}"` };
  }

  const values = {
    api_url,
    api_key,
    bearer_token,
    client_id,
    default_country_code,
    password,
    sender_id,
    service_id,
    username
  };
  const requiredFields = [
    ...profile.required_credentials,
    ...profile.required_sender_fields,
    ...profile.required_static_fields
  ];
  const missing = requiredFields.filter(field => !String(values[field] || '').trim());

  return {
    profile,
    missing,
    error: missing.length > 0 ? `Missing required SMS fields: ${missing.map(labelSmsProviderField).join(', ')}.` : null
  };
}

export function buildSmsReadinessChecklist({
  provider,
  api_url,
  config = {},
  sender_id,
  sender_approval_status,
  default_country_code,
  pricing = {}
} = {}) {
  const providerKey = normalizeProviderKey(provider);
  const profile = getSmsProviderProfile(providerKey);
  const validation = validateSmsProviderConfig({
    provider: providerKey,
    api_url,
    api_key: config.api_key,
    bearer_token: config.bearer_token,
    client_id: config.client_id,
    default_country_code,
    password: config.password,
    sender_id,
    service_id: config.service_id,
    username: config.username
  });
  const credentialsRequired = profile?.required_credentials || [];
  const credentialsPresent = Boolean(profile) && credentialsRequired.every(field => String(config[field] || '').trim());
  const pricingConfigured = Number(pricing.default_sms_provider_cost || 0) >= 0
    && Number(pricing.default_sms_sell_price || 0) >= 0
    && Boolean(String(pricing.sms_currency || 'KES').trim());
  const senderApproval = String(sender_approval_status || 'pending').trim().toLowerCase();
  const senderApproved = senderApproval === 'approved';
  const liveAllowed = Boolean(profile) && validation.missing.length === 0 && senderApproved;

  return {
    provider_profile: profile,
    checklist: [
      {
        key: 'provider_selected',
        label: 'Provider selected',
        ok: Boolean(profile),
        status: profile ? 'ready' : 'missing',
        detail: profile ? profile.provider_display_name : 'Choose a supported SMS provider.'
      },
      {
        key: 'api_credentials_present',
        label: 'API credentials present',
        ok: credentialsPresent,
        status: credentialsPresent ? 'ready' : 'missing',
        detail: credentialsPresent ? 'Credentials are stored securely.' : `Missing: ${validation.missing.filter(field => credentialsRequired.includes(field)).map(labelSmsProviderField).join(', ') || 'provider credentials'}.`
      },
      {
        key: 'sender_id_configured',
        label: 'Sender ID configured',
        ok: Boolean(String(sender_id || '').trim()),
        status: String(sender_id || '').trim() ? 'ready' : 'missing',
        detail: String(sender_id || '').trim() ? sender_id : 'Set the sender name used for outgoing SMS.'
      },
      {
        key: 'sender_approval_status',
        label: 'Sender approval status',
        ok: senderApproved,
        status: senderApproved ? 'ready' : 'blocked',
        detail: senderApproved ? 'Sender ID is approved for live SMS.' : `Live SMS is blocked while status is ${senderApproval || 'pending'}.`
      },
      {
        key: 'pricing_configured',
        label: 'Pricing configured',
        ok: pricingConfigured,
        status: pricingConfigured ? 'ready' : 'missing',
        detail: pricingConfigured ? `${pricing.sms_currency || 'KES'} pricing is configured.` : 'Set provider cost, billing price, and currency.'
      },
      {
        key: 'live_sending_allowed',
        label: 'Live sending allowed',
        ok: liveAllowed,
        status: liveAllowed ? 'ready' : 'blocked',
        detail: liveAllowed ? 'Configuration can send when an explicit live test is allowed.' : 'Live SMS remains blocked until provider, credentials, sender, and approval are ready.'
      }
    ],
    missing_fields: validation.missing,
    live_sending_allowed: liveAllowed
  };
}

export async function sendSmsViaAdapter({
  provider,
  api_url,
  api_key,
  client_id,
  sender_id,
  to,
  message,
  sender_approval_status,
  default_country_code,
  api_key_header_name,
  service_id,
  callback_url,
  bearer_token,
  username,
  password,
  allow_live_test = false
}) {
  const normalizedTo = normalizeKenyanPhoneNumber(to);
  const providerKey = normalizeProviderKey(provider);
  const profile = getSmsProviderProfile(providerKey);
  const sensitiveValues = [api_key, client_id, bearer_token, username, password].filter(Boolean);

  if (!profile) {
    return failureResult(providerKey || provider, `Unsupported SMS provider: "${provider}"`, sensitiveValues);
  }

  const validation = validateSmsProviderConfig({
    provider: providerKey,
    api_url,
    api_key,
    client_id,
    sender_id,
    default_country_code,
    service_id,
    bearer_token,
    username,
    password
  });

  if (validation.missing.length > 0) {
    return failureResult(providerKey, validation.error, sensitiveValues);
  }

  if (providerKey === 'mock') {
    if (api_key === 'invalid-key') {
      return failureResult(providerKey, 'Invalid API Key / Token.', sensitiveValues);
    }
    if (api_url && api_url.includes('invalid-url')) {
      return failureResult(providerKey, 'Unreachable SMS Gateway API URL.', sensitiveValues);
    }
    return successResult(providerKey, `mock-sms-${crypto.randomUUID()}`);
  }

  if (String(sender_approval_status || '').trim().toLowerCase() !== 'approved') {
    return failureResult(
      providerKey,
      `Live SMS sending is blocked: Sender ID "${sender_id || 'SMARTLANDY'}" status is "${sender_approval_status || 'pending'}". It must be "approved" to send real SMS.`,
      sensitiveValues,
      'blocked'
    );
  }

  if (!allow_live_test) {
    return failureResult(
      providerKey,
      'Live SMS sending is blocked: explicit live test guard is not enabled.',
      sensitiveValues,
      'blocked'
    );
  }

  if (providerKey === 'mobitech_official') {
    return failureResult(
      providerKey,
      'Mobitech Official sending is readiness-only until provider response details are confirmed.',
      sensitiveValues
    );
  }

  if (providerKey === 'textsms_compatible') {
    const payload = {
      apikey: api_key,
      partnerID: client_id,
      message,
      shortcode: sender_id || 'SMARTLANDY',
      mobile: normalizedTo
    };

    try {
      const url = api_url.replace(/\/$/, '') + '/api/services/sendsms/';
      const apiRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      const text = await apiRes.text();
      let apiData = null;
      try {
        apiData = JSON.parse(text);
      } catch {}

      if (!apiRes.ok) {
        return failureResult(providerKey, `HTTP Error Status ${apiRes.status}: ${text.substring(0, 100)}`, sensitiveValues);
      }

      const firstResponse = apiData?.responses?.[0];
      const responseCode = firstResponse?.['respose-code'];
      const responseDesc = firstResponse?.['response-description'] || 'No description';

      if (responseCode !== 200 && responseCode !== '200') {
        return failureResult(providerKey, `TextSMS Gateway Error ${responseCode}: ${responseDesc}`, sensitiveValues);
      }

      return successResult(providerKey, firstResponse?.messageid ? String(firstResponse.messageid) : `textsms-${crypto.randomUUID()}`);
    } catch (error) {
      return failureResult(providerKey, `TextSMS request failed: ${error.message}`, sensitiveValues);
    }
  }

  return failureResult(providerKey, `Unsupported SMS provider: "${provider}"`, sensitiveValues);
}

export function labelSmsProviderField(field) {
  return FIELD_LABELS[field] || field;
}

function successResult(provider, providerMessageId, providerCost = null) {
  return {
    ok: true,
    success: true,
    provider,
    status: 'sent',
    provider_message_id: providerMessageId,
    provider_cost: providerCost,
    sanitized_error: null,
    messageId: providerMessageId
  };
}

function failureResult(provider, message, sensitiveValues = [], status = 'failed') {
  const sanitized = sanitizeSmsProviderError(message, sensitiveValues);
  return {
    ok: false,
    success: false,
    provider,
    status,
    provider_message_id: null,
    provider_cost: null,
    sanitized_error: sanitized,
    error: sanitized
  };
}
