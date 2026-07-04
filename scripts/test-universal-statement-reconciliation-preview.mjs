import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { db as localDb } from '../server/db.js';
import { StatementIngestionService } from '../server/services/payment-evidence/StatementIngestionService.js';

async function runTests() {
  console.log('Running Universal Statement Ingestion Service tests...');

  // Mock Db
  const mockDb = {
    async find(table) {
      if (table === 'tenants') return [];
      if (table === 'invoices') return [];
      if (table === 'units') return [];
      if (table === 'properties') return [];
      if (table === 'payment_evidence') return [];
      if (table === 'transactions') return [];
      return [];
    }
  };

  // Test 1: File type detection
  console.log('Test 1: File type detection...');
  assert.strictEqual(StatementIngestionService.detectFileType('statement.csv'), 'CSV');
  assert.strictEqual(StatementIngestionService.detectFileType('bank_stmt.pdf'), 'PDF');
  assert.strictEqual(StatementIngestionService.detectFileType('financials.xlsx'), 'XLSX');
  assert.strictEqual(StatementIngestionService.detectFileType('data.xls'), 'XLS');
  assert.strictEqual(StatementIngestionService.detectFileType('report.docx'), 'DOCX');
  assert.strictEqual(StatementIngestionService.detectFileType('legacy.doc'), 'DOC');
  assert.strictEqual(StatementIngestionService.detectFileType('notes.txt'), 'TXT');
  assert.strictEqual(StatementIngestionService.detectFileType('image.png'), 'UNKNOWN');
  console.log('✓ File type detection passed.');

  // Test 2: Date normalization
  console.log('Test 2: Date normalization...');
  assert.strictEqual(StatementIngestionService.normalizeDate('2026-06-25'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('25/06/2026'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('25-06-2026'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('2026/06/25 10:00:00'), '2026-06-25');
  console.log('✓ Date normalization passed.');

  // Test 3: Provider detection heuristics
  console.log('Test 3: Provider detection heuristics...');
  const mpesaText = 'Safaricom M-PESA Statement Receipt No. RFG2P3Q98M Completion Time Paid In KES';
  assert.strictEqual(StatementIngestionService.detectProvider(mpesaText, 'statement.pdf').provider, 'MPESA');

  const loopText = 'LOOP Ref via NCBA WLTBNK Customer Number';
  assert.strictEqual(StatementIngestionService.detectProvider(loopText, 'loop.pdf').provider, 'LOOP_STATEMENT');

  const genericText = 'Value Date Transaction Date Particulars Debit Credit Balance';
  assert.strictEqual(StatementIngestionService.detectProvider(genericText, 'statement.csv').provider, 'GENERIC_BANK');
  console.log('✓ Provider detection heuristics passed.');

  // Test 4: Text-based unstructured parsing
  console.log('Test 4: Text-based unstructured parsing...');
  const txtData = '2026-06-04 RFG2P3Q98M Deposit KES 30000.00 Rent payment received\n2026-06-05 KCB12345 Debit KES 1500.00 Transaction fee';
  const parsedTxt = StatementIngestionService.parseUnstructuredText(txtData, 'TXT', 'GENERIC_BANK');
  assert.strictEqual(parsedTxt.length, 2);
  assert.strictEqual(parsedTxt[0].transaction_code, 'RFG2P3Q98M');
  assert.strictEqual(parsedTxt[0].amount, 30000);
  assert.strictEqual(parsedTxt[0].direction, 'money_in');
  assert.strictEqual(parsedTxt[1].transaction_code, 'KCB12345');
  assert.strictEqual(parsedTxt[1].amount, 1500);
  assert.strictEqual(parsedTxt[1].direction, 'money_out');
  console.log('✓ Text-based unstructured parsing passed.');

  // Test 5: CSV preview ingestion
  console.log('Test 5: CSV preview ingestion...');
  const csvBuffer = Buffer.from('date,amount,code,payer,narration\n2026-06-04,30000,RFG2P3Q98M,Alice Wambui,Rent payment', 'utf8');
  const csvResult = await StatementIngestionService.preview(csvBuffer, 'statement.csv', 1, mockDb);
  assert.strictEqual(csvResult.success, true);
  assert.strictEqual(csvResult.source_format, 'CSV');
  assert.strictEqual(csvResult.financial_mutation, false);
  assert.strictEqual(csvResult.summary.rows_detected, 1);
  assert.strictEqual(csvResult.preview_rows[0].transaction_code, 'RFG2P3Q98M');
  assert.strictEqual(csvResult.preview_rows[0].amount, 30000);
  console.log('✓ CSV preview ingestion passed.');

  // Test 6: Legacy DOC format rejection
  console.log('Test 6: Legacy DOC format rejection...');
  const docBuffer = Buffer.from([0, 1, 2, 3]);
  const docResult = await StatementIngestionService.preview(docBuffer, 'legacy.doc', 1, mockDb);
  assert.strictEqual(docResult.success, false);
  assert.strictEqual(docResult.parser_status, 'legacy_doc_not_supported');
  console.log('✓ Legacy DOC format rejection passed.');

  console.log('All Universal Ingestion Service tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
