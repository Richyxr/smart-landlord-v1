-- Migration 031: Add Co-op Bank (Co-op Connect API) integration support to organization_integrations.
-- Updates provider_type check constraint to include 'coop' provider type.

ALTER TABLE organization_integrations DROP CONSTRAINT IF EXISTS organization_integrations_provider_type_check;

ALTER TABLE organization_integrations ADD CONSTRAINT organization_integrations_provider_type_check 
  CHECK (provider_type IN ('sms', 'mpesa', 'bank', 'whatsapp', 'email', 'coop'));

COMMENT ON CONSTRAINT organization_integrations_provider_type_check ON organization_integrations IS 'Allows sms, mpesa, bank, whatsapp, email, and coop integration provider types.';
