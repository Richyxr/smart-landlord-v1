-- Migration: 032_kcb_buni_integration.sql
-- Description: Add 'kcb_buni' to organization_integrations provider_type_check constraint

ALTER TABLE organization_integrations
DROP CONSTRAINT IF EXISTS organization_integrations_provider_type_check;

ALTER TABLE organization_integrations
ADD CONSTRAINT organization_integrations_provider_type_check
CHECK (provider_type IN ('sms', 'mpesa', 'bank', 'coop', 'kcb_buni', 'whatsapp', 'email'));
