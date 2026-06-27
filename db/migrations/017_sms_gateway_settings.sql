-- Add SMS Gateway settings columns to platform_billing_settings
ALTER TABLE platform_billing_settings
  ADD COLUMN IF NOT EXISTS sms_provider TEXT,
  ADD COLUMN IF NOT EXISTS sms_api_url TEXT,
  ADD COLUMN IF NOT EXISTS sms_config_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS sms_sender_id TEXT NOT NULL DEFAULT 'SMARTLANDY',
  ADD COLUMN IF NOT EXISTS sms_sender_id_type TEXT NOT NULL DEFAULT 'transactional'
    CHECK (sms_sender_id_type IN ('transactional', 'promotional', 'both')),
  ADD COLUMN IF NOT EXISTS sms_sender_approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sms_sender_approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS sms_default_country_code TEXT NOT NULL DEFAULT '+254',
  ADD COLUMN IF NOT EXISTS sms_status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (sms_status IN ('not_configured', 'verified', 'active', 'test_failed', 'disabled')),
  ADD COLUMN IF NOT EXISTS sms_last_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_last_error TEXT;
