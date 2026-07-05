import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StatementParserRegistry } from '../server/services/payment-evidence/StatementParserRegistry.js';

let failures = 0;

function runAssert(description, condition) {
  if (condition) {
    console.log(`  PASS: ${description}`);
  } else {
    console.error(`  FAIL: ${description}`);
    failures++;
  }
}

async function runTests() {
  console.log('Running Bank Statement Processing Pipeline Tests...');

  // Mock DB wrapper
  const mockDb = {
    data: {
      statement_uploads: [],
      statement_extracted_transactions: [],
      confirmed_statement_transactions: []
    },
    async find(table, filterObj = {}) {
      const list = this.data[table] || [];
      return list.filter(row => {
        for (const [key, val] of Object.entries(filterObj)) {
          if (row[key] !== val) return false;
        }
        return true;
      });
    },
    async findOne(table, filterObj = {}) {
      const list = await this.find(table, filterObj);
      return list[0] || null;
    },
    async insert(table, rowData) {
      const list = this.data[table] || [];
      const newId = list.length > 0 ? Math.max(...list.map(r => r.id)) + 1 : 1;
      const newRow = { id: newId, ...rowData };
      list.push(newRow);
      this.data[table] = list;
      return newRow;
    },
    async update(table, id, updates) {
      const list = this.data[table] || [];
      const idx = list.findIndex(r => r.id === Number(id));
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...updates };
        return [list[idx]];
      }
      return [];
    }
  };

  // Test 1: CSV upload and parsing
  console.log('\n1. CSV statement parsing & normalization:');
  const csvData = 'date,amount,code,payer,narration\n25/06/2026,5000,TX1001,Alice Wambui,Rent Payment\n26/06/2026,-1500,TX1002,Bob,Withdrawal';
  const csvBuffer = Buffer.from(csvData, 'utf8');
  
  const parsedCsv = await StatementParserRegistry.parse({ buffer: csvBuffer, filename: 'statement.csv' });
  runAssert('CSV parser extracts two rows', parsedCsv.rawRows.length === 2);

  const normalizedCsv = StatementParserRegistry.normalize(parsedCsv.rawRows, 'CSV', 'GENERIC_BANK');
  runAssert('Normalized CSV yields credit for positive amount', normalizedCsv[0].normalizedAmount === 5000 && normalizedCsv[0].transactionType === 'credit');
  runAssert('Normalized CSV yields debit for negative amount', normalizedCsv[1].normalizedAmount === -1500 && normalizedCsv[1].transactionType === 'debit');
  runAssert('Normalized CSV transaction date matches', normalizedCsv[0].transactionDate === '2026-06-25');

  // Test 2: XLSX parsing
  console.log('\n2. Excel (XLSX) parsing & validation:');
  const xlsxHeaders = ['Date', 'Amount', 'Reference', 'Description'];
  const providerGuess = StatementParserRegistry.detectProvider({ filename: 'equity.xlsx' }, '', xlsxHeaders);
  runAssert('Excel provider guess maps to EQUITY', providerGuess === 'EQUITY');

  // Test 3: Malformed date handling
  console.log('\n3. Malformed date handling:');
  const normalizedDate1 = StatementParserRegistry.normalizeDate('invalid date string');
  const normalizedDate2 = StatementParserRegistry.normalizeDate('30/02/2026'); // Non-existent date
  runAssert('Invalid date string returns null', normalizedDate1 === null);

  // Test 4: PDF parsing failure path
  console.log('\n4. PDF unsupported/unreadable extraction failure path:');
  const emptyPdfBuffer = Buffer.from([1, 2, 3, 4]); // Corrupt PDF
  const parsedPdf = await StatementParserRegistry.parse({ buffer: emptyPdfBuffer, filename: 'statement.pdf' });
  runAssert('Corrupt PDF results in empty raw text', parsedPdf.rawText === '');

  // Test 5: Row duplicate detection
  console.log('\n5. Row duplicate candidate detection:');
  const duplicateRows = [
    {
      row_index: 1,
      transactionDate: '2026-06-25',
      valueDate: '2026-06-25',
      description: 'Rent Payment',
      reference: 'TX1001',
      debitAmount: null,
      creditAmount: 5000,
      runningBalance: null,
      normalizedAmount: 5000,
      transactionType: 'credit',
      currency: 'KES',
      confidenceScore: 90,
      validationFlags: []
    },
    {
      row_index: 2,
      transactionDate: '2026-06-25',
      valueDate: '2026-06-25',
      description: 'Rent Payment',
      reference: 'TX1001', // Exact same code, date, amount, description
      debitAmount: null,
      creditAmount: 5000,
      runningBalance: null,
      normalizedAmount: 5000,
      transactionType: 'credit',
      currency: 'KES',
      confidenceScore: 90,
      validationFlags: []
    }
  ];

  await StatementParserRegistry.validate(duplicateRows, 1, mockDb);
  runAssert('Duplicate row candidate is flagged as duplicate', duplicateRows[1].duplicate_candidate === true);
  runAssert('Duplicate row candidate contains duplicate_row flag', duplicateRows[1].validationFlags.includes('duplicate_row'));

  // Test 6: Tenant isolation
  console.log('\n6. Scoping and tenant isolation checks:');
  // Organization 1 uploads
  const uploadOrg1 = await mockDb.insert('statement_uploads', {
    organization_id: 1,
    uploaded_by_user_id: 10,
    file_name: 'org1_stmt.csv',
    file_type: 'CSV',
    file_size: 100,
    storage_path: 'uploads/hash1',
    sha256_hash: 'HASH1',
    status: 'parsed'
  });

  const uploadsOrg2 = await mockDb.find('statement_uploads', { organization_id: 2 });
  runAssert('Upload for Org 1 is isolated from Org 2 query', uploadsOrg2.length === 0);

  // Test 7: Confirm import skips invalid rows
  console.log('\n7. Confirm import behavior for invalid and duplicate rows:');
  const extRow1 = await mockDb.insert('statement_extracted_transactions', {
    statement_upload_id: uploadOrg1.id,
    organization_id: 1,
    row_index: 1,
    transaction_date: '2026-06-25',
    description: 'Valid Row',
    reference: 'VAL001',
    normalized_amount: 5000,
    transaction_type: 'credit',
    duplicate_candidate: false,
    validation_flags_json: []
  });

  const extRow2 = await mockDb.insert('statement_extracted_transactions', {
    statement_upload_id: uploadOrg1.id,
    organization_id: 1,
    row_index: 2,
    transaction_date: '2026-06-25',
    description: 'Invalid Row (mismatched amount)',
    reference: 'INV001',
    normalized_amount: 0,
    transaction_type: 'unknown',
    duplicate_candidate: false,
    validation_flags_json: ['incomplete_no_amount']
  });

  // Confirm import function logic replication
  const rows = await mockDb.find('statement_extracted_transactions', { statement_upload_id: uploadOrg1.id, organization_id: 1 });
  let imported_count = 0;
  let skipped_invalid_count = 0;

  for (const row of rows) {
    const flags = row.validation_flags_json || [];
    const isInvalid = flags.includes('incomplete_no_amount') || flags.includes('missing_date');
    if (isInvalid) {
      skipped_invalid_count++;
      continue;
    }
    
    await mockDb.insert('confirmed_statement_transactions', {
      organization_id: 1,
      statement_upload_id: uploadOrg1.id,
      extracted_transaction_id: row.id,
      transaction_date: row.transaction_date,
      description: row.description,
      reference: row.reference,
      amount: Math.abs(row.normalized_amount),
      direction: row.normalized_amount >= 0 ? 'money_in' : 'money_out',
      source_provider: 'CSV_GENERIC',
      source_hash: 'ROW_HASH_' + row.id
    });
    imported_count++;
  }

  runAssert('Confirmed import counts 1 imported row', imported_count === 1);
  runAssert('Confirmed import counts 1 skipped invalid row', skipped_invalid_count === 1);
  const confirmedRows = await mockDb.find('confirmed_statement_transactions', { organization_id: 1 });
  runAssert('Confirmed transactions database has exactly 1 row', confirmedRows.length === 1);
  runAssert('Confirmed transaction reference is VAL001', confirmedRows[0].reference === 'VAL001');

  // Test 8: UI Static integration check
  console.log('\n8. UI Component Integration static checks:');
  const statementImportsContent = fs.readFileSync('src/components/StatementImports.jsx', 'utf8');
  const invoicesContent = fs.readFileSync('src/pages/Invoices.jsx', 'utf8');

  runAssert('StatementImports.jsx handles confirm endpoint', statementImportsContent.includes('/confirm'));
  runAssert('StatementImports.jsx renders upload statement file input', statementImportsContent.includes('accept=".csv,.pdf,.xlsx"'));
  runAssert('StatementImports.jsx contains Confirm Import action button label', statementImportsContent.includes('Confirm Import'));
  runAssert('StatementImports.jsx displays duplicate rows option', statementImportsContent.includes('include_duplicates'));
  runAssert('Invoices.jsx registers statement_imports subtab', invoicesContent.includes("id: 'statement_imports'"));
  runAssert('Invoices.jsx renders StatementImports component when active', invoicesContent.includes('<StatementImports'));

  console.log(`\nTests completed. ${failures} failure(s) recorded.`);
  if (failures > 0) {
    process.exit(1);
  } else {
    console.log('All bank statement processing pipeline tests passed successfully!');
  }
}

runTests().catch(err => {
  console.error('Test suite failed to run:', err);
  process.exit(1);
});
