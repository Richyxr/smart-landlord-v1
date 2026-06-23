import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL financial smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5056';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'postgres'
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

async function request(path, token) {
  return fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function postJson(path, token, body) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

function assertStatus(label, response, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected ${expectedStatus}, received ${response.status}`);
  }
  console.log(`PASS ${label}: ${response.status}`);
}

function assertCondition(label, condition) {
  if (!condition) {
    throw new Error(`${label}: assertion failed`);
  }
  console.log(`PASS ${label}`);
}

async function createManualPaymentFixture({ orgId, userId }) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const suffix = Date.now();

    const property = await client.query(
      `
        INSERT INTO properties (organization_id, name, property_type, location, status)
        VALUES ($1, $2, 'apartment', 'Smoke Test', 'active')
        RETURNING id
      `,
      [orgId, `Smoke Payment Property ${suffix}`]
    );

    const unit = await client.query(
      `
        INSERT INTO units (organization_id, property_id, unit_code, unit_type, rent_amount, deposit_amount, status)
        VALUES ($1, $2, $3, 'bedsitter', 1000, 0, 'occupied')
        RETURNING id
      `,
      [orgId, property.rows[0].id, `PAY-${suffix}`]
    );

    const tenant = await client.query(
      `
        INSERT INTO tenants (
          organization_id,
          property_id,
          unit_id,
          tenant_identifier,
          tenant_account_number,
          full_name,
          phone_number,
          email,
          move_in_date,
          rent_amount,
          billing_day,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'Smoke Payment Tenant', '+254700000111', 'payment-smoke@example.com', CURRENT_DATE, 1000, 1, 'active')
        RETURNING id
      `,
      [orgId, property.rows[0].id, unit.rows[0].id, `SMOKE-TENANT-${suffix}`, `SMOKE-ACC-${suffix}`]
    );

    const invoice = await client.query(
      `
        INSERT INTO invoices (
          organization_id,
          property_id,
          unit_id,
          tenant_id,
          invoice_number,
          invoice_type,
          status,
          issue_date,
          due_date,
          currency,
          subtotal,
          total,
          amount_paid,
          balance,
          notes,
          created_by,
          issued_at
        )
        VALUES ($1, $2, $3, $4, $5, 'rent', 'issued', CURRENT_DATE, CURRENT_DATE, 'KES', 1000, 1000, 0, 1000, 'Manual payment smoke invoice', $6, now())
        RETURNING id
      `,
      [orgId, property.rows[0].id, unit.rows[0].id, tenant.rows[0].id, `SMOKE-INV-${suffix}`, userId]
    );

    const otherOrg = await client.query(
      `
        INSERT INTO organizations (
          owner_user_id,
          name,
          type,
          email,
          phone_number,
          country,
          billing_currency,
          subscription_tier,
          subscription_status,
          is_locked,
          status
        )
        VALUES ($1, $2, 'individual', $3, '+254700000222', 'Kenya', 'KES', 'standard', 'active', false, 'active')
        RETURNING id
      `,
      [userId, `Smoke Other Org ${suffix}`, `other-${suffix}@example.com`]
    );

    const otherProperty = await client.query(
      `
        INSERT INTO properties (organization_id, name, property_type, location, status)
        VALUES ($1, $2, 'apartment', 'Smoke Test', 'active')
        RETURNING id
      `,
      [otherOrg.rows[0].id, `Smoke Other Property ${suffix}`]
    );

    const otherUnit = await client.query(
      `
        INSERT INTO units (organization_id, property_id, unit_code, unit_type, rent_amount, deposit_amount, status)
        VALUES ($1, $2, $3, 'bedsitter', 1000, 0, 'occupied')
        RETURNING id
      `,
      [otherOrg.rows[0].id, otherProperty.rows[0].id, `XORG-${suffix}`]
    );

    const otherTenant = await client.query(
      `
        INSERT INTO tenants (
          organization_id,
          property_id,
          unit_id,
          tenant_identifier,
          tenant_account_number,
          full_name,
          phone_number,
          move_in_date,
          rent_amount,
          billing_day,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'Cross Org Tenant', '+254700000333', CURRENT_DATE, 1000, 1, 'active')
        RETURNING id
      `,
      [otherOrg.rows[0].id, otherProperty.rows[0].id, otherUnit.rows[0].id, `CROSS-TENANT-${suffix}`, `CROSS-ACC-${suffix}`]
    );

    return {
      suffix,
      tenantId: tenant.rows[0].id,
      invoiceId: invoice.rows[0].id,
      otherTenantId: otherTenant.rows[0].id,
      reference: `SMOKE-MANUAL-${suffix}`
    };
  } finally {
    await client.end();
  }
}

async function getInvoice(invoiceId) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    return result.rows[0];
  } finally {
    await client.end();
  }
}

const server = startServer();

try {
  await waitForServer();

  const landlord = await login('landlord@demo.com');
  const caretaker = await login('caretaker@demo.com');
  const fixture = await createManualPaymentFixture({
    orgId: landlord.organization.id,
    userId: landlord.user.id
  });

  assertStatus('postgres landlord can read invoices', await request('/api/invoices', landlord.auth_token), 200);
  assertStatus('postgres landlord can read payments', await request('/api/payments', landlord.auth_token), 200);
  assertStatus('postgres caretaker cannot read invoices', await request('/api/invoices', caretaker.auth_token), 403);
  assertStatus('postgres caretaker cannot read payments', await request('/api/payments', caretaker.auth_token), 403);

  const invalidAmount = await postJson('/api/payments', landlord.auth_token, {
    tenant_id: fixture.tenantId,
    amount: -1,
    payment_method: 'cash',
    reference_number: `SMOKE-INVALID-${fixture.suffix}`,
    transaction_date: '2026-06-23'
  });
  assertStatus('postgres manual payment rejects invalid amount', invalidAmount, 400);

  const crossOrg = await postJson('/api/payments', landlord.auth_token, {
    tenant_id: fixture.otherTenantId,
    amount: 1,
    payment_method: 'cash',
    reference_number: `SMOKE-CROSS-${fixture.suffix}`,
    transaction_date: '2026-06-23'
  });
  assertStatus('postgres manual payment blocks cross-org tenant', crossOrg, 400);

  const caretakerPost = await postJson('/api/payments', caretaker.auth_token, {
    tenant_id: fixture.tenantId,
    amount: 1,
    payment_method: 'cash',
    reference_number: `SMOKE-CARETAKER-${fixture.suffix}`,
    transaction_date: '2026-06-23'
  });
  assertStatus('postgres caretaker cannot record payment', caretakerPost, 403);

  const payment = await postJson('/api/payments', landlord.auth_token, {
    tenant_id: fixture.tenantId,
    amount: 600,
    payment_method: 'cash',
    reference_number: fixture.reference,
    transaction_date: '2026-06-23',
    note: 'Manual payment smoke test'
  });
  assertStatus('postgres landlord can record manual payment', payment, 201);
  const paymentBody = await payment.json();

  assertCondition('manual payment returns receipt payload', Boolean(paymentBody.receipt));
  assertCondition('receipt includes transaction reference', paymentBody.receipt.receipt_number === fixture.reference);
  assertCondition('receipt includes tenant and organization', paymentBody.receipt.tenant_name === 'Smoke Payment Tenant' && Boolean(paymentBody.receipt.organization_name));
  assertCondition('receipt includes allocation summary', paymentBody.receipt.allocation_summary.length === 1);
  assertCondition('receipt includes balance after payment', paymentBody.receipt.balance_after_payment === 400);

  const updatedInvoice = await getInvoice(fixture.invoiceId);
  assertCondition('manual payment updates invoice amount paid', Number(updatedInvoice.amount_paid) === 600);
  assertCondition('manual payment updates invoice balance/status', Number(updatedInvoice.balance) === 400 && updatedInvoice.status === 'partially_paid');

  const duplicate = await postJson('/api/payments', landlord.auth_token, {
    tenant_id: fixture.tenantId,
    amount: 1,
    payment_method: 'cash',
    reference_number: fixture.reference,
    transaction_date: '2026-06-23'
  });
  assertStatus('postgres manual payment rejects duplicate reference', duplicate, 400);

  console.log('PostgreSQL financial smoke test passed.');
} finally {
  server.kill('SIGTERM');
}
