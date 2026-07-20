import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { db as localDb } from '../server/db.js';
import { StatementIngestionService } from '../server/services/payment-evidence/StatementIngestionService.js';

async function runTests() {
  console.log('Running Universal Statement Ingestion Service tests...');

  // Mock Db
  let mutationDetected = false;
  const mockDb = {
    async find(table) {
      if (table === 'tenants') {
        return [
          { id: 101, full_name: 'Alice Wambui', phone_number: '0712345678', tenant_account_number: 'ACC-101', unit_id: 1, status: 'active' },
          { id: 102, full_name: 'Bob Mwangi', phone_number: '0722998877', tenant_account_number: 'ACC-102', unit_id: 2, status: 'active' }
        ];
      }
      if (table === 'invoices') {
        return [
          { id: 501, tenant_id: 101, invoice_number: 'INV-501', due_date: '2026-06-01', total: 30000, balance: 30000, status: 'unpaid' },
          { id: 502, tenant_id: 102, invoice_number: 'INV-502', due_date: '2026-06-01', total: 15000, balance: 15000, status: 'unpaid' }
        ];
      }
      if (table === 'units') return [{ id: 1, unit_code: 'A1', property_id: 10 }, { id: 2, unit_code: 'B2', property_id: 10 }];
      if (table === 'properties') return [{ id: 10, name: 'Sunburst Apartments' }];
      if (table === 'payment_evidence') return [];
      if (table === 'transactions') return [];
      return [];
    },
    async insert() { mutationDetected = true; },
    async update() { mutationDetected = true; },
    async delete() { mutationDetected = true; }
  };

  // Test 1: File type detection (with extension & magic bytes)
  console.log('Test 1: File type detection...');
  assert.strictEqual(StatementIngestionService.detectFileType('statement.csv'), 'CSV');
  assert.strictEqual(StatementIngestionService.detectFileType('bank_stmt.pdf'), 'PDF');
  assert.strictEqual(StatementIngestionService.detectFileType('financials.xlsx'), 'XLSX');
  assert.strictEqual(StatementIngestionService.detectFileType('data.xls'), 'XLS');
  assert.strictEqual(StatementIngestionService.detectFileType('report.docx'), 'DOCX');
  assert.strictEqual(StatementIngestionService.detectFileType('legacy.doc'), 'DOC');
  assert.strictEqual(StatementIngestionService.detectFileType('notes.txt'), 'TXT');
  assert.strictEqual(StatementIngestionService.detectFileType('image.png'), 'UNKNOWN');

  // Magic bytes checks
  const pdfMagicBuffer = Buffer.from('%PDF-1.4 header text');
  assert.strictEqual(StatementIngestionService.detectFileType('unknown.bin', pdfMagicBuffer), 'PDF');
  const zipMagicBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
  assert.strictEqual(StatementIngestionService.detectFileType('data.xlsx', zipMagicBuffer), 'XLSX');
  assert.strictEqual(StatementIngestionService.detectFileType('doc.docx', zipMagicBuffer), 'DOCX');
  console.log('✓ File type detection passed.');

  // Test 2: Date normalization
  console.log('Test 2: Date normalization...');
  assert.strictEqual(StatementIngestionService.normalizeDate('2026-06-25'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('25/06/2026'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('25-06-2026'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('2026/06/25 10:00:00'), '2026-06-25');
  assert.strictEqual(StatementIngestionService.normalizeDate('15 Jun 2026'), '2026-06-15');
  assert.strictEqual(StatementIngestionService.normalizeDate('15 June 2026'), '2026-06-15');
  console.log('✓ Date normalization passed.');

  // Test 3: Provider detection heuristics
  console.log('Test 3: Provider detection heuristics...');
  const mpesaText = 'Safaricom M-PESA Statement Receipt No. RFG2P3Q98M Completion Time Paid In KES';
  assert.strictEqual(StatementIngestionService.detectProvider(mpesaText, 'statement.pdf').provider, 'MPESA');

  const loopText = 'LOOP Ref via NCBA WLTBNK Customer Number Account Statement';
  assert.strictEqual(StatementIngestionService.detectProvider(loopText, 'loop.pdf').provider, 'LOOP_STATEMENT');

  const coopText = 'Co-operative Bank STATEMENT OF ACCOUNT KCOOKENA Money In';
  assert.strictEqual(StatementIngestionService.detectProvider(coopText, 'coop.pdf').provider, 'COOP_BANK_STATEMENT');

  const kcbText = 'Kenya Commercial Bank KCB Account Statement Debit Credit Balance';
  assert.strictEqual(StatementIngestionService.detectProvider(kcbText, 'kcb.pdf').provider, 'KCB_BANK_STATEMENT');

  const equityText = 'Equity Bank Transaction Details Debit Credit Balance';
  assert.strictEqual(StatementIngestionService.detectProvider(equityText, 'equity.pdf').provider, 'EQUITY_BANK_STATEMENT');

  const absaText = 'Absa Barclays Transaction Details Debit Credit Balance';
  assert.strictEqual(StatementIngestionService.detectProvider(absaText, 'absa.pdf').provider, 'ABSA_BANK_STATEMENT');

  const genericText = 'Value Date Transaction Date Particulars Debit Credit Balance';
  assert.strictEqual(StatementIngestionService.detectProvider(genericText, 'statement.csv').provider, 'GENERIC_BANK_STATEMENT');
  console.log('✓ Provider detection heuristics passed.');

  // Test 4: Text-based unstructured parsing
  console.log('Test 4: Text-based unstructured parsing...');
  const txtData = '2026-06-04 RFG2P3Q98M Deposit KES 30000.00 Rent payment received\n2026-06-05 KCB12345 Debit KES 1500.00 Transaction fee';
  const parsedTxt = StatementIngestionService.parseUnstructuredText(txtData, 'TXT', 'GENERIC_BANK_STATEMENT');
  assert.strictEqual(parsedTxt.length, 2);
  assert.strictEqual(parsedTxt[0].transaction_code, 'RFG2P3Q98M');
  assert.strictEqual(parsedTxt[0].amount, 30000);
  assert.strictEqual(parsedTxt[0].direction, 'money_in');
  assert.strictEqual(parsedTxt[1].transaction_code, 'KCB12345');
  assert.strictEqual(parsedTxt[1].amount, 1500);
  assert.strictEqual(parsedTxt[1].direction, 'money_out');
  console.log('✓ Text-based unstructured parsing passed.');

  // Test 5: CSV preview ingestion & matching suggestions
  console.log('Test 5: CSV preview ingestion & matching suggestions...');
  const csvBuffer = Buffer.from('date,amount,code,payer,narration\n2026-06-04,30000,RFG2P3Q98M,Alice Wambui,INV-501 Rent payment\n2026-06-05,150,FEE123,Bank,Bank charge fee', 'utf8');
  const csvResult = await StatementIngestionService.preview(csvBuffer, 'statement.csv', 1, mockDb);
  assert.strictEqual(csvResult.success, true);
  assert.strictEqual(csvResult.source_format, 'CSV');
  assert.strictEqual(csvResult.financial_mutation, false);
  assert.strictEqual(csvResult.summary.rows_detected, 2);
  assert.strictEqual(csvResult.summary.rows_ready_for_review, 1);
  assert.strictEqual(csvResult.summary.rows_ignored, 1);
  assert.strictEqual(csvResult.preview_rows[0].transaction_code, 'RFG2P3Q98M');
  assert.strictEqual(csvResult.preview_rows[0].amount, 30000);
  assert.strictEqual(csvResult.preview_rows[0].suggested_matches.length, 1);
  assert.strictEqual(csvResult.preview_rows[0].suggested_matches[0].invoice_number, 'INV-501');
  assert.strictEqual(csvResult.preview_rows[1].row_status, 'ignored');
  assert.strictEqual(mutationDetected, false);
  console.log('✓ CSV preview ingestion passed.');

  // Test 6: Empty file handling
  console.log('Test 6: Empty file handling...');
  const emptyBuffer = Buffer.from('', 'utf8');
  const emptyResult = await StatementIngestionService.preview(emptyBuffer, 'empty.csv', 1, mockDb);
  assert.strictEqual(emptyResult.success, true);
  assert.strictEqual(emptyResult.summary.rows_detected, 0);
  assert.strictEqual(emptyResult.preview_rows.length, 0);
  console.log('✓ Empty file handling passed.');

  // Test 7: Scanned PDF handling
  console.log('Test 7: Scanned PDF handling...');
  const scannedPdfBuffer = Buffer.from('%PDF-1.4 fake scanned pdf with no text', 'utf8');
  const scannedResult = await StatementIngestionService.preview(scannedPdfBuffer, 'scanned.pdf', 1, mockDb);
  assert.strictEqual(scannedResult.success, false);
  assert.strictEqual(scannedResult.parser_status, 'scanned_pdf_needs_ocr');
  console.log('✓ Scanned PDF handling passed.');

  // Test 8: Legacy DOC format rejection
  console.log('Test 8: Legacy DOC format rejection...');
  const docBuffer = Buffer.from([0, 1, 2, 3]);
  const docResult = await StatementIngestionService.preview(docBuffer, 'legacy.doc', 1, mockDb);
  assert.strictEqual(docResult.success, false);
  assert.strictEqual(docResult.parser_status, 'legacy_doc_not_supported');
  console.log('✓ Legacy DOC format rejection passed.');

  // Test 9: Financial safety confirmation
  console.log('Test 9: Financial safety confirmation...');
  assert.strictEqual(mutationDetected, false);
  console.log('✓ Financial safety confirmation passed.');

  console.log('All Universal Ingestion Service tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
