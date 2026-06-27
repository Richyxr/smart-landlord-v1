import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateOrganizationAccountNumber, normalizeOrganizationAccountNumber } from './organizationAccountNumbers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Ensure data folder exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Default Schema Structure
const defaultDb = {
  users: [],
  organizations: [],
  organization_members: [],
  staff_assignments: [],
  staff_assignment_properties: [],
  properties: [],
  units: [],
  tenants: [],
  invoices: [],
  invoice_items: [],
  transactions: [],
  payment_allocations: [],
  reconciliation_batches: [],
  reconciliation_staging_rows: [],
  archived_transactions: [],
  meter_readings: [],
  service_rates: [],
  internal_messages: [],
  organization_integrations: [],
  integration_test_logs: [],
  notification_settings: [],
  notifications: [],
  notification_logs: [],
  audit_logs: [],
  support_access_sessions: [],
  system_audit_logs: [],
  system_errors: [],
  platform_billing_settings: [],
  platform_billing_invoices: [],
  platform_billing_payments: [],
  deletion_requests: [],
  maintenance_requests: [],
  otp_codes: [],
  password_reset_tokens: []
};

// Reading the DB
export function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      writeDb(defaultDb);
      seedDb();
      return ensureOrganizationAccountNumbers(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    }
    const content = fs.readFileSync(DB_FILE, 'utf8');
    if (!content.trim()) {
      writeDb(defaultDb);
      seedDb();
      return ensureOrganizationAccountNumbers(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    }
    return ensureOrganizationAccountNumbers(JSON.parse(content));
  } catch (error) {
    console.error('Error reading database file, resetting:', error);
    writeDb(defaultDb);
    return defaultDb;
  }
}

function ensureOrganizationAccountNumbers(data) {
  if (!data || !Array.isArray(data.organizations)) return data;

  let changed = false;
  const used = new Set(
    data.organizations
      .map(org => normalizeOrganizationAccountNumber(org.account_number))
      .filter(Boolean)
  );

  for (const org of data.organizations) {
    if (!String(org.account_number || '').trim()) {
      const idNumber = Number(org.id || 0);
      const preferred = idNumber > 0 ? `SL-ORG-${String(idNumber).padStart(6, '0')}` : '';
      org.account_number = preferred && !used.has(preferred)
        ? preferred
        : generateOrganizationAccountNumber(data.organizations);
      used.add(org.account_number);
      changed = true;
    }
  }

  if (changed) {
    writeDb(data);
  }

  return data;
}

// Writing the DB atomically
export function writeDb(data) {
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (error) {
    console.error('Error writing database file:', error);
    return false;
  }
}

