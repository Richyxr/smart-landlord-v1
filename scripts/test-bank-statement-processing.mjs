import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'node:child_process';
import XLSX from 'xlsx';

const PORT = '5099';
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;

function startServer(backend, dbUrl) {
  console.log(`Starting server with DATA_BACKEND=${backend}...`);
  const env = {
    ...process.env,
    PORT,
    NODE_ENV: 'development',
    DEMO_MODE: 'true',
    DATA_BACKEND: backend
  };
  if (dbUrl) {
    env.DATABASE_URL = dbUrl;
  }

  const child = spawn(process.execPath, ['server/server.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => {
    const msg = data.toString();
    if (msg.includes('server error') || msg.includes('Failed to start')) {
      console.error(`[server stdout] ${msg}`);
    }
  });

  child.stderr.on('data', data => {
    console.error(`[server stderr] ${data.toString()}`);
  });

  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'landlord@demo.com' })
      });
      if (res.ok) {
        console.log('Server is ready!');
        return;
      }
    } catch (_error) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw new Error('Server did not start in time.');
}

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}`);
  }
  return res.json();
}

async function registerLandlord(email, first, last) {
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'individual',
      first_name: first,
      last_name: last,
      email,
      phone_number: `+254799${Math.floor(100000 + Math.random() * 900000)}`,
      country: 'Kenya',
      billing_currency: 'KES',
      profile_confirmed: true
    })
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(`Registration failed: ${errData.error || res.status}`);
  }
  return res.json();
}

async function uploadFile(token, filename, contentBuffer, mimeType = 'text/csv') {
  const form = new FormData();
  const blob = new Blob([contentBuffer], { type: mimeType });
  form.append('file', blob, filename);

  const res = await fetch(`${BASE_URL}/api/billing/statement-uploads`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: form
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error(`Failed to parse JSON response. Status: ${res.status}. Text content:`, text);
    throw new Error(`Non-JSON response received: ${res.status}`);
  }

  return { ok: res.ok, status: res.status, data };
}

async function checkUploadStatusUntilProcessed(token, uploadId) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/billing/statement-uploads/${uploadId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch details');
    const data = await res.json();
    if (data.status !== 'uploaded' && data.status !== 'parsing') {
      return data;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Statement processing timed out.');
}

async function runBackendSuite(backend, dbUrl) {
  console.log(`\n======================================================`);
  console.log(`RUNNING SUITE FOR BACKEND: ${backend}`);
  console.log(`======================================================`);

  serverProcess = startServer(backend, dbUrl);
  try {
    await waitForServer();

    // 1. Logins
    console.log('Logging in and registering test entities...');
    const landlord1 = await login('landlord@demo.com');
    
    // Register landlord 2 for tenant isolation checks
    const janeEmail = `jane.${Date.now()}@demo.com`;
    await registerLandlord(janeEmail, 'Jane', 'Doe');
    const landlord2 = await login(janeEmail);

    const token1 = landlord1.auth_token;
    const token2 = landlord2.auth_token;

    const rand = Math.floor(100000 + Math.random() * 900000);
    const refA = `REF${rand}A`;
    const refB = `REF${rand}B`;

    console.log('Testing cross-tenant upload isolation...');
    // Create valid CSV statement
    const csvContent = `date,amount,code,payer,narration\n2026-06-15,5000,${refA},David,Rent Payment`;
    const uploadRes1 = await uploadFile(token1, 'landlord1_stmt.csv', Buffer.from(csvContent, 'utf-8'));
    if (!uploadRes1.ok) {
      console.error('Upload failed with details:', uploadRes1.status, uploadRes1.data);
    }
    assert.strictEqual(uploadRes1.ok, true, 'Landlord 1 should upload statement successfully');
    const upload1 = await checkUploadStatusUntilProcessed(token1, uploadRes1.data.upload_id);
    assert.strictEqual(upload1.status, 'parsed', 'Upload status should be parsed');

    // Query upload history as Landlord 2
    const historyRes2 = await fetch(`${BASE_URL}/api/billing/statement-uploads`, {
      headers: { 'Authorization': `Bearer ${token2}` }
    });
    const history2 = await historyRes2.json();
    console.log('Landlord 1 organization:', landlord1.organization?.id, 'Upload 1 organization_id:', upload1.organization_id);
    console.log('Landlord 2 organization:', landlord2.organization?.id, 'history2 items:', history2.map(h => ({ id: h.id, organization_id: h.organization_id })));
    const hasOrg1Upload = history2.some(u => u.id === upload1.id);
    assert.strictEqual(hasOrg1Upload, false, 'Landlord 2 must not see Landlord 1 uploads in history log');

    // Fetch details of Landlord 1 upload as Landlord 2
    const detailRes2 = await fetch(`${BASE_URL}/api/billing/statement-uploads/${upload1.id}`, {
      headers: { 'Authorization': `Bearer ${token2}` }
    });
    assert.strictEqual(detailRes2.status, 404, 'Landlord 2 fetching details of Landlord 1 upload should return 404');

    // Confirm Landlord 1 upload as Landlord 2
    const confirmRes2 = await fetch(`${BASE_URL}/api/billing/statement-uploads/${upload1.id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token2}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ include_duplicates: false })
    });
    assert.strictEqual(confirmRes2.status, 404, 'Landlord 2 confirming Landlord 1 upload should return 404');

    // Delete Landlord 1 upload as Landlord 2
    const deleteRes2 = await fetch(`${BASE_URL}/api/billing/statement-uploads/${upload1.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token2}` }
    });
    assert.strictEqual(deleteRes2.status, 404, 'Landlord 2 deleting Landlord 1 upload should return 404');

    console.log('✓ Cross-tenant upload and confirm isolation verified successfully.');

    // 2. Duplicate file upload protection
    console.log('Testing duplicate file prevention...');
    const dupUpload = await uploadFile(token1, 'landlord1_stmt_dup.csv', Buffer.from(csvContent, 'utf-8'));
    assert.strictEqual(dupUpload.ok, false, 'Duplicate file upload must be blocked');
    assert.strictEqual(dupUpload.status, 400, 'Duplicate file upload returns 400 Bad Request');
    console.log('✓ Duplicate file upload blocked successfully.');

    // 3. Failed statement confirmation block
    console.log('Testing confirmation blocks on failed uploads...');
    const malformedCsv = 'some random garbage content without columns or commas\nand binary data';
    const malformedUploadRes = await uploadFile(token1, 'malformed.csv', Buffer.from(malformedCsv, 'utf-8'));
    if (!malformedUploadRes.ok) {
      console.error('Malformed CSV upload failed with status:', malformedUploadRes.status, 'data:', malformedUploadRes.data);
    }
    assert.strictEqual(malformedUploadRes.ok, true, 'Upload endpoint accepts file but sets status in async processing');
    const malformedUpload = await checkUploadStatusUntilProcessed(token1, malformedUploadRes.data.upload_id);
    assert.strictEqual(malformedUpload.status, 'failed', 'Malformed/empty CSV status must be failed');

    const confirmFailedRes = await fetch(`${BASE_URL}/api/billing/statement-uploads/${malformedUpload.id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ include_duplicates: false })
    });
    assert.strictEqual(confirmFailedRes.status, 400, 'Confirming failed upload must return 400 Bad Request');
    const confirmFailedData = await confirmFailedRes.json();
    assert.strictEqual(confirmFailedData.error, 'Failed statement uploads cannot be confirmed.', 'Error message should match exactly');
    console.log('✓ Failed upload confirmation block verified.');

    // 4. XLSX empty sheet gracefully failing
    console.log('Testing empty XLSX sheet parsing...');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const emptyXlsxRes = await uploadFile(token1, 'empty.xlsx', xlsxBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.strictEqual(emptyXlsxRes.ok, true);
    const emptyXlsx = await checkUploadStatusUntilProcessed(token1, emptyXlsxRes.data.upload_id);
    assert.strictEqual(emptyXlsx.status, 'failed', 'Empty XLSX sheet should transition status to failed');
    assert.strictEqual(emptyXlsx.error_message, 'Statement parsing failed: Excel sheet contains no data rows.', 'Error message matches empty sheet');
    console.log('✓ Empty XLSX sheet gracefully fails parsing.');

    // 5. Scanned PDF without text layer returns failed
    console.log('Testing scanned PDF without text layer...');
    const corruptPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0x03]); // Corrupt PDF header
    const scannedPdfRes = await uploadFile(token1, 'scanned.pdf', corruptPdfBuffer, 'application/pdf');
    assert.strictEqual(scannedPdfRes.ok, true);
    const scannedPdf = await checkUploadStatusUntilProcessed(token1, scannedPdfRes.data.upload_id);
    assert.strictEqual(scannedPdf.status, 'failed', 'Scanned PDF without text layer status must be failed');
    assert.ok(
      scannedPdf.error_message.includes('Failed to parse PDF') ||
      scannedPdf.error_message.includes('No text layer could be extracted'),
      'Error message matches PDF text layer/structural failure'
    );
    console.log('✓ PDF without text layer returns failed with clear message.');

    // 6. Confirmed imports are idempotent and source_hash duplicate block
    console.log('Testing confirmed imports idempotency & source_hash duplicate prevention...');
    // Log initial confirmed rows count
    const detailsBefore = await checkUploadStatusUntilProcessed(token1, upload1.id);
    assert.strictEqual(detailsBefore.status, 'parsed');

    // Confirm upload1
    const confirmRes = await fetch(`${BASE_URL}/api/billing/statement-uploads/${upload1.id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ include_duplicates: false })
    });
    assert.strictEqual(confirmRes.status, 200, 'Confirming parsed upload should succeed');
    const confirmData = await confirmRes.json();
    assert.strictEqual(confirmData.imported_count, 1, '1 transaction should be imported');

    // Attempt to confirm the same upload again
    const confirmResDup = await fetch(`${BASE_URL}/api/billing/statement-uploads/${upload1.id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ include_duplicates: false })
    });
    assert.strictEqual(confirmResDup.status, 400, 'Confirming already confirmed upload should return 400');

    // Upload a DIFFERENT file containing the SAME transaction code (overlapping imports)
    const overlappingCsv = `date,amount,code,payer,narration\n2026-06-15,5000,${refA},David,Rent Payment`;
    const overlapRes = await uploadFile(token1, 'landlord1_stmt_overlap.csv', Buffer.from(overlappingCsv + `\n2026-06-16,3000,${refB},Alice,Rent`, 'utf-8'));
    const overlapUpload = await checkUploadStatusUntilProcessed(token1, overlapRes.data.upload_id);
    assert.strictEqual(overlapUpload.status, 'needs_review', 'Overlap file contains duplicates, status should be needs_review');

    // Confirm the overlap statement. Since refA was already confirmed, it should be skipped!
    const confirmOverlapRes = await fetch(`${BASE_URL}/api/billing/statement-uploads/${overlapUpload.id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ include_duplicates: true }) // Include duplicates check
    });
    assert.strictEqual(confirmOverlapRes.status, 200);
    const confirmOverlapData = await confirmOverlapRes.json();
    assert.strictEqual(confirmOverlapData.imported_count, 1, `Only the new transaction ${refB} should be imported`);
    assert.strictEqual(confirmOverlapData.skipped_duplicate_count, 1, `The duplicate ${refA} transaction must be skipped`);

    console.log('✓ Import idempotency and source_hash duplicate prevention verified.');

    // 7. Deleted/rejected upload cannot be confirmed
    console.log('Testing rejected/deleted upload cannot be confirmed...');
    const deleteRes = await fetch(`${BASE_URL}/api/billing/statement-uploads/${overlapUpload.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token1}` }
    });
    assert.strictEqual(deleteRes.status, 200, 'Deleting statement upload should succeed');

    const confirmDeletedRes = await fetch(`${BASE_URL}/api/billing/statement-uploads/${overlapUpload.id}/confirm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ include_duplicates: false })
    });
    assert.strictEqual(confirmDeletedRes.status, 404, 'Confirming deleted upload must return 404 Not Found');
    console.log('✓ Deleted/rejected uploads cannot be confirmed verified.');
 
    if (backend === 'postgres') {
      // 8. Bank Reconciliation Queue and Intelligent Match Suggestions Tests
      console.log('Testing Bank Reconciliation Queue & Intelligent Matching...');
      
      const tenantsRes = await fetch(`${BASE_URL}/api/tenants`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      const tenantList = await tenantsRes.json();
      assert.ok(tenantList.length > 0, 'Should have active tenants from seeds');
      const targetTenant = tenantList[0];

      const invoiceRes = await fetch(`${BASE_URL}/api/invoices`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token1}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tenant_id: targetTenant.id,
          invoice_type: 'rent',
          issue_date: '2026-06-01',
          due_date: '2026-06-10',
          notes: 'Test invoice for matching',
          items: [{
            description: 'Rent Payment',
            item_type: 'rent',
            quantity: 1,
            unit_price: 12000
          }]
        })
      });
      assert.strictEqual(invoiceRes.status, 201, 'Invoice creation should succeed');
      const createdInvoice = await invoiceRes.json();

      const mpesaCode = `TX${Math.floor(10000000 + Math.random() * 90000000)}`;
      const mpesaLine = `${mpesaCode} 2026-06-05 12:00:00 Customer Transfer Paid In KES 12,000.00 from ${targetTenant.phone_number || '0711222333'} - ${targetTenant.full_name || 'John Doe'} for ${createdInvoice.invoice_number}`;
      const mpesaPdfText = `Safaricom M-Pesa Statement\n${mpesaLine}\n`;
      
      const mpesaUploadRes = await uploadFile(token1, 'mpesa_stmt.csv', Buffer.from(mpesaPdfText, 'utf-8'), 'text/csv');
      assert.strictEqual(mpesaUploadRes.ok, true);
      const mpesaUpload = await checkUploadStatusUntilProcessed(token1, mpesaUploadRes.data.upload_id);
      assert.strictEqual(mpesaUpload.status, 'parsed', 'MPesa statement should parse successfully');

      const confirmMpesaRes = await fetch(`${BASE_URL}/api/billing/statement-uploads/${mpesaUpload.id}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token1}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ include_duplicates: false })
      });
      assert.strictEqual(confirmMpesaRes.status, 200);

      const queueResAll = await fetch(`${BASE_URL}/api/billing/bank-transactions`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      assert.strictEqual(queueResAll.status, 200);
      const queueDataAll = await queueResAll.json();
      console.log('All queue transactions:', JSON.stringify(queueDataAll.transactions, null, 2));

      const queueTx = queueDataAll.transactions.find(t => t.reference === mpesaCode);
      assert.ok(queueTx, 'Imported transaction should be in the review queue');
      assert.strictEqual(queueTx.status, 'Possible Match', 'Transaction should have Possible Match status');

      const suggestionsRes = await fetch(`${BASE_URL}/api/billing/bank-transactions/${queueTx.id}/suggestions`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      assert.strictEqual(suggestionsRes.status, 200);
      const suggestions = await suggestionsRes.json();
      assert.ok(suggestions.length > 0, 'Should return matching invoice suggestions');
      
      const bestMatch = suggestions[0];
      assert.strictEqual(bestMatch.invoice_number, createdInvoice.invoice_number, 'Best suggestion should match created invoice number');
      assert.ok(bestMatch.score >= 80, 'Score should be high >= 80%');
      assert.ok(bestMatch.reasons.some(r => r.includes('Exact match')), 'Reasons should include exact amount match');

      const ignoreRes = await fetch(`${BASE_URL}/api/billing/bank-transactions/${queueTx.id}/ignore`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      assert.strictEqual(ignoreRes.status, 200);
      
      const checkTxRes = await fetch(`${BASE_URL}/api/billing/bank-transactions?status=Ignored`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      const checkTxData = await checkTxRes.json();
      const ignoredTx = checkTxData.transactions.find(t => t.id === queueTx.id);
      assert.ok(ignoredTx, 'Transaction should now be in Ignored status');

      const returnRes = await fetch(`${BASE_URL}/api/billing/bank-transactions/${queueTx.id}/return-to-queue`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      assert.strictEqual(returnRes.status, 200);

      const matchConfirmRes = await fetch(`${BASE_URL}/api/billing/bank-transactions/${queueTx.id}/approve-match`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token1}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ invoice_id: createdInvoice.id })
      });
      assert.strictEqual(matchConfirmRes.status, 200, 'Approve match should succeed');
      const matchConfirmData = await matchConfirmRes.json();
      assert.strictEqual(matchConfirmData.status_after, 'Match Approved', 'Status should be Match Approved');

      // Assert invoice balance, status and amount_paid did NOT change
      const checkInvoiceRes = await fetch(`${BASE_URL}/api/invoices`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      const checkInvoicesList = await checkInvoiceRes.json();
      const updatedInvoice = checkInvoicesList.find(i => Number(i.id) === Number(createdInvoice.id));
      assert.ok(updatedInvoice, 'Invoice should exist');
      assert.strictEqual(updatedInvoice.status, 'draft', 'Invoice status must remain draft');
      assert.strictEqual(Number(updatedInvoice.balance), 12000, 'Invoice balance must remain unchanged');
      assert.strictEqual(Number(updatedInvoice.amount_paid), 0, 'Invoice amount_paid must remain 0');

      // Assert no payment was created in the REST API
      const paymentsRes = await fetch(`${BASE_URL}/api/payments`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      const paymentsList = await paymentsRes.json();
      const matchingPayment = paymentsList.find(p => p.reference_number === mpesaCode);
      assert.ok(!matchingPayment, 'No payment record should be created in transactions table');

      // Direct DB assertions (for postgres backend)
      const dbClient = new pg.Client({ connectionString: dbUrl });
      await dbClient.connect();
      try {
        const txsCount = await dbClient.query('SELECT COUNT(*)::int FROM transactions WHERE reference_number = $1', [mpesaCode]);
        assert.strictEqual(txsCount.rows[0].count, 0, 'No transactions row should be inserted in database');

        const allocationsCount = await dbClient.query('SELECT COUNT(*)::int FROM payment_allocations WHERE invoice_id = $1', [createdInvoice.id]);
        assert.strictEqual(allocationsCount.rows[0].count, 0, 'No payment_allocations row should be inserted in database');

        const decisions = await dbClient.query('SELECT * FROM bank_reconciliation_decisions WHERE bank_transaction_id = $1', [queueTx.id]);
        assert.strictEqual(decisions.rows.length, 1, 'Exactly one decision record should be created');
        assert.strictEqual(decisions.rows[0].invoice_id, String(createdInvoice.id), 'Decision invoice_id should match');
        assert.strictEqual(decisions.rows[0].status, 'pending', 'Decision status should be pending');
      } finally {
        await dbClient.end();
      }

      const searchRes = await fetch(`${BASE_URL}/api/billing/reconciliation/search-candidates?q=${targetTenant.full_name.substring(0, 4)}`, {
        headers: { 'Authorization': `Bearer ${token1}` }
      });
      assert.strictEqual(searchRes.status, 200);
      const searchCandidates = await searchRes.json();
      assert.ok(searchCandidates.length > 0, 'Should find search candidates by tenant name');

      console.log('✓ Bank Reconciliation Queue & Intelligent Matching verified successfully.');
    }

  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

import pg from 'pg';

function cleanJsonDb() {
  const dbPath = path.resolve('server/data/db.json');
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    data.statement_uploads = [];
    data.statement_extracted_transactions = [];
    data.confirmed_statement_transactions = [];
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
    console.log('JSON DB tables truncated successfully.');
  } catch (err) {
    console.error('Failed to clean JSON DB:', err.message);
  }
}

async function cleanPostgresDb(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('TRUNCATE TABLE confirmed_statement_transactions CASCADE');
    await client.query('TRUNCATE TABLE statement_extracted_transactions CASCADE');
    await client.query('TRUNCATE TABLE statement_uploads CASCADE');
    console.log('PostgreSQL tables truncated successfully.');
  } catch (err) {
    console.error('Failed to truncate PostgreSQL tables:', err.message);
  } finally {
    await client.end();
  }
}

async function runAllBackendSuites() {
  // Clean JSON DB
  cleanJsonDb();
  // Test JSON fallback backend
  await runBackendSuite('json');

  // Test Postgres backend
  const pgDbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/smart_landlord_test';
  await cleanPostgresDb(pgDbUrl);
  await runBackendSuite('postgres', pgDbUrl);

  console.log('\n======================================================');
  console.log('ALL INTEGRATION HARDENING TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================');
}

runAllBackendSuites().catch(err => {
  console.error('\nHardening test suite failed:', err);
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  process.exit(1);
});
