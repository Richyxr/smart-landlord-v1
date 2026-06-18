import { spawn } from 'node:child_process';

const PORT = process.env.SMOKE_PORT || '5055';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true'
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
  const admin = await login('admin@smartlandlord.com');

  assertStatus('landlord can read invoices', await request('/api/invoices', landlord.auth_token), 200);
  assertStatus('caretaker cannot read invoices', await request('/api/invoices', caretaker.auth_token), 403);
  assertStatus('caretaker can read assigned properties', await request('/api/properties', caretaker.auth_token), 200);
  assertStatus('admin can read platform stats', await request('/api/admin/stats', admin.auth_token), 200);
  assertStatus('landlord cannot read admin stats', await request('/api/admin/stats', landlord.auth_token), 403);

  console.log('Auth/RBAC smoke test passed.');
} finally {
  server.kill('SIGTERM');
}