// Database CRUD operations
export const db = {
  get(table) {
    const data = readDb();
    return data[table] || [];
  },

  find(table, filterObj) {
    const rows = this.get(table);
    return rows.filter(row => {
      for (const key in filterObj) {
        // Handle soft deletes if filtering is active
        if (key === 'deleted_at' && filterObj[key] === null) {
          if (row.deleted_at !== null && row.deleted_at !== undefined) return false;
          continue;
        }
        if (row[key] !== filterObj[key]) return false;
      }
      return true;
    });
  },

  findOne(table, filterObj) {
    const results = this.find(table, filterObj);
    return results.length > 0 ? results[0] : null;
  },

  insert(table, rowData) {
    const data = readDb();
    if (!data[table]) data[table] = [];

    // Auto increment ID
    const maxId = data[table].reduce((max, r) => (r.id > max ? r.id : max), 0);
    const newId = maxId + 1;

    const newRow = {
      id: newId,
      ...rowData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    data[table].push(newRow);
    writeDb(data);
    return newRow;
  },

  update(table, query, updates) {
    const data = readDb();
    if (!data[table]) return [];

    const updatedRows = [];
    const isId = typeof query === 'number';

    data[table] = data[table].map(row => {
      let match = false;
      if (isId) {
        match = row.id === query;
      } else {
        match = true;
        for (const key in query) {
          if (row[key] !== query[key]) {
            match = false;
            break;
          }
        }
      }

      if (match) {
        const updatedRow = {
          ...row,
          ...updates,
          updated_at: new Date().toISOString()
        };
        updatedRows.push(updatedRow);
        return updatedRow;
      }
      return row;
    });

    writeDb(data);
    return updatedRows;
  },

  delete(table, query) {
    const data = readDb();
    if (!data[table]) return false;

    const isId = typeof query === 'number';
    const initialLength = data[table].length;

    data[table] = data[table].filter(row => {
      if (isId) return row.id !== query;
      for (const key in query) {
        if (row[key] !== query[key]) return true;
      }
      return false;
    });

    writeDb(data);
    return data[table].length < initialLength;
  },

  // Log system error
  logError(orgId, userId, source, message, stack = null, metadata = {}) {
    return this.insert('system_errors', {
      organization_id: orgId,
      user_id: userId,
      source,
      severity: 'error',
      message,
      stack_trace: stack,
      metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
      status: 'open'
    });
  },

  // Log audit event
  logAudit(orgId, actorUserId, actorRole, actionType, targetType, targetId, oldValues = null, newValues = null, reason = '', pinValidated = null) {
    return this.insert('audit_logs', {
      organization_id: orgId,
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: actionType,
      target_type: targetType,
      target_id: targetId,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      pin_validation_status: pinValidated,
      reason,
      metadata: JSON.stringify({ ip: '127.0.0.1', device: 'Mobile Admin Web' })
    });
  }
};

// Seed function to create initial mock data
function seedDb() {
  console.log('Seeding database with Smart Landlord MVP mock data...');
  const data = readDb();

  // Create Users
  // Password hash isn't used strictly since we mock authentication, but we keep structure
  const adminUser = { id: 1, email: 'admin@smartlandlord.com', is_super_admin: true, email_verified: true, phone_number: '+254700000000', phone_verified: true, name: 'Super Admin', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const landlordUser = { id: 2, email: 'landlord@demo.com', is_super_admin: false, email_verified: true, phone_number: '+254712345678', phone_verified: true, name: 'Maina Kamau', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const caretakerUser = { id: 3, email: 'caretaker@demo.com', is_super_admin: false, email_verified: true, phone_number: '+254722111222', phone_verified: true, name: 'Juma Omondi', caretaker_pin_hash: '$2a$10$LhgFLAFrl6frTX9../AgreYmI1T5/oJPLGrNznXu5H0JuW7L0iblm', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  
  data.users = [adminUser, landlordUser, caretakerUser];

  // Create Organizations
  // Local JSON/demo only: caretaker demo PIN is 123456.
  // Production caretaker PINs are generated per caretaker and stored only as bcrypt hashes.
  const pinHash = '$2a$10$LhgFLAFrl6frTX9../AgreYmI1T5/oJPLGrNznXu5H0JuW7L0iblm'; // Hashed version of '123456' using bcryptjs

  const landlordOrg = {
    id: 1,
    owner_user_id: 2,
    account_number: 'SL-ORG-000001',
    name: 'Kamau Properties Ltd',
    type: 'company',
    registration_number: 'CPR/2022/1009482',
    tax_identifier: 'P051234567A',
    email: 'info@kamauproperties.co.ke',
    phone_number: '+254712345678',
    country: 'Kenya',
    billing_currency: 'KES',
    email_delivery_mode: 'use_platform_email',
    subscription_tier: 'standard',
    subscription_status: 'active',
    is_locked: false,
    security_pin_hash: pinHash,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  data.organizations = [landlordOrg];

  // Default Service Billing Rates
  data.service_rates = [
    {
      id: 1,
      organization_id: 1,
      service_type: 'water',
      label: 'Water',
      rate_type: 'per_unit', // 'per_unit' | 'monthly_flat'
      unit_label: 'unit',
      rate: 150,
      currency: 'KES',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 2,
      organization_id: 1,
      service_type: 'electricity',
      label: 'Electricity',
      rate_type: 'per_unit',
      unit_label: 'unit',
      rate: 25,
      currency: 'KES',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 3,
      organization_id: 1,
      service_type: 'garbage',
      label: 'Garbage Collection',
      rate_type: 'monthly_flat',
      unit_label: 'month',
      rate: 500,
      currency: 'KES',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 4,
      organization_id: 1,
      service_type: 'security',
      label: 'Security Levy',
      rate_type: 'monthly_flat',
      unit_label: 'month',
      rate: 1000,
      currency: 'KES',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // Organization Members
  data.organization_members = [
    { id: 1, organization_id: 1, user_id: 2, role: 'landlord', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 2, organization_id: 1, user_id: 3, role: 'caretaker', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];

  // Staff Assignments (Caretaker assignments)
  data.staff_assignments = [
    { id: 1, organization_id: 1, caretaker_user_id: 3, access_level: 'caretaker', status: 'active', created_by: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];

  // Properties
  const prop1 = {
    id: 1,
    organization_id: 1,
    name: 'Sunset Heights Apartments',
    property_type: 'Apartment',
    location: 'Kilimani, Nairobi',
    county: 'Nairobi',
    town: 'Nairobi',
    status: 'active',
    notes: 'Premium residential apartments with 24/7 security and water backup.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const prop2 = {
    id: 2,
    organization_id: 1,
    name: 'Greenwood Bedsitters',
    property_type: 'Bedsitter block',
    location: 'Roysambu, Thika Road',
    county: 'Nairobi',
    town: 'Nairobi',
    status: 'active',
    notes: 'Student-friendly affordable housing block.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  data.properties = [prop1, prop2];

  // Caretaker Assigned Properties
  data.staff_assignment_properties = [
    { id: 1, organization_id: 1, staff_assignment_id: 1, property_id: 1, created_at: new Date().toISOString() } // Caretaker 3 assigned to Property 1 (Sunset Heights)
  ];

  // Units
  // Sunset Heights (Property 1)
  const unitsProp1 = [
    { id: 1, organization_id: 1, property_id: 1, unit_code: 'A1', unit_type: '2 Bedroom', rent_amount: 45000, deposit_amount: 45000, status: 'occupied', floor: '1st', block: 'Block A', notes: 'Master bedroom ensuite.', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 2, organization_id: 1, property_id: 1, unit_code: 'A2', unit_type: '2 Bedroom', rent_amount: 45000, deposit_amount: 45000, status: 'occupied', floor: '1st', block: 'Block A', notes: 'Road view balcony.', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 3, organization_id: 1, property_id: 1, unit_code: 'B1', unit_type: '3 Bedroom', rent_amount: 60000, deposit_amount: 60000, status: 'vacant', floor: '2nd', block: 'Block B', notes: 'Freshly repainted unit.', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 4, organization_id: 1, property_id: 1, unit_code: 'B2', unit_type: '3 Bedroom', rent_amount: 60000, deposit_amount: 60000, status: 'under_maintenance', floor: '2nd', block: 'Block B', notes: 'Leaking pipe repair in master bath.', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];
  // Greenwood Bedsitters (Property 2)
  const unitsProp2 = [
    { id: 5, organization_id: 1, property_id: 2, unit_code: 'G01', unit_type: 'Bedsitter', rent_amount: 15000, deposit_amount: 15000, status: 'occupied', floor: 'Ground', block: 'Single Block', notes: 'Prepaid electricity meter.', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 6, organization_id: 1, property_id: 2, unit_code: 'G02', unit_type: 'Bedsitter', rent_amount: 15000, deposit_amount: 15000, status: 'vacant', floor: 'Ground', block: 'Single Block', notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];

  data.units = [...unitsProp1, ...unitsProp2];

  // Tenants
  // System-generated tenant account number format: ACC-0000-XX
  const tenant1 = {
    id: 1,
    organization_id: 1,
    property_id: 1,
    unit_id: 1,
    tenant_identifier: 'TID-90821',
    tenant_account_number: 'ACC-0010-A1',
    full_name: 'David Kiprop',
    phone_number: '+254711222333',
    email: 'kiprop.david@outlook.com',
    id_number: '31234567',
    move_in_date: '2024-01-10',
    move_out_date: null,
    rent_amount: 45000,
    billing_day: 1,
    status: 'active',
    emergency_contact_name: 'Jane Kiprop',
    emergency_contact_phone: '+254711333444',
    notes: 'Pays rent via bank transfer on or before 3rd.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const tenant2 = {
    id: 2,
    organization_id: 1,
    property_id: 1,
    unit_id: 2,
    tenant_identifier: 'TID-31294',
    tenant_account_number: 'ACC-0010-A2',
    full_name: 'Alice Wambui',
    phone_number: '+254722888999',
    email: 'wambui.alice@gmail.com',
    id_number: '28938210',
    move_in_date: '2023-08-15',
    move_out_date: null,
    rent_amount: 45000,
    billing_day: 1,
    status: 'active',
    emergency_contact_name: 'John Wambui',
    emergency_contact_phone: '+254722999000',
    notes: 'Prefers M-Pesa. Needs monthly invoices early.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const tenant3 = {
    id: 3,
    organization_id: 1,
    property_id: 2,
    unit_id: 5,
    tenant_identifier: 'TID-11029',
    tenant_account_number: 'ACC-0020-G01',
    full_name: 'John Mwangi',
    phone_number: '+254733444555',
    email: 'mwangi.j@yahoo.com',
    id_number: '35482910',
    move_in_date: '2024-03-01',
    move_out_date: null,
    rent_amount: 15000,
    billing_day: 5,
    status: 'active',
    emergency_contact_name: 'Peter Mwangi',
    emergency_contact_phone: '+254733555666',
    notes: 'Student tenant.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  data.tenants = [tenant1, tenant2, tenant3];

  // Invoices (Historically generated)
  // Tenant 1 has fully paid invoices
  // Tenant 2 has a partially paid invoice
  // Tenant 3 has an overdue unpaid invoice
  const invoicesList = [
    {
      id: 1,
      organization_id: 1,
      property_id: 1,
      unit_id: 1,
      tenant_id: 1,
      invoice_number: 'INV-2026-001',
      invoice_type: 'rent',
      status: 'paid',
      issue_date: '2026-05-01',
      due_date: '2026-05-05',
      currency: 'KES',
      subtotal: 45000,
      total: 45000,
      amount_paid: 45000,
      balance: 0,
      notes: 'Rent invoice for May 2026',
      created_by: 2,
      issued_at: '2026-05-01T08:00:00Z',
      created_at: '2026-05-01T08:00:00Z',
      updated_at: '2026-05-03T14:30:00Z'
    },
    {
      id: 2,
      organization_id: 1,
      property_id: 1,
      unit_id: 2,
      tenant_id: 2,
      invoice_number: 'INV-2026-002',
      invoice_type: 'rent',
      status: 'partially_paid',
      issue_date: '2026-06-01',
      due_date: '2026-06-05',
      currency: 'KES',
      subtotal: 45000,
      total: 45000,
      amount_paid: 30000,
      balance: 15000,
      notes: 'Rent invoice for June 2026',
      created_by: 2,
      issued_at: '2026-06-01T08:00:00Z',
      created_at: '2026-06-01T08:00:00Z',
      updated_at: '2026-06-04T11:00:00Z'
    },
    {
      id: 3,
      organization_id: 1,
      property_id: 2,
      unit_id: 5,
      tenant_id: 3,
      invoice_number: 'INV-2026-003',
      invoice_type: 'rent',
      status: 'overdue',
      issue_date: '2026-06-05',
      due_date: '2026-06-10',
      currency: 'KES',
      subtotal: 15000,
      total: 15000,
      amount_paid: 0,
      balance: 15000,
      notes: 'Rent invoice for June 2026',
      created_by: 2,
      issued_at: '2026-06-05T08:00:00Z',
      created_at: '2026-06-05T08:00:00Z',
      updated_at: '2026-06-05T08:00:00Z'
    },
    {
      id: 4,
      organization_id: 1,
      property_id: 1,
      unit_id: 1,
      tenant_id: 1,
      invoice_number: 'INV-2026-004',
      invoice_type: 'rent',
      status: 'issued',
      issue_date: '2026-06-01',
      due_date: '2026-06-05',
      currency: 'KES',
      subtotal: 45000,
      total: 45000,
      amount_paid: 45000,
      balance: 0,
      notes: 'Rent invoice for June 2026',
      created_by: 2,
      issued_at: '2026-06-01T08:00:00Z',
      created_at: '2026-06-01T08:00:00Z',
      updated_at: '2026-06-02T10:00:00Z'
    }
  ];

  data.invoices = invoicesList;

  // Invoice Items
  data.invoice_items = [
    { id: 1, organization_id: 1, invoice_id: 1, description: 'Monthly Rent - A1', item_type: 'rent', quantity: 1, unit_price: 45000, total: 45000, created_at: new Date().toISOString() },
    { id: 2, organization_id: 1, invoice_id: 2, description: 'Monthly Rent - A2', item_type: 'rent', quantity: 1, unit_price: 45000, total: 45000, created_at: new Date().toISOString() },
    { id: 3, organization_id: 1, invoice_id: 3, description: 'Monthly Rent - G01', item_type: 'rent', quantity: 1, unit_price: 15000, total: 15000, created_at: new Date().toISOString() },
    { id: 4, organization_id: 1, invoice_id: 4, description: 'Monthly Rent - A1', item_type: 'rent', quantity: 1, unit_price: 45000, total: 45000, created_at: new Date().toISOString() }
  ];

  // Ledger Transactions (reconciled ledger)
  data.transactions = [
    {
      id: 1,
      organization_id: 1,
      tenant_id: 1,
      property_id: 1,
      unit_id: 1,
      invoice_id: 1,
      amount: 45000,
      currency: 'KES',
      transaction_type: 'payment',
      payment_method: 'bank',
      source: 'bank_csv',
      reference_number: 'FT261248910',
      account_number: '11094821',
      payer_name: 'David Kiprop',
      payer_phone: '+254711222333',
      transaction_date: '2026-05-03T12:00:00Z',
      status: 'reconciled',
      raw_payload: 'CSV_LINE_018',
      created_by: 2,
      reconciled_by: 2,
      reconciled_at: '2026-05-03T14:30:00Z',
      created_at: '2026-05-03T14:30:00Z',
      updated_at: '2026-05-03T14:30:00Z'
    },
    {
      id: 2,
      organization_id: 1,
      tenant_id: 1,
      property_id: 1,
      unit_id: 1,
      invoice_id: 4,
      amount: 45000,
      currency: 'KES',
      transaction_type: 'payment',
      payment_method: 'mpesa',
      source: 'mpesa_callback',
      reference_number: 'RFE9X8Z10A',
      account_number: 'ACC-0010-A1',
      payer_name: 'David Kiprop',
      payer_phone: '+254711222333',
      transaction_date: '2026-06-02T09:12:00Z',
      status: 'reconciled',
      raw_payload: JSON.stringify({ BillRefNumber: 'ACC-0010-A1', TransAmount: '45000', TransID: 'RFE9X8Z10A', MSISDN: '254711222333', FirstName: 'David' }),
      created_by: null,
      reconciled_by: null,
      reconciled_at: '2026-06-02T09:12:05Z',
      created_at: '2026-06-02T09:12:05Z',
      updated_at: '2026-06-02T09:12:05Z'
    },
    {
      id: 3,
      organization_id: 1,
      tenant_id: 2,
      property_id: 1,
      unit_id: 2,
      invoice_id: 2,
      amount: 30000,
      currency: 'KES',
      transaction_type: 'payment',
      payment_method: 'mpesa',
      source: 'mpesa_callback',
      reference_number: 'RFG2P3Q98M',
      account_number: 'ACC-0010-A2',
      payer_name: 'Alice Wambui',
      payer_phone: '+254722888999',
      transaction_date: '2026-06-04T10:55:00Z',
      status: 'reconciled',
      raw_payload: JSON.stringify({ BillRefNumber: 'ACC-0010-A2', TransAmount: '30000', TransID: 'RFG2P3Q98M', MSISDN: '254722888999', FirstName: 'Alice' }),
      created_by: null,
      reconciled_by: null,
      reconciled_at: '2026-06-04T11:00:00Z',
      created_at: '2026-06-04T11:00:00Z',
      updated_at: '2026-06-04T11:00:00Z'
    }
  ];

  // Payment Allocations
  data.payment_allocations = [
    { id: 1, organization_id: 1, transaction_id: 1, invoice_id: 1, amount_allocated: 45000, allocated_by: 2, allocated_at: '2026-05-03T14:30:00Z', created_at: new Date().toISOString() },
    { id: 2, organization_id: 1, transaction_id: 2, invoice_id: 4, amount_allocated: 45000, allocated_by: 2, allocated_at: '2026-06-02T09:12:05Z', created_at: new Date().toISOString() },
    { id: 3, organization_id: 1, transaction_id: 3, invoice_id: 2, amount_allocated: 30000, allocated_by: 2, allocated_at: '2026-06-04T11:00:00Z', created_at: new Date().toISOString() }
  ];

  // Default Integrations Setup
  data.organization_integrations = [
    {
      id: 1,
      organization_id: 1,
      provider_type: 'sms',
      provider_name: 'Africa’s Talking',
      environment: 'sandbox',
      config_json_encrypted: JSON.stringify({ api_key: '********', username: 'sandbox', sender_id: 'SMARTLAND' }),
      callback_url: '',
      is_active: true,
      status: 'ready',
      last_tested_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 2,
      organization_id: 1,
      provider_type: 'mpesa',
      provider_name: 'Safaricom Daraja API',
      environment: 'sandbox',
      config_json_encrypted: JSON.stringify({ consumer_key: '********', consumer_secret: '********', shortcode: '174379', passkey: '********' }),
      callback_url: 'http://localhost:5000/api/webhooks/payment',
      is_active: false,
      status: 'needs_credentials',
      last_tested_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // Default Notification Settings
  data.notification_settings = [
    {
      id: 1,
      organization_id: 1,
      rent_reminders_enabled: true,
      reminder_days_before_due: 3,
      payment_confirmation_enabled: true,
      unmatched_payment_alert_enabled: true,
      meter_reading_alert_enabled: true,
      billing_alerts_enabled: true,
      sms_provider: 'Africa’s Talking',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // Internal messages between landlord (user 2) and caretaker (user 3)
  data.internal_messages = [
    {
      id: 1,
      organization_id: 1,
      sender_user_id: 3,
      recipient_user_id: 2,
      property_id: 1,
      unit_id: 4,
      message_body: 'Hi Mr. Kamau, Unit B2 bathroom pipe leak is repaired. Can you approve the plumber’s receipt for KES 2,500?',
      is_read: true,
      created_at: '2026-06-15T09:00:00Z',
      read_at: '2026-06-15T10:15:00Z'
    },
    {
      id: 2,
      organization_id: 1,
      sender_user_id: 2,
      recipient_user_id: 3,
      property_id: 1,
      unit_id: 4,
      message_body: 'Good work Juma. Please upload the receipt in the maintenance log so I can record the cost.',
      is_read: true,
      created_at: '2026-06-15T11:00:00Z',
      read_at: '2026-06-15T11:30:00Z'
    }
  ];

  // Meter Readings submitted by caretaker (user 3)
  data.meter_readings = [
    {
      id: 1,
      organization_id: 1,
      property_id: 1,
      unit_id: 1,
      tenant_id: 1,
      meter_type: 'water',
      previous_reading: 1042,
      current_reading: 1058,
      usage: 16,
      reading_date: '2026-05-31',
      submitted_by: 3,
      reviewed_by: 2,
      status: 'approved',
      notes: 'Regular usage.',
      created_at: '2026-05-31T15:00:00Z',
      updated_at: '2026-06-01T09:00:00Z'
    },
    {
      id: 2,
      organization_id: 1,
      property_id: 1,
      unit_id: 2,
      tenant_id: 2,
      meter_type: 'water',
      previous_reading: 894,
      current_reading: 915,
      usage: 21,
      reading_date: '2026-05-31',
      submitted_by: 3,
      reviewed_by: null,
      status: 'submitted',
      notes: 'Balcony water tap left running.',
      created_at: '2026-05-31T15:10:00Z',
      updated_at: '2026-05-31T15:10:00Z'
    }
  ];

  // Maintenance Requests
  data.maintenance_requests = [
    {
      id: 1,
      organization_id: 1,
      property_id: 1,
      unit_id: 4,
      tenant_id: null,
      reported_by_user_id: 3,
      title: 'Bathroom pipe leak',
      description: 'Major leak in bathroom ceiling dripping into lower unit floor. Requires urgent plumber assistance.',
      status: 'resolved',
      priority: 'high',
      photo_url: '',
      assigned_to_user_id: 3,
      estimated_cost: 3000,
      actual_cost: 2500,
      cost_approved_by: 2,
      created_at: '2026-06-14T08:00:00Z',
      updated_at: '2026-06-15T14:00:00Z',
      resolved_at: '2026-06-15T14:00:00Z'
    }
  ];

  // Reconciliation Staging Rows (Bank CSV simulation content)
  // These rows represent items uploaded in the CSV but not yet fully reconciled in the ledger
  data.reconciliation_staging_rows = [
    {
      id: 1,
      organization_id: 1,
      batch_id: null,
      raw_row_data: '2026-06-15,45000,KCB-TR-90823,ACC-0010-A1,DAVID KIPROP,KIPROP RENT',
      transaction_date: '2026-06-15T00:00:00Z',
      amount: 45000,
      reference_number: 'KCB-TR-90823',
      account_number: 'ACC-0010-A1',
      description: 'KIPROP RENT',
      payer_name: 'DAVID KIPROP',
      payer_phone: '',
      status: 'needs_review',
      suggested_tenant_id: 1,
      suggested_unit_id: 1,
      suggested_invoice_id: 4,
      confidence_score: 95,
      matched_transaction_id: null,
      reviewed_by: null,
      reviewed_at: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 2,
      organization_id: 1,
      batch_id: null,
      raw_row_data: '2026-06-16,15000,KCB-TR-10294,ACC-0020-G01,UNKNOWN PAYER,RENT G01 MWANGI',
      transaction_date: '2026-06-16T00:00:00Z',
      amount: 15000,
      reference_number: 'KCB-TR-10294',
      account_number: 'ACC-0020-G01',
      description: 'RENT G01 MWANGI',
      payer_name: 'UNKNOWN PAYER',
      payer_phone: '',
      status: 'needs_review',
      suggested_tenant_id: 3,
      suggested_unit_id: 5,
      suggested_invoice_id: 3,
      confidence_score: 85,
      matched_transaction_id: null,
      reviewed_by: null,
      reviewed_at: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 3,
      organization_id: 1,
      batch_id: null,
      raw_row_data: '2026-06-16,5000,KCB-TR-99999,,JOHN KIPRUTO,CASH DEPOSIT',
      transaction_date: '2026-06-16T00:00:00Z',
      amount: 5000,
      reference_number: 'KCB-TR-99999',
      account_number: '',
      description: 'CASH DEPOSIT',
      payer_name: 'JOHN KIPRUTO',
      payer_phone: '',
      status: 'unmatched',
      suggested_tenant_id: null,
      suggested_unit_id: null,
      suggested_invoice_id: null,
      confidence_score: 0,
      matched_transaction_id: null,
      reviewed_by: null,
      reviewed_at: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // Platform Billing Settings (for SaaS module)
  data.platform_billing_settings = [
    {
      id: 1,
      country: 'Kenya',
      currency: 'KES',
      price_per_active_tenant: 200, // KES 200 per active tenant per month
      grace_period_days: 7,
      is_default: true,
      smtp_config_encrypted: null,
      smtp_status: 'not_configured',
      smtp_last_tested_at: null,
      smtp_last_error: null,
      sms_provider: null,
      sms_api_url: null,
      sms_config_encrypted: null,
      sms_sender_id: 'SMARTLANDY',
      sms_sender_id_type: 'transactional',
      sms_sender_approval_status: 'pending',
      sms_default_country_code: '+254',
      sms_status: 'not_configured',
      sms_last_tested_at: null,
      sms_last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // Platform Billing Invoices (for Landlord SaaS invoices)
  data.platform_billing_invoices = [
    {
      id: 1,
      organization_id: 1,
      billing_period_start: '2026-05-01T00:00:00Z',
      billing_period_end: '2026-05-31T23:59:59Z',
      billing_currency: 'KES',
      active_tenant_count: 3,
      price_per_active_tenant: 200,
      subtotal: 600,
      tax_amount: 96, // 16% VAT
      total: 696,
      status: 'paid',
      issued_at: '2026-06-01T00:00:00Z',
      due_at: '2026-06-08T00:00:00Z',
      paid_at: '2026-06-02T15:00:00Z',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-02T15:00:00Z'
    }
  ];

  // Platform Billing Payments
  data.platform_billing_payments = [
    {
      id: 1,
      organization_id: 1,
      billing_invoice_id: 1,
      amount: 696,
      currency: 'KES',
      payment_method: 'mpesa',
      reference_number: 'QWE1R2T3Y4',
      status: 'confirmed',
      confirmed_by: 1, // Confirmed by Super Admin
      confirmed_at: '2026-06-02T15:00:00Z',
      created_at: '2026-06-02T15:00:00Z'
    }
  ];

  // Audit Logs (Sample history)
  data.audit_logs = [
    {
      id: 1,
      organization_id: 1,
      actor_user_id: 2,
      actor_role: 'landlord',
      action_type: 'security_pin_created',
      target_type: 'organization',
      target_id: 1,
      old_values: null,
      new_values: JSON.stringify({ pin_hash: 'set' }),
      metadata: JSON.stringify({ ip: '127.0.0.1' }),
      pin_validation_status: 'success',
      reason: 'Initial setup',
      created_at: '2026-05-01T07:30:00Z'
    },
    {
      id: 2,
      organization_id: 1,
      actor_user_id: 2,
      actor_role: 'landlord',
      action_type: 'property_created',
      target_type: 'property',
      target_id: 1,
      old_values: null,
      new_values: JSON.stringify({ name: 'Sunset Heights Apartments' }),
      metadata: JSON.stringify({ ip: '127.0.0.1' }),
      pin_validation_status: null,
      reason: '',
      created_at: '2026-05-01T07:45:00Z'
    }
  ];

  writeDb(data);
  console.log('Database successfully seeded!');
}
