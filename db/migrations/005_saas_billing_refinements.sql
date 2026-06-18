-- Phase 9: SaaS platform billing invoice refinements.
-- Adds an invoice_number column to platform_billing_invoices.

ALTER TABLE platform_billing_invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- Update existing rows if any
UPDATE platform_billing_invoices
  SET invoice_number = 'PLAT-INV-' || LPAD(id::text, 6, '0')
  WHERE invoice_number IS NULL;

-- Enforce constraints
ALTER TABLE platform_billing_invoices
  ALTER COLUMN invoice_number SET NOT NULL,
  ADD CONSTRAINT platform_billing_invoices_invoice_number_unique UNIQUE (invoice_number);

COMMENT ON COLUMN platform_billing_invoices.invoice_number IS 'Human readable sequence identifier for platform SaaS billing invoices.';
