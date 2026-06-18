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

const server = startServer();

try {
  await waitForServer();

  const landlord = await login('landlord@demo.com');
  const landlordHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${landlord.auth_token}`
  };

  // 1. Get initial integrations
  const getRes = await fetch(`${BASE_URL}/api/integrations`, { headers: landlordHeaders });
  if (getRes.status !== 200) {
    throw new Error(`GET /api/integrations failed with status ${getRes.status}`);
  }
  const initialIntegrations = await getRes.json();
  console.log(`Initial integrations count: ${initialIntegrations.length}`);

  // 2. Save a new/updated integration
  const saveRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: landlordHeaders,
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'M-Pesa Webhook Provider',
      environment: 'sandbox',
      config_json: {
        shortcode: '654321',
        passkey: 'secretpasskey123',
        consumer_key: 'consumerkey789'
      }
    })
  });

  if (saveRes.status !== 200) {
    throw new Error(`POST /api/integrations failed with status ${saveRes.status}: ${await saveRes.text()}`);
  }

  const savedIntegration = await saveRes.json();
  console.log('Saved integration response:', JSON.stringify(savedIntegration, null, 2));

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
  if (!maskedPasskey || !maskedPasskey.includes('********') || maskedPasskey === 'secretpasskey123') {
    throw new Error(`Passkey was not properly masked: ${maskedPasskey}`);
  }
  console.log('PASS: API response sanitizes sensitive fields.');

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
    console.log(`Encrypted value stored in DB: ${encrypted}`);
    
    // Ciphertext format must be iv:ciphertext:tag
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(`DB config_json_encrypted format is invalid. Expected iv:ciphertext:tag format, got: ${encrypted}`);
    }
    if (encrypted.includes('secretpasskey123') || encrypted.includes('consumerkey789')) {
      throw new Error('DB config_json_encrypted contains plaintext credentials!');
    }
    console.log('PASS: Credentials are encrypted at rest in the database using AES-256-GCM.');
  } finally {
    await pgClient.end();
  }

  // 4. Test integration API connection simulation
  const testRes = await fetch(`${BASE_URL}/api/integrations/${savedIntegration.id}/test`, {
    method: 'POST',
    headers: landlordHeaders
  });
  if (testRes.status !== 200) {
    throw new Error(`POST /api/integrations/:id/test failed with status ${testRes.status}`);
  }
  const testResult = await testRes.json();
  console.log('Test result response:', JSON.stringify(testResult, null, 2));
  if (!['ready', 'test_failed'].includes(testResult.new_status)) {
    throw new Error(`Unexpected status transition after test: ${testResult.new_status}`);
  }
  console.log('PASS: Integration testing logs test run and transitions status.');

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
