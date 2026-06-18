import { spawn } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL reconciliation smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5057';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'postgres'
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
  console.log(`PASS ${label}: ${response.status}`);
}

const server = startServer();

try {
  await waitForServer();

  const landlord = await login('landlord@demo.com');
  const caretaker = await login('caretaker@demo.com');
  const landlordHeaders = { Authorization: `Bearer ${landlord.auth_token}` };
  const caretakerHeaders = { Authorization: `Bearer ${caretaker.auth_token}` };

  assertStatus(
    'postgres landlord can read reconciliation staging',
    await fetch(`${BASE_URL}/api/reconciliation/staging`, { headers: landlordHeaders }),
    200
  );

  assertStatus(
    'postgres caretaker cannot read reconciliation staging',
    await fetch(`${BASE_URL}/api/reconciliation/staging`, { headers: caretakerHeaders }),
    403
  );

  const form = new FormData();
  form.append(
    'file',
    new Blob(['Date,Amount,Reference,Account number,Description,Payer name\n2026-06-15,1,SMOKE-REF-1,ACC-0010-A1,Smoke test,David Kiprop'], { type: 'text/csv' }),
    'smoke.csv'
  );

  const upload = await fetch(`${BASE_URL}/api/reconciliation/upload`, {
    method: 'POST',
    headers: landlordHeaders,
    body: form
  });
  assertStatus('postgres landlord can upload reconciliation CSV', upload, 200);

  console.log('PostgreSQL reconciliation smoke test passed.');
} finally {
  server.kill('SIGTERM');
}
