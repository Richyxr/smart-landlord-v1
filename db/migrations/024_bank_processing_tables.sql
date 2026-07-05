-- Migration 024: Bank Statement Processing Engine

CREATE TABLE IF NOT EXISTS statement_uploads (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id),
  provider_guess TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'parsing', 'parsed', 'needs_review', 'confirmed', 'failed')),
  parse_engine TEXT,
  parse_summary_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statement_extracted_transactions (
  id BIGSERIAL PRIMARY KEY,
  statement_upload_id BIGINT NOT NULL REFERENCES statement_uploads(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  row_index INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  value_date DATE,
  description TEXT NOT NULL,
  reference TEXT,
  debit_amount NUMERIC(14,2),
  credit_amount NUMERIC(14,2),
  running_balance NUMERIC(14,2),
  normalized_amount NUMERIC(14,2) NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('debit', 'credit', 'unknown')),
  currency TEXT NOT NULL DEFAULT 'KES',
  confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100),
  raw_row_json JSONB,
  duplicate_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  validation_flags_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS confirmed_statement_transactions (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  statement_upload_id BIGINT NOT NULL REFERENCES statement_uploads(id) ON DELETE CASCADE,
  extracted_transaction_id BIGINT NOT NULL REFERENCES statement_extracted_transactions(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  amount NUMERIC(14,2) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('money_in', 'money_out')),
  running_balance NUMERIC(14,2),
  source_provider TEXT,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_statement_uploads_org ON statement_uploads(organization_id);
CREATE INDEX IF NOT EXISTS idx_statement_uploads_sha256 ON statement_uploads(organization_id, sha256_hash);

CREATE INDEX IF NOT EXISTS idx_statement_extracted_txs_org ON statement_extracted_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_statement_extracted_txs_upload ON statement_extracted_transactions(statement_upload_id);
CREATE INDEX IF NOT EXISTS idx_statement_extracted_txs_date ON statement_extracted_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_statement_extracted_txs_ref ON statement_extracted_transactions(reference);

CREATE INDEX IF NOT EXISTS idx_confirmed_txs_org ON confirmed_statement_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_txs_upload ON confirmed_statement_transactions(statement_upload_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_txs_date ON confirmed_statement_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_confirmed_txs_ref ON confirmed_statement_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_confirmed_txs_source_hash ON confirmed_statement_transactions(organization_id, source_hash);
