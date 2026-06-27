import { spawn } from 'node:child_process';
import assert from 'node:assert';

const APP_PORT = process.env.SMOKE_PORT || '5064';
const BASE_URL = `http://localhost:${APP_PORT}`;
const SMOKE_HEADER = 'x-smart-landlord-registration-smoke';

const uniqueId = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const testEmail1 = `invalidphone1_${uniqueId}@demo.com`;
const testEmail2 = `invalidphone2_${uniqueId}@demo.com`;
const testEmail3 = `invalidphone3_${uniqueId}@demo.com`;
const indivEmail = `johndoe_${uniqueId}@demo.com`;
const companyEmail = `acuity_${uniqueId}@demo.com`;
const repEmail = `sarah_${uniqueId}@acuity.co.ke`;
const oauthEmail = `oauthuser_${uniqueId}@demo.com`;

const indivPhone = `0722${String(Math.floor(100000 + Math.random() * 900000))}`;
const companyPhone = `0711${String(Math.floor(100000 + Math.random() * 900000))}`;
const repPhone = `0733${String(Math.floor(100000 + Math.random() * 900000))}`;
const oauthPhone = `0711${String(Math.floor(100000 + Math.random() * 900000))}`;

function startAppServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT: APP_PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'json',
      APP_PUBLIC_URL: BASE_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  let lastStatus = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'landlord@demo.com' })
      });
      lastStatus = res.status;
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not become ready in time. Last status: ${lastStatus || 'none'}; last error: ${lastError?.message || 'none'}`);
}

async function runTests() {
  console.log('Starting app server...');
  const appProcess = startAppServer();

  try {
    await waitForServer();
    console.log('App server is ready. Running KYC validation tests...');

    // 1. Phone number validation checks (Kenya prefix normalization and length checks)
    console.log('Testing invalid phone number registration (too short)...');
    const resShort = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SMOKE_HEADER]: 'true' },
      body: JSON.stringify({
        type: 'individual',
        first_name: 'Maina',
        last_name: 'Kamau',
        email: testEmail1,
        phone_number: '0712345', // Too short
        country: 'Kenya',
        billing_currency: 'KES',
        profile_confirmed: true
      })
    });
    assert.strictEqual(resShort.status, 400);
    const bodyShort = await resShort.json();
    assert.ok(bodyShort.error.includes('Invalid Kenyan phone number format'));

    console.log('Testing invalid phone number registration (too long)...');
    const resLong = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SMOKE_HEADER]: 'true' },
      body: JSON.stringify({
        type: 'individual',
        first_name: 'Maina',
        last_name: 'Kamau',
        email: testEmail2,
        phone_number: '07123456789', // Too long
        country: 'Kenya',
        billing_currency: 'KES',
        profile_confirmed: true
      })
    });
    assert.strictEqual(resLong.status, 400);
    const bodyLong = await resLong.json();
    assert.ok(bodyLong.error.includes('Invalid Kenyan phone number format'));

    console.log('Testing invalid country format (non-Kenyan but selecting Kenya prefix)...');
    const resBadPrefix = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SMOKE_HEADER]: 'true' },
      body: JSON.stringify({
        type: 'individual',
        first_name: 'Maina',
        last_name: 'Kamau',
        email: testEmail3,
        phone_number: '+1712345678', // Bad prefix for country 'Kenya'
        country: 'Kenya',
        billing_currency: 'KES',
        profile_confirmed: true
      })
    });
    assert.strictEqual(resBadPrefix.status, 400);
    const bodyBadPrefix = await resBadPrefix.json();
    assert.ok(bodyBadPrefix.error.includes('Invalid Kenyan phone number format'));

    // 2. Individual Landlord successful registration with phone prefix normalization
    console.log('Testing successful individual landlord registration...');
    const resIndiv = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SMOKE_HEADER]: 'true' },
      body: JSON.stringify({
        type: 'individual',
        first_name: 'John',
        last_name: 'Doe',
        email: indivEmail,
        phone_number: indivPhone, // Will normalize to +2547...
        country: 'Kenya',
        billing_currency: 'KES',
        profile_confirmed: true
      })
    });
    
    if (resIndiv.status !== 201) {
      const errText = await resIndiv.text();
      throw new Error(`johndoe registration failed: ${resIndiv.status} - ${errText}`);
    }
    const dataIndiv = await resIndiv.json();
    assert.strictEqual(dataIndiv.user.first_name, 'John');
    assert.strictEqual(dataIndiv.user.last_name, 'Doe');
    assert.ok(dataIndiv.user.phone_number.startsWith('+254'));
    assert.strictEqual(dataIndiv.organization.type, 'individual');
    assert.strictEqual(dataIndiv.organization.profile_completed, true);
    assert.strictEqual(dataIndiv.organization.kyc_status, 'completed');

    // 3. Company Landlord registration and validation
    console.log('Testing company landlord registration missing representative authorization...');
    const resCompFail = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SMOKE_HEADER]: 'true' },
      body: JSON.stringify({
        type: 'company',
        company_name: 'Acuity Holdings Ltd',
        registration_number: 'CPR/2026/889',
        tax_identifier: 'P051122334Z',
        email: companyEmail,
        phone_number: companyPhone,
        country: 'Kenya',
        billing_currency: 'KES',
        representative_first_name: 'Sarah',
        representative_last_name: 'Wambui',
        representative_role: 'CEO',
        representative_phone_e164: repPhone,
        representative_email: repEmail,
        representative_authorized: false, // Must be true
        profile_confirmed: true
      })
    });
    assert.strictEqual(resCompFail.status, 400);

    console.log('Testing successful company landlord registration...');
    const resCompSuccess = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SMOKE_HEADER]: 'true' },
      body: JSON.stringify({
        type: 'company',
        company_name: 'Acuity Holdings Ltd',
        registration_number: 'CPR/2026/889',
        tax_identifier: 'P051122334Z',
        email: companyEmail,
        phone_number: companyPhone,
        country: 'Kenya',
        billing_currency: 'KES',
        representative_first_name: 'Sarah',
        representative_last_name: 'Wambui',
        representative_role: 'CEO',
        representative_phone_e164: repPhone,
        representative_email: repEmail,
        representative_authorized: true,
        profile_confirmed: true
      })
    });
    
    if (resCompSuccess.status !== 201) {
      const errText = await resCompSuccess.text();
      throw new Error(`company registration failed: ${resCompSuccess.status} - ${errText}`);
    }
    const dataComp = await resCompSuccess.json();
    assert.strictEqual(dataComp.user.first_name, 'Sarah');
    assert.strictEqual(dataComp.user.last_name, 'Wambui');
    assert.ok(dataComp.user.phone_number.startsWith('+254'));
    assert.strictEqual(dataComp.organization.name, 'Acuity Holdings Ltd');
    assert.strictEqual(dataComp.organization.type, 'company');
    assert.strictEqual(dataComp.organization.registration_number, 'CPR/2026/889');
    assert.strictEqual(dataComp.organization.tax_identifier, 'P051122334Z');
    assert.strictEqual(dataComp.organization.representative_first_name, 'Sarah');
    assert.strictEqual(dataComp.organization.representative_last_name, 'Wambui');
    assert.strictEqual(dataComp.organization.representative_role, 'CEO');
    assert.ok(dataComp.organization.representative_phone_e164.startsWith('+254'));
    assert.strictEqual(dataComp.organization.representative_email, repEmail);
    assert.strictEqual(dataComp.organization.profile_completed, true);
    assert.strictEqual(dataComp.organization.kyc_status, 'completed');

    // 4. Incomplete Profile & Complete Profile API (Google Auth Simulation)
    console.log('Testing Firebase profile simulation with incomplete profile details...');
    const idToken = 'mock-id-token';
    const resOAuth = await fetch(`${BASE_URL}/api/auth/firebase-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        [SMOKE_HEADER]: 'true'
      },
      body: JSON.stringify({
        name: 'OAuth User',
        email: oauthEmail,
        email_verified: true,
        phone_number: '',
        type: 'individual'
      })
    });
    assert.strictEqual(resOAuth.status, 200);
    const dataOAuth = await resOAuth.json();
    assert.strictEqual(dataOAuth.organization.profile_completed, false); // Profile is incomplete initially
    assert.strictEqual(dataOAuth.organization.kyc_status, 'incomplete');

    const authToken = dataOAuth.auth_token;

    console.log('Testing Complete Profile API update for individual...');
    const resComplete = await fetch(`${BASE_URL}/api/auth/complete-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        type: 'individual',
        first_name: 'OAuthFirst',
        last_name: 'OAuthLast',
        email: oauthEmail,
        phone_number: oauthPhone,
        country: 'Kenya',
        billing_currency: 'KES',
        profile_confirmed: true
      })
    });
    if (resComplete.status !== 200) {
      const errText = await resComplete.text();
      throw new Error(`complete-profile failed: ${resComplete.status} - ${errText}`);
    }
    const dataComplete = await resComplete.json();
    assert.strictEqual(dataComplete.success, true);
    assert.strictEqual(dataComplete.user.first_name, 'OAuthFirst');
    assert.strictEqual(dataComplete.user.last_name, 'OAuthLast');
    assert.ok(dataComplete.user.phone_number.startsWith('+254'));
    assert.strictEqual(dataComplete.organization.profile_completed, true);
    assert.strictEqual(dataComplete.organization.kyc_status, 'completed');

    console.log('\nAll KYC and registration foundation tests passed successfully!');
  } finally {
    console.log('Shutting down app server...');
    appProcess.kill();
  }
}

runTests().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
