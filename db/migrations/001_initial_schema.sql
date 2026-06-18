-- Smart Landlord MVP initial PostgreSQL schema
-- Production target schema for replacing server/data/db.json.

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  auth_provider_uid TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_number TEXT NOT NULL,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'pending_verification')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('individual', 'company')),
  registration_number TEXT,
  tax_identifier TEXT,
  email TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Kenya',
  billing_currency TEXT NOT NULL DEFAULT 'KES',
  subscription_tier TEXT NOT NULL DEFAULT 'standard',
  subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trial', 'active', 'overdue', 'locked', 'suspended', 'cancelled')),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  security_pin_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE organization_members (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('landlord', 'caretaker')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE staff_assignments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  caretaker_user_id BIGINT NOT NULL REFERENCES users(id),
  access_level TEXT NOT NULL DEFAULT 'caretaker' CHECK (access_level IN ('caretaker')),
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'disabled')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  property_type TEXT NOT NULL,
  location TEXT,
  county TEXT,
  town TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE staff_assignment_properties (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  staff_assignment_id BIGINT NOT NULL REFERENCES staff_assignments(id) ON DELETE CASCADE,
  property_id BIGINT NOT NULL REFERENCES properties(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, staff_assignment_id, property_id)
);

CREATE TABLE units (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  property_id BIGINT NOT NULL REFERENCES properties(id),
  unit_code TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  rent_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rent_amount >= 0),
  deposit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  status TEXT NOT NULL DEFAULT 'vacant'
    CHECK (status IN ('vacant', 'occupied', 'inactive', 'under_maintenance')),
  floor TEXT,
  block TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, property_id, unit_code)
);

CREATE TABLE tenants (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  property_id BIGINT NOT NULL REFERENCES properties(id),
  unit_id BIGINT NOT NULL REFERENCES units(id),
  tenant_identifier TEXT NOT NULL,
  tenant_account_number TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  id_number TEXT,
  move_in_date DATE NOT NULL,
  move_out_date DATE,
  rent_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rent_amount >= 0),
  billing_day INTEGER NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 31),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'notice', 'vacated', 'inactive', 'deleted')),
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, tenant_identifier),
  UNIQUE (organization_id, tenant_account_number)
);

CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  property_id BIGINT NOT NULL REFERENCES properties(id),
  unit_id BIGINT NOT NULL REFERENCES units(id),
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  invoice_number TEXT NOT NULL,
  invoice_type TEXT NOT NULL DEFAULT 'rent'
    CHECK (invoice_type IN ('rent', 'utility', 'deposit', 'penalty', 'other')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void')),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  notes TEXT,
  created_by BIGINT REFERENCES users(id),
  issued_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_by BIGINT REFERENCES users(id),
  last_reminder_sent_at TIMESTAMPTZ,
  last_reminder_channel TEXT CHECK (last_reminder_channel IN ('sms', 'email', 'whatsapp') OR last_reminder_channel IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_number)
);

