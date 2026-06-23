import { spawn } from 'node:child_process';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for PostgreSQL webhook smoke tests.');
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT || '5058';
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

async function saveMpesaSandboxIntegration(token) {
  const landlord = await login('landlord@demo.com');
  const res = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${landlord.auth_token}`
    },
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'Safaricom M-Pesa API',
      environment: 'sandbox',
      config_json: {
        shortcode: '654321',
        passkey: token,
        consumer_key: 'sandbox-consumer-key-for-webhook-smoke',
        consumer_secret: 'sandbox-consumer-secret-for-webhook-smoke'
      }
    })
  });

  if (res.status !== 200) {
    throw new Error(`Could not save M-Pesa sandbox integration: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function saveMpesaLiveIntegration(token) {
  const landlord = await login('landlord@demo.com');
  const res = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${landlord.auth_token}`
    },
    body: JSON.stringify({
      provider_type: 'mpesa',
      provider_name: 'Safaricom M-Pesa API',
      environment: 'live',
      acknowledge_live_gate: true,
      config_json: {
        shortcode: '987654',
        passkey: token,
        consumer_key: 'live-consumer-key-for-webhook-smoke',
        consumer_secret: 'live-consumer-secret-for-webhook-smoke'
      }
    })
  });

  if (res.status !== 200) {
    throw new Error(`Could not save M-Pesa live integration: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function postMpesaWebhook(reference) {
  const res = await fetch(`${BASE_URL}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      TransID: reference,
      TransAmount: '1',
      BillRefNumber: 'ACC-0010-A1',
      MSISDN: '254711222333',
      FirstName: 'Smoke',
      LastName: 'Test'
    })
  });

  return {
    status: res.status,
    body: await res.json()
  };
}

async function postMpesaC2b(reference, token) {
  const res = await fetch(`${BASE_URL}/api/webhooks/mpesa/c2b?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      TransID: reference,
      TransAmount: '1',
      BillRefNumber: 'ACC-0010-A1',
      BusinessShortCode: '654321',
      MSISDN: '254711222333',
      FirstName: 'Smoke',
      LastName: 'C2B'
    })
  });

  return {
    status: res.status,
    body: await res.json()
  };
}

async function postMpesaLiveC2b(reference, token) {
  const res = await fetch(`${BASE_URL}/api/webhooks/mpesa/c2b?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      TransID: reference,
      TransAmount: '100',
      BillRefNumber: 'ACC-0010-A1',
      BusinessShortCode: '987654',
      MSISDN: '254711222333',
      FirstName: 'Smoke',
      LastName: 'LiveC2B'
    })
  });

  return {
    status: res.status,
    body: await res.json()
  };
}

async function postBankWebhook(reference) {
  const res = await fetch(`${BASE_URL}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider_type: 'bank',
      reference_number: reference,
      amount: '1',
      account_number: 'ACC-0010-A1',
      payer_name: 'Smoke Bank',
      phone_number: '254711222333'
    })
  });

  return {
    status: res.status,
    body: await res.json()
  };
}

function assertWebhook(label, result, expectedResultCode) {
  if (result.status !== 200 || result.body.ResultCode !== expectedResultCode) {
    throw new Error(`${label}: expected HTTP 200 / ResultCode ${expectedResultCode}, received HTTP ${result.status} / ${JSON.stringify(result.body)}`);
  }
  console.log(`PASS ${label}: HTTP ${result.status}, ResultCode ${result.body.ResultCode}`);
}

const server = startServer();

try {
  await waitForServer();

  const c2bToken = `sandbox-c2b-token-${Date.now()}`;
  const savedIntegration = await saveMpesaSandboxIntegration(c2bToken);
  if (savedIntegration.config_json_encrypted || savedIntegration.webhook_secret) {
    throw new Error('M-Pesa integration response exposed sensitive fields.');
  }
  console.log('PASS M-Pesa sandbox integration saved with masked response.');

  const c2bReference = `SMOKE-C2B-${Date.now()}`;
  assertWebhook('postgres M-Pesa C2B accepts correct callback token', await postMpesaC2b(c2bReference, c2bToken), 0);
  assertWebhook('postgres M-Pesa C2B rejects wrong callback token', await postMpesaC2b(`SMOKE-C2B-WRONG-${Date.now()}`, 'wrong-token'), 1);
  assertWebhook('postgres M-Pesa C2B blocks duplicate receipt', await postMpesaC2b(c2bReference, c2bToken), 1);

  const mpesaReference = `SMOKE-MPESA-${Date.now()}`;
  assertWebhook('postgres webhook accepts first M-Pesa callback', await postMpesaWebhook(mpesaReference), 0);
  assertWebhook('postgres webhook blocks duplicate M-Pesa callback', await postMpesaWebhook(mpesaReference), 1);

  const bankReference = `SMOKE-BANK-${Date.now()}`;
  assertWebhook('postgres webhook accepts first bank callback', await postBankWebhook(bankReference), 0);
  assertWebhook('postgres webhook blocks duplicate bank callback', await postBankWebhook(bankReference), 1);

  // Live webhook guard verification
  const liveToken = `live-c2b-token-${Date.now()}`;
  const liveIntegration = await saveMpesaLiveIntegration(liveToken);
  console.log('PASS M-Pesa live integration saved successfully.');

  const liveC2bReference = `SMOKE-LIVE-C2B-${Date.now()}`;
  assertWebhook('postgres M-Pesa live C2B webhook accepted safely', await postMpesaLiveC2b(liveC2bReference, liveToken), 0);

  // Directly check the database to ensure no transaction was created and it was staged as unmatched
  const pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  await pgClient.connect();
  try {
    const txCheck = await pgClient.query(
      'SELECT id FROM transactions WHERE reference_number = $1',
      [liveC2bReference]
    );
    if (txCheck.rows.length > 0) {
      throw new Error('Security violation: transaction was created for live M-Pesa callback!');
    }
    console.log('PASS: No transactions created for live webhook payment callback.');

    const stagingCheck = await pgClient.query(
      'SELECT id, status, error_message FROM reconciliation_staging_rows WHERE reference_number = $1',
      [liveC2bReference]
    );
    if (stagingCheck.rows.length === 0) {
      throw new Error('Error: live M-Pesa callback was not staged in reconciliation_staging_rows!');
    }
    const stagingRow = stagingCheck.rows[0];
    if (stagingRow.status !== 'unmatched') {
      throw new Error(`Expected staging row status to be 'unmatched', got '${stagingRow.status}'`);
    }
    if (!stagingRow.error_message.includes('Live payment processing is not enabled')) {
      throw new Error(`Expected error message to mention live payments not enabled, got: ${stagingRow.error_message}`);
    }
    console.log('PASS: Live webhook payment was staged securely without allocation.');
  } finally {
    await pgClient.end();
  }

  console.log('PostgreSQL webhook smoke test passed.');
} finally {
  server.kill('SIGTERM');
}
