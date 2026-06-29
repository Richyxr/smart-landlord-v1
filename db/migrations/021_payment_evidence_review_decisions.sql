-- Migration 021: Add Manual Review Decision Metadata Columns to Payment Evidence
ALTER TABLE payment_evidence
  ADD COLUMN review_status TEXT,
  ADD COLUMN review_decision TEXT,
  ADD COLUMN reviewed_by BIGINT REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_notes TEXT,
  ADD COLUMN accepted_tenant_id BIGINT REFERENCES tenants(id),
  ADD COLUMN accepted_invoice_id BIGINT REFERENCES invoices(id),
  ADD COLUMN accepted_match_score INTEGER,
  ADD COLUMN accepted_match_confidence TEXT,
  ADD COLUMN rejected_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_evidence_review_status
  ON payment_evidence (organization_id, review_status);
