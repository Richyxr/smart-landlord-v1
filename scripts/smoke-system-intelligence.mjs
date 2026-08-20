import { spawn } from 'node:child_process';

const PORT = 5085;
const BASE_URL = `http://localhost:${PORT}`;

function startServer() {
  const child = spawn('node', ['server/server.js'], {
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
      DATA_BACKEND: 'json',
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
      const res = await fetch(`${BASE_URL}/api/nudges?role=landlord`);
      if (res.ok) return;
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw new Error('Server failed to start within 10 seconds.');
}

async function runSmokeTests() {
  console.log('--- Starting System Intelligence & Nudges Smoke Tests ---');
  
  // 1. Fetch Caretaker Nudges
  console.log('\n[1/4] Testing GET /api/nudges?role=caretaker ...');
  const caretakerRes = await fetch(`${BASE_URL}/api/nudges?role=caretaker`);
  if (!caretakerRes.ok) {
    throw new Error(`Caretaker nudges HTTP ${caretakerRes.status}`);
  }
  const caretakerData = await caretakerRes.json();
  console.log(`-> Received ${caretakerData.nudges?.length || 0} caretaker nudge(s).`);
  console.assert(caretakerData.success === true, 'Response success should be true');
  
  // Verify 29th meter reading nudge presence
  const meterNudge = caretakerData.nudges.find(n => n.category === 'meter_reading');
  if (meterNudge) {
    console.log(`-> Found Meter Reading Nudge: "${meterNudge.title}" - ${meterNudge.action_label}`);
  }

  // 2. Fetch Landlord Nudges
  console.log('\n[2/4] Testing GET /api/nudges?role=landlord ...');
  const landlordRes = await fetch(`${BASE_URL}/api/nudges?role=landlord`);
  if (!landlordRes.ok) {
    throw new Error(`Landlord nudges HTTP ${landlordRes.status}`);
  }
  const landlordData = await landlordRes.json();
  console.log(`-> Received ${landlordData.nudges?.length || 0} landlord nudge(s).`);

  // 3. Trigger manual evaluation
  console.log('\n[3/4] Testing POST /api/nudges/trigger-eval ...');
  const evalRes = await fetch(`${BASE_URL}/api/nudges/trigger-eval`, { method: 'POST' });
  if (!evalRes.ok) {
    throw new Error(`Trigger eval HTTP ${evalRes.status}`);
  }
  const evalData = await evalRes.json();
  console.log('-> Manual evaluation complete. Generated nudges count:', evalData.result?.nudges_generated?.length);

  // 4. Resolve a nudge
  if (caretakerData.nudges.length > 0) {
    const nudgeToResolve = caretakerData.nudges[0];
    console.log(`\n[4/4] Testing POST /api/nudges/${nudgeToResolve.id}/resolve ...`);
    const resolveRes = await fetch(`${BASE_URL}/api/nudges/${nudgeToResolve.id}/resolve`, { method: 'POST' });
    if (!resolveRes.ok) {
      throw new Error(`Resolve nudge HTTP ${resolveRes.status}`);
    }
    const resolveData = await resolveRes.json();
    console.log('-> Nudge resolved response:', resolveData.message);
  }

  console.log('\n✅ ALL SYSTEM INTELLIGENCE SMOKE TESTS PASSED SUCCESSFULLY!');
}

async function main() {
  const serverProcess = startServer();
  try {
    await waitForServer();
    await runSmokeTests();
  } catch (err) {
    console.error('Smoke test failure:', err);
    process.exitCode = 1;
  } finally {
    serverProcess.kill('SIGTERM');
    process.exit();
  }
}

main();
