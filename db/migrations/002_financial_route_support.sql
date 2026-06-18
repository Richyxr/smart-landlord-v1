-- Adds columns/tables needed by the PostgreSQL financial route migration.
-- Safe to run whether 001 already included these objects or not.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reminder_channel TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_last_reminder_channel_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_last_reminder_channel_check
      CHECK (last_reminder_channel IN ('sms', 'email', 'whatsapp') OR last_reminder_channel IS NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_rates (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  service_type TEXT NOT NULL,
  label TEXT NOT NULL,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('per_unit', 'monthly_flat')),
  unit_label TEXT NOT NULL DEFAULT 'unit',
  rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_type)
);

CREATE INDEX IF NOT EXISTS idx_service_rates_org ON service_rates(organization_id, is_active);
