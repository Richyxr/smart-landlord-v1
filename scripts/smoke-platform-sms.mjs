import { spawn } from 'node:child_process';
import assert from 'node:assert';
import pg from 'pg';
import crypto from 'node:crypto';

const APP_PORT = '5064';
const BASE_URL = `http://localhost:${APP_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/smart_landlord';
const ENCRYPTION_KEY = 'local-test-encryption-key-32plus-chars';

process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
process.env.NODE_ENV = 'test';

const SESSION_SECRET = process.env.SESSION_SECRET || 'smart-landlord-dev-session-secret';
const SESSION_TTL_SECONDS = 86400;

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function signPayload(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function createSessionToken(userId, role, organizationId = null) {
  return signPayload({
    user_id: userId,
    role,
    organization_id: organizationId,
    issued_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL_SECONDS * 1000
  });
}

function startAppServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT: APP_PORT,
      NODE_ENV: 'test',
      DATA_BACKEND: 'postgres',
      ENCRYPTION_KEY
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  child.stdout.on('data', data => {
    // Silence output or log to debug
  });
  
  child.stderr.on('data', data => {
    // Silence output or log to debug
  });

  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'non-existent@example.com' })
      });
      if (res.status === 400 || res.ok) return;
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error('App server failed to start within timeout');
}

async function main() {
  console.log('[E2E-TEST] Starting Platform SMS Gateway smoke test...');

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  let testUserId = null;
  let originalSettings = null;
  let appProcess = null;

  try {
    // 1. Fetch original settings
    const origRes = await client.query('SELECT * FROM platform_billing_settings WHERE id = 1');
    originalSettings = origRes.rows[0] || null;

    // 2. Set up test user
    const userRes = await client.query(`
      INSERT INTO users (email, name, phone_number, status, email_verified, auth_provider_uid)
      VALUES ('sms-test@example.com', 'SMS E2E Test User', '+254700111222', 'active', true, 'smoke:sms-test@example.com')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, status = 'active', email_verified = true
      RETURNING id
    `);
    testUserId = userRes.rows[0].id;
    console.log(`[E2E-TEST] Created test user with ID ${testUserId}`);

    // 3. Start app server
    appProcess = startAppServer();
    await waitForServer();
    console.log('[E2E-TEST] Backend server is running');

    const superAdminToken = createSessionToken(testUserId, 'super_admin');
    const landlordToken = createSessionToken(testUserId, 'landlord');

    // 4. Test unauthorized access
    console.log(' - Verify unauthorized access is blocked...');
    const unauthGet = await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      headers: { 'Authorization': `Bearer ${landlordToken}` }
    });
    assert.strictEqual(unauthGet.status, 403, 'Landlord role should not access SMS settings');

    const unauthPut = await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${landlordToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ provider: 'mock' })
    });
    assert.strictEqual(unauthPut.status, 403, 'Landlord role should not save SMS settings');

    const unauthTest = await fetch(`${BASE_URL}/api/admin/platform-sms/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${landlordToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: '+254700111222' })
    });
    assert.strictEqual(unauthTest.status, 403, 'Landlord role should not test SMS settings');
    console.log('   ✅ Unauthorized access block passed');

    // 5. Super admin access allowed
    console.log(' - Verify super admin access...');
    const getRes = await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.hasOwnProperty('status'));
    assert.ok(getData.hasOwnProperty('config_masked'));
    console.log('   ✅ Super admin access allowed passed');

    // 6. Config Save (PUT)
    console.log(' - Verify config save (PUT)...');
    const configPayload = {
      provider: 'mock',
      api_url: 'http://localhost/test-sms-gateway',
      sender_id: 'SMARTLANDY',
      sender_id_type: 'transactional',
      sender_approval_status: 'approved',
      default_country_code: '+254',
      config_json: {
        api_key: 'test-api-key-123456789',
        client_id: 'test-client-id-987654321'
      }
    };

    const putRes = await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(configPayload)
    });
    assert.strictEqual(putRes.status, 200);
    const putData = await putRes.json();
    assert.strictEqual(putData.provider, 'mock');
    assert.strictEqual(putData.sender_id, 'SMARTLANDY');
    assert.strictEqual(putData.sender_id_type, 'transactional');
    assert.strictEqual(putData.sender_approval_status, 'approved');
    assert.strictEqual(putData.default_country_code, '+254');
    assert.strictEqual(putData.status, 'verified');
    console.log('   ✅ Config save (PUT) passed');

    // 7. Masked API response
    console.log(' - Verify masked API response...');
    assert.ok(putData.config_masked.api_key.includes('********'));
    assert.ok(putData.config_masked.client_id.includes('********'));
    assert.ok(!JSON.stringify(putData).includes('test-api-key-123456789'));
    assert.ok(!JSON.stringify(putData).includes('test-client-id-987654321'));
    console.log('   ✅ Masked API response passed');

    // 8. Encrypted storage
    console.log(' - Verify encrypted storage...');
    const dbRes = await client.query('SELECT sms_config_encrypted FROM platform_billing_settings WHERE id = 1');
    const encryptedVal = dbRes.rows[0].sms_config_encrypted;
    assert.ok(encryptedVal);
    assert.ok(!encryptedVal.includes('test-api-key-123456789'));
    console.log('   ✅ Encrypted storage passed');

    // 9. Test SMS success
    console.log(' - Verify test SMS success...');
    const testSuccessRes = await fetch(`${BASE_URL}/api/admin/platform-sms/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: '+254700111222' })
    });
    assert.strictEqual(testSuccessRes.status, 200);
    const testSuccessData = await testSuccessRes.json();
    assert.strictEqual(testSuccessData.success, true);
    assert.strictEqual(testSuccessData.status, 'active');

    const dbStatusRes = await client.query('SELECT sms_status, sms_last_error, sms_last_tested_at FROM platform_billing_settings WHERE id = 1');
    assert.strictEqual(dbStatusRes.rows[0].sms_status, 'active');
    assert.strictEqual(dbStatusRes.rows[0].sms_last_error, null);
    assert.ok(dbStatusRes.rows[0].sms_last_tested_at);
    console.log('   ✅ Test SMS success passed');

    // 10. Test SMS failure with sanitized error
    console.log(' - Verify test SMS failure with sanitized error...');
    const invalidConfigPayload = {
      ...configPayload,
      config_json: {
        api_key: 'invalid-key',
        client_id: 'test-client-id-987654321'
      }
    };
    await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invalidConfigPayload)
    });

    const testFailureRes = await fetch(`${BASE_URL}/api/admin/platform-sms/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: '+254700111222' })
    });
    assert.strictEqual(testFailureRes.status, 502);
    const testFailureData = await testFailureRes.json();
    assert.strictEqual(testFailureData.status, 'test_failed');
    
    const dbStatusFailureRes = await client.query('SELECT sms_status, sms_last_error FROM platform_billing_settings WHERE id = 1');
    assert.strictEqual(dbStatusFailureRes.rows[0].sms_status, 'test_failed');
    assert.ok(dbStatusFailureRes.rows[0].sms_last_error);
    assert.ok(!dbStatusFailureRes.rows[0].sms_last_error.includes('invalid-key'));
    assert.ok(!dbStatusFailureRes.rows[0].sms_last_error.includes('test-client-id-987654321'));
    console.log('   ✅ Test SMS failure with sanitized error passed');

    console.log('\n[E2E-TEST] All E2E smoke tests completed successfully! 🎉');

  } catch (err) {
    console.error('[E2E-TEST] Smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    if (appProcess) {
      appProcess.kill();
    }

    if (testUserId) {
      try {
        await client.query('DELETE FROM audit_logs WHERE actor_user_id = $1', [testUserId]);
        await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
        console.log('[E2E-TEST] Cleaned up test user and related audits');
      } catch (err) {
        console.error('Failed to clean up test user/audits:', err.message);
      }
    }

    if (originalSettings) {
      try {
        await client.query(`
          UPDATE platform_billing_settings
          SET sms_provider = $1, sms_api_url = $2, sms_config_encrypted = $3,
              sms_sender_id = $4, sms_sender_id_type = $5, sms_sender_approval_status = $6,
              sms_default_country_code = $7, sms_status = $8, sms_last_tested_at = $9,
              sms_last_error = $10
          WHERE id = 1
        `, [
          originalSettings.sms_provider,
          originalSettings.sms_api_url,
          originalSettings.sms_config_encrypted,
          originalSettings.sms_sender_id,
          originalSettings.sms_sender_id_type,
          originalSettings.sms_sender_approval_status,
          originalSettings.sms_default_country_code,
          originalSettings.sms_status,
          originalSettings.sms_last_tested_at,
          originalSettings.sms_last_error
        ]);
        console.log('[E2E-TEST] Restored original platform billing settings');
      } catch (err) {
        console.error('Failed to restore original settings:', err.message);
      }
    }

    client.release();
    await pool.end();
  }
}

main().catch(console.error);
