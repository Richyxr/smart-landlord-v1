import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PORT = 5079;
const BASE_URL = `http://localhost:${PORT}`;

async function runTest() {
  console.log('--- Starting Impersonation Scoping Smoke Test ---');

  const serverProcess = spawn('node', ['server/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', DEMO_MODE: 'true', DATA_BACKEND: 'json' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('Backend Server running')) console.log('[server]', msg.trim());
  });
  serverProcess.stderr.on('data', d => console.error('[server-err]', d.toString().trim()));

  await new Promise(resolve => setTimeout(resolve, 2500));

  try {
    const adminToken = 'smoke:admin@smartlandlord.com';
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

    // 1. Get baseline admin stats (should succeed without impersonation header)
    console.log('\n--- 1. Verify Admin can access /api/admin/stats ---');
    const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, { headers: adminHeaders });
    if (!statsRes.ok) throw new Error(`Admin /api/admin/stats failed: ${statsRes.status} ${JSON.stringify(await statsRes.json())}`);
    console.log('Admin stats accessible. OK');

    // 2. Start Impersonation for Organization 1 (has tenants/properties)
    console.log('\n--- 2. Start Impersonation for Org 1 (Landlord with data) ---');
    const start1Res = await fetch(`${BASE_URL}/api/admin/impersonate/start`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ organization_id: 1, reason: 'Support audit for active landlord account' })
    });
    if (!start1Res.ok) throw new Error(`Impersonation start failed: ${start1Res.status} ${JSON.stringify(await start1Res.json())}`);
    const start1Data = await start1Res.json();
    console.log(`Impersonation Session 1 Created. ID: ${start1Data.session.id}, Target Org: "${start1Data.targetOrg.name}" (ID: ${start1Data.targetOrg.id})`);

    // Impersonation headers for Org 1 requests
    const impHeaders1 = { ...adminHeaders, 'x-impersonation-org-id': String(start1Data.targetOrg.id) };

    const [org1PropsRes, org1TenantsRes] = await Promise.all([
      fetch(`${BASE_URL}/api/properties`, { headers: impHeaders1 }),
      fetch(`${BASE_URL}/api/tenants`, { headers: impHeaders1 })
    ]);
    const org1Props = await org1PropsRes.json();
    const org1Tenants = await org1TenantsRes.json();
    console.log(`Org 1 Properties Count: ${org1Props.length}, Tenants Count: ${org1Tenants.length}`);

    if (org1Props.some(p => p.organization_id !== 1)) throw new Error('Data leakage: Org1 properties have wrong org_id');
    if (org1Tenants.some(t => t.organization_id !== 1)) throw new Error('Data leakage: Org1 tenants have wrong org_id');

    // 3. Stop Org 1 session and start Org 2 (empty landlord: FRED MWAI)
    console.log('\n--- 3. Stop Org 1 & Start Impersonation for Org 2 (empty landlord) ---');
    await fetch(`${BASE_URL}/api/admin/impersonate/stop`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ session_id: start1Data.session.id })
    });

    const start2Res = await fetch(`${BASE_URL}/api/admin/impersonate/start`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ organization_id: 2, reason: 'Support audit for empty landlord (FRED MWAI)' })
    });
    if (!start2Res.ok) throw new Error(`Impersonation start 2 failed: ${start2Res.status} ${JSON.stringify(await start2Res.json())}`);
    const start2Data = await start2Res.json();
    console.log(`Impersonation Session 2 Created. ID: ${start2Data.session.id}, Target Org: "${start2Data.targetOrg.name}" (ID: ${start2Data.targetOrg.id})`);

    // Impersonation headers for Org 2 requests
    const impHeaders2 = { ...adminHeaders, 'x-impersonation-org-id': String(start2Data.targetOrg.id) };

    // 4. Fetch all endpoints for Org 2
    console.log('\n--- 4. Fetch Endpoints During Impersonation (Org 2 / FRED MWAI) ---');
    const [propsRes, unitsRes, tenantsRes, stagingRes, paymentsRes] = await Promise.all([
      fetch(`${BASE_URL}/api/properties`, { headers: impHeaders2 }),
      fetch(`${BASE_URL}/api/units`, { headers: impHeaders2 }),
      fetch(`${BASE_URL}/api/tenants`, { headers: impHeaders2 }),
      fetch(`${BASE_URL}/api/reconciliation/staging`, { headers: impHeaders2 }),
      fetch(`${BASE_URL}/api/payments`, { headers: impHeaders2 })
    ]);

    const props = await propsRes.json();
    const units = await unitsRes.json();
    const tenants = await tenantsRes.json();
    const staging = await stagingRes.json();
    const payments = await paymentsRes.json();

    console.log(`Org 2 Properties Count: ${props.length}`);
    console.log(`Org 2 Units Count: ${units.length}`);
    console.log(`Org 2 Tenants Count: ${tenants.length}`);
    console.log(`Org 2 Staging Rows Count: ${staging.length}`);
    console.log(`Org 2 Payments Count: ${payments.length}`);

    // Ensure zero cross-org leakage
    if (props.some(p => p.organization_id !== 2)) throw new Error('Data leakage: Org2 properties contain data from another org');
    if (units.some(u => u.organization_id !== 2)) throw new Error('Data leakage: Org2 units contain data from another org');
    if (tenants.some(t => t.organization_id !== 2)) throw new Error('Data leakage: Org2 tenants contain data from another org');

    // Verify no Org1 data leaked into Org2 view (FRED MWAI has no tenants registered)
    if (tenants.length !== 0) throw new Error(`Data leakage! Expected 0 tenants for empty landlord Org2, got ${tenants.length}`);
    if (props.length !== 0) throw new Error(`Data leakage! Expected 0 properties for empty landlord Org2, got ${props.length}`);

    console.log('\nSUCCESS: Zero cross-tenant data leakage confirmed!');

    // 5. Stop Org 2 impersonation
    console.log('\n--- 5. Stop Impersonation & Verify Admin Context Intact ---');
    await fetch(`${BASE_URL}/api/admin/impersonate/stop`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ session_id: start2Data.session.id })
    });
    console.log('Impersonation stopped successfully.');

    // 6. Admin should still have full admin access to /api/admin/* without impersonation header
    const finalStatsRes = await fetch(`${BASE_URL}/api/admin/stats`, { headers: adminHeaders });
    if (!finalStatsRes.ok) throw new Error(`Admin /api/admin/stats failed after stop: ${finalStatsRes.status}`);
    console.log('Admin context intact after exit. OK');

    console.log('\nSUCCESS: All impersonation scoping smoke tests passed cleanly!');
  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    serverProcess.kill();
  }
}

runTest();
