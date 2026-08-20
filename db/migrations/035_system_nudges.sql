-- Migration: 035_system_nudges.sql
-- Description: System Intelligence & Proactive Action Nudges Table

CREATE TABLE IF NOT EXISTS system_nudges (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_role TEXT NOT NULL CHECK (target_role IN ('landlord', 'caretaker', 'tenant', 'super_admin')),
  target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('meter_reading', 'billing', 'reconciliation', 'lease', 'maintenance', 'security', 'saas')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'success')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_label TEXT,
  action_url TEXT,
  action_type TEXT,
  action_payload JSONB,
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_nudges_org_role ON system_nudges(organization_id, target_role, is_resolved);
CREATE INDEX IF NOT EXISTS idx_system_nudges_category ON system_nudges(category);
CREATE INDEX IF NOT EXISTS idx_system_nudges_created ON system_nudges(created_at DESC);
