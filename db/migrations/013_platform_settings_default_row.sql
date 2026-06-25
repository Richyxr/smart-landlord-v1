-- Ensure a default platform_billing_settings row exists for admin/platform email and SaaS defaults.
-- This is idempotent and does not overwrite existing production values.

INSERT INTO platform_billing_settings (
  id,
  country,
  currency,
  price_per_active_tenant,
  grace_period_days,
  is_default,
  mpesa_shortcode
)
VALUES (
  1,
  'Kenya',
  'KES',
  200,
  7,
  TRUE,
  '174379'
)
ON CONFLICT (id) DO NOTHING;
