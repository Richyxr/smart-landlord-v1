-- Migration 025: Bank Reconciliation Queue & Matching Engine Foundation

ALTER TABLE confirmed_statement_transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Unmatched'
  CHECK (status IN ('Unmatched', 'Possible Match', 'Matched', 'Ignored', 'Duplicate', 'Needs Review', 'Confirmed'));
ALTER TABLE confirmed_statement_transactions ADD COLUMN IF NOT EXISTS confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100);
ALTER TABLE confirmed_statement_transactions ADD COLUMN IF NOT EXISTS matched_invoice_id BIGINT REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE confirmed_statement_transactions ADD COLUMN IF NOT EXISTS matched_tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE confirmed_statement_transactions ADD COLUMN IF NOT EXISTS match_reasoning JSONB;

CREATE INDEX IF NOT EXISTS idx_confirmed_txs_status ON confirmed_statement_transactions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_confirmed_txs_invoice ON confirmed_statement_transactions(matched_invoice_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_txs_tenant ON confirmed_statement_transactions(matched_tenant_id);
