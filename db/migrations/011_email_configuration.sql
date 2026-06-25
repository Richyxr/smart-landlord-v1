-- Email configuration split: platform email + landlord email mode

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS email_delivery_mode TEXT NOT NULL DEFAULT 'use_platform_email'
    CHECK (email_delivery_mode IN ('use_platform_email', 'use_custom_smtp'));

ALTER TABLE platform_billing_settings
  ADD COLUMN IF NOT EXISTS smtp_config_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS smtp_status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (smtp_status IN ('not_configured', 'needs_credentials', 'test_failed', 'verified', 'active')),
  ADD COLUMN IF NOT EXISTS smtp_last_tested_at TIMESTAMPTZ;
