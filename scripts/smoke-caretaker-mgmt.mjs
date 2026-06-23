import { spawn } from 'node:child_process';
import assert from 'node:assert';

const PORT = process.env.SMOKE_PORT || '5056';
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'json' // Test JSON backend first
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => {
    // Suppress verbose logging, but keep for debugging if needed
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
  if (!res.ok) throw new Error(`Login failed for ${email}`);
  return res.json();
}

async function runTests() {
  const server = startServer();
  try {
    await waitForServer();

    // Generate unique phone numbers and emails per run
    const uniqueSuffix = Date.now().toString().slice(-6); // last 6 digits of timestamp
    const random8 = () => Math.floor(10000000 + Math.random() * 90000000).toString();
    
    const testPhone = `+2547${random8()}`;
    const testPhoneUpdated = `+2547${random8()}`;
    const testEmail = `testct_${uniqueSuffix}@demo.com`;
    const testEmailUpdated = `testct_updated_${uniqueSuffix}@demo.com`;

    // 1. Log in as landlord
    console.log('Logging in as landlord...');
    const landlord = await login('landlord@demo.com');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${landlord.auth_token}`
    };

    // 2. Fetch current caretakers list
    console.log('Fetching current caretakers list...');
    const listRes = await fetch(`${BASE_URL}/api/properties/caretakers`, { headers });
    assert.strictEqual(listRes.status, 200);
    const caretakersBefore = await listRes.json();
    console.log(`Fetched ${caretakersBefore.length} caretakers successfully.`);

    // 3. Create a new caretaker
    console.log(`Creating new caretaker with phone: ${testPhone}, email: ${testEmail}...`);
    const createRes = await fetch(`${BASE_URL}/api/properties/caretakers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Test Caretaker',
        email: testEmail,
        phone_number: testPhone,
        assigned_properties: []
      })
    });
    
    if (createRes.status !== 201) {
      const body = await createRes.text();
      console.error('Create caretaker failed:', createRes.status, body);
    }
    assert.strictEqual(createRes.status, 201);
    
    const createdData = await createRes.json();
    assert.ok(createdData.temporary_pin);
    const caretakerId = createdData.user.id;
    const initialPin = createdData.temporary_pin;
    console.log(`Created caretaker with ID: ${caretakerId}, temporary PIN: ${initialPin}`);

    // 4. Verify caretaker can login with initial PIN
    console.log('Verifying caretaker login with initial PIN...');
    const loginRes1 = await fetch(`${BASE_URL}/api/auth/caretaker/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: testPhone, pin: initialPin })
    });
    if (loginRes1.status !== 200) {
      const body = await loginRes1.text();
      console.error('Login with initial PIN failed:', loginRes1.status, body);
    }
    assert.strictEqual(loginRes1.status, 200);
    console.log('Login with initial PIN succeeded.');

    // 5. Update caretaker details (Edit Name, Phone, and disable them)
    console.log(`Updating caretaker details (Edit & Deactivate) to phone: ${testPhoneUpdated}...`);
    const updateRes1 = await fetch(`${BASE_URL}/api/properties/caretakers/${caretakerId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name: 'Updated Caretaker Name',
        phone_number: testPhoneUpdated,
        email: testEmailUpdated,
        status: 'disabled',
        assigned_properties: []
      })
    });
    if (updateRes1.status !== 200) {
      const body = await updateRes1.text();
      console.error('Update caretaker (deactivate) failed:', updateRes1.status, body);
    }
    assert.strictEqual(updateRes1.status, 200);
    console.log('Caretaker updated to inactive status.');

    // 6. Verify disabled caretaker login is rejected
    console.log('Verifying deactivated caretaker login is rejected...');
    const loginRes2 = await fetch(`${BASE_URL}/api/auth/caretaker/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: testPhoneUpdated, pin: initialPin })
    });
    assert.strictEqual(loginRes2.status, 403);
    console.log('Deactivated login rejected correctly with 403.');

    // 7. Reactivate caretaker
    console.log('Reactivating caretaker...');
    const updateRes2 = await fetch(`${BASE_URL}/api/properties/caretakers/${caretakerId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name: 'Updated Caretaker Name',
        phone_number: testPhoneUpdated,
        email: testEmailUpdated,
        status: 'active',
        assigned_properties: []
      })
    });
    if (updateRes2.status !== 200) {
      const body = await updateRes2.text();
      console.error('Update caretaker (reactivate) failed:', updateRes2.status, body);
    }
    assert.strictEqual(updateRes2.status, 200);
    console.log('Caretaker reactivated.');

    // 8. Reset caretaker PIN
    console.log('Resetting caretaker PIN...');
    const resetRes = await fetch(`${BASE_URL}/api/properties/caretakers/${caretakerId}/reset-pin`, {
      method: 'POST',
      headers
    });
    if (resetRes.status !== 200) {
      const body = await resetRes.text();
      console.error('Reset caretaker PIN failed:', resetRes.status, body);
    }
    assert.strictEqual(resetRes.status, 200);
    const resetData = await resetRes.json();
    const newPin = resetData.temporary_pin;
    assert.ok(newPin);
    assert.notStrictEqual(newPin, initialPin);
    console.log(`PIN reset succeeded. New PIN: ${newPin}`);

    // 9. Verify login with old PIN fails
    console.log('Verifying login with old PIN is rejected...');
    const loginRes3 = await fetch(`${BASE_URL}/api/auth/caretaker/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: testPhoneUpdated, pin: initialPin })
    });
    assert.strictEqual(loginRes3.status, 401);
    console.log('Old PIN login rejected correctly.');

    // 10. Verify login with new PIN succeeds
    console.log('Verifying login with new PIN...');
    const loginRes4 = await fetch(`${BASE_URL}/api/auth/caretaker/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: testPhoneUpdated, pin: newPin })
    });
    if (loginRes4.status !== 200) {
      const body = await loginRes4.text();
      console.error('Login with new PIN failed:', loginRes4.status, body);
    }
    assert.strictEqual(loginRes4.status, 200);
    console.log('New PIN login succeeded.');

    console.log('ALL CARETAKER MGMT SMOKE TESTS PASSED.');
  } finally {
    server.kill('SIGTERM');
  }
}

runTests().catch(err => {
  console.error('TEST FAIL:', err);
  process.exit(1);
});


