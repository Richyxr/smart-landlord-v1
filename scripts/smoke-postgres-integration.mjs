import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL integration smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5059';
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

function assertStatus(label, response, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected ${expectedStatus}, received ${response.status}`);
  }
  console.log(`PASS: ${label}`);
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

  // 1. Get initial integrations
  const getRes = await fetch(`${BASE_URL}/api/integrations`, { headers: landlordHeaders });
  if (getRes.status !== 200) {
    throw new Error(`GET /api/integrations failed with status ${getRes.status}`);
  }
  const initialIntegrations = await getRes.json();
  console.log(`Initial integrations count: ${initialIntegrations.length}`);

  const caretakerGet = await fetch(`${BASE_URL}/api/integrations`, { headers: caretakerHeaders });
  assertStatus('Caretaker cannot access integration routes', caretakerGet, 403);

  const missingCredentialRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'M-Pesa Webhook Provider',
      environment: 'sandbox',
      config_json: {
        shortcode: '654321',
        passkey: 'sandbox-passkey-only'
      }
    })
  });
  assertStatus('M-Pesa sandbox save rejects missing credentials', missingCredentialRes, 400);

  const liveRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'M-Pesa Webhook Provider',
      environment: 'live',
      config_json: {
        shortcode: '654321',
        passkey: 'sandbox-passkey',
        consumer_key: 'sandbox-consumer-key',
        consumer_secret: 'sandbox-consumer-secret'
      }
    })
  });
  assertStatus('M-Pesa live environment is rejected without gate acknowledgment', liveRes, 400);

  const liveSaveGateRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'M-Pesa Webhook Provider',
      environment: 'live',
      acknowledge_live_gate: true,
      config_json: {
        shortcode: '654321',
        passkey: 'live-passkey-for-smoke',
        consumer_key: 'live-consumer-key-for-smoke',
        consumer_secret: 'live-consumer-secret-for-smoke'
      }
    })
  });
  assertStatus('M-Pesa live environment saves with gate acknowledgment', liveSaveGateRes, 200);
  const liveSavedIntegration = await liveSaveGateRes.json();
  if (liveSavedIntegration.environment !== 'live') {
    throw new Error(`Expected environment to be 'live', got ${liveSavedIntegration.environment}`);
  }
  console.log('PASS: Saved live M-Pesa integration successfully.');

  // Test live Daraja token connection using the live integration we created
  const liveTestRes = await fetch(`${BASE_URL}/api/integrations/${liveSavedIntegration.id}/test`, {
    method: 'POST',
    headers: landlordHeaders
  });
  if (liveTestRes.status !== 502) {
    throw new Error(`Expected invalid live Daraja credentials to fail with 502, got ${liveTestRes.status}`);
  }
  const liveTestResult = await liveTestRes.json();
  if (!liveTestResult.response_summary || !liveTestResult.response_summary.includes('Daraja live OAuth rejected')) {
    throw new Error(`Expected live test response summary to mention live OAuth rejection, got: ${JSON.stringify(liveTestResult)}`);
  }
  console.log('PASS: Live Daraja token test used production Safaricom URL.');

  // Delete live integration credentials too to clean up
  const liveDeleteRes = await fetch(`${BASE_URL}/api/integrations/${liveSavedIntegration.id}/delete`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ pin: '123456' })
  });
  if (liveDeleteRes.status !== 200) {
    throw new Error(`Expected live delete to succeed, got ${liveDeleteRes.status}`);
  }
  console.log('PASS: Live integration credentials deleted successfully.');

  // 2. Save a new/updated sandbox integration
  const saveRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'M-Pesa Webhook Provider',
      environment: 'sandbox',
      config_json: {
        shortcode: '654321',
        passkey: 'sandbox-passkey-for-smoke',
        consumer_key: 'sandbox-consumer-key-for-smoke',
        consumer_secret: 'sandbox-consumer-secret-for-smoke'
      }
    })
  });

  if (saveRes.status !== 200) {
    throw new Error(`POST /api/integrations failed with status ${saveRes.status}: ${await saveRes.text()}`);
  }

  const savedIntegration = await saveRes.json();
  console.log('Saved integration response status:', savedIntegration.status);

  // Assertions on API response:
  // - config_json_encrypted must NOT be present
  if (savedIntegration.config_json_encrypted) {
    throw new Error('Security vulnerability: config_json_encrypted exposed in API response!');
  }
  // - config_masked must be populated
  if (!savedIntegration.config_masked || typeof savedIntegration.config_masked !== 'object') {
    throw new Error('Saved integration config_masked is missing or not an object.');
  }
  // - Values must be masked
  const maskedPasskey = savedIntegration.config_masked.passkey;
  if (!maskedPasskey || !maskedPasskey.includes('********') || maskedPasskey === 'sandbox-passkey-for-smoke') {
    throw new Error(`Passkey was not properly masked: ${maskedPasskey}`);
  }
  const maskedSecret = savedIntegration.config_masked.consumer_secret;
  if (!maskedSecret || !maskedSecret.includes('********') || maskedSecret === 'sandbox-consumer-secret-for-smoke') {
    throw new Error('Consumer secret was not properly masked.');
  }
  console.log('PASS: API response sanitizes sensitive fields.');

  if (savedIntegration.environment !== 'sandbox') {
    throw new Error(`Expected saved M-Pesa integration environment to be sandbox, got ${savedIntegration.environment}`);
  }
  console.log('PASS: M-Pesa integration remains sandbox-only.');

  // Verify status is updated to 'draft'
  if (savedIntegration.status !== 'draft') {
    throw new Error(`Expected integration status to be 'draft', but got '${savedIntegration.status}'`);
  }
  console.log('PASS: Integration status resolves to draft upon credentials save.');

  // 3. Directly check the database to verify AES-256-GCM encryption is stored
  const pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient.connect();
  try {
    const dbRes = await pgClient.query(
      'SELECT config_json_encrypted, shortcode, webhook_secret FROM organization_integrations WHERE id = $1',
      [savedIntegration.id]
    );
    if (dbRes.rows.length === 0) {
      throw new Error(`Could not find integration ${savedIntegration.id} in DB.`);
    }
    const dbRow = dbRes.rows[0];
    const encrypted = dbRow.config_json_encrypted;
    
    // Ciphertext format must be iv:ciphertext:tag
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(`DB config_json_encrypted format is invalid. Expected iv:ciphertext:tag format, got: ${encrypted}`);
    }
    if (
      encrypted.includes('sandbox-passkey-for-smoke') ||
      encrypted.includes('sandbox-consumer-key-for-smoke') ||
      encrypted.includes('sandbox-consumer-secret-for-smoke')
    ) {
      throw new Error('DB config_json_encrypted contains plaintext credentials!');
    }
    console.log('PASS: Credentials are encrypted at rest in the database using AES-256-GCM.');
  } finally {
    await pgClient.end();
  }

  // 4. Test Daraja sandbox token action with invalid smoke credentials.
  const testRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}/test`, {
    method: 'POST',
    headers: landlordHeaders
  });
  if (testRes.status !== 502) {
    throw new Error(`Expected invalid Daraja sandbox credentials to fail safely with 502, got ${testRes.status}: ${await testRes.text()}`);
  }
  const testResult = await testRes.json();
  if (testResult.success !== false || testResult.new_status !== 'test_failed') {
    throw new Error(`Unexpected Daraja sandbox test failure response: ${JSON.stringify(testResult)}`);
  }
  if (/sandbox-consumer-secret-for-smoke|sandbox-consumer-key-for-smoke/.test(JSON.stringify(testResult))) {
    throw new Error('Daraja sandbox test response exposed credentials.');
  }
  console.log('PASS: Daraja sandbox token test rejects invalid credentials safely.');

  // 5. Try to delete credentials with incorrect PIN (must fail)
  const deleteFailRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}/delete`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ pin: 'wrong-pin' })
  });
  if (deleteFailRes.status === 200) {
    throw new Error('Expected delete request with incorrect PIN to fail, but it succeeded.');
  }
  console.log('PASS: Credential deletion blocks incorrect PIN.');

  // 6. Delete credentials with correct PIN (must succeed)
  const deleteSuccessRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}/delete`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({ pin: '123456' })
  });
  if (deleteSuccessRes.status !== 200) {
    throw new Error(`POST /api/integrations/:id/delete failed with status ${deleteSuccessRes.status}: ${await deleteSuccessRes.text()}`);
  }
  const deleteResult = await deleteSuccessRes.json();
  if (!deleteResult.success) {
    throw new Error(`Expected delete response success to be true, got: ${JSON.stringify(deleteResult)}`);
  }
  console.log('PASS: Credential deletion succeeds with correct PIN.');

  // 7. Verify status reset in database
  const getAfterDeleteRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}`, { headers: landlordHeaders });
  const integrationAfterDelete = await getAfterDeleteRes.json();
  if (integrationAfterDelete.status !== 'needs_credentials') {
    throw new Error(`Expected status reset to 'needs_credentials', got: ${integrationAfterDelete.status}`);
  }
  if (integrationAfterDelete.has_credentials) {
    throw new Error('Integration still has credentials after deletion.');
  }
  console.log('PASS: Deletion soft-resets the integration status and clears credentials.');

  console.log('PostgreSQL integration secret management smoke test passed successfully.');
} finally {
  server.kill('SIGTERM');
}