CREATE TABLE invoice_items (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'other'
    CHECK (item_type IN ('rent', 'water', 'electricity', 'service_charge', 'deposit', 'penalty', 'other')),
  quantity NUMERIC(14,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  tenant_id BIGINT REFERENCES tenants(id),
  property_id BIGINT REFERENCES properties(id),
  unit_id BIGINT REFERENCES units(id),
  invoice_id BIGINT REFERENCES invoices(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('payment', 'reversal', 'adjustment', 'credit')),
  payment_method TEXT NOT NULL DEFAULT 'other'
    CHECK (payment_method IN ('mpesa', 'bank', 'cash', 'other')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'mpesa_callback', 'bank_callback', 'bank_csv')),
  reference_number TEXT,
  account_number TEXT,
  payer_name TEXT,
  payer_phone TEXT,
  transaction_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reconciled', 'unmatched', 'reversed', 'duplicate', 'failed', 'archived')),
  raw_payload JSONB,
  created_by BIGINT REFERENCES users(id),
  reconciled_by BIGINT REFERENCES users(id),
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX transactions_unique_reference_per_org
  ON transactions (organization_id, reference_number)
  WHERE reference_number IS NOT NULL AND status <> 'failed';

CREATE TABLE payment_allocations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  transaction_id BIGINT NOT NULL REFERENCES transactions(id),
  invoice_id BIGINT NOT NULL REFERENCES invoices(id),
  amount_allocated NUMERIC(14,2) NOT NULL CHECK (amount_allocated > 0),
  allocated_by BIGINT REFERENCES users(id),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_batches (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  uploaded_by BIGINT REFERENCES users(id),
  source_type TEXT NOT NULL DEFAULT 'bank_csv' CHECK (source_type IN ('bank_csv')),
  original_file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsed', 'reviewed', 'finalized', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  matched_rows INTEGER NOT NULL DEFAULT 0 CHECK (matched_rows >= 0),
  unmatched_rows INTEGER NOT NULL DEFAULT 0 CHECK (unmatched_rows >= 0),
  duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  invalid_rows INTEGER NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE reconciliation_staging_rows (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  batch_id BIGINT REFERENCES reconciliation_batches(id),
  raw_row_data JSONB,
  transaction_date TIMESTAMPTZ,
  amount NUMERIC(14,2) CHECK (amount >= 0),
  reference_number TEXT,
  account_number TEXT,
  description TEXT,
  payer_name TEXT,
  payer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'imported'
    CHECK (status IN ('imported', 'auto_matched', 'needs_review', 'unmatched', 'duplicate', 'invalid', 'reconciled', 'ignored')),
  suggested_tenant_id BIGINT REFERENCES tenants(id),
  suggested_unit_id BIGINT REFERENCES units(id),
  suggested_invoice_id BIGINT REFERENCES invoices(id),
  confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100),
  matched_transaction_id BIGINT REFERENCES transactions(id),
  reviewed_by BIGINT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staging_unique_reference_per_org
  ON reconciliation_staging_rows (organization_id, reference_number)
  WHERE reference_number IS NOT NULL AND status <> 'ignored';

CREATE TABLE archived_transactions (
  id BIGSERIAL PRIMARY KEY,
  original_transaction_id BIGINT NOT NULL REFERENCES transactions(id),
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  archived_by BIGINT REFERENCES users(id),
  archive_reason TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transaction_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meter_readings (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  property_id BIGINT NOT NULL REFERENCES properties(id),
  unit_id BIGINT NOT NULL REFERENCES units(id),
  tenant_id BIGINT REFERENCES tenants(id),
  meter_type TEXT NOT NULL CHECK (meter_type IN ('water', 'electricity', 'other')),
  previous_reading NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_reading NUMERIC(14,2) NOT NULL,
  usage NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (usage >= 0),
  reading_date DATE NOT NULL,
  submitted_by BIGINT NOT NULL REFERENCES users(id),
  reviewed_by BIGINT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewed', 'approved', 'rejected', 'billed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE internal_messages (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  sender_user_id BIGINT NOT NULL REFERENCES users(id),
  recipient_user_id BIGINT NOT NULL REFERENCES users(id),
  property_id BIGINT REFERENCES properties(id),
  unit_id BIGINT REFERENCES units(id),
  message_body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE TABLE service_rates (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  service_type TEXT NOT NULL,
  label TEXT NOT NULL,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('per_unit', 'monthly_flat')),
  unit_label TEXT NOT NULL DEFAULT 'unit',
  rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_type)
);

CREATE TABLE organization_integrations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  provider_type TEXT NOT NULL CHECK (provider_type IN ('sms', 'mpesa', 'bank', 'whatsapp', 'email')),
  provider_name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'live')),
  config_json_encrypted TEXT,
  callback_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'draft', 'needs_credentials', 'test_failed', 'ready', 'live', 'disabled')),
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_type)
);

