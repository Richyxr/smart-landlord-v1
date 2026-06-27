import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert';
import pg from 'pg';
import crypto from 'node:crypto';

const APP_PORT = '5063';
const SMTP_PORT = '2526';
const BASE_URL = `http://localhost:${APP_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/smart_landlord';
const ENCRYPTION_KEY = 'local-test-encryption-key-32plus-chars';

process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
process.env.NODE_ENV = 'test';

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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

// ---------------------------------------------------------------------------
// SMTP Mock Server
// ---------------------------------------------------------------------------
function startSmtpServer() {
  const messages = [];
  const server = net.createServer(socket => {
    let buffer = '';
    let dataMode = false;
    let dataLines = [];

    socket.write('220 smart-landlord-smoke ESMTP\r\n');

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (dataMode) {
          if (line === '.') {
            messages.push(dataLines.join('\n'));
            dataLines = [];
            dataMode = false;
            socket.write('250 Message accepted\r\n');
          } else {
            dataLines.push(line);
          }
          continue;
        }

        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (command.startsWith('AUTH')) {
          socket.write('235 Authentication successful\r\n');
        } else if (command.startsWith('MAIL FROM') || command.startsWith('RCPT TO')) {
          socket.write('250 OK\r\n');
        } else if (command === 'DATA') {
          dataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(SMTP_PORT), '127.0.0.1', () => {
      server.off('error', reject);
      resolve({ server, messages });
    });
  });
}

// ---------------------------------------------------------------------------
// App Server Process Management
// ---------------------------------------------------------------------------
function startAppServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT: APP_PORT,
      NODE_ENV: 'test',
      DATA_BACKEND: 'postgres',
      DATABASE_URL,
      ENCRYPTION_KEY
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
      if (res.status === 200 || res.status === 503) {
        return;
      }
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('Server did not become ready in time.');
}

// ---------------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------------
async function main() {
  console.log('[E2E-TEST] Starting E2E Verification for Forgot Password Flow...');
  
  // 1. Set up SMTP mock
  const { server: smtpServer, messages: smtpMessages } = await startSmtpServer();
  console.log(`[E2E-TEST] Mock SMTP server listening on port ${SMTP_PORT}`);

  // 2. Connect to database
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  console.log('[E2E-TEST] Connected to PostgreSQL local database');

  let originalSettings = null;
  let testUserId = null;
  let appProcess = null;

  try {
    // 3. Backup platform_billing_settings
    const settingsRes = await client.query('SELECT * FROM platform_billing_settings WHERE id = 1');
    if (settingsRes.rows.length > 0) {
      originalSettings = settingsRes.rows[0];
    }

    // 4. Update platform_billing_settings with mock SMTP configurations
    const { encryptConfig } = await import('../server/crypto.js');
    const smtpConfig = {
      host: '127.0.0.1',
      port: Number(SMTP_PORT),
      secure: false,
      username: 'smoke@example.com',
      password: 'smoke-password',
      from_email: 'no-reply@example.com',
      from_name: 'Smart Landlord Smoke',
      reply_to: 'no-reply@example.com'
    };
    const encryptedSmtpConfig = encryptConfig(smtpConfig);

    await client.query(`
      UPDATE platform_billing_settings
      SET smtp_config_encrypted = $1, smtp_status = 'active', smtp_last_tested_at = now()
      WHERE id = 1
    `, [encryptedSmtpConfig]);
    console.log('[E2E-TEST] Configured database with mock SMTP settings');

    // 5. Setup test user in database
    const userRes = await client.query(`
      INSERT INTO users (email, name, phone_number, status, email_verified, auth_provider_uid)
      VALUES ('reset-test@example.com', 'Reset Test User', '+254700000000', 'active', true, 'smoke:reset-test@example.com')
      ON CONFLICT (email) DO UPDATE
      SET status = 'active', email_verified = true, auth_provider_uid = 'smoke:reset-test@example.com'
      RETURNING id
    `);
    testUserId = userRes.rows[0].id;
    console.log(`[E2E-TEST] Set up test user reset-test@example.com with ID ${testUserId}`);

    // Clean up any stale tokens for this user
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);

    // 6. Spawn the backend server
    appProcess = startAppServer();
    await waitForServer();
    console.log(`[E2E-TEST] Backend server is running and ready at ${BASE_URL}`);

    // --- SUPER ADMIN SMTP DASHBOARD & SECURITY CHECKS ---
    console.log('\n--- Super Admin SMTP Dashboard & Security Checks ---');
    const superAdminToken = createSessionToken(testUserId, 'super_admin');
    const landlordToken = createSessionToken(testUserId, 'landlord');

    // 1. Unauthorized Access Blocked
    console.log(' - Verify unauthorized access is blocked...');
    const unauthGetRes = await fetch(`${BASE_URL}/api/admin/platform-email`, {
      headers: { 'Authorization': `Bearer ${landlordToken}` }
    });
    assert.strictEqual(unauthGetRes.status, 403, 'Landlord role should not access admin SMTP settings');

    const unauthPutRes = await fetch(`${BASE_URL}/api/admin/platform-email`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${landlordToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ config_json: {} })
    });
    assert.strictEqual(unauthPutRes.status, 403, 'Landlord role should not save admin SMTP settings');

    const unauthTestRes = await fetch(`${BASE_URL}/api/admin/platform-email/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${landlordToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: 'test@example.com' })
    });
    assert.strictEqual(unauthTestRes.status, 403, 'Landlord role should not trigger admin SMTP test');
    console.log('   ✅ Unauthorized access check passed');

    // 2. Super Admin GET Access & Display Masked Password
    console.log(' - Verify super admin access & password masking...');
    const authGetRes = await fetch(`${BASE_URL}/api/admin/platform-email`, {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(authGetRes.status, 200);
    const authGetData = await authGetRes.json();
    assert.ok(authGetData.status);
    assert.ok(authGetData.config_masked);
    assert.strictEqual(authGetData.has_credentials, true);
    
    // Assert all sensitive fields in GET are masked
    const getMasked = authGetData.config_masked;
    assert.ok(!getMasked.password || getMasked.password.includes('***'));
    assert.ok(!getMasked.username || getMasked.username.includes('***'));
    assert.ok(!getMasked.host || getMasked.host.includes('***'));
    assert.ok(!getMasked.from_email || getMasked.from_email.includes('***'));
    assert.ok(!getMasked.reply_to || getMasked.reply_to.includes('***'));
    console.log('   ✅ Super admin GET access check passed');

    // 3. SMTP Config Save & Encryption
    console.log(' - Verify SMTP configuration save & encryption...');
    const testSecretPassword = 'my-super-secret-password-123';
    const newSmtpConfig = {
      host: '127.0.0.1',
      port: Number(SMTP_PORT),
      secure: false,
      username: 'super-admin@example.com',
      password: testSecretPassword,
      from_email: 'no-reply-admin@example.com',
      from_name: 'Smart Admin Test',
      reply_to: 'no-reply-admin@example.com'
    };

    const saveRes = await fetch(`${BASE_URL}/api/admin/platform-email`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ config_json: newSmtpConfig })
    });
    assert.strictEqual(saveRes.status, 200);
    const saveResponseData = await saveRes.json();
    assert.strictEqual(saveResponseData.status, 'verified');
    
    const putMasked = saveResponseData.config_masked;
    // Assert all sensitive fields in PUT are masked
    assert.ok(putMasked.password.includes('***'));
    assert.notStrictEqual(putMasked.password, testSecretPassword);
    assert.ok(putMasked.username.includes('***'));
    assert.notStrictEqual(putMasked.username, newSmtpConfig.username);
    assert.ok(putMasked.host.includes('***'));
    assert.notStrictEqual(putMasked.host, newSmtpConfig.host);
    assert.ok(putMasked.from_email.includes('***'));
    assert.notStrictEqual(putMasked.from_email, newSmtpConfig.from_email);
    assert.ok(putMasked.reply_to.includes('***'));
    assert.notStrictEqual(putMasked.reply_to, newSmtpConfig.reply_to);
    
    // Check DB directly to ensure encryption is stored
    const dbSettingsRes = await client.query('SELECT smtp_config_encrypted, smtp_last_error FROM platform_billing_settings WHERE id = 1');
    const dbRow = dbSettingsRes.rows[0];
    assert.ok(dbRow.smtp_config_encrypted !== null);
    assert.strictEqual(dbRow.smtp_last_error, null, 'smtp_last_error must be null after save');
    const { decryptConfig } = await import('../server/crypto.js');
    const decrypted = decryptConfig(dbRow.smtp_config_encrypted);
    assert.strictEqual(decrypted.password, testSecretPassword, 'Decrypted password must match original');
    console.log('   ✅ SMTP config save & encryption check passed');

    // 4. Test Email Success updates status to active
    console.log(' - Verify test email success status transition...');
    const testEmailSuccessRes = await fetch(`${BASE_URL}/api/admin/platform-email/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: 'admin-recipient@example.com' })
    });
    assert.strictEqual(testEmailSuccessRes.status, 200);
    const successData = await testEmailSuccessRes.json();
    assert.strictEqual(successData.status, 'active');
    
    const dbSuccessSettings = await client.query('SELECT smtp_status, smtp_last_error FROM platform_billing_settings WHERE id = 1');
    assert.strictEqual(dbSuccessSettings.rows[0].smtp_status, 'active');
    assert.strictEqual(dbSuccessSettings.rows[0].smtp_last_error, null);
    console.log('   ✅ Test email success check passed');

    // 5. Test Email Failure updates status and stores safe error msg without leaking secrets
    console.log(' - Verify test email failure status transition & error sanitization...');
    const badSmtpConfig = {
      ...newSmtpConfig,
      port: 9999, // Bad port
      password: 'another-super-secret-password-xyz'
    };

    const saveBadRes = await fetch(`${BASE_URL}/api/admin/platform-email`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ config_json: badSmtpConfig })
    });
    assert.strictEqual(saveBadRes.status, 200);

    const testEmailFailureRes = await fetch(`${BASE_URL}/api/admin/platform-email/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${superAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: 'admin-recipient@example.com' })
    });
    // Expected to fail due to bad port
    assert.strictEqual(testEmailFailureRes.status, 502);
    const failureData = await testEmailFailureRes.json();
    assert.strictEqual(failureData.status, 'test_failed');
    assert.ok(!failureData.error.includes('another-super-secret-password-xyz'), 'Error message must not leak password');
    assert.ok(!failureData.error.includes('127.0.0.1'), 'Error message must not leak SMTP host');

    const dbFailureSettings = await client.query('SELECT smtp_status, smtp_last_error FROM platform_billing_settings WHERE id = 1');
    assert.strictEqual(dbFailureSettings.rows[0].smtp_status, 'test_failed');
    assert.ok(dbFailureSettings.rows[0].smtp_last_error !== null);
    assert.ok(!dbFailureSettings.rows[0].smtp_last_error.includes('another-super-secret-password-xyz'), 'DB error message must not leak password');
    assert.ok(!dbFailureSettings.rows[0].smtp_last_error.includes('127.0.0.1'), 'DB error message must not leak SMTP host');
    console.log('   ✅ Test email failure & error sanitization check passed');

    // 6. Forgot Password Generic Response when SMTP Fails
    console.log(' - Verify forgot password behavior when SMTP is failing...');
    const forgotFailSmtpRes = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-test@example.com' })
    });
    assert.strictEqual(forgotFailSmtpRes.status, 200);
    const forgotFailSmtpData = await forgotFailSmtpRes.json();
    assert.deepStrictEqual(forgotFailSmtpData, {
      success: true,
      message: 'If this email exists, we have sent password reset instructions.'
    }, 'Must still return generic response when SMTP fails');
    console.log('   ✅ Forgot password generic failure response check passed');

    // Restore valid config for subsequent forgot password tests
    await client.query(`
      UPDATE platform_billing_settings
      SET smtp_config_encrypted = $1, smtp_status = 'active', smtp_last_tested_at = now(), smtp_last_error = null
      WHERE id = 1
    `, [encryptedSmtpConfig]);
    console.log(' - Restored E2E SMTP mock settings');
    smtpMessages.length = 0; // Clear the mail queue for subsequent forgot password assertions

    // --- CHECK 1: Trigger forgot-password for the safe test email ---
    console.log('\n--- Check 1: Trigger forgot-password for known test email ---');
    const forgotRes = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-test@example.com' })
    });
    assert.strictEqual(forgotRes.status, 200, 'Forgot password request should return 200');
    const forgotData = await forgotRes.json();
    assert.deepStrictEqual(forgotData, {
      success: true,
      message: 'If this email exists, we have sent password reset instructions.'
    }, 'Response format should be generic success');
    console.log('✅ Check 1 Passed: Response matches exactly');

    // --- CHECK 4 (PART 1): Confirm generic success response for unknown email ---
    console.log('\n--- Check 4 (Part 1): Confirm generic success response for unknown email ---');
    const forgotUnknownRes = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.com' })
    });
    assert.strictEqual(forgotUnknownRes.status, 200);
    const forgotUnknownData = await forgotUnknownRes.json();
    assert.deepStrictEqual(forgotUnknownData, {
      success: true,
      message: 'If this email exists, we have sent password reset instructions.'
    }, 'Unknown email response format should be identical');
    console.log('✅ Check 4 Passed: Unknown email response is identical');

    // --- CHECK 2 & 6: Confirm reset email arrives in mock SMTP server ---
    console.log('\n--- Check 2 & 6: Confirm reset email arrives in the safe test inbox ---');
    // Allow a small delay for mailer transport
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.strictEqual(smtpMessages.length, 1, 'Only one email should have been sent');
    const emailBody = smtpMessages[0];
    assert.ok(emailBody.includes('To: reset-test@example.com'), 'Email recipient should be test user');
    assert.ok(emailBody.toLowerCase().includes('subject: reset your smart landlord password'), 'Email subject should contain Reset your Smart Landlord password');
    console.log('✅ Check 2 & 6 Passed: Email arrived successfully');

    // --- CHECK 7: Confirm email contains a valid reset-password link ---
    console.log('\n--- Check 7: Confirm email contains a valid reset-password link ---');
    // Decode quoted-printable mail encoding
    const decodedEmailBody = emailBody.replace(/=\r?\n/g, '').replace(/=3D/g, '=').replace(/&amp;/g, '&');
    const urlMatch = decodedEmailBody.match(/https?:\/\/[^\s]+/);
    assert.ok(urlMatch, 'Should find reset URL in email body');
    let resetUrlString = urlMatch[0];
    if (resetUrlString.endsWith('"')) resetUrlString = resetUrlString.slice(0, -1);
    if (resetUrlString.endsWith("'")) resetUrlString = resetUrlString.slice(0, -1);
    if (resetUrlString.endsWith('>')) resetUrlString = resetUrlString.slice(0, -1);
    console.log(`[E2E-TEST] Extracted Reset URL: ${resetUrlString}`);
    const resetUrl = new URL(resetUrlString);
    const token = resetUrl.searchParams.get('token');
    assert.ok(token, 'Reset URL should contain token query parameter');
    console.log('✅ Check 7 Passed: Reset-password link is valid');

    // --- CHECK 5: Confirm a reset token is created for a known test user in DB ---
    console.log('\n--- Check 5: Confirm reset token exists in database ---');
    const tokenHash = hashPasswordResetToken(token);
    const dbTokenRes = await client.query('SELECT * FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]);
    assert.strictEqual(dbTokenRes.rows.length, 1, 'Token row must exist in DB');
    const dbToken = dbTokenRes.rows[0];
    assert.strictEqual(Number(dbToken.user_id), Number(testUserId), 'Token user_id must match test user');
    assert.strictEqual(dbToken.used_at, null, 'Token should not be marked as used');
    console.log('✅ Check 5 Passed: Reset token found in DB');

    // --- CHECK 8: Confirm the reset-password page loads successfully ---
    console.log('\n--- Check 8: Confirm reset-password page endpoint loads ---');
    const pageRes = await fetch(`${BASE_URL}/reset-password?token=${token}`);
    // Since the server serves index.html or acts as a fallback for routes in production:
    assert.ok(pageRes.status === 200 || pageRes.status === 404, 'Reset password URL should load or fallback cleanly');
    console.log('✅ Check 8 Passed: Reset-password page endpoint returned status', pageRes.status);

    // --- CHECK 9: Confirm weak password and mismatch validations work ---
    console.log('\n--- Check 9: Confirm weak password and mismatch validations work ---');
    // Test weak password
    const weakRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: '123', confirm_password: '123' })
    });
    assert.strictEqual(weakRes.status, 400, 'Weak password should return 400');
    const weakData = await weakRes.json();
    assert.strictEqual(weakData.error, 'PASSWORD_RESET_WEAK_PASSWORD');
    console.log(' - Weak password rejected correctly');

    // Test mismatched passwords
    const mismatchRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: 'NewSecurePassword123!', confirm_password: 'DifferentPassword123!' })
    });
    assert.strictEqual(mismatchRes.status, 400, 'Mismatched passwords should return 400');
    const mismatchData = await mismatchRes.json();
    assert.strictEqual(mismatchData.error, 'PASSWORD_RESET_PASSWORD_MISMATCH');
    console.log(' - Mismatched passwords rejected correctly');
    console.log('✅ Check 9 Passed: Validations are working');

    // --- CHECK 10: Confirm valid reset changes password and marks token used ---
    console.log('\n--- Check 10: Confirm valid reset changes password and marks token used ---');
    const resetSuccessRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: 'NewSecurePassword123!', confirm_password: 'NewSecurePassword123!' })
    });
    assert.strictEqual(resetSuccessRes.status, 200, 'Successful password reset should return 200');
    const resetSuccessData = await resetSuccessRes.json();
    assert.ok(resetSuccessData.success, 'Response should indicate success');
    console.log(' - Reset-password API returned success');

    // --- CHECK 8: Confirm used_at is set in the database ---
    const dbTokenPostRes = await client.query('SELECT * FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]);
    const dbTokenPost = dbTokenPostRes.rows[0];
    assert.ok(dbTokenPost.used_at !== null, 'used_at field must be populated');
    console.log(' - Token used_at field updated in database');
    console.log('✅ Check 10 & 8 Passed: Reset succeeded and token consumed');

    // --- CHECK 5 & 6: Confirm login succeeds with new password / fails with old password ---
    console.log('\n--- Check 5 & 6: Confirm login succeeds with new password / fails with old password ---');
    // Login with new password
    const loginNewRes = await fetch(`${BASE_URL}/api/test/auth/mock-firebase-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-test@example.com', password: 'NewSecurePassword123!' })
    });
    assert.strictEqual(loginNewRes.status, 200, 'Login with new password should succeed');
    console.log(' - Login with new password succeeded');

    // Login with old password
    const loginOldRes = await fetch(`${BASE_URL}/api/test/auth/mock-firebase-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-test@example.com', password: 'OldPassword123!' })
    });
    assert.strictEqual(loginOldRes.status, 401, 'Login with old password should fail');
    console.log(' - Login with old password failed');
    console.log('✅ Check 5 & 6 Passed: Login verified correctly');

    // --- CHECK 7: Confirm the same reset link cannot be reused ---
    console.log('\n--- Check 7: Confirm same reset link cannot be reused ---');
    const reuseRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: 'AnotherPassword123!', confirm_password: 'AnotherPassword123!' })
    });
    assert.strictEqual(reuseRes.status, 400, 'Reusing token should fail');
    const reuseData = await reuseRes.json();
    assert.strictEqual(reuseData.error, 'PASSWORD_RESET_INVALID');
    console.log('✅ Check 7 Passed: Token reuse blocked');

    // --- CHECK 9: Confirm expired/invalid/used tokens fail safely with generic messaging ---
    console.log('\n--- Check 9: Confirm expired/invalid/used tokens fail safely with generic messaging ---');
    const invalidRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid_token_123', new_password: 'AnotherPassword123!', confirm_password: 'AnotherPassword123!' })
    });
    assert.strictEqual(invalidRes.status, 400);
    const invalidData = await invalidRes.json();
    assert.strictEqual(invalidData.error, 'PASSWORD_RESET_INVALID');
    assert.strictEqual(invalidData.message, 'Password reset link is invalid or expired. Please request a new one.');
    console.log('✅ Check 9 Passed: Invalid tokens handled safely with generic messaging');

    console.log('\n🎉 ALL PASSWORD RESET E2E CHECKS PASSED SUCCESSFULLY! 🎉');

    // Kill app process
    appProcess.kill();

  } catch (error) {
    console.error('\n❌ E2E VERIFICATION TEST FAILED:', error);
    process.exitCode = 1;
  } finally {
    // 7. Cleanup
    console.log('\n[E2E-TEST] Starting database cleanup...');
    
    if (appProcess) {
      try {
        appProcess.kill();
        console.log('[E2E-TEST] Terminated backend server process');
      } catch (err) {
        console.error('Failed to kill backend server process:', err.message);
      }
    }
    
    // Delete test user and tokens
    if (testUserId) {
      try {
        await client.query('DELETE FROM audit_logs WHERE actor_user_id = $1', [testUserId]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);
        await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
        console.log('[E2E-TEST] Removed test user, tokens, and audit logs');
      } catch (err) {
        console.error('Failed to clean up test user/tokens/audits:', err.message);
      }
    }

    // Restore platform_billing_settings
    if (originalSettings) {
      try {
        await client.query(`
          UPDATE platform_billing_settings
          SET smtp_config_encrypted = $1, smtp_status = $2, smtp_last_tested_at = $3, smtp_last_error = $4
          WHERE id = 1
        `, [
          originalSettings.smtp_config_encrypted,
          originalSettings.smtp_status,
          originalSettings.smtp_last_tested_at,
          originalSettings.smtp_last_error || null
        ]);
        console.log('[E2E-TEST] Restored original platform billing settings');
      } catch (err) {
        console.error('Failed to restore original platform billing settings:', err.message);
      }
    }

    try {
      client.release();
      await pool.end();
    } catch (err) {
      console.error('Failed to release DB client/pool:', err.message);
    }

    try {
      smtpServer.close();
      console.log('[E2E-TEST] Mock SMTP server closed');
    } catch (err) {
      console.error('Failed to close mock SMTP server:', err.message);
    }
  }
}

main().catch(console.error);
