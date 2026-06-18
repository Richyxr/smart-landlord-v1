import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL SaaS billing smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5062';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'postgres',
      SESSION_SECRET: 'smoke-session-secret-for-saas-billing'
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

try {
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

  console.log('--- SaaS Billing Smoke Test Start ---');

  // Ensure default pricing settings exist in database and reset organization 1 for a clean start
  const pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient.connect();
  try {
    await pgClient.query(`
      INSERT INTO platform_billing_settings (id, country, currency, price_per_active_tenant, grace_period_days, is_default, mpesa_shortcode)
      VALUES (1, 'Kenya', 'KES', 200, 7, true, '174379')
      ON CONFLICT (id) DO UPDATE SET mpesa_shortcode = '174379';
    `);
    await pgClient.query(`
      UPDATE organizations SET is_locked = false, subscription_status = 'active' WHERE id = 1;
    `);
    await pgClient.query(`
      DELETE FROM platform_billing_payments WHERE organization_id = 1;
    `);
    await pgClient.query(`
      DELETE FROM platform_billing_invoices WHERE organization_id = 1;
    `);
  } finally {
    await pgClient.end();
  }

  // 1. Check initial status (should be unlocked / active)
  const statusRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  if (statusRes.status !== 200) {
    throw new Error(`GET /api/saas/status failed: ${statusRes.status}`);
  }
  const status = await statusRes.json();
  console.log('Initial Status:', status.organization.is_locked ? 'LOCKED' : 'UNLOCKED');
  if (status.organization.is_locked) {
    throw new Error('Organization should initially be unlocked.');
  }
  console.log('PASS: Organization is unlocked initially.');

  // 2. Trigger Billing Run to lock the account
  console.log('Triggering simulated billing run to cause lockout...');
  const billRunRes = await fetch(`${BASE_URL}/api/saas/trigger-bill-run`, {
    method: 'POST',
    headers: landlordHeaders
  });
  if (billRunRes.status !== 200) {
    throw new Error(`POST /api/saas/trigger-bill-run failed: ${billRunRes.status}`);
  }
  const overdueInvoice = await billRunRes.json();
  console.log(`Generated overdue platform invoice: ${overdueInvoice.invoice_number}, Total: ${overdueInvoice.total}`);

  // Check new lock status
  const lockedStatusRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  const lockedStatus = await lockedStatusRes.json();
  console.log('Post-billing Status:', lockedStatus.organization.is_locked ? 'LOCKED' : 'UNLOCKED');
  if (!lockedStatus.organization.is_locked) {
    throw new Error('Organization should be locked after overdue invoice generation.');
  }
  console.log('PASS: Organization is successfully locked.');

  // 3. Verify Lockout Middleware blocks standard routes
  console.log('Verifying lockout middleware blocks /api/properties...');
  const propRes = await fetch(`${BASE_URL}/api/properties`, { headers: landlordHeaders });
  console.log(`GET /api/properties status code: ${propRes.status}`);
  if (propRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for locked account, got ${propRes.status}`);
  }
  const propErr = await propRes.json();
  if (propErr.error !== 'LOCKED') {
    throw new Error(`Expected error code LOCKED, got ${propErr.error}`);
  }
  console.log('PASS: Lockout middleware successfully blocked standard request.');

  // 4. Verify billing routes are exempted from lockout
  console.log('Verifying billing routes (/api/saas/*) are accessible when locked...');
  const saasCheckRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  if (saasCheckRes.status !== 200) {
    throw new Error(`Expected 200 OK for /api/saas/status when locked, got ${saasCheckRes.status}`);
  }
  console.log('PASS: Billing status route remains accessible during lockout.');

  // 5. Test Webhook Auto-Unlock via M-Pesa STK Push
  console.log('Initiating SaaS payment via simulated STK Push...');
  const payRes = await fetch(`${BASE_URL}/api/saas/pay`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      invoice_id: overdueInvoice.id,
      phone_number: '+254712345678'
    })
  });
  if (payRes.status !== 200) {
    throw new Error(`POST /api/saas/pay failed: ${payRes.status}`);
  }
  const payData = await payRes.json();
  console.log('Payment Initiated. Checkout Request ID:', payData.checkoutRequestId);

  console.log('Waiting for background STK push webhook callback...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Check if organization unlocked automatically
  const postPayStatusRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  const postPayStatus = await postPayStatusRes.json();
  console.log('Post-payment Status:', postPayStatus.organization.is_locked ? 'LOCKED' : 'UNLOCKED');
  if (postPayStatus.organization.is_locked) {
    throw new Error('Organization should be unlocked after STK push webhook callback.');
  }
  console.log('PASS: Organization automatically unlocked via STK callback.');

  // 6. Test Webhook Auto-Unlock via M-Pesa C2B Paybill
  console.log('Triggering another billing run to lock the organization again...');
  // Delete the old invoice first so we can generate a new one cleanly
  const pgClient2 = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient2.connect();
  try {
    await pgClient2.query('DELETE FROM platform_billing_payments WHERE organization_id = 1');
    await pgClient2.query('DELETE FROM platform_billing_invoices WHERE organization_id = 1');
  } finally {
    await pgClient2.end();
  }

  const billRun2Res = await fetch(`${BASE_URL}/api/saas/trigger-bill-run`, {
    method: 'POST',
    headers: landlordHeaders
  });
  const overdueInvoice2 = await billRun2Res.json();
  console.log(`Generated new overdue platform invoice: ${overdueInvoice2.invoice_number}`);

  // Verify locked again
  const saasCheckLockedRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  const saasCheckLocked = await saasCheckLockedRes.json();
  if (!saasCheckLocked.organization.is_locked) {
    throw new Error('Organization should be locked again.');
  }

  console.log('Simulating M-Pesa C2B payment to platform Paybill (174379)...');
  const c2bRes = await fetch(`${BASE_URL}/api/webhooks/mpesa/c2b?token=smoke-session-secret-for-saas-billing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: '174379',
      TransID: `C2B-${Date.now()}`,
      TransAmount: String(overdueInvoice2.total),
      BillRefNumber: 'Kamau Properties Ltd', // Account Name maps to cleaned org name
      MSISDN: '254712345678',
      FirstName: 'Maina',
      LastName: 'Kamau'
    })
  });
  if (c2bRes.status !== 200) {
    throw new Error(`C2B callback failed: ${c2bRes.status} ${await c2bRes.text()}`);
  }
  const c2bData = await c2bRes.json();
  console.log('C2B Webhook Response:', c2bData);

  // Verify unlocked
  const postC2bStatusRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  const postC2bStatus = await postC2bStatusRes.json();
  console.log('Post-C2B Status:', postC2bStatus.organization.is_locked ? 'LOCKED' : 'UNLOCKED');
  if (postC2bStatus.organization.is_locked) {
    throw new Error('Organization should be unlocked after C2B webhook.');
  }
  console.log('PASS: Organization automatically unlocked via C2B callback.');

  // 7. Test Super Admin Manual Confirmation Override
  console.log('Locking organization for the third time...');
  const pgClient3 = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient3.connect();
  try {
    await pgClient3.query('DELETE FROM platform_billing_payments WHERE organization_id = 1');
    await pgClient3.query('DELETE FROM platform_billing_invoices WHERE organization_id = 1');
  } finally {
    await pgClient3.end();
  }

  const billRun3Res = await fetch(`${BASE_URL}/api/saas/trigger-bill-run`, {
    method: 'POST',
    headers: landlordHeaders
  });
  const overdueInvoice3 = await billRun3Res.json();
  console.log(`Generated third overdue platform invoice: ${overdueInvoice3.invoice_number}`);

  // Create pending payment manually via landlord context
  const initiateManualPayRes = await fetch(`${BASE_URL}/api/saas/pay`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      invoice_id: overdueInvoice3.id,
      phone_number: '+254712345678'
    })
  });
  const manualPayData = await initiateManualPayRes.json();
  console.log('Initiated payment for manual confirm. Payment ID:', manualPayData.paymentId);

  // Fetch pending payments as Super Admin
  console.log('Fetching pending payments list as Super Admin...');
  const pendingPaymentsRes = await fetch(`${BASE_URL}/api/admin/platform-payments`, { headers: adminHeaders });
  if (pendingPaymentsRes.status !== 200) {
    throw new Error(`Failed to fetch platform payments as Admin: ${pendingPaymentsRes.status}`);
  }
  const platformPayments = await pendingPaymentsRes.json();
  const pendingPayment = platformPayments.find(p => p.status === 'pending');
  if (!pendingPayment) {
    throw new Error('Could not find any pending platform payments.');
  }
  console.log(`Found pending platform payment: ID ${pendingPayment.id}, Ref: ${pendingPayment.reference_number}`);

  // Confirm payment manually
  console.log('Confirming payment manually as Super Admin...');
  const confirmRes = await fetch(`${BASE_URL}/api/admin/confirm-payment`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      payment_id: pendingPayment.id
    })
  });
  if (confirmRes.status !== 200) {
    throw new Error(`POST /api/admin/confirm-payment failed: ${confirmRes.status} ${await confirmRes.text()}`);
  }
  console.log('Manual confirmation call returned success.');

  // Verify unlocked
  const postConfirmStatusRes = await fetch(`${BASE_URL}/api/saas/status`, { headers: landlordHeaders });
  const postConfirmStatus = await postConfirmStatusRes.json();
  console.log('Post-confirm Status:', postConfirmStatus.organization.is_locked ? 'LOCKED' : 'UNLOCKED');
  if (postConfirmStatus.organization.is_locked) {
    throw new Error('Organization should be unlocked after Super Admin confirmation.');
  }
  console.log('PASS: Organization unlocked successfully via Super Admin manual confirmation.');

  // Check system audit log
  console.log('Verifying system audit logs...');
  const auditsRes = await fetch(`${BASE_URL}/api/admin/system-audits`, { headers: adminHeaders });
  const audits = await auditsRes.json();
  const manualConfirmAudit = audits.find(a => a.action === 'saas_payment_confirmed_manually');
  if (!manualConfirmAudit) {
    throw new Error('Could not find manual confirmation action in system audit logs.');
  }
  console.log('PASS: Manual confirmation action is audited successfully.');

  // 8. Test Pricing Config adjustments
  console.log('Testing global pricing adjustments...');
  const pricingRes = await fetch(`${BASE_URL}/api/admin/pricing`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      price_per_active_tenant: 250,
      grace_period_days: 10
    })
  });
  if (pricingRes.status !== 200) {
    throw new Error(`POST /api/admin/pricing failed: ${pricingRes.status}`);
  }
  const updatedPricing = await pricingRes.json();
  if (parseFloat(updatedPricing.price_per_active_tenant) !== 250 || parseInt(updatedPricing.grace_period_days) !== 10) {
    throw new Error(`Pricing did not update correctly: ${JSON.stringify(updatedPricing)}`);
  }
  console.log('PASS: Global platform pricing updated successfully.');

  console.log('All SaaS billing smoke tests passed successfully!');
} finally {
  server.kill('SIGTERM');
}
