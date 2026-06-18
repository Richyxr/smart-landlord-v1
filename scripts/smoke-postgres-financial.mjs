import { spawn } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL financial smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5056';
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

async function request(path, token) {
  return fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
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

  assertStatus('postgres landlord can read invoices', await request('/api/invoices', landlord.auth_token), 200);
  assertStatus('postgres landlord can read payments', await request('/api/payments', landlord.auth_token), 200);
  assertStatus('postgres caretaker cannot read invoices', await request('/api/invoices', caretaker.auth_token), 403);
  assertStatus('postgres caretaker cannot read payments', await request('/api/payments', caretaker.auth_token), 403);

  console.log('PostgreSQL financial smoke test passed.');
} finally {
  server.kill('SIGTERM');
}
