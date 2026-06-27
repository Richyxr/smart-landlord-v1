-- Migration 019: SMS usage billing ledger foundation

ALTER TABLE platform_billing_settings
  ADD COLUMN IF NOT EXISTS sms_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_sms_sell_price NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (default_sms_sell_price >= 0),
  ADD COLUMN IF NOT EXISTS default_sms_provider_cost NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (default_sms_provider_cost >= 0),
  ADD COLUMN IF NOT EXISTS sms_currency TEXT NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS sms_free_monthly_allowance INTEGER NOT NULL DEFAULT 0 CHECK (sms_free_monthly_allowance >= 0),
  ADD COLUMN IF NOT EXISTS sms_markup_strategy TEXT NOT NULL DEFAULT 'fixed'
    CHECK (sms_markup_strategy IN ('fixed', 'per_sms'));

CREATE TABLE IF NOT EXISTS sms_usage_ledger (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id),
  message_type TEXT NOT NULL DEFAULT 'transactional'
    CHECK (message_type IN ('transactional', 'reminder', 'bulk', 'test')),
  recipient_phone_e164 TEXT NOT NULL,
  sender_id TEXT,
  provider TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'blocked')),
  failure_reason TEXT,
  sms_units INTEGER NOT NULL DEFAULT 1 CHECK (sms_units > 0),
  provider_unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (provider_unit_cost >= 0),
  provider_total_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (provider_total_cost >= 0),
  billed_unit_price NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (billed_unit_price >= 0),
  billed_total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (billed_total_amount >= 0),
  margin_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KES',
  source TEXT NOT NULL DEFAULT 'manual',
  related_entity_type TEXT,
  related_entity_id BIGINT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_usage_ledger_org_created
  ON sms_usage_ledger (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_usage_ledger_status_created
  ON sms_usage_ledger (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_usage_ledger_month_summary
  ON sms_usage_ledger (created_at DESC, organization_id, status);
