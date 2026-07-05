-- Migration 026: Add Bank Reconciliation Decisions and Adjust Status Constraint

CREATE TABLE IF NOT EXISTS bank_reconciliation_decisions (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  bank_transaction_id BIGINT NOT NULL REFERENCES confirmed_statement_transactions(id) ON DELETE CASCADE,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'allocated', 'rejected')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_decisions_org ON bank_reconciliation_decisions(organization_id);
CREATE INDEX IF NOT EXISTS idx_bank_recon_decisions_tx ON bank_reconciliation_decisions(bank_transaction_id);

-- Drop the old constraint if it exists and add the updated status constraint
ALTER TABLE confirmed_statement_transactions DROP CONSTRAINT IF EXISTS confirmed_statement_transactions_status_check;
ALTER TABLE confirmed_statement_transactions ADD CONSTRAINT confirmed_statement_transactions_status_check
  CHECK (status IN ('Unmatched', 'Possible Match', 'Matched', 'Ignored', 'Duplicate', 'Needs Review', 'Confirmed', 'Match Approved', 'Ready for Allocation'));
