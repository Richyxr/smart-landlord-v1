import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert';
import { db } from '../server/db.js';

const APP_PORT = process.env.SMOKE_PORT || '5062';
const SMTP_PORT = process.env.SMOKE_SMTP_PORT || '2526';
const BASE_URL = `http://localhost:${APP_PORT}`;
const SMOKE_HEADER = 'x-smart-landlord-registration-smoke';

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

function startAppServer() {
  const child = spawn(process.execPath, ['server/server.js'], {
    env: {
      ...process.env,
      PORT: APP_PORT,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'json',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT,
      SMTP_SECURE: 'false',
      SMTP_USERNAME: 'smoke@example.com',
      SMTP_PASSWORD: 'smoke-password',
      EMAIL_FROM: 'no-reply@example.com',
      EMAIL_FROM_NAME: 'Smart Landlord Smoke',
      APP_PUBLIC_URL: BASE_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
  child.on('exit', (code, signal) => {
    process.stderr.write(`[server] exited code=${code} signal=${signal}\n`);
  });
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
  throw new Error(`Server did not become ready in time. Last status: ${lastStatus || 'none'}; last error: ${lastError?.message || 'none'}; cause: ${lastError?.cause?.message || 'none'}`);
}

function registrationHeaders() {
  return {
    'Content-Type': 'application/json',
    [SMOKE_HEADER]: 'true'
  };
}

function assertNoOtpLeak(label, payload, otps) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const otp of otps.filter(Boolean)) {
    assert.ok(!text.includes(otp), `${label}: API/audit payload exposed OTP ${otp}`);
  }
}

async function readJson(res) {
  const text = await res.text();
  return { text, body: text ? JSON.parse(text) : {} };
}

async function startRegistration(email, messages, profile = {}) {
  const before = messages.length;
  const res = await fetch(`${BASE_URL}/api/auth/registration/start`, {
    method: 'POST',
    headers: registrationHeaders(),
    body: JSON.stringify({
      firebase_uid: `smoke:${email}`,
      name: 'Registration Smoke',
      email,
      phone_number: `+2547${Math.floor(10000000 + Math.random() * 90000000)}`,
      country: 'Kenya',
      billing_currency: 'KES',
      type: 'individual',
      ...profile
    })
  });
  const { text, body } = await readJson(res);
  assert.strictEqual(res.status, 202, `start registration failed: ${res.status} ${text}`);
  assertNoOtpLeak('registration start response', body, []);

  const message = await waitForEmail(messages, before);
  const otp = extractOtp(message);
  assert.ok(otp, 'registration email did not contain a 6-digit OTP');
  assertNoOtpLeak('registration start API response', body, [otp]);

  return { body, otp, message };
}

async function waitForEmail(messages, previousCount) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (messages.length > previousCount) {
      return messages[messages.length - 1];
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for SMTP message.');
}

function extractOtp(message) {
  return message.match(/\b\d{6}\b/)?.[0] || null;
}

async function profileRequest(email) {
  return fetch(`${BASE_URL}/api/auth/firebase-profile`, {
    method: 'POST',
    headers: registrationHeaders(),
    body: JSON.stringify({
      firebase_uid: `smoke:${email}`,
      email,
      name: 'Registration Smoke'
    })
  });
}

async function verifyEmail(email, otp) {
  return fetch(`${BASE_URL}/api/auth/registration/verify-email`, {
    method: 'POST',
    headers: registrationHeaders(),
    body: JSON.stringify({
      firebase_uid: `smoke:${email}`,
      email,
      otp
    })
  });
}

async function resendOtp(email) {
  return fetch(`${BASE_URL}/api/auth/registration/resend-otp`, {
    method: 'POST',
    headers: registrationHeaders(),
    body: JSON.stringify({
      firebase_uid: `smoke:${email}`,
      email
    })
  });
}

function latestOtpRow(email) {
  return db.get('otp_codes')
    .filter(row => row.identifier === email && row.context === 'registration_email_verify')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

async function run() {
  const smtp = await startSmtpServer();
  const app = startAppServer();
  const seenOtps = [];

  try {
    await waitForServer();

    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = name => `reg_${name}_${suffix}@example.com`;

    const primary = await startRegistration(email('primary'), smtp.messages);
    seenOtps.push(primary.otp);
    console.log('PASS registration sends OTP email.');

    let profileRes = await profileRequest(email('primary'));
    let parsed = await readJson(profileRes);
    assert.strictEqual(profileRes.status, 403);
    assert.strictEqual(parsed.body.error, 'EMAIL_VERIFICATION_REQUIRED');
    assertNoOtpLeak('unverified profile response', parsed.body, seenOtps);
    console.log('PASS unverified account cannot complete login/profile session.');

    const verifyRes = await verifyEmail(email('primary'), primary.otp);
    parsed = await readJson(verifyRes);
    assert.strictEqual(verifyRes.status, 200, `correct OTP failed: ${verifyRes.status} ${parsed.text}`);
    assert.ok(parsed.body.auth_token);
    assert.strictEqual(parsed.body.user.email_verified, true);
    assert.strictEqual(parsed.body.user.status, 'active');
    assertNoOtpLeak('verify success response', parsed.body, seenOtps);
    console.log('PASS correct OTP verifies account and returns app session.');

    const reuseRes = await verifyEmail(email('primary'), primary.otp);
    parsed = await readJson(reuseRes);
    assert.strictEqual(reuseRes.status, 400);
    assertNoOtpLeak('reused OTP response', parsed.body, seenOtps);
    console.log('PASS reused OTP fails.');

    const wrong = await startRegistration(email('wrong'), smtp.messages);
    seenOtps.push(wrong.otp);
    const wrongRes = await verifyEmail(email('wrong'), '000000');
    parsed = await readJson(wrongRes);
    assert.strictEqual(wrongRes.status, 400);
    assert.strictEqual(latestOtpRow(email('wrong')).attempts, 1);
    assertNoOtpLeak('wrong OTP response', parsed.body, seenOtps);
    console.log('PASS wrong OTP fails and counts attempts.');

    const expired = await startRegistration(email('expired'), smtp.messages);
    seenOtps.push(expired.otp);
    db.update('otp_codes', latestOtpRow(email('expired')).id, {
      expires_at: new Date(Date.now() - 1000).toISOString()
    });
    const expiredRes = await verifyEmail(email('expired'), expired.otp);
    parsed = await readJson(expiredRes);
    assert.strictEqual(expiredRes.status, 400);
    assertNoOtpLeak('expired OTP response', parsed.body, seenOtps);
    console.log('PASS expired OTP fails.');

    const resendEmail = email('resend');
    const resendStart = await startRegistration(resendEmail, smtp.messages);
    seenOtps.push(resendStart.otp);
    for (let i = 0; i < 4; i += 1) {
      const before = smtp.messages.length;
      const res = await resendOtp(resendEmail);
      parsed = await readJson(res);
      assert.strictEqual(res.status, 200, `resend ${i + 1} failed: ${res.status} ${parsed.text}`);
      const otp = extractOtp(await waitForEmail(smtp.messages, before));
      seenOtps.push(otp);
      assertNoOtpLeak(`resend ${i + 1} response`, parsed.body, seenOtps);
    }

    const limitedRes = await resendOtp(resendEmail);
    parsed = await readJson(limitedRes);
    assert.strictEqual(limitedRes.status, 429);
    assertNoOtpLeak('rate limited resend response', parsed.body, seenOtps);
    console.log('PASS resend respects 5 requests/hour rate limit.');

    const auditText = JSON.stringify(db.get('audit_logs'));
    assertNoOtpLeak('audit logs', auditText, seenOtps);
    console.log('PASS no OTP appears in API responses or audit logs.');

    console.log('Registration email verification smoke test passed.');
  } finally {
    app.kill('SIGTERM');
    smtp.server.close();
  }
}

run().catch(error => {
  console.error('TEST FAIL:', error);
  process.exit(1);
});
