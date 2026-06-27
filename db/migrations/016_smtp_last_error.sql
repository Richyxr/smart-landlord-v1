-- Add smtp_last_error column to platform_billing_settings
ALTER TABLE platform_billing_settings
  ADD COLUMN IF NOT EXISTS smtp_last_error TEXT;
