-- Phase 6: Webhook provider routing and signature validation columns.
-- Adds provider-specific identifiers and webhook secrets to organization_integrations
-- so that inbound callbacks can be routed to the correct organization and validated
-- before any financial processing occurs.

-- Provider routing columns
ALTER TABLE organization_integrations
  ADD COLUMN IF NOT EXISTS shortcode TEXT,
  ADD COLUMN IF NOT EXISTS account_reference TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS provider_identifier TEXT;

-- Comments for documentation
COMMENT ON COLUMN organization_integrations.shortcode IS 'M-Pesa shortcode or paybill number used to route inbound callbacks to the owning organization.';
COMMENT ON COLUMN organization_integrations.account_reference IS 'Expected account reference prefix for M-Pesa payments (e.g. ACC- prefix pattern).';
COMMENT ON COLUMN organization_integrations.webhook_secret IS 'HMAC secret, M-Pesa passkey, or URL callback token used to validate inbound webhook signatures.';
COMMENT ON COLUMN organization_integrations.provider_identifier IS 'Generic provider identifier such as bank code or partner ID for non-M-Pesa integrations.';

-- Fast lookup index for webhook routing: given a provider type and shortcode,
-- find the active integration row without a full table scan.
CREATE INDEX IF NOT EXISTS idx_integrations_provider_shortcode
  ON organization_integrations (provider_type, shortcode)
  WHERE shortcode IS NOT NULL AND is_active = true;

-- Fast lookup for bank webhooks by provider_identifier.
CREATE INDEX IF NOT EXISTS idx_integrations_provider_identifier
  ON organization_integrations (provider_type, provider_identifier)
  WHERE provider_identifier IS NOT NULL AND is_active = true;
