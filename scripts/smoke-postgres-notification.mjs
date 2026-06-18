import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL notification smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5060';
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
  const caretaker = await login('caretaker@demo.com');
  const landlordHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${landlord.auth_token}`
  };
  const caretakerHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${caretaker.auth_token}`
  };

  // 1. Get initial notification settings
  const settingsRes = await fetch(`${BASE_URL}/api/settings/notifications`, { headers: landlordHeaders });
  if (settingsRes.status !== 200) {
    throw new Error(`GET /api/settings/notifications failed: ${settingsRes.status}`);
  }
  const settings = await settingsRes.json();
  console.log('GET Settings Success:', JSON.stringify(settings));

  if (settings.rent_reminders_enabled !== true) {
    throw new Error(`Expected default rent_reminders_enabled to be true, got ${settings.rent_reminders_enabled}`);
  }
  console.log('PASS: Loaded default notification settings.');

  // 2. Update notification settings
  const updateRes = await fetch(`${BASE_URL}/api/settings/notifications`, {
    method: 'PUT',
    headers: landlordHeaders,
    body: JSON.stringify({
      rent_reminders_enabled: false,
      reminder_days_before_due: 5,
      sms_provider: 'Sema'
    })
  });
  if (updateRes.status !== 200) {
    throw new Error(`PUT /api/settings/notifications failed: ${updateRes.status}`);
  }
  const updatedSettings = await updateRes.json();
  if (updatedSettings.rent_reminders_enabled !== false || updatedSettings.reminder_days_before_due !== 5 || updatedSettings.sms_provider !== 'Sema') {
    throw new Error(`Settings did not update correctly: ${JSON.stringify(updatedSettings)}`);
  }
  console.log('PASS: Updated notification settings successfully.');

  // 3. Caretaker restriction check
  const caretakerSettingsRes = await fetch(`${BASE_URL}/api/settings/notifications`, { headers: caretakerHeaders });
  // Caretaker is blocked by the general `/api/settings` RBAC middleware (returns 403)
  if (caretakerSettingsRes.status !== 403) {
    throw new Error(`Expected caretaker to receive 403 for settings, got: ${caretakerSettingsRes.status}`);
  }
  console.log('PASS: Caretaker restricted from settings endpoints.');

  // 4. Directly insert a failed log into PostgreSQL for retry test
  const pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient.connect();
  let testLog;
  try {
    const insertRes = await pgClient.query(
      `
        INSERT INTO notification_logs (
          organization_id, recipient_user_id, phone_number, channel, type, message, status, retry_count, max_retries
        )
        VALUES ($1, $2, '254711222333', 'sms', 'payment_confirmed', 'Test failed notification retry.', 'failed', 0, 3)
        RETURNING *
      `,
      [settings.organization_id, landlord.user_id]
    );
    testLog = insertRes.rows[0];
    console.log(`Created failed test log in DB: ${testLog.id}`);
  } finally {
    await pgClient.end();
  }

  // 5. Trigger manual retry on failed log
  const retryRes = await fetch(`${BASE_URL}/api/settings/notification-logs/${testLog.id}/retry`, {
    method: 'POST',
    headers: landlordHeaders
  });
  if (retryRes.status !== 200) {
    throw new Error(`POST /api/settings/notification-logs/:id/retry failed: ${retryRes.status} ${await retryRes.text()}`);
  }
  const retriedLog = await retryRes.json();
  // Status should change from failed. Since retry is processed immediately, it should be either 'sent' or 'failed' (but attempt count incremented)
  if (retriedLog.retry_count !== 1) {
    throw new Error(`Expected retry count to be incremented to 1, got ${retriedLog.retry_count}`);
  }
  if (!['sent', 'failed'].includes(retriedLog.status)) {
    throw new Error(`Expected status to be sent or failed, got ${retriedLog.status}`);
  }
  console.log('PASS: Manual retry successfully executed and updated status.');

  // 6. Caretaker log isolation check
  const caretakerLogsRes = await fetch(`${BASE_URL}/api/settings/notification-logs`, { headers: caretakerHeaders });
  if (caretakerLogsRes.status !== 403) {
    throw new Error(`Expected caretaker to receive 403 for logs list, got: ${caretakerLogsRes.status}`);
  }
  console.log('PASS: Caretaker restricted from fetching settings notification logs.');

  console.log('PostgreSQL notifications smoke test passed successfully.');
} finally {
  server.kill('SIGTERM');
}
