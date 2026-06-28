-- Migration 020: Payment Evidence normalized schema foundation with Refinements

CREATE TABLE IF NOT EXISTS payment_evidence_batches (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  upload_filename TEXT,
  sha256 TEXT,
  import_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by BIGINT REFERENCES users(id),
  detected_provider TEXT,
  detected_format TEXT,
  parser_version TEXT,
  statement_period TEXT,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_ignored INTEGER NOT NULL DEFAULT 0,
  rows_duplicated INTEGER NOT NULL DEFAULT 0,
  rows_reconciled INTEGER NOT NULL DEFAULT 0,
  rows_needing_review INTEGER NOT NULL DEFAULT 0,
  rows_failed_validation INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_evidence (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  batch_id BIGINT REFERENCES payment_evidence_batches(id),
  source_provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_perspective TEXT NOT NULL CHECK (source_perspective IN ('landlord', 'tenant', 'unknown')),
  collection_channel TEXT NOT NULL,
  document_source TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_time TIME,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit', 'unknown')),
  transaction_code TEXT,
  payer_name TEXT,
  payer_phone TEXT,
  recipient_name TEXT,
  recipient_phone TEXT,
  paybill_number TEXT,
  till_number TEXT,
  agent_number TEXT,
  reference_account TEXT,
  description TEXT,
  raw_text TEXT,
  raw_fields JSONB,
  row_hash TEXT NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  evidence_strength TEXT NOT NULL CHECK (evidence_strength IN ('verified', 'high', 'medium', 'low', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('imported', 'ignored', 'duplicate', 'candidate_found', 'needs_review', 'auto_reconciled', 'manually_reconciled', 'failed_validation')),
  ignored_reason TEXT,

  -- Prepare future matchers placeholders
  paybill_reference TEXT,
  bank_reference TEXT,
  recipient_account TEXT,
  invoice_reference TEXT,
  landlord_account_number TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_evidence_unique_hash_per_org
  ON payment_evidence (organization_id, row_hash);

CREATE INDEX IF NOT EXISTS idx_payment_evidence_org_status
  ON payment_evidence (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_evidence_tx_code
  ON payment_evidence (transaction_code)
  WHERE transaction_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_evidence_reference_account
ON payment_evidence (organization_id, reference_account)
WHERE reference_account IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_evidence_payer_phone
ON payment_evidence (organization_id, payer_phone)
WHERE payer_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_evidence_batch
ON payment_evidence (batch_id);
