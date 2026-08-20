import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 5080;
const BASE_URL = `http://localhost:${PORT}`;

async function runTest() {
  console.log('--- Debug: Test Admin Auth Context ---');

  const serverProcess = spawn('node', ['server/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', DEMO_MODE: 'true', DATA_BACKEND: 'json' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('Backend Server running') || msg.includes('[debug]')) console.log('[server]', msg.trim());
  });
  serverProcess.stderr.on('data', d => console.error('[server-err]', d.toString().trim()));

  await new Promise(resolve => setTimeout(resolve, 2500));

  try {
    const adminToken = 'smoke:admin@smartlandlord.com';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    };

    // Try properties list (admin should see landlord org data after impersonation)
    console.log('\n--- Test: GET /api/properties as super admin token ---');
    const propsRes = await fetch(`${BASE_URL}/api/properties`, { headers });
    console.log('Status:', propsRes.status, propsRes.statusText);
    const propsData = await propsRes.json();
    console.log('Response:', JSON.stringify(propsData).slice(0, 200));

    // Try admin stats
    console.log('\n--- Test: GET /api/admin/stats as super admin token ---');
    const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, { headers });
    console.log('Status:', statsRes.status, statsRes.statusText);
    const statsData = await statsRes.json();
    console.log('Response:', JSON.stringify(statsData).slice(0, 200));
  } catch (err) {
    console.error('TEST ERROR:', err.message);
  } finally {
    serverProcess.kill();
  }
}

runTest();
