import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL compliance smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5063';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'postgres',
      SESSION_SECRET: 'smoke-session-secret-for-compliance'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));

  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'landlord@demo.com' })
      });
      if (res.ok) return;
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('Server did not become ready in time.');
}

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${res.status}`);
  }

  return res.json();
}

const server = startServer();

const pgClient = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

try {
  await pgClient.connect();
  await waitForServer();

  const landlord = await login('landlord@demo.com');
  const admin = await login('admin@smartlandlord.com');

  const landlordHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${landlord.auth_token}`,
    'x-organization-id': String(landlord.organization?.id || 1),
    'x-user-id': String(landlord.user?.id || 2),
    'x-user-role': 'landlord'
  };

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${admin.auth_token}`,
    'x-user-id': String(admin.user?.id || 1),
    'x-user-role': 'super_admin'
  };

  console.log('--- Compliance & Data Safety Smoke Test Start ---');

  // 1. Get properties and units for seeding
  const propRes = await pgClient.query('SELECT id FROM properties LIMIT 1');
  const unitRes = await pgClient.query('SELECT id FROM units LIMIT 1');

  if (propRes.rows.length === 0 || unitRes.rows.length === 0) {
    throw new Error('Please seed the PostgreSQL database first (e.g. using npm run db:seed:from-json). Properties and units are required.');
  }

  const propertyId = propRes.rows[0].id;
  const unitId = unitRes.rows[0].id;
  const orgId = landlord.organization?.id || 1;

  // 2. Insert test tenant
  const tenantRes = await pgClient.query(`
    INSERT INTO tenants (
      organization_id, property_id, unit_id, tenant_identifier, tenant_account_number,
      full_name, phone_number, email, id_number, move_in_date, billing_day, status,
      emergency_contact_name, emergency_contact_phone
    ) VALUES (
      $1, $2, $3, 'COMP-SMOKE-T', 'ACC-COMP-SMOKE',
      'Compliance Tenant Name', '+254799888777', 'compliance.tenant@smoke.com',
      '12345678', '2026-06-01', 1, 'active',
      'Emergency Contact', '+254722222222'
    ) RETURNING *
  `, [orgId, propertyId, unitId]);

  const tenant = tenantRes.rows[0];
  console.log(`Created test tenant: ID = ${tenant.id}`);

  // 3. Insert test invoice for retention validation
  const invoiceNumber = `INV-COMP-SMOKE-${Date.now()}`;
  const invoiceRes = await pgClient.query(`
    INSERT INTO invoices (
      organization_id, property_id, unit_id, tenant_id, invoice_number,
      invoice_type, status, issue_date, due_date, currency, subtotal, total, amount_paid, balance
    ) VALUES (
      $1, $2, $3, $4, $5,
      'rent', 'issued', '2026-06-01', '2026-06-05', 'KES', 5000.00, 5000.00, 0, 5000.00
    ) RETURNING *
  `, [orgId, propertyId, unitId, tenant.id, invoiceNumber]);

  const invoice = invoiceRes.rows[0];
  console.log(`Created test invoice: ID = ${invoice.id}, Total = ${invoice.total}`);

  // 4. Submit Deletion Request (Landlord)
  const submitRes = await fetch(`${BASE_URL}/api/compliance/delete-request`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      reason: 'Requested under GDPR/Compliance GDPR validation smoke test',
      target_type: 'tenant_data',
      target_tenant_id: tenant.id
    })
  });

  if (!submitRes.ok) {
    const errorBody = await submitRes.text();
    throw new Error(`Failed to submit deletion request: HTTP ${submitRes.status} - ${errorBody}`);
  }

  const requestObj = await submitRes.json();
  console.log(`Deletion request submitted: ID = ${requestObj.id}`);

  // 5. Landlord verifies request is listed
  const listRes = await fetch(`${BASE_URL}/api/compliance/delete-request`, {
    headers: landlordHeaders
  });
  if (!listRes.ok) {
    throw new Error(`Failed to fetch landlord requests: HTTP ${listRes.status}`);
  }
  const landlordRequests = await listRes.json();
  const foundInLandlord = landlordRequests.some(r => r.id === requestObj.id);
  if (!foundInLandlord) {
    throw new Error('Submitted request was not found in the landlord compliance log.');
  }
  console.log('PASS: Landlord request listed successfully');

  // 6. Super Admin fetches pending requests and processes it
  const adminListRes = await fetch(`${BASE_URL}/api/admin/compliance/delete-requests`, {
    headers: adminHeaders
  });
  if (!adminListRes.ok) {
    throw new Error(`Failed to fetch admin requests: HTTP ${adminListRes.status}`);
  }
  const adminRequests = await adminListRes.json();
  const requestForProcessing = adminRequests.find(r => r.id === requestObj.id);
  if (!requestForProcessing) {
    throw new Error('Submitted request was not found in the Super Admin list.');
  }

  // Verify that requester_name and org_name were populated via joins
  if (!requestForProcessing.requester_name || !requestForProcessing.org_name) {
    throw new Error('Super Admin list returned request missing requester_name or org_name joins.');
  }
  console.log(`PASS: Super Admin list returned populated joins. Requester: ${requestForProcessing.requester_name}, Org: ${requestForProcessing.org_name}`);

  // Approve request
  const approveRes = await fetch(`${BASE_URL}/api/admin/compliance/delete-requests/${requestObj.id}/process`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      action: 'approve'
    })
  });
  if (!approveRes.ok) {
    const errorBody = await approveRes.text();
    throw new Error(`Failed to approve deletion request: HTTP ${approveRes.status} - ${errorBody}`);
  }
  console.log('PASS: Super Admin approved deletion request successfully');

  // 7. Assertions - Tenant PII is anonymized
  const updatedTenantRes = await pgClient.query('SELECT * FROM tenants WHERE id = $1', [tenant.id]);
  const updatedTenant = updatedTenantRes.rows[0];

  console.log('Validating updated tenant fields:');
  console.log(`- full_name: ${updatedTenant.full_name}`);
  console.log(`- phone_number: ${updatedTenant.phone_number}`);
  console.log(`- email: ${updatedTenant.email}`);
  console.log(`- id_number: ${updatedTenant.id_number}`);
  console.log(`- emergency_contact_name: ${updatedTenant.emergency_contact_name}`);
  console.log(`- status: ${updatedTenant.status}`);
  console.log(`- deleted_at: ${updatedTenant.deleted_at}`);

  if (!updatedTenant.full_name.startsWith('[ANONYMIZED_TENANT_')) {
    throw new Error(`PII validation failed: full_name was not anonymized: ${updatedTenant.full_name}`);
  }
  if (!updatedTenant.phone_number.startsWith('+000000000')) {
    throw new Error(`PII validation failed: phone_number was not anonymized: ${updatedTenant.phone_number}`);
  }
  if (!updatedTenant.email.startsWith('anonymized_')) {
    throw new Error(`PII validation failed: email was not anonymized: ${updatedTenant.email}`);
  }
  if (updatedTenant.id_number !== 'ANONYMIZED') {
    throw new Error(`PII validation failed: id_number was not anonymized: ${updatedTenant.id_number}`);
  }
  if (updatedTenant.emergency_contact_name !== 'ANONYMIZED') {
    throw new Error(`PII validation failed: emergency_contact_name was not anonymized: ${updatedTenant.emergency_contact_name}`);
  }
  if (updatedTenant.status !== 'inactive') {
    throw new Error(`PII validation failed: status was not set to inactive: ${updatedTenant.status}`);
  }
  if (!updatedTenant.deleted_at) {
    throw new Error('PII validation failed: deleted_at timestamp was not set');
  }
  console.log('PASS: Tenant PII anonymized correctly.');

  // 8. Assertions - Invoice remains intact for audit retention
  const updatedInvoiceRes = await pgClient.query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
  if (updatedInvoiceRes.rows.length === 0) {
    throw new Error('Audit Retention failed: The invoice record was deleted.');
  }
  const updatedInvoice = updatedInvoiceRes.rows[0];
  if (parseFloat(updatedInvoice.total) !== 5000.00) {
    throw new Error(`Audit Retention failed: The invoice total changed. Expected 5000.00, got ${updatedInvoice.total}`);
  }
  console.log(`PASS: Invoice remains intact with original amount ${updatedInvoice.total} (7-year retention rule verified).`);

  // Clean up DB records
  await pgClient.query('DELETE FROM invoices WHERE id = $1', [invoice.id]);
  await pgClient.query('DELETE FROM deletion_requests WHERE id = $1', [requestObj.id]);
  await pgClient.query('DELETE FROM tenants WHERE id = $1', [tenant.id]);
  console.log('DB clean up completed.');

  console.log('PostgreSQL compliance smoke test passed.');
} catch (e) {
  console.error('FAIL: Compliance smoke test failed:', e);
  process.exitCode = 1;
} finally {
  await pgClient.end();
  server.kill('SIGTERM');
}
