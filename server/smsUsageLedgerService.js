const DEFAULT_SMS_SETTINGS = {
  sms_billing_enabled: false,
  default_sms_sell_price: 0,
  default_sms_provider_cost: 0,
  sms_currency: 'KES',
  sms_free_monthly_allowance: 0,
  sms_markup_strategy: 'fixed'
};

export function sanitizeSmsLedgerError(message, sensitiveValues = []) {
  if (!message) return null;
  let sanitized = String(message);

  for (const value of sensitiveValues) {
    if (value && typeof value === 'string' && value.length > 2) {
      const escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      sanitized = sanitized.replace(new RegExp(escaped, 'gi'), '********');
    }
  }

  sanitized = sanitized
    .replace(/(key|token|password|pass|secret|auth|apikey)\s*[=:]\s*[^\s&;,\"]+/gi, '$1=********')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.slice(0, 500) || null;
}

export function normalizeSmsPricingSettings(settings = {}) {
  return {
    sms_billing_enabled: Boolean(settings.sms_billing_enabled),
    default_sms_sell_price: toMoneyNumber(settings.default_sms_sell_price),
    default_sms_provider_cost: toMoneyNumber(settings.default_sms_provider_cost),
    sms_currency: String(settings.sms_currency || settings.currency || 'KES').trim().toUpperCase() || 'KES',
    sms_free_monthly_allowance: Math.max(0, Number.parseInt(settings.sms_free_monthly_allowance || 0, 10) || 0),
    sms_markup_strategy: ['fixed', 'per_sms'].includes(settings.sms_markup_strategy) ? settings.sms_markup_strategy : 'fixed'
  };
}

export function validateSmsPricingInput(input = {}) {
  const providerCost = parseDecimalInput(input.default_sms_provider_cost);
  const sellPrice = parseDecimalInput(input.default_sms_sell_price);
  const currency = String(input.sms_currency || '').trim().toUpperCase();
  const billingEnabled = Boolean(input.sms_billing_enabled);

  if (providerCost === null || providerCost < 0) {
    return { error: 'default_sms_provider_cost must be a decimal greater than or equal to 0.' };
  }

  if (sellPrice === null || sellPrice < 0) {
    return { error: 'default_sms_sell_price must be a decimal greater than or equal to 0.' };
  }

  if (!currency) {
    return { error: 'sms_currency is required.' };
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: 'sms_currency must be a 3-letter currency code.' };
  }

  return {
    value: {
      sms_billing_enabled: billingEnabled,
      default_sms_provider_cost: providerCost.toFixed(4),
      default_sms_sell_price: sellPrice.toFixed(4),
      sms_currency: currency,
      sms_markup_strategy: ['fixed', 'per_sms'].includes(input.sms_markup_strategy) ? input.sms_markup_strategy : 'fixed',
      sms_free_monthly_allowance: Math.max(0, Number.parseInt(input.sms_free_monthly_allowance || 0, 10) || 0)
    }
  };
}

export function calculateSmsLedgerAmounts(settings = {}, smsUnits = 1) {
  const normalized = normalizeSmsPricingSettings({ ...DEFAULT_SMS_SETTINGS, ...settings });
  const units = Math.max(1, Number.parseInt(smsUnits || 1, 10) || 1);
  const providerUnitCost = normalized.default_sms_provider_cost;
  const billedUnitPrice = normalized.sms_billing_enabled ? normalized.default_sms_sell_price : 0;
  const providerTotalCost = roundMoney(providerUnitCost * units);
  const billedTotalAmount = roundMoney(billedUnitPrice * units);
  const marginAmount = roundMoney(billedTotalAmount - providerTotalCost);

  return {
    sms_units: units,
    provider_unit_cost: providerUnitCost.toFixed(4),
    provider_total_cost: providerTotalCost.toFixed(2),
    billed_unit_price: billedUnitPrice.toFixed(4),
    billed_total_amount: billedTotalAmount.toFixed(2),
    margin_amount: marginAmount.toFixed(2),
    currency: normalized.sms_currency
  };
}

export async function getPlatformSmsPricingSettings(activeDb) {
  const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  return normalizeSmsPricingSettings({ ...DEFAULT_SMS_SETTINGS, ...(settings || {}) });
}

export async function recordSmsUsageLedger(activeDb, input = {}) {
  if (!activeDb) return null;

  const settings = input.pricingSettings || await getPlatformSmsPricingSettings(activeDb);
  const amounts = calculateSmsLedgerAmounts(settings, input.sms_units || 1);
  const status = normalizeStatus(input.status);
  const timestamp = input.timestamp || new Date().toISOString();
  const failureReason = ['failed', 'blocked'].includes(status)
    ? sanitizeSmsLedgerError(input.failure_reason || input.error, input.sensitiveValues || [])
    : null;

  const row = {
    organization_id: input.organization_id || null,
    message_type: normalizeMessageType(input.message_type),
    recipient_phone_e164: String(input.recipient_phone_e164 || input.to || '').trim() || 'unknown',
    sender_id: input.sender_id || null,
    provider: input.provider || null,
    provider_message_id: input.provider_message_id || null,
    status,
    failure_reason: failureReason,
    ...amounts,
    source: input.source || 'manual',
    related_entity_type: input.related_entity_type || null,
    related_entity_id: input.related_entity_id || null,
    sent_at: status === 'sent' ? timestamp : null,
    delivered_at: status === 'delivered' ? timestamp : null,
    failed_at: ['failed', 'blocked'].includes(status) ? timestamp : null
  };

  return activeDb.insert('sms_usage_ledger', row);
}

export async function logSmsSystemError(activeDb, input = {}) {
  if (!activeDb?.insert) return null;
  const status = normalizeStatus(input.status);
  const severity = status === 'failed' ? 'warning' : 'warning';
  const message = sanitizeSmsLedgerError(input.message || input.failure_reason || input.error, input.sensitiveValues || []);

  if (!message) return null;

  return activeDb.insert('system_errors', {
    organization_id: input.organization_id || null,
    user_id: input.user_id || null,
    source: 'sms',
    severity,
    message,
    stack_trace: null,
    metadata: {
      category: 'sms',
      provider: input.provider || null,
      status,
      ledger_id: input.ledger_id || null
    },
    status: 'open'
  });
}

function normalizeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return ['queued', 'sent', 'delivered', 'failed', 'blocked'].includes(normalized) ? normalized : 'failed';
}

function normalizeMessageType(type) {
  const normalized = String(type || '').toLowerCase();
  return ['transactional', 'reminder', 'bulk', 'test'].includes(normalized) ? normalized : 'transactional';
}

function parseDecimalInput(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function toMoneyNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
