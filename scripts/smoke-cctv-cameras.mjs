import { spawn } from 'node:child_process';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/smart_landlord';
const PORT = 5074;
const BASE_URL = `http://localhost:${PORT}`;

function startServer() {
  const child = spawn('node', ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      DATABASE_URL,
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
      DATA_BACKEND: process.env.DATA_BACKEND || 'json',
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

const server = startServer();

try {
  await waitForServer();

  console.log('\n--- 1. Authenticate Landlord Session ---');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer smoke:landlord@demo.com'
  };

  console.log('\n--- 2. Register Dahua IP Camera ---');
  const createRes = await fetch(`${BASE_URL}/api/cameras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Main Gate Dahua IPC',
      ip_address: '127.0.0.1',
      port: 80,
      rtsp_port: 554,
      username: 'admin',
      password: 'DahuaSec123!',
      channel_no: 1
    })
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Register camera failed: ${createRes.status} — ${text}`);
  }

  const camera = await createRes.json();
  console.log(`Registered Camera ID: ${camera.id}, Name: "${camera.name}", IP: ${camera.ip_address}`);
  console.log(`Masked Password: "${camera.password_masked}", RTSP URL: ${camera.rtsp_stream_url}`);

  if (!camera.rtsp_stream_url.includes('cam/realmonitor')) {
    throw new Error(`Invalid RTSP URL returned: ${camera.rtsp_stream_url}`);
  }

  console.log('\n--- 3. List Property Cameras ---');
  const listRes = await fetch(`${BASE_URL}/api/cameras`, { headers });
  if (!listRes.ok) throw new Error(`List cameras failed: ${listRes.status}`);
  const camerasList = await listRes.json();
  console.log(`Found ${camerasList.length} cameras registered.`);

  console.log('\n--- 4. Fetch Single Camera Detail & Dahua System Info ---');
  const detailRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}`, { headers });
  if (!detailRes.ok) throw new Error(`Get camera detail failed: ${detailRes.status}`);
  const detail = await detailRes.json();
  console.log(`Camera Detail:`, detail.name, detail.status);
  console.log(`System Info:`, detail.system_info);

  console.log('\n--- 5. Test Dahua PTZ Control Commands ---');
  const ptzCommands = ['Up', 'Down', 'Left', 'Right', 'ZoomIn', 'ZoomOut', 'Stop'];
  for (const code of ptzCommands) {
    const ptzRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}/ptz`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: code === 'Stop' ? 'stop' : 'start', code, arg1: 4, arg2: 4 })
    });

    if (!ptzRes.ok) {
      const text = await ptzRes.text();
      throw new Error(`PTZ command ${code} failed: ${ptzRes.status} — ${text}`);
    }

    const ptzResult = await ptzRes.json();
    console.log(`PTZ ${code} result:`, ptzResult.message || 'success');
  }

  console.log('\n--- 6. Test Dahua Remote Reboot (magicBox.cgi) ---');
  const rebootRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}/reboot`, {
    method: 'POST',
    headers
  });

  if (!rebootRes.ok) {
    const text = await rebootRes.text();
    throw new Error(`Reboot failed: ${rebootRes.status} — ${text}`);
  }

  const rebootData = await rebootRes.json();
  console.log(`Reboot Result:`, rebootData.message);

  console.log('\n--- 7. Delete Camera Registration ---');
  const deleteRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}`, {
    method: 'DELETE',
    headers
  });

  if (!deleteRes.ok) throw new Error(`Delete camera failed: ${deleteRes.status}`);
  console.log(`Camera ID ${camera.id} deleted successfully.`);

  console.log('\nSUCCESS: All CCTV Dahua IP Camera module smoke tests passed cleanly!\n');
} catch (error) {
  console.error('\nFAIL: CCTV Dahua IP Camera smoke test failed:', error);
  process.exitCode = 1;
} finally {
  server.kill();
}