CREATE TABLE integration_test_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  integration_id BIGINT NOT NULL REFERENCES organization_integrations(id) ON DELETE CASCADE,
  tested_by BIGINT REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  response_summary TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_settings (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL UNIQUE REFERENCES organizations(id),
  rent_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_days_before_due INTEGER NOT NULL DEFAULT 3 CHECK (reminder_days_before_due >= 0),
  payment_confirmation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  unmatched_payment_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  meter_reading_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  billing_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  user_id BIGINT REFERENCES users(id),
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'informational'
    CHECK (priority IN ('critical', 'actionable', 'informational')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE TABLE notification_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  recipient_user_id BIGINT REFERENCES users(id),
  tenant_id BIGINT REFERENCES tenants(id),
  phone_number TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'in_app')),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_reference TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id),
  actor_user_id BIGINT REFERENCES users(id),
  actor_role TEXT,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id BIGINT,
  old_values JSONB,
  new_values JSONB,
  metadata JSONB,
  pin_validation_status TEXT CHECK (pin_validation_status IN ('success', 'failed') OR pin_validation_status IS NULL),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_access_sessions (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id BIGINT NOT NULL REFERENCES users(id),
  target_organization_id BIGINT NOT NULL REFERENCES organizations(id),
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id BIGINT REFERENCES users(id),
  target_organization_id BIGINT REFERENCES organizations(id),
  action TEXT NOT NULL,
  reason TEXT,
  impersonation_session_id BIGINT REFERENCES support_access_sessions(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_errors (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id),
  user_id BIGINT REFERENCES users(id),
  source TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message TEXT NOT NULL,
  stack_trace TEXT,
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_billing_settings (
  id BIGSERIAL PRIMARY KEY,
  country TEXT NOT NULL DEFAULT 'Kenya',
  currency TEXT NOT NULL DEFAULT 'KES',
  price_per_active_tenant NUMERIC(14,2) NOT NULL CHECK (price_per_active_tenant >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_period_days >= 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  mpesa_shortcode TEXT,
  bank_account_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_billing_invoices (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  billing_period_start TIMESTAMPTZ NOT NULL,
  billing_period_end TIMESTAMPTZ NOT NULL,
  billing_currency TEXT NOT NULL DEFAULT 'KES',
  active_tenant_count INTEGER NOT NULL DEFAULT 0 CHECK (active_tenant_count >= 0),
  price_per_active_tenant NUMERIC(14,2) NOT NULL CHECK (price_per_active_tenant >= 0),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'overdue', 'paid', 'void')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, billing_period_start, billing_period_end)
);

CREATE TABLE platform_billing_payments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  billing_invoice_id BIGINT NOT NULL REFERENCES platform_billing_invoices(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mpesa', 'bank', 'cash', 'other')),
  reference_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed', 'reversed')),
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference_number)
);

CREATE TABLE deletion_requests (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  requested_by BIGINT NOT NULL REFERENCES users(id),
  request_type TEXT NOT NULL
    CHECK (request_type IN ('organization_account', 'tenant_data', 'api_credentials')),
  target_user_id BIGINT REFERENCES users(id),
  target_tenant_id BIGINT REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'reviewing', 'completed', 'rejected')),
  reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_requests (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  property_id BIGINT NOT NULL REFERENCES properties(id),
  unit_id BIGINT REFERENCES units(id),
  tenant_id BIGINT REFERENCES tenants(id),
  reported_by_user_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  photo_url TEXT,
  assigned_to_user_id BIGINT REFERENCES users(id),
  estimated_cost NUMERIC(14,2) CHECK (estimated_cost >= 0),
  actual_cost NUMERIC(14,2) CHECK (actual_cost >= 0),
  cost_approved_by BIGINT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_owner ON organizations(owner_user_id);
CREATE INDEX idx_members_user ON organization_members(user_id);
CREATE INDEX idx_properties_org ON properties(organization_id);
CREATE INDEX idx_units_org_property ON units(organization_id, property_id);
CREATE INDEX idx_tenants_org_property_unit ON tenants(organization_id, property_id, unit_id);
CREATE INDEX idx_invoices_org_tenant_status ON invoices(organization_id, tenant_id, status);
CREATE INDEX idx_transactions_org_tenant_status ON transactions(organization_id, tenant_id, status);
CREATE INDEX idx_transactions_org_reference ON transactions(organization_id, reference_number);
CREATE INDEX idx_allocations_org_invoice ON payment_allocations(organization_id, invoice_id);
CREATE INDEX idx_staging_org_status ON reconciliation_staging_rows(organization_id, status);
CREATE INDEX idx_meter_readings_org_unit ON meter_readings(organization_id, unit_id);
CREATE INDEX idx_messages_org_recipient ON internal_messages(organization_id, recipient_user_id, is_read);
CREATE INDEX idx_service_rates_org ON service_rates(organization_id, is_active);
CREATE INDEX idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_notifications_org_user ON notifications(organization_id, user_id, is_read);
CREATE INDEX idx_billing_invoices_org_status ON platform_billing_invoices(organization_id, status);
CREATE INDEX idx_maintenance_org_status ON maintenance_requests(organization_id, status);
