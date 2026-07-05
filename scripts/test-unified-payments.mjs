import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const PORT = '5098';
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;

function startServer(backend, dbUrl) {
  console.log(`Starting server with DATA_BACKEND=${backend}...`);
  const env = {
    ...process.env,
    PORT,
    NODE_ENV: 'development',
    DEMO_MODE: 'true',
    DATA_BACKEND: backend
  };
  if (dbUrl) {
    env.DATABASE_URL = dbUrl;
  }

  const child = spawn(process.execPath, ['server/server.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => {
    const msg = data.toString();
    if (msg.includes('server error') || msg.includes('Failed to start')) {
      console.error(`[server stdout] ${msg}`);
    }
  });

  child.stderr.on('data', data => {
    console.error(`[server stderr] ${data.toString()}`);
  });

  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'landlord@demo.com' })
      });
      if (res.ok) {
        console.log('Server is ready!');
        return;
      }
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw new Error('Server did not start in time.');
}

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}`);
  }
  return res.json();
}

async function registerLandlord(email, first, last) {
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'individual',
      first_name: first,
      last_name: last,
      email,
      phone_number: `+254799${Math.floor(100000 + Math.random() * 900000)}`,
      country: 'Kenya',
      billing_currency: 'KES',
      profile_confirmed: true
    })
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(`Registration failed: ${errData.error || res.status}`);
  }
  return res.json();
}

async function cleanPostgresDb(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('TRUNCATE TABLE payments CASCADE');
    await client.query('TRUNCATE TABLE payment_allocations CASCADE');
    await client.query('TRUNCATE TABLE transactions CASCADE');
    console.log('PostgreSQL tables truncated successfully.');
  } catch (err) {
    console.error('Failed to truncate PostgreSQL tables:', err.message);
  } finally {
    await client.end();
  }
}

async function runTests(dbUrl) {
  serverProcess = startServer('postgres', dbUrl);
  await waitForServer();

  try {
    // 1. Logins & Tenancy Setup
    const landlord1 = await login('landlord@demo.com');
    const token1 = landlord1.auth_token;

    const email2 = `landlord2.${Date.now()}@demo.com`;
    await registerLandlord(email2, 'John', 'Landlord');
    const landlord2 = await login(email2);
    const token2 = landlord2.auth_token;

    const orgId1 = landlord1.organization.id;
    const orgId2 = landlord2.organization.id;

    // Create an Invoice for Landlord 1 using SQL direct inserts
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();

    let tenant1Id, propertyId, unitId, invoice1Id, invoice2Id;
    try {
      const propRes = await client.query(
        "INSERT INTO properties (organization_id, name, property_type, location, status) VALUES ($1, 'Sunset Hills', 'apartment', 'Nairobi', 'active') RETURNING id",
        [orgId1]
      );
      propertyId = propRes.rows[0].id;

      const unitRes = await client.query(
        "INSERT INTO units (organization_id, property_id, unit_code, unit_type, rent_amount, deposit_amount, status) VALUES ($1, $2, 'A1', 'bedsitter', 12000, 0, 'occupied') RETURNING id",
        [orgId1, propertyId]
      );
      unitId = unitRes.rows[0].id;

      const uniq = Date.now();
      const tenantRes = await client.query(
        `INSERT INTO tenants (organization_id, property_id, unit_id, tenant_identifier, tenant_account_number, full_name, phone_number, move_in_date, rent_amount, billing_day, status) VALUES ($1, $2, $3, 'T-' || $4, 'ACC-' || $4, 'David', '+254711222333', CURRENT_DATE, 12000, 1, 'active') RETURNING id`,
        [orgId1, propertyId, unitId, uniq]
      );
      tenant1Id = tenantRes.rows[0].id;

      const invRes = await client.query(
        `INSERT INTO invoices (organization_id, property_id, unit_id, tenant_id, invoice_number, invoice_type, status, issue_date, due_date, currency, subtotal, total, amount_paid, balance, notes, created_by, issued_at) VALUES ($1, $2, $3, $4, 'INV-1-' || $5, 'rent', 'issued', CURRENT_DATE, CURRENT_DATE, 'KES', 12000, 12000, 0, 12000, 'Test Invoice 1', $6, now()) RETURNING id`,
        [orgId1, propertyId, unitId, tenant1Id, uniq, landlord1.user.id]
      );
      invoice1Id = invRes.rows[0].id;

      const invRes2 = await client.query(
        `INSERT INTO invoices (organization_id, property_id, unit_id, tenant_id, invoice_number, invoice_type, status, issue_date, due_date, currency, subtotal, total, amount_paid, balance, notes, created_by, issued_at) VALUES ($1, $2, $3, $4, 'INV-2-' || $5, 'rent', 'issued', CURRENT_DATE, CURRENT_DATE, 'KES', 12000, 12000, 0, 12000, 'Test Invoice 2', $6, now()) RETURNING id`,
        [orgId1, propertyId, unitId, tenant1Id, uniq, landlord1.user.id]
      );
      invoice2Id = invRes2.rows[0].id;
    } finally {
      await client.end();
    }

    console.log('Setup finished. Property, Tenant, and Invoice created.');

    // 2. Test Payment Capture (Phase 2 & 6)
    console.log('Testing payment capture...');
    const sourceHash = `hash-${Date.now()}`;
    const captureRes = await fetch(`${BASE_URL}/api/billing/payments/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payer_type: 'tenant',
        payer_id: tenant1Id,
        source_type: 'mpesa',
        source_hash: sourceHash,
        amount: 8000,
        reference: 'MPESA-REF-1',
        external_reference: 'MPESA-REF-1'
      })
    });
    assert.strictEqual(captureRes.status, 200);
    const captureData = await captureRes.json();
    assert.ok(captureData.success);
    const payment = captureData.payment;
    assert.strictEqual(Number(payment.amount), 8000);
    assert.strictEqual(payment.status, 'captured');
    assert.strictEqual(payment.allocation_status, 'unallocated');

    // 3. Test Idempotency of Payment Capture (Phase 6)
    console.log('Testing payment capture idempotency...');
    const captureRes2 = await fetch(`${BASE_URL}/api/billing/payments/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payer_type: 'tenant',
        payer_id: tenant1Id,
        source_type: 'mpesa',
        source_hash: sourceHash,
        amount: 8000,
        reference: 'MPESA-REF-1',
        external_reference: 'MPESA-REF-1'
      })
    });
    assert.strictEqual(captureRes2.status, 200);
    const captureData2 = await captureRes2.json();
    assert.strictEqual(Number(captureData2.payment.id), Number(payment.id), 'Should return same payment record (idempotent)');

    // 4. Test Verify Payment (Phase 2 & 8)
    console.log('Testing payment verification...');
    const verifyRes = await fetch(`${BASE_URL}/api/billing/payments/${payment.id}/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token1}` }
    });
    assert.strictEqual(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.payment.status, 'verified');
    assert.ok(verifyData.payment.verified_at);

    // 5. Test Payment Allocation (Phase 3 & 8)
    console.log('Testing payment allocation...');
    const allocateRes = await fetch(`${BASE_URL}/api/billing/payments/${payment.id}/allocate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoice1Id,
        amount: 5000,
        notes: 'Partial payment'
      })
    });
    assert.strictEqual(allocateRes.status, 200);
    const allocateData = await allocateRes.json();
    assert.ok(allocateData.success);
    const allocation = allocateData.allocation;
    assert.strictEqual(Number(allocation.amount), 5000);

    // Fetch Invoice payment summary and verify balance/status changed correctly
    const summaryRes = await fetch(`${BASE_URL}/api/billing/invoices/${invoice1Id}/payment-summary`, {
      headers: { 'Authorization': `Bearer ${token1}` }
    });
    assert.strictEqual(summaryRes.status, 200);
    const summaryData = await summaryRes.json();
    assert.strictEqual(Number(summaryData.invoice_state.amount_paid), 5000, 'Invoice amount paid should be 5000');
    assert.strictEqual(Number(summaryData.invoice_state.balance), 7000, 'Invoice balance should be 7000');
    assert.strictEqual(summaryData.invoice_state.status, 'partially_paid', 'Invoice should be partially paid');

    // 6. Test Allocation cannot exceed Payment Amount (Phase 3)
    console.log('Testing allocation limit checks...');
    const overAllocateRes = await fetch(`${BASE_URL}/api/billing/payments/${payment.id}/allocate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoice2Id,
        amount: 4000 // Total allocated would be 5000 + 4000 = 9000 > payment amount 8000
      })
    });
    assert.strictEqual(overAllocateRes.status, 400); // should throw error

    // 7. Test Allocation Idempotency (Phase 6)
    console.log('Testing allocation idempotency...');
    const allocateRes2 = await fetch(`${BASE_URL}/api/billing/payments/${payment.id}/allocate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoice1Id,
        amount: 5000
      })
    });
    assert.strictEqual(allocateRes2.status, 200);
    const allocateData2 = await allocateRes2.json();
    assert.strictEqual(Number(allocateData2.allocation.id), Number(allocation.id), 'Allocation should be idempotent');

    // 8. Test Cross-tenant access controls (Phase 9)
    console.log('Testing cross-tenant access controls...');
    const crossTenantGet = await fetch(`${BASE_URL}/api/billing/payments/${payment.id}`, {
      headers: { 'Authorization': `Bearer ${token2}` }
    });
    assert.strictEqual(crossTenantGet.status, 404, 'Should block cross-tenant payment retrieval');

    const crossTenantAllocate = await fetch(`${BASE_URL}/api/billing/payments/${payment.id}/allocate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token2}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_id: invoice1Id,
        amount: 1000
      })
    });
    assert.strictEqual(crossTenantAllocate.status, 404, 'Should block cross-tenant payment allocation');

    console.log('✓ Unified Payments Domain Foundation verified successfully.');
  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

const pgDbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/smart_landlord_test';
cleanPostgresDb(pgDbUrl)
  .then(() => runTests(pgDbUrl))
  .catch(err => {
    console.error('Unified Payments testing failed:', err);
    if (serverProcess) serverProcess.kill('SIGTERM');
    process.exit(1);
  });
