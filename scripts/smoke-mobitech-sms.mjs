import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL Mobitech SMS smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5070';
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverOutput = '';

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

  child.stdout.on('data', data => {
    const chunk = data.toString();
    serverOutput += chunk;
    process.stdout.write(`[server] ${chunk}`);
  });
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
  const caretaker = await login('caretaker@demo.com');
  
  const landlordHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${landlord.auth_token}`
  };
  const caretakerHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${caretaker.auth_token}`
  };

  // 1. Caretaker RBAC blocking checks
  console.log('Testing Caretaker RBAC blocking...');
  
  const ctGetRes = await fetch(`${BASE_URL}/api/integrations`, { headers: caretakerHeaders });
  if (ctGetRes.status !== 403) {
    throw new Error(`Expected caretaker to get 403 on GET /api/integrations, got ${ctGetRes.status}`);
  }
  
  const ctPostRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: caretakerHeaders,
    body: JSON.stringify({
      provider_type: 'sms',
      provider_name: 'Mobitech',
      config_json: { api_key: 'test', partner_id: '123' }
    })
  });
  if (ctPostRes.status !== 403) {
    throw new Error(`Expected caretaker to get 403 on POST /api/integrations, got ${ctPostRes.status}`);
  }
  console.log('PASS: Caretaker restricted from integrations endpoints.');

  // 2. Landlord configures Mobitech
  console.log('Landlord configuring Mobitech...');
  const saveRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'sms',
      provider_name: 'Mobitech',
      environment: 'sandbox',
      config_json: {
        api_key: 'mock_mobitech_api_key_xyz',
        partner_id: 'partner98765',
        sender_id: 'MOBISMS'
      }
    })
  });

  if (saveRes.status !== 200) {
    throw new Error(`POST /api/integrations failed with status ${saveRes.status}: ${await saveRes.text()}`);
  }

  const savedIntegration = await saveRes.json();
  
  // Verify masking
  if (savedIntegration.config_json_encrypted) {
    throw new Error('Security vulnerability: config_json_encrypted exposed in API response!');
  }
  
  const maskedApiKey = savedIntegration.config_masked.api_key;
  const maskedPartnerId = savedIntegration.config_masked.partner_id;
  if (!maskedApiKey || !maskedApiKey.includes('********') || maskedApiKey === 'mock_mobitech_api_key_xyz') {
    throw new Error(`API key not masked properly: ${maskedApiKey}`);
  }
  if (!maskedPartnerId || !maskedPartnerId.includes('********') || maskedPartnerId === 'partner98765') {
    throw new Error(`Partner ID not masked properly: ${maskedPartnerId}`);
  }
  console.log('PASS: API response masks credentials properly.');

  // 3. Database AES-256-GCM verification
  console.log('Checking database encryption...');
  const pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient.connect();
  let dbRow;
  try {
    const dbRes = await pgClient.query(
      'SELECT config_json_encrypted, provider_name FROM organization_integrations WHERE id = $1',
      [savedIntegration.id]
    );
    if (dbRes.rows.length === 0) {
      throw new Error(`Could not find integration ${savedIntegration.id} in DB.`);
    }
    dbRow = dbRes.rows[0];
    const encrypted = dbRow.config_json_encrypted;
    console.log(`Encrypted DB value: ${encrypted}`);
    
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(`DB config_json_encrypted format is invalid. Expected iv:ciphertext:tag, got: ${encrypted}`);
    }
    if (encrypted.includes('mock_mobitech') || encrypted.includes('partner98765')) {
      throw new Error('Plaintext secrets leaked into DB config_json_encrypted!');
    }
  } finally {
    await pgClient.end();
  }
  console.log('PASS: Credentials are encrypted at rest using AES-256-GCM.');

  // 4. Test SMS endpoint verification (RBAC & Success)
  console.log('Testing test-sms endpoint role guard...');
  const ctTestSmsRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}/test-sms`, {
    method: 'POST',
    headers: caretakerHeaders,
    body: JSON.stringify({ phone_number: '0712345678' })
  });
  if (ctTestSmsRes.status !== 403) {
    throw new Error(`Expected caretaker to get 403 on test-sms, got ${ctTestSmsRes.status}`);
  }
  console.log('PASS: Caretaker blocked from test-sms endpoint.');

  console.log('Triggering test SMS via Landlord...');
  const testSmsRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}/test-sms`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ phone_number: '0712345678' })
  });
  if (testSmsRes.status !== 200) {
    throw new Error(`Landlord test SMS failed with status ${testSmsRes.status}: ${await testSmsRes.text()}`);
  }
  const testSmsResult = await testSmsRes.json();
  if (!testSmsResult.success || !testSmsResult.message.includes('Mock Send Success')) {
    throw new Error(`Unexpected test SMS outcome: ${JSON.stringify(testSmsResult)}`);
  }
  console.log('PASS: Landlord test-sms endpoint returned success.');

  // 5. Update Preferred SMS Provider to Mobitech
  console.log('Updating preferred SMS provider...');
  const updateSettingsRes = await fetch(`${BASE_URL}/api/settings/notifications`, {
    method: 'PUT',
    headers: landlordHeaders,
    body: JSON.stringify({
      rent_reminders_enabled: true,
      sms_provider: 'Mobitech'
    })
  });
  if (updateSettingsRes.status !== 200) {
    throw new Error(`Failed to update notification settings: ${updateSettingsRes.status}`);
  }
  const updatedSettings = await updateSettingsRes.json();
  if (updatedSettings.sms_provider !== 'Mobitech') {
    throw new Error(`Failed to set SMS provider to Mobitech. Settings: ${JSON.stringify(updatedSettings)}`);
  }
  console.log('PASS: Preferred SMS provider set to Mobitech.');

  // 6. Test notification routing via Mobitech
  console.log('Queueing and retrying SMS notification via Mobitech routing...');
  const pgClient2 = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient2.connect();
  let testLog;
  try {
    const insertRes = await pgClient2.query(
      `
        INSERT INTO notification_logs (
          organization_id, recipient_user_id, phone_number, channel, type, message, status, retry_count, max_retries
        )
        VALUES ($1, $2, '0799887766', 'sms', 'rent_reminder', 'Mock Mobitech SMS routing test.', 'pending', 0, 3)
        RETURNING *
      `,
      [updatedSettings.organization_id, landlord.user_id]
    );
    testLog = insertRes.rows[0];
  } finally {
    await pgClient2.end();
  }

  // Trigger manual retry on this pending log which will invoke sendImmediately
  const retryRes = await fetch(`${BASE_URL}/api/settings/notification-logs/${testLog.id}/retry`, {
    method: 'POST',
    headers: landlordHeaders
  });
  if (retryRes.status !== 200) {
    throw new Error(`Manual retry failed: ${retryRes.status} ${await retryRes.text()}`);
  }
  const retriedLog = await retryRes.json();
  if (retriedLog.status !== 'sent') {
    throw new Error(`Expected log status to be 'sent', got: ${retriedLog.status}`);
  }
  if (!retriedLog.provider_reference.startsWith('mobitech-mock-')) {
    throw new Error(`Expected provider reference to start with 'mobitech-mock-', got: ${retriedLog.provider_reference}`);
  }
  
  // Verify standard output shows the mock send log statement
  if (!serverOutput.includes('[NotificationService MOCK MOBITECH SUCCESS]')) {
    throw new Error('NotificationService mock log print was not captured in stdout.');
  }
  console.log('PASS: Outgoing SMS routed via Mobitech successfully.');

  console.log('ALL MOBITECH SMS GATEWAY SETUP SMOKE TESTS PASSED SUCCESSFULLY.');
} finally {
  server.kill('SIGTERM');
}
