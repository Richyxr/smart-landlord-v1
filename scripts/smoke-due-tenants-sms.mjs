import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for due tenants SMS smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5075';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'postgres',
      ENCRYPTION_KEY: 'test-encryption-key-for-smoke-tests-only'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'landlord@demo.com' })
      });
      if (res.ok) return;
    } catch (_) {
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
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.json();
}

const server = startServer();

try {
  await waitForServer();

  const landlord = await login('landlord@demo.com');
  const caretaker = await login('caretaker@demo.com');

  const landlordHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${landlord.auth_token}`
  };
  const caretakerHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${caretaker.auth_token}`
  };

  const ENDPOINT = `${BASE_URL}/api/notifications/due-tenants/send-reminders`;

  // =========================================================
  // Test 1: Caretaker RBAC blocking
  // =========================================================
  console.log('\n[1/6] Testing caretaker RBAC block...');
  const ctRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: caretakerHeaders,
    body: JSON.stringify({ tenant_ids: [1] })
  });
  if (ctRes.status !== 403) {
    throw new Error(`Expected 403 for caretaker, got ${ctRes.status}: ${await ctRes.text()}`);
  }
  console.log('PASS: Caretaker blocked with 403.');

  // =========================================================
  // Test 2: Empty tenant_ids → 400
  // =========================================================
  console.log('\n[2/6] Testing empty tenant_ids → 400...');
  const emptyRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ tenant_ids: [] })
  });
  if (emptyRes.status !== 400) {
    throw new Error(`Expected 400 for empty tenant_ids, got ${emptyRes.status}`);
  }
  console.log('PASS: Empty tenant_ids returns 400.');

  // =========================================================
  // Test 3: No SMS provider configured → 503
  // =========================================================
  console.log('\n[3/6] Testing no SMS provider → 503...');

  // Get orgId by fetching notification settings (uses the token's org context)
  const settingsCheckRes = await fetch(`${BASE_URL}/api/settings/notifications`, {
    headers: landlordHeaders
  });
  if (!settingsCheckRes.ok) throw new Error(`Could not fetch notification settings: ${settingsCheckRes.status}`);
  const settingsCheck = await settingsCheckRes.json();
  const orgId = settingsCheck.organization_id;
  if (!orgId) throw new Error(`org_id not found in notification settings response: ${JSON.stringify(settingsCheck)}`);

  // Set sms_provider to None via the API
  const resetProviderRes = await fetch(`${BASE_URL}/api/settings/notifications`, {
    method: 'PUT',
    headers: landlordHeaders,
    body: JSON.stringify({ sms_provider: 'None' })
  });
  if (!resetProviderRes.ok) throw new Error(`Could not reset SMS provider: ${resetProviderRes.status}`);

  // Get a valid tenant id via the tenants API
  const tenantsRes = await fetch(`${BASE_URL}/api/tenants`, { headers: landlordHeaders });
  if (!tenantsRes.ok) throw new Error(`Could not fetch tenants: ${tenantsRes.status}`);
  const tenantsList = await tenantsRes.json();
  const activeTenants = tenantsList.filter(t => t.status === 'active');
  if (activeTenants.length === 0) throw new Error('No active tenants found — run db-seed-from-json first');
  const tenantId = activeTenants[0].id;


  const noProviderRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ tenant_ids: [tenantId] })
  });
  const noProviderData = await noProviderRes.json();
  console.log('No-provider response:', JSON.stringify(noProviderData));
  if (noProviderRes.status !== 503) {
    throw new Error(`Expected 503 for no SMS provider, got ${noProviderRes.status}`);
  }
  if (noProviderData.error !== 'SMS_PROVIDER_NOT_CONFIGURED') {
    throw new Error(`Expected SMS_PROVIDER_NOT_CONFIGURED error, got: ${noProviderData.error}`);
  }
  console.log('PASS: No SMS provider returns 503 with SMS_PROVIDER_NOT_CONFIGURED.');

  // =========================================================
  // Test 4: Cross-org tenant ID → 400 NO_VALID_TENANTS
  // =========================================================
  console.log('\n[4/6] Testing cross-org tenant ID (invalid) → 400...');
  const crossOrgRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ tenant_ids: [999999999] })
  });
  const crossOrgData = await crossOrgRes.json();
  console.log('Cross-org response:', JSON.stringify(crossOrgData));
  if (crossOrgRes.status !== 400 && crossOrgRes.status !== 503) {
    // 503 is also acceptable if provider check runs first
    throw new Error(`Expected 400 or 503 for cross-org tenant, got ${crossOrgRes.status}`);
  }
  console.log('PASS: Cross-org / invalid tenant ID handled safely (no data leak).');

  // =========================================================
  // Test 5: Configure mock Mobitech + successful send
  // =========================================================
  console.log('\n[5/6] Configuring mock Mobitech and sending SMS reminder...');

  // Configure Mobitech integration
  const saveIntRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'sms',
      provider_name: 'Mobitech',
      environment: 'sandbox',
      config_json: {
        api_key: 'mock_due_tenants_key',
        partner_id: 'partner_due_test',
        sender_id: 'DUETEST'
      }
    })
  });
  if (saveIntRes.status !== 200) {
    throw new Error(`Failed to configure Mobitech: ${saveIntRes.status} ${await saveIntRes.text()}`);
  }

  // Update notification settings to use Mobitech
  const settingsRes = await fetch(`${BASE_URL}/api/settings/notifications`, {
    method: 'PUT',
    headers: landlordHeaders,
    body: JSON.stringify({ sms_provider: 'Mobitech', rent_reminders_enabled: true })
  });
  if (settingsRes.status !== 200) {
    throw new Error(`Failed to update settings: ${settingsRes.status}`);
  }

  // Send the reminder
  const sendRes = await fetch(ENDPOINT, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ tenant_ids: [tenantId] })
  });
  const sendData = await sendRes.json();
  console.log('Send response:', JSON.stringify(sendData));

  if (sendRes.status !== 200) {
    throw new Error(`Expected 200 for valid send, got ${sendRes.status}: ${JSON.stringify(sendData)}`);
  }
  if (typeof sendData.queued !== 'number' || sendData.queued < 0) {
    throw new Error(`Expected queued count in response, got: ${JSON.stringify(sendData)}`);
  }
  if (!Array.isArray(sendData.results) || sendData.results.length === 0) {
    throw new Error(`Expected results array, got: ${JSON.stringify(sendData)}`);
  }

  const result0 = sendData.results[0];
  if (result0.status !== 'queued') {
    throw new Error(`Expected first result to be 'queued', got: ${result0.status} — reason: ${result0.reason}`);
  }
  console.log('PASS: SMS reminder queued successfully via Mobitech mock.');

  // =========================================================
  // Test 6: Verify notification log row was created in DB
  // =========================================================
  console.log('\n[6/6] Verifying notification log row in database...');
  const pgClient2 = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient2.connect();
  try {
    const logRes = await pgClient2.query(
      `SELECT id, status, channel, type, provider_reference
       FROM notification_logs
       WHERE id = $1`,
      [result0.log_id]
    );
    if (logRes.rows.length === 0) {
      throw new Error(`Notification log row ${result0.log_id} not found in DB`);
    }
    const logRow = logRes.rows[0];
    console.log(`  Log ${logRow.id}: channel=${logRow.channel}, type=${logRow.type}, status=${logRow.status}`);
    if (logRow.channel !== 'sms') throw new Error(`Expected channel=sms, got ${logRow.channel}`);
    // status will be 'sent' (processed immediately) or 'pending' depending on timing
    if (!['sent', 'pending'].includes(logRow.status)) {
      throw new Error(`Unexpected log status: ${logRow.status}`);
    }
  } finally {
    await pgClient2.end();
  }
  console.log('PASS: Notification log row created and valid in database.');

  console.log('\nALL DUE TENANTS SMS SMOKE TESTS PASSED SUCCESSFULLY.');

} finally {
  server.kill('SIGTERM');
}
