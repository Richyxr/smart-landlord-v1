-- Migration 027: Unified Payments Domain Foundation

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  payer_type TEXT NOT NULL CHECK (payer_type IN ('tenant', 'landlord', 'unknown', 'external')),
  payer_id BIGINT,
  payer_name TEXT,
  payer_phone TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'mpesa', 'bank_statement', 'card', 'cash', 'adjustment', 'wallet_credit')),
  source_id BIGINT,
  source_hash TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured', 'verified', 'rejected', 'duplicate', 'reversed', 'refunded')),
  allocation_status TEXT NOT NULL DEFAULT 'unallocated' CHECK (allocation_status IN ('unallocated', 'partially_allocated', 'fully_allocated', 'overpaid', 'pending_review')),
  description TEXT,
  reference TEXT,
  external_reference TEXT,
  provider TEXT,
  created_by_user_id BIGINT REFERENCES users(id),
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_source_hash_org ON payments (organization_id, source_hash) WHERE source_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments (organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (organization_id, status);

-- Alter payment_allocations table
ALTER TABLE payment_allocations ALTER COLUMN transaction_id DROP NOT NULL;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS payment_id BIGINT REFERENCES payments(id) ON DELETE CASCADE;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2);
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS allocated_by_user_id BIGINT REFERENCES users(id);
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS allocation_source TEXT CHECK (allocation_source IN ('manual', 'bank_reconciliation', 'mpesa_reconciliation', 'system'));
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS decision_id BIGINT;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS bank_transaction_id BIGINT REFERENCES confirmed_statement_transactions(id) ON DELETE SET NULL;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS metadata_json JSONB;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations (invoice_id);

-- Populate amount column with existing amount_allocated value
UPDATE payment_allocations SET amount = amount_allocated WHERE amount IS NULL;

-- Migrate existing payment transactions to payments table
DO $$
DECLARE
  r RECORD;
  new_payment_id BIGINT;
  p_type TEXT;
  p_source TEXT;
BEGIN
  FOR r IN SELECT * FROM transactions WHERE transaction_type = 'payment' LOOP
    -- Determine payer type
    IF r.tenant_id IS NOT NULL THEN
      p_type := 'tenant';
    ELSE
      p_type := 'unknown';
    END IF;

    -- Determine source type
    IF r.source = 'mpesa_callback' THEN
      p_source := 'mpesa';
    ELSIF r.source = 'bank_csv' OR r.source = 'bank_callback' THEN
      p_source := 'bank_statement';
    ELSE
      p_source := 'manual';
    END IF;

    -- Check if already migrated
    IF NOT EXISTS (SELECT 1 FROM payments WHERE organization_id = r.organization_id AND source_type = p_source AND source_id = r.id) THEN
      INSERT INTO payments (
        organization_id, payer_type, payer_id, payer_name, payer_phone,
        source_type, source_id, source_hash, amount, currency, received_at,
        verified_at, status, allocation_status, description, reference,
        external_reference, provider, created_by_user_id, created_at, updated_at
      ) VALUES (
        r.organization_id, p_type, r.tenant_id, r.payer_name, r.payer_phone,
        p_source, r.id, NULL, r.amount, r.currency, r.transaction_date,
        CASE WHEN r.status = 'reconciled' THEN r.transaction_date ELSE NULL END,
        CASE WHEN r.status = 'reversed' THEN 'reversed'::text
             WHEN r.status = 'duplicate' THEN 'duplicate'::text
             WHEN r.status = 'failed' THEN 'rejected'::text
             WHEN r.status = 'reconciled' THEN 'verified'::text
             ELSE 'captured'::text END,
        CASE WHEN r.status = 'reconciled' THEN 'fully_allocated'::text ELSE 'unallocated'::text END,
        'Migrated from transaction record', r.reference_number, r.reference_number,
        CASE WHEN p_source = 'mpesa' THEN 'MPesa' ELSE 'Bank' END, r.created_by, r.created_at, r.updated_at
      ) RETURNING id INTO new_payment_id;

      -- Update the corresponding payment_allocations row
      UPDATE payment_allocations SET payment_id = new_payment_id WHERE transaction_id = r.id;
    END IF;
  END LOOP;
END $$;
