import { spawn } from 'node:child_process';
import assert from 'node:assert';
import pg from 'pg';
import crypto from 'node:crypto';
import { normalizeKenyanPhoneNumber, sendSmsViaAdapter } from '../server/smsProviderService.js';

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

  console.log('\n--- Running SMS Provider Adapter Unit Tests ---');
  // 1. Phone number normalization
  console.log(' - Verify phone number normalization...');
  assert.strictEqual(normalizeKenyanPhoneNumber('0712345678'), '254712345678');
  assert.strictEqual(normalizeKenyanPhoneNumber('+254712345678'), '254712345678');
  assert.strictEqual(normalizeKenyanPhoneNumber('254712345678'), '254712345678');
  assert.strictEqual(normalizeKenyanPhoneNumber('0112345678'), '254112345678');
  assert.strictEqual(normalizeKenyanPhoneNumber('+254112345678'), '254112345678');
  assert.strictEqual(normalizeKenyanPhoneNumber('254112345678'), '254112345678');

  // 2. Invalid phone rejection
  console.log(' - Verify invalid phone rejection...');
  assert.throws(() => normalizeKenyanPhoneNumber('12345'), /Invalid Kenyan phone number/);
  assert.throws(() => normalizeKenyanPhoneNumber('071234567'), /Invalid Kenyan phone number/);
  assert.throws(() => normalizeKenyanPhoneNumber('+2547123456789'), /Invalid Kenyan phone number/);
  assert.throws(() => normalizeKenyanPhoneNumber('abc'), /Invalid Kenyan phone number/);

  // 3. Mock provider success
  console.log(' - Verify mock provider success...');
  const mockSuccess = await sendSmsViaAdapter({
    provider: 'mock',
    api_url: 'http://localhost/test',
    api_key: 'valid-key',
    client_id: 'client-id',
    sender_id: 'SMARTLANDY',
    to: '0712345678',
    message: 'Hello'
  });
  assert.strictEqual(mockSuccess.success, true);
  assert.strictEqual(mockSuccess.status, 'sent');
  assert.ok(mockSuccess.messageId.startsWith('mock-sms-'));

  // 4. Mock provider failure
  console.log(' - Verify mock provider failure...');
  const mockFailure = await sendSmsViaAdapter({
    provider: 'mock',
    api_url: 'http://localhost/test',
    api_key: 'invalid-key',
    client_id: 'client-id',
    sender_id: 'SMARTLANDY',
    to: '0712345678',
    message: 'Hello'
  });
  assert.strictEqual(mockFailure.success, false);
  assert.strictEqual(mockFailure.status, 'failed');
  assert.strictEqual(mockFailure.error, 'Invalid API Key / Token.');

  // 5. Unsupported provider rejection
  console.log(' - Verify unsupported provider rejection...');
  const unsupported = await sendSmsViaAdapter({
    provider: 'unsupported-provider',
    api_url: 'http://localhost/test',
    api_key: 'key',
    client_id: 'client',
    sender_id: 'SMARTLANDY',
    default_country_code: '+254',
    to: '0712345678',
    message: 'Hello'
  });
  assert.strictEqual(unsupported.success, false);
  assert.strictEqual(unsupported.status, 'failed');
  assert.ok(unsupported.error.includes('Unsupported SMS provider'));

  // 6. Real provider adapter does not run unless required config exists
  console.log(' - Verify real provider adapter requires configuration...');
  const realNoKey = await sendSmsViaAdapter({
    provider: 'mobitech',
    api_url: 'http://localhost/test',
    api_key: '',
    client_id: 'client',
    sender_id: 'SMARTLANDY',
    default_country_code: '+254',
    to: '0712345678',
    message: 'Hello',
    sender_approval_status: 'approved'
  });
  assert.strictEqual(realNoKey.success, false);
  assert.strictEqual(realNoKey.error, 'Missing required SMS fields: API Key.');

  const realNoClientId = await sendSmsViaAdapter({
    provider: 'mobitech',
    api_url: 'http://localhost/test',
    api_key: 'key',
    client_id: '',
    sender_id: 'SMARTLANDY',
    default_country_code: '+254',
    to: '0712345678',
    message: 'Hello',
    sender_approval_status: 'approved'
  });
  assert.strictEqual(realNoClientId.success, false);
  assert.strictEqual(realNoClientId.error, 'Missing required SMS fields: Partner ID / Client ID.');

  const realNoUrl = await sendSmsViaAdapter({
    provider: 'mobitech',
    api_url: '',
    api_key: 'key',
    client_id: 'client',
    sender_id: 'SMARTLANDY',
    default_country_code: '+254',
    to: '0712345678',
    message: 'Hello',
    sender_approval_status: 'approved'
  });
  assert.strictEqual(realNoUrl.success, false);
  assert.strictEqual(realNoUrl.error, 'Missing required SMS fields: API Base URL.');
  // 7. Live SMS block when Sender ID is not approved
  console.log(' - Verify live SMS block when Sender ID is not approved...');
  const realBlocked = await sendSmsViaAdapter({
    provider: 'mobitech',
    api_url: 'http://localhost/test',
    api_key: 'key',
    client_id: 'client',
    sender_id: 'SMARTLANDY',
    default_country_code: '+254',
    to: '0712345678',
    message: 'Hello',
    sender_approval_status: 'pending'
  });
  assert.strictEqual(realBlocked.success, false);
  assert.strictEqual(realBlocked.status, 'blocked');
  assert.ok(realBlocked.error.includes('Live SMS sending is blocked'));

  console.log('   ✅ All adapter unit tests passed!\n');

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

    await client.query("DELETE FROM sms_usage_ledger WHERE recipient_phone_e164 IN ($1, $2)", ['+254700111222', '254700111222']);

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

    const unauthUsage = await fetch(`${BASE_URL}/api/admin/platform-sms/usage`, {
      headers: { 'Authorization': `Bearer ${landlordToken}` }
    });
    assert.strictEqual(unauthUsage.status, 403, 'Landlord role should not read platform-wide SMS usage');

    const unauthPricing = await fetch(`${BASE_URL}/api/admin/platform-sms/pricing`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${landlordToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ default_sms_provider_cost: '1', default_sms_sell_price: '2', sms_currency: 'KES' })
    });
    assert.strictEqual(unauthPricing.status, 403, 'Landlord role should not save SMS pricing');

    const unauthProviders = await fetch(`${BASE_URL}/api/admin/platform-sms/providers`, {
      headers: { 'Authorization': `Bearer ${landlordToken}` }
    });
    assert.strictEqual(unauthProviders.status, 403, 'Landlord role should not read provider profiles');

    const unauthReadiness = await fetch(`${BASE_URL}/api/admin/platform-sms/readiness`, {
      headers: { 'Authorization': `Bearer ${landlordToken}` }
    });
    assert.strictEqual(unauthReadiness.status, 403, 'Landlord role should not read SMS readiness');
    console.log('   ✅ Unauthorized access block passed');

    // 5. Super admin access allowed
    console.log(' - Verify super admin access...');
    const providersRes = await fetch(`${BASE_URL}/api/admin/platform-sms/providers`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(providersRes.status, 200);
    const providersData = await providersRes.json();
    const providerKeys = providersData.providers.map(provider => provider.provider_key);
    assert.ok(providerKeys.includes('mock'));
    assert.ok(providerKeys.includes('mobitech_official'));
    assert.ok(providerKeys.includes('textsms_compatible'));

    const getRes = await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.hasOwnProperty('status'));
    assert.ok(getData.hasOwnProperty('config_masked'));
    assert.ok(getData.hasOwnProperty('default_sms_sell_price'));
    assert.ok(getData.hasOwnProperty('readiness'));
    console.log('   ✅ Super admin access allowed passed');

    // 5b. Pricing controls validation and save
    console.log(' - Verify SMS pricing controls...');
    const invalidPricingRes = await fetch(`${BASE_URL}/api/admin/platform-sms/pricing`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sms_billing_enabled: true,
        default_sms_provider_cost: '-1',
        default_sms_sell_price: '2.00',
        sms_currency: 'KES'
      })
    });
    assert.strictEqual(invalidPricingRes.status, 400, 'Invalid SMS pricing settings should be rejected');

    const pricingRes = await fetch(`${BASE_URL}/api/admin/platform-sms/pricing`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sms_billing_enabled: true,
        default_sms_provider_cost: '1.25',
        default_sms_sell_price: '2.50',
        sms_currency: 'KES'
      })
    });
    assert.strictEqual(pricingRes.status, 200);
    const pricingData = await pricingRes.json();
    assert.strictEqual(Number(pricingData.default_sms_provider_cost), 1.25);
    assert.strictEqual(Number(pricingData.default_sms_sell_price), 2.5);
    assert.strictEqual(pricingData.sms_currency, 'KES');
    assert.strictEqual(pricingData.sms_billing_enabled, true);
    console.log('   ✅ SMS pricing controls passed');

    // 5c. Provider-specific required fields block incomplete configuration
    console.log(' - Verify provider readiness validation...');
    const incompleteProviderRes = await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'textsms_compatible',
        api_url: 'http://localhost/test-sms-gateway',
        sender_id: 'SMARTLANDY',
        sender_id_type: 'transactional',
        sender_approval_status: 'approved',
        default_country_code: '+254',
        config_json: {
          api_key: 'test-api-key-123456789'
        }
      })
    });
    assert.strictEqual(incompleteProviderRes.status, 400, 'Missing provider credentials should be rejected safely');
    const incompleteProviderData = await incompleteProviderRes.json();
    assert.ok(incompleteProviderData.error.includes('Partner ID / Client ID'));
    console.log('   ✅ Provider readiness validation passed');

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
    assert.strictEqual(putData.provider_key, 'mock');
    assert.ok(putData.readiness.checklist.find(item => item.key === 'provider_selected')?.ok);
    assert.ok(putData.readiness.checklist.find(item => item.key === 'api_credentials_present')?.ok);
    console.log('   ✅ Config save (PUT) passed');

    const readinessRes = await fetch(`${BASE_URL}/api/admin/platform-sms/readiness`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(readinessRes.status, 200);
    const readinessData = await readinessRes.json();
    assert.strictEqual(readinessData.provider_key, 'mock');
    assert.ok(readinessData.readiness.checklist.find(item => item.key === 'pricing_configured')?.ok);
    assert.ok(readinessData.readiness.checklist.find(item => item.key === 'live_sending_allowed')?.ok);
    console.log('   ✅ Provider readiness checklist passed');

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
    assert.strictEqual(testSuccessData.ok, true);
    assert.strictEqual(testSuccessData.status, 'active');

    const dbStatusRes = await client.query('SELECT sms_status, sms_last_error, sms_last_tested_at FROM platform_billing_settings WHERE id = 1');
    assert.strictEqual(dbStatusRes.rows[0].sms_status, 'active');
    assert.strictEqual(dbStatusRes.rows[0].sms_last_error, null);
    assert.ok(dbStatusRes.rows[0].sms_last_tested_at);

    const successLedgerRes = await client.query(`
      SELECT *
      FROM sms_usage_ledger
      WHERE recipient_phone_e164 = '+254700111222'
      ORDER BY id DESC
      LIMIT 1
    `);
    assert.strictEqual(successLedgerRes.rows.length, 1, 'Successful test SMS should create a ledger row');
    assert.strictEqual(successLedgerRes.rows[0].status, 'sent');
    assert.strictEqual(successLedgerRes.rows[0].source, 'test_sms');
    assert.strictEqual(Number(successLedgerRes.rows[0].provider_unit_cost), 1.25);
    assert.strictEqual(Number(successLedgerRes.rows[0].billed_unit_price), 2.5);
    assert.strictEqual(Number(successLedgerRes.rows[0].provider_total_cost), 1.25);
    assert.strictEqual(Number(successLedgerRes.rows[0].billed_total_amount), 2.5);
    assert.strictEqual(Number(successLedgerRes.rows[0].margin_amount), 1.25);
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

    const failureLedgerRes = await client.query(`
      SELECT *
      FROM sms_usage_ledger
      WHERE recipient_phone_e164 = '+254700111222'
      ORDER BY id DESC
      LIMIT 1
    `);
    assert.strictEqual(failureLedgerRes.rows[0].status, 'failed');
    assert.ok(failureLedgerRes.rows[0].failure_reason);
    assert.ok(!failureLedgerRes.rows[0].failure_reason.includes('invalid-key'));
    console.log('   ✅ Test SMS failure with sanitized error passed');

    // 11. Sender ID pending blocks live SMS and records blocked ledger row
    console.log(' - Verify Sender ID pending block ledger...');
    await fetch(`${BASE_URL}/api/admin/platform-sms`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'textsms_compatible',
        api_url: 'http://localhost/test-sms-gateway',
        sender_id: 'SMARTLANDY',
        sender_id_type: 'transactional',
        sender_approval_status: 'pending',
        default_country_code: '+254',
        config_json: {
          api_key: 'test-api-key-123456789',
          client_id: 'test-client-id-987654321'
        }
      })
    });

    const blockedRes = await fetch(`${BASE_URL}/api/admin/platform-sms/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: '+254700111222' })
    });
    assert.strictEqual(blockedRes.status, 502);
    const blockedLedgerRes = await client.query(`
      SELECT *
      FROM sms_usage_ledger
      WHERE recipient_phone_e164 = '+254700111222'
      ORDER BY id DESC
      LIMIT 1
    `);
    assert.strictEqual(blockedLedgerRes.rows[0].status, 'blocked');
    assert.ok(blockedLedgerRes.rows[0].failure_reason.includes('Live SMS sending is blocked'));

    const blockedReadinessRes = await fetch(`${BASE_URL}/api/admin/platform-sms/readiness`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(blockedReadinessRes.status, 200);
    const blockedReadinessData = await blockedReadinessRes.json();
    assert.strictEqual(blockedReadinessData.provider_key, 'textsms_compatible');
    assert.strictEqual(blockedReadinessData.readiness.checklist.find(item => item.key === 'sender_approval_status')?.status, 'blocked');
    assert.strictEqual(blockedReadinessData.readiness.checklist.find(item => item.key === 'live_sending_allowed')?.status, 'blocked');
    console.log('   ✅ Sender ID pending block ledger passed');

    // 12. Super Admin usage summary
    console.log(' - Verify Super Admin SMS usage summary...');
    const usageRes = await fetch(`${BASE_URL}/api/admin/platform-sms/usage`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(usageRes.status, 200);
    const usageData = await usageRes.json();
    assert.ok(Number(usageData.summary.sent_month) >= 1);
    assert.ok(Number(usageData.summary.failed_month) >= 1);
    assert.ok(Number(usageData.summary.blocked_month) >= 1);
    assert.ok(Number(usageData.summary.provider_cost_month) >= 3.75);
    assert.ok(Number(usageData.summary.billed_revenue_month) >= 7.5);
    assert.ok(Number(usageData.summary.margin_month) >= 3.75);
    assert.ok(Array.isArray(usageData.landlords));
    console.log('   ✅ Super Admin SMS usage summary passed');

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
        await client.query("DELETE FROM sms_usage_ledger WHERE recipient_phone_e164 IN ($1, $2)", ['+254700111222', '254700111222']);
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
              sms_last_error = $10,
              sms_billing_enabled = $11,
              default_sms_sell_price = $12,
              default_sms_provider_cost = $13,
              sms_currency = $14,
              sms_free_monthly_allowance = $15,
              sms_markup_strategy = $16
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
          originalSettings.sms_last_error,
          originalSettings.sms_billing_enabled,
          originalSettings.default_sms_sell_price,
          originalSettings.default_sms_provider_cost,
          originalSettings.sms_currency,
          originalSettings.sms_free_monthly_allowance,
          originalSettings.sms_markup_strategy
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
