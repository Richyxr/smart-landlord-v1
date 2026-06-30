-- Migration 023: Receipt storage foundation
-- Creates durable receipt storage only. This migration does not backfill or issue receipts.

CREATE TABLE IF NOT EXISTS receipts (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  invoice_id BIGINT NOT NULL REFERENCES invoices(id),
  transaction_id BIGINT NOT NULL REFERENCES transactions(id),
  payment_allocation_id BIGINT NOT NULL REFERENCES payment_allocations(id),
  payment_evidence_id BIGINT NOT NULL REFERENCES payment_evidence(id),
  receipt_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'voided')),
  issued_at TIMESTAMPTZ,
  issued_by_user_id BIGINT REFERENCES users(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  payment_method TEXT NOT NULL DEFAULT 'other',
  receipt_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_org_receipt_number
  ON receipts (organization_id, receipt_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_org_payment_allocation
  ON receipts (organization_id, payment_allocation_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_org_payment_evidence
  ON receipts (organization_id, payment_evidence_id);

CREATE INDEX IF NOT EXISTS idx_receipts_org_tenant
  ON receipts (organization_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_receipts_org_invoice
  ON receipts (organization_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_receipts_org_transaction
  ON receipts (organization_id, transaction_id);

CREATE INDEX IF NOT EXISTS idx_receipts_org_status
  ON receipts (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_receipts_org_issued_at
  ON receipts (organization_id, issued_at DESC);
