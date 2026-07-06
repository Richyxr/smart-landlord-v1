-- Migration 028: Add Payment Allocation Audit Events Table

CREATE TABLE IF NOT EXISTS payment_allocation_audit_events (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  allocation_id BIGINT REFERENCES payment_allocations(id) ON DELETE SET NULL,
  decision_id BIGINT REFERENCES bank_reconciliation_decisions(id) ON DELETE SET NULL,
  bank_transaction_id BIGINT REFERENCES confirmed_statement_transactions(id) ON DELETE SET NULL,
  previous_invoice_balance NUMERIC(14,2) NOT NULL,
  new_invoice_balance NUMERIC(14,2) NOT NULL,
  allocated_amount NUMERIC(14,2) NOT NULL CHECK (allocated_amount > 0),
  allocation_source TEXT NOT NULL CHECK (allocation_source IN ('manual', 'bank_reconciliation', 'mpesa_reconciliation', 'system')),
  source_hash TEXT,
  action TEXT NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_audit_org ON payment_allocation_audit_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_audit_payment ON payment_allocation_audit_events (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_audit_invoice ON payment_allocation_audit_events (invoice_id);
