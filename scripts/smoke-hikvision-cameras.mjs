import { spawn } from 'node:child_process';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/smart_landlord';
const PORT = 5075;
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

  console.log('\n--- 2. Register Hikvision ISAPI Camera ---');
  const createRes = await fetch(`${BASE_URL}/api/cameras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Lobby Hikvision IPC',
      brand: 'hikvision',
      ip_address: '127.0.0.1',
      port: 80,
      rtsp_port: 554,
      username: 'admin',
      password: 'HikSec999!',
      channel_no: 1
    })
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Register Hikvision camera failed: ${createRes.status} — ${text}`);
  }

  const camera = await createRes.json();
  console.log(`Registered Camera ID: ${camera.id}, Name: "${camera.name}", Brand: ${camera.brand.toUpperCase()}`);
  console.log(`Masked Password: "${camera.password_masked}", RTSP Stream URL: ${camera.rtsp_stream_url}`);

  if (!camera.rtsp_stream_url.includes('/Streaming/Channels/101')) {
    throw new Error(`Invalid Hikvision RTSP URL returned: ${camera.rtsp_stream_url}`);
  }

  console.log('\n--- 3. List Property Cameras ---');
  const listRes = await fetch(`${BASE_URL}/api/cameras`, { headers });
  if (!listRes.ok) throw new Error(`List cameras failed: ${listRes.status}`);
  const camerasList = await listRes.json();
  console.log(`Found ${camerasList.length} cameras registered.`);

  console.log('\n--- 4. Fetch Camera Detail & Hikvision ISAPI deviceInfo ---');
  const detailRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}`, { headers });
  if (!detailRes.ok) throw new Error(`Get camera detail failed: ${detailRes.status}`);
  const detail = await detailRes.json();
  console.log(`Camera Detail:`, detail.name, detail.brand, detail.status);
  console.log(`Hikvision ISAPI deviceInfo:`, detail.system_info);

  if (detail.system_info?.model !== 'DS-2CD2143G0-I') {
    throw new Error(`Expected Hikvision model DS-2CD2143G0-I, got: ${detail.system_info?.model}`);
  }

  console.log('\n--- 5. Capture Live Snapshot Picture (ISAPI) ---');
  const snapshotRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}/snapshot`, { headers });
  if (!snapshotRes.ok) throw new Error(`Snapshot failed: ${snapshotRes.status}`);
  const snapshotData = await snapshotRes.json();
  console.log(`Snapshot Result:`, snapshotData);

  console.log('\n--- 6. Test Hikvision PTZ Control ---');
  const ptzRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}/ptz`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'start', code: 'Up', arg1: 4, arg2: 4 })
  });
  if (!ptzRes.ok) throw new Error(`Hikvision PTZ failed: ${ptzRes.status}`);
  const ptzResult = await ptzRes.json();
  console.log(`Hikvision PTZ Result:`, ptzResult.message);

  console.log('\n--- 7. Test Hikvision ISAPI Remote Reboot (/ISAPI/System/reboot) ---');
  const rebootRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}/reboot`, {
    method: 'POST',
    headers
  });

  if (!rebootRes.ok) {
    const text = await rebootRes.text();
    throw new Error(`Hikvision reboot failed: ${rebootRes.status} — ${text}`);
  }

  const rebootData = await rebootRes.json();
  console.log(`Hikvision Reboot Result:`, rebootData.message);

  console.log('\n--- 8. Delete Hikvision Camera Registration ---');
  const deleteRes = await fetch(`${BASE_URL}/api/cameras/${camera.id}`, {
    method: 'DELETE',
    headers
  });

  if (!deleteRes.ok) throw new Error(`Delete camera failed: ${deleteRes.status}`);
  console.log(`Camera ID ${camera.id} deleted successfully.`);

  console.log('\nSUCCESS: All Hikvision ISAPI IP Camera module smoke tests passed cleanly!\n');
} catch (error) {
  console.error('\nFAIL: Hikvision ISAPI IP Camera smoke test failed:', error);
  process.exitCode = 1;
} finally {
  server.kill();
}
