import { spawn } from 'node:child_process';
import assert from 'node:assert';
import { db } from '../server/db.js';

const PORT = process.env.SMOKE_PORT || '5056';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'json'
    },
    stdio: ['ignore', 'pipe', 'pipe']
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
        headers: JSON_HEADERS,
        body: JSON.stringify({ email: 'landlord@demo.com' })
      });
      if (res.ok) return;
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('Server did not become ready in time.');
}

async function landlordLogin() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'landlord@demo.com' })
  });
  if (!res.ok) throw new Error(`Landlord login failed: ${res.status}`);
  return res.json();
}

async function caretakerLogin(phoneNumber, pin) {
  return fetch(`${BASE_URL}/api/auth/caretaker/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone_number: phoneNumber, pin })
  });
}

async function postCaretaker(headers, body) {
  return fetch(`${BASE_URL}/api/properties/caretakers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function resetCaretakerPin(headers, caretakerId, pin) {
  return fetch(`${BASE_URL}/api/properties/caretakers/${caretakerId}/reset-pin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pin })
  });
}

function assertNoPinLeak(label, payload, pins) {
  const body = typeof payload === 'string' ? JSON.parse(payload || '{}') : payload;
  const sensitiveKeys = new Set(['pin', 'temporary_pin', 'caretaker_pin_hash']);

  function visit(value, path = '') {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        for (const pin of pins) {
          assert.notStrictEqual(value, pin, `${label}: response exposed raw PIN at ${path}`);
        }
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      assert.ok(!sensitiveKeys.has(key), `${label}: response exposed sensitive key ${key}`);
      visit(child, path ? `${path}.${key}` : key);
    }
  }

  visit(body);
}

async function assertStatus(label, response, expectedStatus) {
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  assertNoPinLeak(label, text, ['123456', '654321', '111111', '222222', '000000']);
  console.log(`PASS ${label}: ${response.status}`);
  return text ? JSON.parse(text) : {};
}

async function runTests() {
  const server = startServer();
  try {
    await waitForServer();

    const uniqueSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const phoneBase = uniqueSuffix.slice(-8);
    const phoneNumber = `+2547${phoneBase}`;
    const invalidPhoneOne = `+2546${phoneBase}`;
    const invalidPhoneTwo = `+2545${phoneBase}`;
    const testEmail = `caretaker_${uniqueSuffix}@demo.com`;
    const initialPin = '123456';
    const newPin = '654321';

    const landlord = await landlordLogin();
    const headers = {
      ...JSON_HEADERS,
      Authorization: `Bearer ${landlord.auth_token}`
    };

    await assertStatus(
      '4-digit caretaker PIN rejected on create',
      await postCaretaker(headers, {
        name: 'Invalid Short PIN',
        email: `short_${testEmail}`,
        phone_number: invalidPhoneOne,
        pin: '1234',
        assigned_properties: []
      }),
      400
    );

    await assertStatus(
      'non-numeric caretaker PIN rejected on create',
      await postCaretaker(headers, {
        name: 'Invalid Alpha PIN',
        email: `alpha_${testEmail}`,
        phone_number: invalidPhoneTwo,
        pin: '12A456',
        assigned_properties: []
      }),
      400
    );

    const createData = await assertStatus(
      '6-digit caretaker PIN accepted on create',
      await postCaretaker(headers, {
        name: 'PIN Lockout Test Caretaker',
        email: testEmail,
        phone_number: phoneNumber,
        pin: initialPin,
        assigned_properties: []
      }),
      201
    );

    const caretakerId = createData.user.id;

    let loginRes = await caretakerLogin(phoneNumber, initialPin);
    const loginData = await assertStatus('caretaker login succeeds with 6-digit PIN', loginRes, 200);
    assert.ok(loginData.auth_token, 'caretaker login did not return auth token');

    await assertStatus('first wrong PIN attempt rejected', await caretakerLogin(phoneNumber, '000000'), 401);
    await assertStatus('second wrong PIN attempt rejected', await caretakerLogin(phoneNumber, '000000'), 401);
    await assertStatus('third wrong PIN attempt rejected and locks account', await caretakerLogin(phoneNumber, '000000'), 401);

    await assertStatus(
      'correct PIN during lockout rejected',
      await caretakerLogin(phoneNumber, initialPin),
      423
    );

    db.update('users', caretakerId, {
      caretaker_locked_until: new Date(Date.now() - 1000).toISOString()
    });

    loginRes = await caretakerLogin(phoneNumber, initialPin);
    const unlockedLoginData = await assertStatus('correct PIN after lockout expiry succeeds', loginRes, 200);
    assert.ok(unlockedLoginData.auth_token, 'unlock login did not return auth token');

    const userAfterSuccess = db.findOne('users', { id: caretakerId });
    assert.strictEqual(Number(userAfterSuccess.caretaker_failed_login_attempts || 0), 0);
    assert.strictEqual(userAfterSuccess.caretaker_locked_until || null, null);
    assert.strictEqual(userAfterSuccess.caretaker_last_failed_login_at || null, null);
    console.log('PASS successful login resets failed attempts and lockout fields');

    await assertStatus(
      '4-digit caretaker PIN rejected on reset',
      await resetCaretakerPin(headers, caretakerId, '2222'),
      400
    );

    await assertStatus(
      '6-digit caretaker PIN accepted on reset',
      await resetCaretakerPin(headers, caretakerId, newPin),
      200
    );

    await assertStatus('old PIN rejected after reset', await caretakerLogin(phoneNumber, initialPin), 401);
    loginRes = await caretakerLogin(phoneNumber, newPin);
    const finalLoginData = await assertStatus('new PIN accepted after reset', loginRes, 200);

    await assertStatus(
      'caretaker RBAC still blocks landlord-only invoice route',
      await fetch(`${BASE_URL}/api/invoices`, {
        headers: { Authorization: `Bearer ${finalLoginData.auth_token}` }
      }),
      403
    );

    console.log('Caretaker PIN and lockout smoke test passed.');
  } finally {
    server.kill('SIGTERM');
  }
}

runTests().catch(err => {
  console.error('TEST FAIL:', err);
  process.exit(1);
});
