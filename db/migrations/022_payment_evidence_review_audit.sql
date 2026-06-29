-- Migration 022: Add Manual Review Decision Audit Trail
CREATE TABLE IF NOT EXISTS payment_evidence_review_audit (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  payment_evidence_id BIGINT NOT NULL REFERENCES payment_evidence(id),
  action TEXT NOT NULL,
  previous_review_status TEXT,
  new_review_status TEXT,
  previous_review_decision TEXT,
  new_review_decision TEXT,
  previous_accepted_tenant_id BIGINT,
  new_accepted_tenant_id BIGINT,
  previous_accepted_invoice_id BIGINT,
  new_accepted_invoice_id BIGINT,
  previous_accepted_match_score INTEGER,
  new_accepted_match_score INTEGER,
  previous_accepted_match_confidence TEXT,
  new_accepted_match_confidence TEXT,
  previous_rejected_reason TEXT,
  new_rejected_reason TEXT,
  previous_review_notes TEXT,
  new_review_notes TEXT,
  actor_user_id BIGINT REFERENCES users(id),
  actor_role TEXT,
  actor_ip TEXT,
  user_agent TEXT,
  safety_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pe_review_audit_evidence
  ON payment_evidence_review_audit (organization_id, payment_evidence_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pe_review_audit_created_at
  ON payment_evidence_review_audit (organization_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pe_review_audit_actor_user
  ON payment_evidence_review_audit (actor_user_id, created_at);
