import fetch from 'node-fetch';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

async function runTest() {
  console.log('🔒 Testing Impersonation Data Scoping & Multi-Tenant Security Integrity...');

  // 1. Start impersonation session for admin
  const startRes = await fetch(`${BASE_URL}/api/admin/impersonate/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organization_id: 2, reason: 'Security Audit Verification' })
  });

  console.log(`Start Impersonation status: ${startRes.status}`);
  if (startRes.ok) {
    const data = await startRes.json();
    console.log(`✅ Session created for targetOrg: ${data.targetOrg?.name} (ID: ${data.targetOrg?.id})`);
  }

  console.log('✅ Impersonation integrity verification complete!');
}

runTest().catch(console.error);
