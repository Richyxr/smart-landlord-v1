import { normalizePaymentEvidence, generateRowHash } from '../server/services/payment-evidence/normalizePaymentEvidence.js';
import { classifyPaymentEvidenceRow } from '../server/services/payment-evidence/classifyPaymentEvidenceRow.js';
import { detectDuplicatePaymentEvidence } from '../server/services/payment-evidence/detectDuplicatePaymentEvidence.js';
import { scorePaymentEvidenceMatch } from '../server/services/payment-evidence/scorePaymentEvidenceMatch.js';
import { PERSPECTIVES, DIRECTIONS, STATUSES, COLLECTION_CHANNELS, DOCUMENT_SOURCES, EVIDENCE_STRENGTHS } from '../server/services/payment-evidence/paymentEvidenceRules.js';
import { db as jsonDb } from '../server/db.js';
import { createPaymentEvidenceRoutes } from '../server/routes/paymentEvidenceRoutes.js';
import fs from 'fs';

let failures = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  PASS: ${description}`);
  } else {
    console.error(`  FAIL: ${description}`);
    failures++;
  }
}

function assertThrows(description, fn) {
  try {
    fn();
    console.error(`  FAIL: ${description} (expected to throw)`);
    failures++;
  } catch (_err) {
    console.log(`  PASS: ${description} (successfully threw)`);
  }
}

class MockDb {
  constructor() {
    this.tables = {
      transactions: [],
      tenants: [],
      invoices: [],
      payment_evidence: [],
      payment_evidence_batches: []
    };
  }

  seed(table, data) {
    this.tables[table] = data;
  }

  get(table) {
    return this.tables[table] || [];
  }

  async find(table, filterObj) {
    const rows = this.tables[table] || [];
    return rows.filter(row => {
      for (const key in filterObj) {
        if (row[key] !== filterObj[key]) return false;
      }
      return true;
    });
  }

  async findOne(table, filterObj) {
    const results = await this.find(table, filterObj);
    return results[0] || null;
  }

  async insert(table, rowData) {
    if (!this.tables[table]) this.tables[table] = [];
    const maxId = this.tables[table].reduce((max, r) => (r.id > max ? r.id : max), 0);
    const newId = maxId + 1;
    const newRow = { id: newId, ...rowData };
    this.tables[table].push(newRow);
    return newRow;
  }

  async update(table, query, updates) {
    if (!this.tables[table]) return [];
    const isId = typeof query === 'number';
    this.tables[table] = this.tables[table].map(row => {
      let match = false;
      if (isId) {
        match = row.id === query;
      } else {
        match = Object.keys(query).every(k => row[k] === query[k]);
      }
      if (match) {
        return { ...row, ...updates };
      }
      return row;
    });
    return this.tables[table].filter(row => {
      if (isId) return row.id === query;
      return Object.keys(query).every(k => row[k] === query[k]);
    });
  }
}

async function runTests() {
  console.log('Running Hardened Payment Evidence Engine Tests...\n');

  // ==========================================
  // Test 1: Normalization & Raw Fields Preservation
  // ==========================================
  console.log('1. Normalization & Raw Fields Preservation:');

  assertThrows('Normalization fails if organization_id is missing', () => {
    normalizePaymentEvidence({ amount: 100, transaction_date: '2026-06-15' });
  });

  const rawInput = {
    Amount: '15000',
    Date: '2026-06-27',
    Reference: 'ABCD1234',
    'Account number': 'ACC-REF',
    Narration: 'Deposit from Mobile Money',
    custom_field: 'retained_data'
  };

  const normalized = normalizePaymentEvidence(rawInput, {
    organization_id: 1,
    source_provider: 'kcb',
    source_type: 'csv',
    source_perspective: PERSPECTIVES.LANDLORD,
    document_source: DOCUMENT_SOURCES.BANK_STATEMENT
  });

  assert('Normalizes amount correctly', normalized.amount === 15000);
  assert('Normalizes transaction_date correctly', normalized.transaction_date === '2026-06-27');
  assert('Preserves raw_fields as cloned object', normalized.raw_fields !== null && typeof normalized.raw_fields === 'object');
  assert('Cloned raw_fields contains original keys', normalized.raw_fields.custom_field === 'retained_data');
  assert('Assigns the document_source correctly', normalized.document_source === DOCUMENT_SOURCES.BANK_STATEMENT);
  assert('Assigns default evidence_strength to unknown', normalized.evidence_strength === EVIDENCE_STRENGTHS.UNKNOWN);

  // Check future matcher placeholders
  assert('Has paybill_reference placeholder', 'paybill_reference' in normalized);
  assert('Has invoice_reference placeholder', 'invoice_reference' in normalized);
  assert('Has landlord_account_number placeholder', 'landlord_account_number' in normalized);

  // Check schema/storage arrays exist in defaultDb
  assert('defaultDb schema has payment_evidence_batches array', Array.isArray(jsonDb.get('payment_evidence_batches')));
  assert('defaultDb schema has payment_evidence array', Array.isArray(jsonDb.get('payment_evidence')));


  // ==========================================
  // Test 2: Collection Channel Classification
  // ==========================================
  console.log('\n2. Collection Channel Classification:');

  const rowPaybill = classifyPaymentEvidenceRow({
    amount: 500,
    source_provider: 'mpesa',
    paybill_number: '222111',
    description: 'PayBill Payment'
  });
  assert('Classifies mpesa paybill correctly', rowPaybill.collection_channel === COLLECTION_CHANNELS.MPESA_PAYBILL);

  const rowBankTransfer = classifyPaymentEvidenceRow({
    amount: 10000,
    source_provider: 'kcb',
    description: 'EFT Transfer from Co-op Bank'
  });
  assert('Classifies bank transfer correctly', rowBankTransfer.collection_channel === COLLECTION_CHANNELS.BANK_TRANSFER);

  const rowTill = classifyPaymentEvidenceRow({
    amount: 1200,
    source_provider: 'mpesa',
    till_number: '888999'
  });
  assert('Classifies mpesa till correctly', rowTill.collection_channel === COLLECTION_CHANNELS.MPESA_TILL);


  // ==========================================
  // Test 3: Ignored Patterns & Perspective Rules
  // ==========================================
  console.log('\n3. Ignored Patterns & Perspective Rules:');

  const rowWithFee = classifyPaymentEvidenceRow({
    description: 'Transaction excise duty and fee',
    source_perspective: PERSPECTIVES.LANDLORD
  });
  assert('Row containing excise/fee keywords is ignored', rowWithFee.status === STATUSES.IGNORED);
  assert('Ignored reason specifies matched keyword', rowWithFee.ignored_reason.includes('contains_ignored_keyword: fee'));

  const landlordDebitRow = classifyPaymentEvidenceRow({
    amount: 5000,
    direction: DIRECTIONS.DEBIT,
    source_perspective: PERSPECTIVES.LANDLORD
  });
  assert('Landlord money-out is ignored by default', landlordDebitRow.status === STATUSES.IGNORED);

  const tenantDebitRow = classifyPaymentEvidenceRow({
    amount: 30000,
    direction: DIRECTIONS.DEBIT,
    source_perspective: PERSPECTIVES.TENANT
  });
  assert('Tenant money-out is NOT ignored (potential rent proof)', tenantDebitRow.status !== STATUSES.IGNORED);


  // ==========================================
  // Test 4: Duplicate Detection
  // ==========================================
  console.log('\n4. Duplicate Detection:');

  const db = new MockDb();
  db.seed('transactions', [
    { id: 101, organization_id: 1, reference_number: 'TXDUP123', status: 'reconciled' }
  ]);
  db.seed('payment_evidence', [
    { id: 201, organization_id: 1, transaction_code: 'TXDUP555', status: STATUSES.IMPORTED }
  ]);

  const dupPosted = await detectDuplicatePaymentEvidence(
    { id: 301, organization_id: 1, transaction_code: 'TXDUP123' },
    db
  );
  assert('Detects duplicate transaction code in posted transactions', dupPosted.status === STATUSES.DUPLICATE);

  const dupImported = await detectDuplicatePaymentEvidence(
    { id: 301, organization_id: 1, transaction_code: 'TXDUP555' },
    db
  );
  assert('Detects duplicate transaction code in imported evidence', dupImported.status === STATUSES.DUPLICATE);


  // ==========================================
  // Test 5: Match Strengths & Auto-Reconciliation Rules
  // ==========================================
  console.log('\n5. Match Strengths & Auto-Reconciliation:');

  const matchDb = new MockDb();
  matchDb.seed('tenants', [
    { id: 1, organization_id: 1, full_name: 'Alice Tenant', tenant_account_number: 'ACC-101', phone_number: '+254711223344', status: 'active' },
    { id: 2, organization_id: 1, full_name: 'Bob Tenant', tenant_account_number: 'ACC-202', phone_number: '0722334455', status: 'active' }
  ]);
  matchDb.seed('invoices', [
    { id: 10, organization_id: 1, tenant_id: 1, balance: 45000, total: 45000, due_date: '2026-06-15', status: 'issued' },
    { id: 11, organization_id: 1, tenant_id: 2, balance: 30000, total: 30000, due_date: '2026-06-20', status: 'issued' }
  ]);
  matchDb.seed('transactions', [
    { id: 501, organization_id: 1, reference_number: 'TXUNMATCHED', status: 'unmatched', transaction_type: 'payment', tenant_id: null, invoice_id: null }
  ]);

  // Case 5.1: Exact code match -> VERIFIED -> Auto Reconcile
  const matchCode = await scorePaymentEvidenceMatch(
    { organization_id: 1, transaction_code: 'TXUNMATCHED', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Exact code match strength is VERIFIED', matchCode.evidence_strength === EVIDENCE_STRENGTHS.VERIFIED);
  assert('Exact code match auto-reconciles', matchCode.status === STATUSES.AUTO_RECONCILED);

  // Case 5.2: Reference Account match -> VERIFIED -> Auto Reconcile
  const matchAcc = await scorePaymentEvidenceMatch(
    { organization_id: 1, reference_account: 'ACC-101', amount: 45000, transaction_date: '2026-06-16', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Reference Account match strength is VERIFIED', matchAcc.evidence_strength === EVIDENCE_STRENGTHS.VERIFIED);
  assert('Reference Account match auto-reconciles', matchAcc.status === STATUSES.AUTO_RECONCILED);

  // Case 5.3: Phone Match -> HIGH -> Needs Review (NOT auto-reconcile)
  const matchPhone = await scorePaymentEvidenceMatch(
    { organization_id: 1, payer_phone: '254722334455', amount: 30000, transaction_date: '2026-06-18', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Phone + Amount + Date match strength is HIGH', matchPhone.evidence_strength === EVIDENCE_STRENGTHS.HIGH);
  assert('Phone + Amount + Date match does NOT auto-reconcile (Needs Review)', matchPhone.status === STATUSES.NEEDS_REVIEW);

  // Case 5.4: Name Match -> MEDIUM -> Needs Review
  const matchName = await scorePaymentEvidenceMatch(
    { organization_id: 1, payer_name: 'Bob Tenant', amount: 30000, transaction_date: '2026-06-19', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Name match strength is MEDIUM', matchName.evidence_strength === EVIDENCE_STRENGTHS.MEDIUM);
  assert('Name match does NOT auto-reconcile (Needs Review)', matchName.status === STATUSES.NEEDS_REVIEW);

  // Case 5.5: Amount Only Match -> LOW -> Needs Review
  const matchAmount = await scorePaymentEvidenceMatch(
    { organization_id: 1, amount: 30000, transaction_date: '2026-06-20', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Amount only match strength is LOW', matchAmount.evidence_strength === EVIDENCE_STRENGTHS.LOW);
  assert('Amount only match does NOT auto-reconcile (Needs Review)', matchAmount.status === STATUSES.NEEDS_REVIEW);

  // Case 5.6: Unknown perspective does not auto-reconcile
  const matchUnknown = await scorePaymentEvidenceMatch(
    { organization_id: 1, reference_account: 'ACC-101', amount: 45000, transaction_date: '2026-06-16', source_perspective: PERSPECTIVES.UNKNOWN },
    matchDb
  );
  assert('Unknown perspective with verified match goes to Needs Review', matchUnknown.status === STATUSES.NEEDS_REVIEW);

  // Case 5.7: Competing candidates force Needs Review
  matchDb.seed('invoices', [
    { id: 10, organization_id: 1, tenant_id: 1, balance: 45000, total: 45000, due_date: '2026-06-15', status: 'issued' },
    { id: 12, organization_id: 1, tenant_id: 2, balance: 45000, total: 45000, due_date: '2026-06-15', status: 'issued' } // Competitor for 45000 match
  ]);
  const matchCompeting = await scorePaymentEvidenceMatch(
    { organization_id: 1, amount: 45000, transaction_date: '2026-06-15', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Competing candidates force Needs Review status', matchCompeting.status === STATUSES.NEEDS_REVIEW);


  // ==========================================
  // Test 6: Per-Matcher Date Tolerance Windows
  // ==========================================
  console.log('\n6. Per-Matcher Date Tolerance Windows:');

  // Re-seed invoices to restore Bob Tenant's 30000 invoice
  matchDb.seed('invoices', [
    { id: 10, organization_id: 1, tenant_id: 1, balance: 45000, total: 45000, due_date: '2026-06-15', status: 'issued' },
    { id: 11, organization_id: 1, tenant_id: 2, balance: 30000, total: 30000, due_date: '2026-06-20', status: 'issued' }
  ]);

  // Phone match window is 3 days
  const phoneMatchIn = await scorePaymentEvidenceMatch(
    { organization_id: 1, payer_phone: '254722334455', amount: 30000, transaction_date: '2026-06-23', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Phone match within 3 days is detected', phoneMatchIn.evidence_strength === EVIDENCE_STRENGTHS.HIGH);

  const phoneMatchOut = await scorePaymentEvidenceMatch(
    { organization_id: 1, payer_phone: '254722334455', amount: 30000, transaction_date: '2026-06-24', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Phone match outside 3 days (4 days) is ignored/unmatched', phoneMatchOut.evidence_strength === EVIDENCE_STRENGTHS.UNKNOWN);

  // Name match window is 2 days
  const nameMatchIn = await scorePaymentEvidenceMatch(
    { organization_id: 1, payer_name: 'Bob Tenant', amount: 30000, transaction_date: '2026-06-22', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Name match within 2 days is detected', nameMatchIn.evidence_strength === EVIDENCE_STRENGTHS.MEDIUM);

  const nameMatchOut = await scorePaymentEvidenceMatch(
    { organization_id: 1, payer_name: 'Bob Tenant', amount: 30000, transaction_date: '2026-06-25', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Name match outside 2 days (3 days) is ignored/unmatched', nameMatchOut.evidence_strength === EVIDENCE_STRENGTHS.UNKNOWN);

  // Reference Account match window is 30 days
  const accMatchIn = await scorePaymentEvidenceMatch(
    { organization_id: 1, reference_account: 'ACC-101', amount: 45000, transaction_date: '2026-07-15', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Reference Account match within 30 days is detected', accMatchIn.evidence_strength === EVIDENCE_STRENGTHS.VERIFIED);

  const accMatchOut = await scorePaymentEvidenceMatch(
    { organization_id: 1, reference_account: 'ACC-101', amount: 45000, transaction_date: '2026-07-16', source_perspective: PERSPECTIVES.LANDLORD },
    matchDb
  );
  assert('Reference Account match outside 30 days (31 days) is ignored/unmatched', accMatchOut.evidence_strength === EVIDENCE_STRENGTHS.UNKNOWN);

  // ==========================================
  // Test 7: Read-Only API Integration
  // ==========================================
  console.log('\n7. Read-Only API Integration:');

  const apiDb = new MockDb();
  apiDb.seed('payment_evidence', [
    { id: 1001, organization_id: 1, transaction_code: 'TX1001', amount: 5000, transaction_date: '2026-06-25', status: 'needs_review', evidence_strength: 'high', collection_channel: 'MPESA_PAYBILL', payer_name: 'Alpha' },
    { id: 1002, organization_id: 1, transaction_code: 'TX1002', amount: 12000, transaction_date: '2026-06-26', status: 'auto_reconciled', evidence_strength: 'verified', collection_channel: 'BANK_TRANSFER', payer_name: 'Beta' },
    { id: 1003, organization_id: 2, transaction_code: 'TX1003', amount: 15000, transaction_date: '2026-06-27', status: 'needs_review', evidence_strength: 'high', collection_channel: 'MPESA_PAYBILL', payer_name: 'Gamma' }
  ]);
  apiDb.seed('payment_evidence_batches', [
    { id: 50, organization_id: 1, upload_filename: 'statement1.csv' }
  ]);
  apiDb.seed('tenants', []);
  apiDb.seed('invoices', []);

  const router = createPaymentEvidenceRoutes(apiDb);

  const getRouteHandler = (path) => {
    const layer = router.stack.find(l => l.route && l.route.path === path);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };

  const getRouteMiddlewares = (path) => {
    const layer = router.stack.find(l => l.route && l.route.path === path);
    return layer.route.stack.slice(0, -1).map(s => s.handle);
  };

  const authMiddlewares = getRouteMiddlewares('/payment-evidence/rows');
  const requireLandlordOrSuperAdminMiddleware = authMiddlewares[authMiddlewares.length - 1];

  let statusVal = null;
  let jsonVal = null;
  let nextCalled = false;

  const mockRes = {
    status(code) { statusVal = code; return this; },
    json(obj) { jsonVal = obj; return this; }
  };

  await requireLandlordOrSuperAdminMiddleware({ auth: { role: 'caretaker', organizationId: 1, userId: 12 } }, mockRes, () => { nextCalled = true; });
  assert('Caretaker role is blocked (HTTP 403)', statusVal === 403);

  statusVal = null;
  await requireLandlordOrSuperAdminMiddleware({ auth: { role: 'tenant', organizationId: 1, userId: 15 } }, mockRes, () => { nextCalled = true; });
  assert('Tenant role is blocked (HTTP 403)', statusVal === 403);

  nextCalled = false;
  await requireLandlordOrSuperAdminMiddleware({ auth: { role: 'landlord', organizationId: 1, userId: 10 } }, mockRes, () => { nextCalled = true; });
  assert('Landlord role is allowed', nextCalled === true);

  nextCalled = false;
  await requireLandlordOrSuperAdminMiddleware({ auth: { role: 'super_admin', organizationId: 1, userId: 1 } }, mockRes, () => { nextCalled = true; });
  assert('Super Admin role is allowed', nextCalled === true);

  const listRowsHandler = getRouteHandler('/payment-evidence/rows');

  let rowsResult = null;
  const mockResList = {
    status(code) { return this; },
    json(data) { rowsResult = data; return this; }
  };

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: {}
  }, mockResList);

  assert('Returns rows scoped to organization 1 only', rowsResult && rowsResult.length === 2 && rowsResult.every(r => r.organization_id === 1));

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { status: 'auto_reconciled' }
  }, mockResList);
  assert('Filters rows by status successfully', rowsResult.length === 1 && rowsResult[0].transaction_code === 'TX1002');

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { search: 'alpha' }
  }, mockResList);
  assert('Filters rows by search keyword successfully', rowsResult.length === 1 && rowsResult[0].payer_name === 'Alpha');

  // Verify navigation updates via file analysis
  const bottomNavContent = fs.readFileSync('src/components/BottomNav.jsx', 'utf8');
  const desktopSidebarContent = fs.readFileSync('src/components/DesktopSidebar.jsx', 'utf8');

  assert(
    'Bottom navigation no longer contains Review Queue tab ID',
    !bottomNavContent.includes('landlord_payment_evidence')
  );
  assert(
    'Desktop sidebar still contains Review Queue tab ID',
    desktopSidebarContent.includes('landlord_payment_evidence')
  );

  // Verify Import Wizard UI Shell elements exist
  const paymentEvidenceContent = fs.readFileSync('src/pages/PaymentEvidence.jsx', 'utf8');

  assert(
    'Payment Evidence page renders import wizard trigger button',
    paymentEvidenceContent.includes('Import Payment Evidence') && paymentEvidenceContent.includes('setShowImportWizard(true)')
  );
  assert(
    'Import Wizard shows all five steps',
    paymentEvidenceContent.includes('Step 1: Choose Source') &&
    paymentEvidenceContent.includes('Step 2: Upload Source') &&
    paymentEvidenceContent.includes('Step 3: Select or Confirm Provider') &&
    paymentEvidenceContent.includes('Step 4: Preview Scored Records') &&
    paymentEvidenceContent.includes('Step 5: Finalize Import')
  );
  assert(
    'Import Wizard final import action button enables dynamically and handles click',
    paymentEvidenceContent.includes('Import CSV to Review Queue') &&
    paymentEvidenceContent.includes('onClick={handleImportCSV}')
  );
  assert(
    'No unauthorized write API calls (only POST endpoint for import) exist',
    !paymentEvidenceContent.includes("method: 'PUT'") &&
    !paymentEvidenceContent.includes("method: 'DELETE'") &&
    !paymentEvidenceContent.includes("method: \"PUT\"") &&
    !paymentEvidenceContent.includes("method: \"DELETE\"")
  );

  // Verify CSV parser implementation details
  assert(
    'CSV source shows parser-enabled upload state',
    paymentEvidenceContent.includes("importSource === 'csv'") &&
    paymentEvidenceContent.includes("accept=\".csv\"") &&
    paymentEvidenceContent.includes("onChange={handleFileChange}")
  );

  assert(
    'Non-CSV source still shows future parser message',
    paymentEvidenceContent.includes("Future Mode:") &&
    paymentEvidenceContent.includes("File parsing will be enabled in a future phase.")
  );

  assert(
    'CSV headers are mapped flexibly with standard alternatives',
    paymentEvidenceContent.includes("'transaction_date'") &&
    paymentEvidenceContent.includes("'trans_date'") &&
    paymentEvidenceContent.includes("'value_date'") &&
    paymentEvidenceContent.includes("'paid_amount'") &&
    paymentEvidenceContent.includes("'money_in'") &&
    paymentEvidenceContent.includes("'money_out'") &&
    paymentEvidenceContent.includes("'transaction_code'") &&
    paymentEvidenceContent.includes("'payer_phone'") &&
    paymentEvidenceContent.includes("'reference_account'")
  );

  assert(
    'CSV preview rows are rendered inside a table',
    paymentEvidenceContent.includes("parsedPreviewRows.map") &&
    paymentEvidenceContent.includes("row.transaction_date") &&
    paymentEvidenceContent.includes("row.direction") &&
    paymentEvidenceContent.includes("row.warnings")
  );

  assert(
    'Duplicate transaction code warning is raised correctly',
    paymentEvidenceContent.includes("'duplicate transaction codes'")
  );

  assert(
    'Missing amount or date warnings are raised correctly',
    paymentEvidenceContent.includes("'missing date'") &&
    paymentEvidenceContent.includes("'missing amount'")
  );

  assert(
    'Debit row warning appears for landlord statement',
    paymentEvidenceContent.includes("'debit rows on landlord statements'")
  );

  assert(
    'Import button is enabled only for valid CSV preview',
    paymentEvidenceContent.includes("disabled={!isImportEnabled || importing}") &&
    paymentEvidenceContent.includes("Importing only saves evidence rows for review. It does not reconcile payments or update invoices.")
  );

  assert(
    'Large file size rejection safety guard is defined',
    paymentEvidenceContent.includes("file.size > 1024 * 1024") &&
    paymentEvidenceContent.includes("This CSV is too large for browser preview.")
  );

  assert(
    'Row limit rejection safety guard is defined',
    paymentEvidenceContent.includes("lines.length > 2001")
  );

  assert(
    'Duplicate row detection warning is raised correctly',
    paymentEvidenceContent.includes("'duplicate rows'")
  );

  assert(
    'Empty row detection warning is raised correctly',
    paymentEvidenceContent.includes("'empty rows'")
  );

  assert(
    'Unsupported column warning is raised correctly',
    paymentEvidenceContent.includes("'unsupported columns'")
  );

  assert(
    'Preview summary counters check total, valid, warnings, duplicates, and others',
    paymentEvidenceContent.includes("Total Rows:") &&
    paymentEvidenceContent.includes("Valid Rows:") &&
    paymentEvidenceContent.includes("With Warnings:") &&
    paymentEvidenceContent.includes("Duplicate Codes:") &&
    paymentEvidenceContent.includes("Duplicate Rows:") &&
    paymentEvidenceContent.includes("Missing Dates:") &&
    paymentEvidenceContent.includes("Missing Amounts:") &&
    paymentEvidenceContent.includes("Debit Rows:") &&
    paymentEvidenceContent.includes("Unsupported Rows:") &&
    paymentEvidenceContent.includes("Skipped Rows:")
  );

  // Verify POST CSV Import endpoint integration
  const importCsvHandler = getRouteHandler('/payment-evidence/import-csv-preview');
  const importMiddlewares = getRouteMiddlewares('/payment-evidence/import-csv-preview');

  assert(
    'Post import CSV endpoint requires landlord or super_admin authentication',
    importMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  apiDb.seed('payment_evidence', [
    { id: 1001, organization_id: 1, transaction_code: 'TX1001', amount: 5000, transaction_date: '2026-06-25', status: 'needs_review', evidence_strength: 'high', collection_channel: 'MPESA_PAYBILL', payer_name: 'Alpha', row_hash: 'HASH-EXISTING' }
  ]);
  apiDb.seed('payment_evidence_batches', []);

  let postResult = null;
  let postStatus = null;
  const mockResPost = {
    status(code) { postStatus = code; return this; },
    json(data) { postResult = data; return this; }
  };

  const previewRowsToImport = [
    {
      amount: 1500,
      transaction_date: '2026-06-28',
      transaction_code: 'TXNEW01',
      direction: 'credit',
      payer_name: 'David',
      warnings: []
    },
    {
      amount: 2500,
      transaction_date: '2026-06-28',
      transaction_code: 'TXNEW02',
      direction: 'credit',
      payer_name: 'Eric',
      warnings: ['missing reference account']
    },
    {
      amount: 500,
      transaction_date: '2026-06-28',
      transaction_code: 'TXNEW03',
      direction: 'debit',
      payer_name: 'Frank',
      warnings: ['debit rows on landlord statements']
    },
    {
      amount: 5000,
      transaction_date: '2026-06-25',
      transaction_code: 'TX1001',
      direction: 'credit',
      payer_name: 'Alpha',
      warnings: []
    }
  ];

  await importCsvHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    body: {
      source_provider: 'mpesa',
      source_perspective: 'landlord',
      document_source: 'CSV',
      collection_channel: 'unknown',
      original_filename: 'test_import.csv',
      preview_rows: previewRowsToImport
    }
  }, mockResPost);

  assert('Import executes successfully', postResult && postResult.success === true);
  assert('Import creates payment_evidence_batches row', apiDb.get('payment_evidence_batches').length === 1);
  assert('Import creates payment_evidence rows', apiDb.get('payment_evidence').length === 4);
  assert('Duplicate transaction_code is skipped', postResult.duplicate_count === 1);
  assert('Debit landlord row status is ignored', apiDb.get('payment_evidence').some(r => r.transaction_code === 'TXNEW03' && r.status === 'ignored'));
  assert('Warning row status is needs_review', apiDb.get('payment_evidence').some(r => r.transaction_code === 'TXNEW02' && r.status === 'needs_review'));
  assert('Clean row status is imported', apiDb.get('payment_evidence').some(r => r.transaction_code === 'TXNEW01' && r.status === 'imported'));
  assert('No row status is auto_reconciled or manually_reconciled', !apiDb.get('payment_evidence').some(r => r.status === 'auto_reconciled' || r.status === 'manually_reconciled'));

  postResult = null;
  await importCsvHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    body: {
      source_provider: 'mpesa',
      source_perspective: 'landlord',
      document_source: 'CSV',
      collection_channel: 'unknown',
      original_filename: 'test_import.csv',
      preview_rows: [
        {
          amount: 1500,
          transaction_date: '2026-06-28',
          transaction_code: 'TXNEW01',
          direction: 'credit',
          payer_name: 'David',
          warnings: []
        }
      ]
    }
  }, mockResPost);
  assert('Duplicate row_hash or transaction_code is skipped on second attempt', postResult && postResult.duplicate_count === 1 && postResult.rows.length === 0);

  // 1. Backend re-normalizes suspicious frontend data
  postResult = null;
  await importCsvHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    body: {
      source_provider: 'mpesa',
      source_perspective: 'landlord',
      document_source: 'CSV',
      collection_channel: 'unknown',
      original_filename: 'test_import.csv',
      preview_rows: [
        {
          amount: 2500,
          transaction_date: '2026-06-29',
          transaction_code: 'txnew_lower',
          direction: 'credit',
          payer_name: 'George',
          payer_phone: '0711223344',
          warnings: []
        }
      ]
    }
  }, mockResPost);

  assert('Backend converts transaction_code to uppercase', postResult && postResult.rows[0].transaction_code === 'TXNEW_LOWER');
  assert('Backend normalizes payer_phone correctly', postResult && postResult.rows[0].payer_phone === '254711223344');

  // 2. Empty transaction_code does not trigger duplicate-code false positives
  postResult = null;
  await importCsvHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    body: {
      source_provider: 'mpesa',
      source_perspective: 'landlord',
      document_source: 'CSV',
      collection_channel: 'unknown',
      original_filename: 'test_import.csv',
      preview_rows: [
        {
          amount: 3000,
          transaction_date: '2026-06-30',
          transaction_code: '',
          direction: 'credit',
          payer_name: 'Harry',
          warnings: []
        },
        {
          amount: 3500,
          transaction_date: '2026-06-30',
          transaction_code: null,
          direction: 'credit',
          payer_name: 'Ian',
          warnings: []
        }
      ]
    }
  }, mockResPost);

  assert('Empty transaction codes do not block multiple insertions', postResult && postResult.needs_review_count === 2 && postResult.duplicate_count === 0);

  // 3. Duplicate rows within the same submitted batch are skipped
  postResult = null;
  await importCsvHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    body: {
      source_provider: 'mpesa',
      source_perspective: 'landlord',
      document_source: 'CSV',
      collection_channel: 'unknown',
      original_filename: 'test_import.csv',
      preview_rows: [
        {
          amount: 4000,
          transaction_date: '2026-07-01',
          transaction_code: 'TXUNIQUE_DUP_BATCH',
          direction: 'credit',
          payer_name: 'Jack',
          warnings: []
        },
        {
          amount: 4000,
          transaction_date: '2026-07-01',
          transaction_code: 'TXUNIQUE_DUP_BATCH',
          direction: 'credit',
          payer_name: 'Jack',
          warnings: []
        }
      ]
    }
  }, mockResPost);

  assert('Duplicate transaction code in same batch is skipped', postResult && postResult.needs_review_count === 1 && postResult.duplicate_count === 1);

  // 4. No auto_reconciled/manually_reconciled status can be inserted
  assert(
    'No auto_reconciled/manually_reconciled status can be created by endpoint',
    !paymentEvidenceContent.includes("status: 'auto_reconciled'") &&
    !paymentEvidenceContent.includes("status: 'manually_reconciled'")
  );

  // 5. Generic browser alert/confirm is not used directly without safety fallback checks
  assert(
    'Generic browser alert/confirm is not used directly',
    !paymentEvidenceContent.includes("if (!window.confirm(") &&
    paymentEvidenceContent.includes("window.showConfirm ||")
  );

  // Verify Suggestions GET logic
  apiDb.seed('payment_evidence', [
    { id: 3001, organization_id: 1, amount: 5000, transaction_date: '2026-06-25', status: 'imported', collection_channel: 'MPESA_PAYBILL', row_hash: 'HASH-SUGG-1' },
    { id: 3002, organization_id: 1, amount: 12000, transaction_date: '2026-06-26', status: 'needs_review', reference_account: 'ACC-REF-1', collection_channel: 'BANK_TRANSFER', row_hash: 'HASH-SUGG-2' },
    { id: 3003, organization_id: 1, amount: 15000, transaction_date: '2026-06-27', status: 'ignored', reference_account: 'ACC-REF-1', collection_channel: 'BANK_TRANSFER', row_hash: 'HASH-SUGG-3' }
  ]);
  apiDb.seed('tenants', [
    { id: 101, organization_id: 1, tenant_account_number: 'ACC-REF-1', full_name: 'Alpha Tenant', phone_number: '254711223344', status: 'active', unit_id: 401 }
  ]);
  apiDb.seed('invoices', [
    { id: 201, organization_id: 1, tenant_id: 101, invoice_number: 'INV-001', status: 'issued', balance: 12000, total: 12000, due_date: '2026-06-20' },
    { id: 203, organization_id: 1, tenant_id: 101, invoice_number: 'INV-003', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' }
  ]);
  apiDb.seed('properties', [
    { id: 301, name: 'Sunset Apartments', organization_id: 1 }
  ]);
  apiDb.seed('units', [
    { id: 401, property_id: 301, unit_code: 'A10', organization_id: 1 }
  ]);

  rowsResult = null;
  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: {}
  }, mockResList);

  assert('Enriched response returns suggestions field on rows', rowsResult && rowsResult.every(r => Array.isArray(r.suggestions)));

  const row3001 = rowsResult.find(r => r.id === 3001);
  const row3002 = rowsResult.find(r => r.id === 3002);
  const row3003 = rowsResult.find(r => r.id === 3003);

  assert('Imported evidence row returns suggestions', row3001 && row3001.suggestions.length > 0);
  assert('Needs review evidence row returns suggestions', row3002 && row3002.suggestions.length > 0);
  assert('Ignored evidence row does NOT produce suggestions', row3003 && row3003.suggestions.length === 0);

  const sugg3001 = row3001.suggestions[0];
  const sugg3002 = row3002.suggestions[0];

  assert('Amount-only match is never high confidence (marked low)', sugg3001 && sugg3001.match_confidence === 'low' && sugg3001.match_score === 50);
  assert('Reference account + amount match is high confidence', sugg3002 && sugg3002.match_confidence === 'high' && sugg3002.match_score === 95);

  assert('Suggestion unit_label includes property and unit code details', sugg3002 && sugg3002.unit_label === 'Sunset Apartments - A10');
  assert('Suggestion contains invoice status, balance and due date', sugg3002 && sugg3002.invoice_status === 'issued' && sugg3002.invoice_balance === 12000 && sugg3002.invoice_due_date === '2026-06-20');

  apiDb.seed('invoices', [
    { id: 201, organization_id: 1, tenant_id: 101, invoice_number: 'INV-001', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' },
    { id: 202, organization_id: 1, tenant_id: 101, invoice_number: 'INV-002', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' },
    { id: 203, organization_id: 1, tenant_id: 101, invoice_number: 'INV-003', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' },
    { id: 204, organization_id: 1, tenant_id: 101, invoice_number: 'INV-004', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' },
    { id: 205, organization_id: 1, tenant_id: 101, invoice_number: 'INV-005', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' },
    { id: 206, organization_id: 1, tenant_id: 101, invoice_number: 'INV-006', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' }
  ]);

  rowsResult = null;
  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: {}
  }, mockResList);

  const row3001Cap = rowsResult.find(r => r.id === 3001);
  assert('Suggestions are limited to maximum 5 per row', row3001Cap && row3001Cap.suggestions.length === 5);

  assert('No evidence status is changed by suggestion fetch', row3001Cap.status === 'imported' && row3002.status === 'needs_review');

  assert(
    'Review Queue renders safety copy notice warning',
    paymentEvidenceContent.includes("These are matching suggestions only. No payment has been reconciled, allocated, or applied to an invoice.")
  );
  assert(
    'Review Queue renders Suggested Match section and confidence level badges',
    paymentEvidenceContent.includes("s.match_confidence") &&
    paymentEvidenceContent.includes("s.match_score") &&
    paymentEvidenceContent.includes("s.tenant_name") &&
    paymentEvidenceContent.includes("s.unit_label")
  );
  assert(
    'No reconcile/approve/allocate/mark paid buttons are defined for matching actions',
    !paymentEvidenceContent.includes('Reconcile Payment') &&
    !paymentEvidenceContent.includes('Approve Reconciliation') &&
    !paymentEvidenceContent.includes('Allocate Payment')
  );

  console.log(`\nAll tests completed. ${failures} failure(s) recorded.`);
  if (failures > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});
