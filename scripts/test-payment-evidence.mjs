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
      receipts: [],
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
    const newRow = {
      id: newId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...rowData
    };
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
    { id: 1001, organization_id: 1, transaction_code: 'TX1001', amount: 5000, transaction_date: '2026-06-25', status: 'needs_review', evidence_strength: 'high', collection_channel: 'MPESA_PAYBILL', payer_name: 'Alpha', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', reviewed_by: 10, reviewed_at: '2026-06-29T08:00:00.000Z', created_at: '2026-06-25T08:00:00.000Z' },
    { id: 1002, organization_id: 1, transaction_code: 'TX1002', amount: 12000, transaction_date: '2026-06-26', status: 'auto_reconciled', evidence_strength: 'verified', collection_channel: 'BANK_TRANSFER', payer_name: 'Beta', review_status: null, review_decision: null, reviewed_at: null, created_at: '2026-06-26T08:00:00.000Z' },
    { id: 1003, organization_id: 2, transaction_code: 'TX1003', amount: 15000, transaction_date: '2026-06-27', status: 'needs_review', evidence_strength: 'high', collection_channel: 'MPESA_PAYBILL', payer_name: 'Gamma', review_status: 'rejected_suggestion', review_decision: 'rejected_suggestion', reviewed_at: '2026-06-29T09:00:00.000Z', created_at: '2026-06-27T08:00:00.000Z' }
  ]);
  apiDb.seed('payment_evidence_batches', [
    { id: 50, organization_id: 1, upload_filename: 'statement1.csv' }
  ]);
  apiDb.seed('payment_evidence_review_audit', [
    { id: 9001, organization_id: 1, payment_evidence_id: 1001, action: 'create_decision', created_at: '2026-06-29T08:01:00.000Z' }
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
  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { review_status: 'accepted_suggestion' }
  }, mockResList);
  assert('Filters rows by review_status successfully', rowsResult.length === 1 && rowsResult[0].id === 1001);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { review_status: 'unreviewed' }
  }, mockResList);
  assert('Filters rows by unreviewed review_status successfully', rowsResult.length === 1 && rowsResult[0].id === 1002);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { review_decision: 'accepted_suggestion' }
  }, mockResList);
  assert('Filters rows by review_decision successfully', rowsResult.length === 1 && rowsResult[0].id === 1001);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { has_audit_history: 'true' }
  }, mockResList);
  assert('Filters rows with audit history successfully', rowsResult.length === 1 && rowsResult[0].id === 1001 && rowsResult[0].audit_count === 1 && rowsResult[0].has_audit_history === true);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { has_audit_history: 'false' }
  }, mockResList);
  assert('Filters rows without audit history successfully', rowsResult.length === 1 && rowsResult[0].id === 1002 && rowsResult[0].has_audit_history === false);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { reviewed_from: '2026-06-29T00:00:00.000Z', reviewed_to: '2026-06-29T23:59:59.999Z' }
  }, mockResList);
  assert('Filters rows by reviewed_from/reviewed_to successfully', rowsResult.length === 1 && rowsResult[0].id === 1001);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { imported_from: '2026-06-26T00:00:00.000Z', imported_to: '2026-06-26T23:59:59.999Z' }
  }, mockResList);
  assert('Filters rows by imported_from/imported_to successfully', rowsResult.length === 1 && rowsResult[0].id === 1002);

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

  // 4. No auto_reconciled/manually_reconciled status can be created by import wizard or review decision
  assert(
    'No auto_reconciled/manually_reconciled status can be created by import wizard or review decision',
    !paymentEvidenceContent.includes("status: 'auto_reconciled'") &&
    paymentEvidenceContent.includes("status: 'manually_reconciled'") &&
    paymentEvidenceContent.split("status: 'manually_reconciled'").length === 2
  );

  // 5. Generic browser alert/confirm is not used directly
  assert(
    'Generic browser alert/confirm is not used directly',
    !paymentEvidenceContent.includes("window.confirm(") &&
    !paymentEvidenceContent.includes("alert(")
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
  assert('Enriched response returns audit visibility fields on rows', rowsResult && rowsResult.every(r => typeof r.audit_count === 'number' && typeof r.has_audit_history === 'boolean'));

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { has_suggestions: 'true' }
  }, mockResList);
  assert('Filters rows with suggestions successfully', rowsResult.length === 2 && rowsResult.every(r => r.suggestions.length > 0));

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { has_suggestions: 'false' }
  }, mockResList);
  assert('Filters rows without suggestions successfully', rowsResult.length === 1 && rowsResult[0].id === 3003);

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { match_confidence: 'high' }
  }, mockResList);
  assert('Filters rows by match_confidence successfully', rowsResult.length >= 1 && rowsResult.every(r => r.suggestions.some(s => s.match_confidence === 'high')));

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { min_match_score: '90' }
  }, mockResList);
  assert('Filters rows by min_match_score successfully', rowsResult.length >= 1 && rowsResult.every(r => r.suggestions.some(s => Number(s.match_score) >= 90)));

  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: { max_match_score: '60' }
  }, mockResList);
  assert('Filters rows by max_match_score successfully', rowsResult.length >= 1 && rowsResult.every(r => r.suggestions.some(s => Number(s.match_score) <= 60)));

  rowsResult = null;
  await listRowsHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    query: {}
  }, mockResList);


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

  // ==========================================
  // Test 9: Manual Review Decision UI Foundation
  // ==========================================
  console.log('\n9. Manual Review Decision UI Foundation:');

  const reviewDecisionHandler = getRouteHandler('/payment-evidence/:id/review-decision');
  const reviewDecisionMiddlewares = getRouteMiddlewares('/payment-evidence/:id/review-decision');

  assert(
    'Review Decision endpoint requires landlord or super_admin role',
    reviewDecisionMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  // Setup test environment data
  apiDb.seed('users', [
    { id: 10, organization_id: 1, name: 'Alice Landlord' }
  ]);
  apiDb.seed('tenants', [
    { id: 101, organization_id: 1, full_name: 'Tenant One', tenant_account_number: 'ACC-T1', status: 'active', phone: '254722334455' }
  ]);
  apiDb.seed('invoices', [
    { id: 201, organization_id: 1, tenant_id: 101, invoice_number: 'INV-101', status: 'issued', balance: 5000, total: 5000, due_date: '2026-06-20' }
  ]);
  apiDb.seed('payment_evidence', [
    { id: 4001, organization_id: 1, amount: 5000, transaction_date: '2026-06-19', status: 'needs_review', collection_channel: 'MPESA_PAYBILL', row_hash: 'HASH-REV-1', payer_phone: '254722334455' },
    { id: 4002, organization_id: 1, amount: 5000, transaction_date: '2026-06-19', status: 'ignored', collection_channel: 'MPESA_PAYBILL', row_hash: 'HASH-REV-2', payer_phone: '254722334455' }
  ]);

  let reviewResStatus = null;
  let reviewResResult = null;
  const mockResReview = {
    status(code) { reviewResStatus = code; return this; },
    json(data) { reviewResResult = data; return this; }
  };

  // 1. Rejected decision validation checks
  reviewResStatus = null;
  reviewResResult = null;
  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '4001' },
    body: {
      decision: 'invalid_decision_type'
    }
  }, mockResReview);
  assert('Invalid decision type returns HTTP 400', reviewResStatus === 400 && reviewResResult.error === 'INVALID_DECISION');

  // 2. Text field length limit validation checks
  reviewResStatus = null;
  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '4001' },
    body: {
      decision: 'rejected_suggestion',
      rejected_reason: 'a'.repeat(501)
    }
  }, mockResReview);
  assert('Rejection reason text exceeding limit returns HTTP 400', reviewResStatus === 400 && reviewResResult.error === 'REASON_TOO_LONG');

  reviewResStatus = null;
  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '4001' },
    body: {
      decision: 'needs_more_evidence',
      review_notes: 'a'.repeat(1001)
    }
  }, mockResReview);
  assert('Review notes text exceeding limit returns HTTP 400', reviewResStatus === 400 && reviewResResult.error === 'NOTES_TOO_LONG');

  // 3. Ignored rows block accepted_suggestion decisions
  reviewResStatus = null;
  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '4002' },
    body: {
      decision: 'accepted_suggestion',
      accepted_tenant_id: 101,
      accepted_invoice_id: 201
    }
  }, mockResReview);
  assert('Ignored rows cannot accept match suggestions', reviewResStatus === 400 && reviewResResult.error === 'IGNORED_ROW_BLOCKED');

  // 4. Validate suggestion references on acceptance
  reviewResStatus = null;
  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '4001' },
    body: {
      decision: 'accepted_suggestion',
      accepted_tenant_id: 999,
      accepted_invoice_id: 999
    }
  }, mockResReview);
  assert('Incorrect matching suggestion parameters are rejected', reviewResStatus === 400 && reviewResResult.error === 'SUGGESTION_NOT_FOUND');

  // 5. Successful review decision save
  reviewResStatus = null;
  reviewResResult = null;
  const initialInvoiceList = JSON.stringify(apiDb.get('invoices'));
  const initialTenantList = JSON.stringify(apiDb.get('tenants'));

  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '4001' },
    body: {
      decision: 'accepted_suggestion',
      accepted_tenant_id: 101,
      accepted_invoice_id: 201,
      review_notes: 'Verified against M-Pesa transaction log notes.'
    }
  }, mockResReview);

  assert('Save review decision is successful', reviewResResult && reviewResResult.success === true);
  assert('Return includes correct safety message', reviewResResult && reviewResResult.message === 'Review decision saved. No payment has been reconciled or applied.');
  assert('Return includes updated row with decision details', reviewResResult && reviewResResult.row.review_decision === 'accepted_suggestion');
  assert('Updated row includes accepted tenant info preloaded', reviewResResult && reviewResResult.row.accepted_tenant.full_name === 'Tenant One');
  assert('Updated row includes accepted invoice info preloaded', reviewResResult && reviewResResult.row.accepted_invoice.invoice_number === 'INV-101');
  assert('Updated row includes reviewer name', reviewResResult && reviewResResult.row.reviewer_name === 'Alice Landlord');

  // Validate database immutability constraints
  assert('Invoices table remains un-mutated', JSON.stringify(apiDb.get('invoices')) === initialInvoiceList);
  assert('Tenants table remains un-mutated', JSON.stringify(apiDb.get('tenants')) === initialTenantList);

  // 6. Verify frontend UI files structure for safety disclaimers, review state buttons and confirm dialogs
  assert(
    'Payment Evidence UI renders manual review safety notice disclaimers',
    paymentEvidenceContent.includes("Manual review decisions are audit notes only. They do not reconcile, allocate, or apply payments.")
  );
  assert(
    'Payment Evidence UI contains decision workflow action buttons',
    paymentEvidenceContent.includes("Save Accepted Suggestion") &&
    paymentEvidenceContent.includes("Reject Suggestion") &&
    paymentEvidenceContent.includes("Needs More Evidence") &&
    paymentEvidenceContent.includes("Mark Irrelevant")
  );
  assert(
    'Payment Evidence UI uses window.showConfirm before saving decisions',
    paymentEvidenceContent.includes("window.showConfirm") &&
    paymentEvidenceContent.includes("Save Review Decision")
  );

  // Hardening: Remove generic browser alert/confirm fallbacks check
  assert(
    'PaymentEvidence.jsx does not contain window.confirm(',
    !paymentEvidenceContent.includes("window.confirm(")
  );
  assert(
    'PaymentEvidence.jsx does not contain alert(',
    !paymentEvidenceContent.includes("alert(")
  );

  // Hardening: Frontend role gate checks
  assert(
    'PaymentEvidence.jsx restricts review workspace strictly to landlord/super_admin role (no || !role bypass)',
    paymentEvidenceContent.includes("(role === 'landlord' || role === 'super_admin')") &&
    !paymentEvidenceContent.includes("(role === 'landlord' || role === 'super_admin' || !role)")
  );

  // Hardening: Ignored-row UI behavior checks
  assert(
    'PaymentEvidence.jsx hides accept match suggestion option from ignored rows',
    paymentEvidenceContent.includes("selectedRow.status !== 'ignored' && selectedRow.suggestions")
  );
  assert(
    'PaymentEvidence.jsx hides other decisions and renders Mark Evidence Irrelevant conditionally for ignored rows',
    paymentEvidenceContent.includes("selectedRow.status !== 'ignored' ?") &&
    paymentEvidenceContent.includes("Mark Evidence Irrelevant")
  );

  // Hardening: Metadata-only updates verification (no status update in route body payload)
  const routeContent = fs.readFileSync('server/routes/paymentEvidenceRoutes.js', 'utf8');
  const updatesStart = routeContent.indexOf("const updates = {");
  const updatesEnd = routeContent.indexOf("};", updatesStart);
  const updatesBlock = routeContent.slice(updatesStart, updatesEnd);
  assert(
    'Route does not include status field inside its update payload',
    updatesStart !== -1 && !/\bstatus\s*:/.test(updatesBlock)
  );

  // ==========================================
  // Test 10: Review Decision Audit Trail Hardening
  // ==========================================
  console.log('\n10. Review Decision Audit Trail Hardening:');

  const reviewAuditHandler = getRouteHandler('/payment-evidence/:id/review-audit');
  const reviewAuditMiddlewares = getRouteMiddlewares('/payment-evidence/:id/review-audit');

  assert(
    'Audit read endpoint is landlord/super_admin only',
    reviewAuditMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let blockedStatus = null;
    let blockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware({
      auth: { role: blockedRole, organizationId: 1, userId: 99 }
    }, {
      status(code) { blockedStatus = code; return this; },
      json() { return this; }
    }, () => { blockedNextCalled = true; });

    assert(`Audit read endpoint blocks ${blockedRole}`, blockedStatus === 403 && blockedNextCalled === false);
  }

  // Setup audit test data
  apiDb.seed('payment_evidence_review_audit', []);
  apiDb.seed('payment_evidence', [
    { id: 5001, organization_id: 1, amount: 5000, transaction_date: '2026-06-19', status: 'needs_review', collection_channel: 'MPESA_PAYBILL', row_hash: 'HASH-AUDIT-1', payer_phone: '254722334455', review_status: null, review_decision: null }
  ]);

  // 1. Save decision creates audit row
  let mockResPostAudit = {
    status(code) { return this; },
    json(data) { return this; }
  };

  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '5001' },
    headers: { 'user-agent': 'Chrome-Test' },
    ip: '192.168.1.1',
    body: {
      decision: 'accepted_suggestion',
      accepted_tenant_id: 101,
      accepted_invoice_id: 201,
      review_notes: 'Initial audit trace check.'
    }
  }, mockResPostAudit);

  const auditsAfterFirst = apiDb.get('payment_evidence_review_audit');
  assert('Saving review decision creates one audit row', auditsAfterFirst.length === 1);
  assert('Audit row stores new review status', auditsAfterFirst[0].new_review_status === 'accepted_suggestion');
  assert('Audit row stores previous and new accepted tenant/invoice ids', auditsAfterFirst[0].previous_accepted_tenant_id === null && auditsAfterFirst[0].new_accepted_tenant_id === 101 && auditsAfterFirst[0].previous_accepted_invoice_id === null && auditsAfterFirst[0].new_accepted_invoice_id === 201);
  assert('Audit row stores actor user id and actor role', auditsAfterFirst[0].actor_user_id === 10 && auditsAfterFirst[0].actor_role === 'landlord');
  assert('Audit row stores request metadata (IP and User-Agent)', auditsAfterFirst[0].actor_ip === '192.168.1.1' && auditsAfterFirst[0].user_agent === 'Chrome-Test');
  assert('Audit row includes correct safety message', auditsAfterFirst[0].safety_message === 'Manual review audit only. No payment has been reconciled, allocated, or applied.');

  // 2. Second review decision creates second audit row
  await new Promise(resolve => setTimeout(resolve, 15));
  await reviewDecisionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '5001' },
    headers: { 'user-agent': 'Chrome-Test' },
    ip: '192.168.1.1',
    body: {
      decision: 'marked_irrelevant',
      rejected_reason: 'Non-rent payment.'
    }
  }, mockResPostAudit);

  const auditsAfterSecond = apiDb.get('payment_evidence_review_audit');
  assert('Second review decision creates second audit row', auditsAfterSecond.length === 2);
  assert('Audit row stores previous and new review status', auditsAfterSecond[1].previous_review_status === 'accepted_suggestion' && auditsAfterSecond[1].new_review_status === 'marked_irrelevant');
  assert('Audit row stores previous accepted tenant/invoice ids on later decisions', auditsAfterSecond[1].previous_accepted_tenant_id === 101 && auditsAfterSecond[1].new_accepted_tenant_id === null && auditsAfterSecond[1].previous_accepted_invoice_id === 201 && auditsAfterSecond[1].new_accepted_invoice_id === null);
  assert('Audit row stores new rejected reason', auditsAfterSecond[1].new_rejected_reason === 'Non-rent payment.');

  // 3. Read audit endpoint scoped by organization_id and sorted newest first
  let auditGetStatus = null;
  let auditGetResult = null;
  const mockResGet = {
    status(code) { auditGetStatus = code; return this; },
    json(data) { auditGetResult = data; return this; }
  };

  await reviewAuditHandler({
    auth: { organizationId: 1, role: 'landlord' },
    params: { id: '5001' }
  }, mockResGet);

  assert('Audit read endpoint returns success', auditGetResult && auditGetResult.success === true);
  assert('Audit rows are returned', auditGetResult.audit && auditGetResult.audit.length === 2);
  assert('Audit rows are sorted newest first', new Date(auditGetResult.audit[0].created_at) >= new Date(auditGetResult.audit[1].created_at));

  // 4. Audit read endpoint checks organization scoping
  let badAuditGetStatus = null;
  const mockResGetBad = {
    status(code) { badAuditGetStatus = code; return this; },
    json(data) { return this; }
  };
  await reviewAuditHandler({
    auth: { organizationId: 999, role: 'landlord' },
    params: { id: '5001' }
  }, mockResGetBad);
  assert('Audit read endpoint is organization-scoped (returns 404 for wrong org)', badAuditGetStatus === 404);

  // 5. Test that if audit insert fails, the review decision fails safely
  const rowBeforeAuditFailure = JSON.stringify(apiDb.get('payment_evidence').find(r => r.id === 5001));
  const failingDb = {
    ...apiDb,
    get: apiDb.get.bind(apiDb),
    find: apiDb.find.bind(apiDb),
    findOne: apiDb.findOne.bind(apiDb),
    update: apiDb.update.bind(apiDb),
    insert(table, data) {
      if (table === 'payment_evidence_review_audit') {
        throw new Error('Simulated insert failure');
      }
      return apiDb.insert(table, data);
    }
  };
  const routerFailing = createPaymentEvidenceRoutes(failingDb);
  const getFailingHandler = (path) => {
    const layer = routerFailing.stack.find(l => l.route && l.route.path === path);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const failingDecisionHandler = getFailingHandler('/payment-evidence/:id/review-decision');

  let failedPostStatus = null;
  let failedPostResult = null;
  const mockResFailed = {
    status(code) { failedPostStatus = code; return this; },
    json(data) { failedPostResult = data; return this; }
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await failingDecisionHandler({
      auth: { organizationId: 1, role: 'landlord', userId: 10 },
      params: { id: '5001' },
      body: {
        decision: 'needs_more_evidence',
        review_notes: 'Must fail.'
      }
    }, mockResFailed);
  } finally {
    console.error = originalConsoleError;
  }
  assert('If audit insert fails, the review decision returns a safe error', failedPostStatus === 500 && failedPostResult && failedPostResult.error === 'AUDIT_WRITE_FAILED');
  assert('If audit insert fails, review metadata is restored in JSON fallback', JSON.stringify(apiDb.get('payment_evidence').find(r => r.id === 5001)) === rowBeforeAuditFailure);

  // 6. Immutability checks: confirm no invoice/tenant balance updates or ledger/receipt records are created
  assert('No invoice status/balance changes', apiDb.get('invoices').every(inv => inv.status === 'issued' && inv.balance === 5000));
  assert('No tenant balance changes', apiDb.get('tenants').every(t => t.status === 'active'));
  assert('No payment allocation records created', apiDb.get('payment_allocations').length === 0);
  assert('No ledger records created', apiDb.get('transactions').length === 0);
  assert('No receipt records created', apiDb.get('receipts').length === 0);
  assert('payment_evidence.status is unchanged', apiDb.get('payment_evidence')[0].status === 'needs_review');
  assert('No auto_reconciled/manually_reconciled status created by review decisions', !apiDb.get('payment_evidence').some(r => r.status === 'auto_reconciled' || r.status === 'manually_reconciled'));

  // 7. Verify frontend history section rendering logic
  assert('Review Decision History section renders in frontend page', paymentEvidenceContent.includes('Review Decision History'));
  assert('Audit safety copy renders in frontend page', paymentEvidenceContent.includes('Review history is an audit trail only. It does not reconcile, allocate, or apply payments.'));
  assert('Fetch call to review-audit endpoint exists', paymentEvidenceContent.includes('/api/payment-evidence/${id}/review-audit') || paymentEvidenceContent.includes('review-audit'));
  assert('Empty history state renders in frontend page', paymentEvidenceContent.includes('No audit history yet.'));
  assert(
    'Forbidden financial-final labels do not exist in PaymentEvidence.jsx',
    ![
      /\bReconcile\b/,
      /\bAllocate\b/,
      /\bMark Paid\b/,
      /\bCreate Receipt\b/,
      /\bApply Payment\b/,
      /\bConfirm Payment\b/,
      /\bPost Payment\b/
    ].some(pattern => pattern.test(paymentEvidenceContent))
  );
  assert('Review Decision History renders per-entry safety message', paymentEvidenceContent.includes('log.safety_message'));

  // ==========================================
  // Test 11: Polish Date Filters & Reset UX Static Checks
  // ==========================================
  console.log('\n11. Polish Date Filters & Reset UX Static Checks:');

  assert(
    'Payment Evidence UI renders new date filter labels',
    paymentEvidenceContent.includes('Imported From:') &&
    paymentEvidenceContent.includes('Imported To:') &&
    paymentEvidenceContent.includes('Reviewed From:') &&
    paymentEvidenceContent.includes('Reviewed To:')
  );

  assert(
    'Payment Evidence UI sends date filter query parameters to backend',
    paymentEvidenceContent.includes("queryParams.append('imported_from', importedFrom)") &&
    paymentEvidenceContent.includes("queryParams.append('imported_to', importedTo)") &&
    paymentEvidenceContent.includes("queryParams.append('reviewed_from', reviewedFrom)") &&
    paymentEvidenceContent.includes("queryParams.append('reviewed_to', reviewedTo)")
  );

  assert(
    'Reset Filters onClick handler clears all filter states',
    paymentEvidenceContent.includes("setStatus('')") &&
    paymentEvidenceContent.includes("setStrength('')") &&
    paymentEvidenceContent.includes("setChannel('')") &&
    paymentEvidenceContent.includes("setStartDate('')") &&
    paymentEvidenceContent.includes("setEndDate('')") &&
    paymentEvidenceContent.includes("setMinAmount('')") &&
    paymentEvidenceContent.includes("setMaxAmount('')") &&
    paymentEvidenceContent.includes("setSelectedBatchId('')") &&
    paymentEvidenceContent.includes("setReviewStatusFilter('')") &&
    paymentEvidenceContent.includes("setReviewDecisionFilter('')") &&
    paymentEvidenceContent.includes("setSuggestionFilter('')") &&
    paymentEvidenceContent.includes("setMatchConfidenceFilter('')") &&
    paymentEvidenceContent.includes("setAuditHistoryFilter('')") &&
    paymentEvidenceContent.includes("setReviewedFrom('')") &&
    paymentEvidenceContent.includes("setReviewedTo('')") &&
    paymentEvidenceContent.includes("setImportedFrom('')") &&
    paymentEvidenceContent.includes("setImportedTo('')") &&
    paymentEvidenceContent.includes("setSearch('')")
  );

  assert(
    'No forbidden financial-final labels or buttons exist in PaymentEvidence.jsx',
    ![
      /\bReconcile\b/,
      /\bAllocate\b/,
      /\bMark Paid\b/,
      /\bCreate Receipt\b/,
      /\bApply Payment\b/,
      /\bConfirm Payment\b/,
      /\bPost Payment\b/,
      /\bApprove Payment\b/,
      /\bReconcile Payment\b/
    ].some(pattern => pattern.test(paymentEvidenceContent))
  );

  // ==========================================
  // Test 12: Review Workspace & Detail Confidence Panel Polish
  // ==========================================
  console.log('\n12. Review Workspace & Detail Confidence Panel Polish Static Checks:');

  assert(
    'Payment Evidence UI renders Evidence Facts header and fields',
    paymentEvidenceContent.includes('Evidence Facts') &&
    paymentEvidenceContent.includes('Transaction Date:') &&
    paymentEvidenceContent.includes('Amount:') &&
    paymentEvidenceContent.includes('Transaction Code:') &&
    paymentEvidenceContent.includes('Reference Account:') &&
    paymentEvidenceContent.includes('Payer Name:') &&
    paymentEvidenceContent.includes('Payer Phone:') &&
    paymentEvidenceContent.includes('Collection Channel:') &&
    paymentEvidenceContent.includes('Evidence Status:') &&
    paymentEvidenceContent.includes('Evidence Strength:') &&
    paymentEvidenceContent.includes('Import Batch Filename:')
  );

  assert(
    'Payment Evidence UI renders Suggested Match Explanation header',
    paymentEvidenceContent.includes('Suggested Match Explanation')
  );

  assert(
    'Payment Evidence UI renders Safety Disclaimer copy',
    paymentEvidenceContent.includes('Review decisions are audit notes only. No invoice is marked paid from this screen, and no payment is allocated from this screen.')
  );

  assert(
    'Payment Evidence UI renders empty states correctly',
    paymentEvidenceContent.includes('No suggestions available.') &&
    paymentEvidenceContent.includes('No audit history yet.') &&
    paymentEvidenceContent.includes('Ignored evidence cannot accept match suggestions.')
  );

  assert(
    'No unauthorized allocation/reconciliation write API endpoints are called',
    !paymentEvidenceContent.includes('/api/reconcile') &&
    !paymentEvidenceContent.includes('/api/allocate') &&
    !paymentEvidenceContent.includes('/api/receipts') &&
    !paymentEvidenceContent.includes('/api/ledger')
  );

  // ==========================================
  // Test 13: Allocation Readiness Gate & Preview Foundation
  // ==========================================
  console.log('\n13. Allocation Readiness Gate & Preview Foundation:');

  const previewHandler = getRouteHandler('/payment-evidence/:id/allocation-preview');
  const previewMiddlewares = getRouteMiddlewares('/payment-evidence/:id/allocation-preview');

  assert(
    'Allocation Preview endpoint requires landlord or super_admin role',
    previewMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  // Access control checks
  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let blockedStatus = null;
    let blockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware({
      auth: { role: blockedRole, organizationId: 1, userId: 99 }
    }, {
      status(code) { blockedStatus = code; return this; },
      json() { return this; }
    }, () => { blockedNextCalled = true; });

    assert(`Allocation Preview endpoint blocks ${blockedRole}`, blockedStatus === 403 && blockedNextCalled === false);
  }

  // Setup database seed for readiness gate testing
  apiDb.seed('payment_evidence', [
    // Unreviewed
    { id: 6001, organization_id: 1, amount: 5000, transaction_date: '2026-06-20', status: 'needs_review', review_status: null, review_decision: null },
    // Ignored
    { id: 6002, organization_id: 1, amount: 5000, transaction_date: '2026-06-20', status: 'ignored', review_status: 'marked_irrelevant', review_decision: 'marked_irrelevant' },
    // Accepted - missing tenant
    { id: 6003, organization_id: 1, amount: 5000, transaction_date: '2026-06-20', status: 'needs_review', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', accepted_tenant_id: 9999, accepted_invoice_id: 201 },
    // Accepted - missing invoice
    { id: 6004, organization_id: 1, amount: 5000, transaction_date: '2026-06-20', status: 'needs_review', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', accepted_tenant_id: 101, accepted_invoice_id: 9999 },
    // Accepted - valid match (ready)
    { id: 6005, organization_id: 1, amount: 5000, transaction_date: '2026-06-20', status: 'needs_review', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', accepted_tenant_id: 101, accepted_invoice_id: 201 },
    // Accepted - overpaid match (ready)
    { id: 6006, organization_id: 1, amount: 8000, transaction_date: '2026-06-20', status: 'needs_review', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', accepted_tenant_id: 101, accepted_invoice_id: 201 },
    // Accepted - negative amount (invalid)
    { id: 6007, organization_id: 1, amount: -100, transaction_date: '2026-06-20', status: 'needs_review', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', accepted_tenant_id: 101, accepted_invoice_id: 201 }
  ]);

  apiDb.seed('tenants', [
    { id: 101, organization_id: 1, full_name: 'Alice Tenant', tenant_account_number: 'ACC-T1', status: 'active' }
  ]);

  apiDb.seed('invoices', [
    { id: 201, organization_id: 1, tenant_id: 101, invoice_number: 'INV-201', status: 'issued', balance: 6000, total: 6000, due_date: '2026-06-15' }
  ]);

  let previewResStatus = null;
  let previewResResult = null;
  const mockResPreview = {
    status(code) { previewResStatus = code; return this; },
    json(data) { previewResResult = data; return this; }
  };

  // 1. Wrong organization is blocked / returns 404
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 2, role: 'landlord', userId: 10 },
    params: { id: '6001' }
  }, mockResPreview);
  assert('Wrong organization returns HTTP 404', previewResStatus === 404 && previewResResult.error === 'ROW_NOT_FOUND');

  // 2. Unreviewed row returns 'not_reviewed' state and false can_confirm_allocation
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6001' }
  }, mockResPreview);
  assert('Unreviewed row returns not_reviewed status', previewResResult && previewResResult.ready === false && previewResResult.state === 'not_reviewed');
  assert('Unreviewed row has can_confirm_allocation false', previewResResult && previewResResult.confirmation_contract.can_confirm_allocation === false && previewResResult.confirmation_contract.blocking_reasons.includes('Evidence row has not been reviewed yet.'));

  // 3. Ignored row returns 'ignored' state and false can_confirm_allocation
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6002' }
  }, mockResPreview);
  assert('Ignored row returns ignored status', previewResResult && previewResResult.ready === false && previewResResult.state === 'ignored');
  assert('Ignored row has can_confirm_allocation false', previewResResult && previewResResult.confirmation_contract.can_confirm_allocation === false && previewResResult.confirmation_contract.blocking_reasons.includes('Evidence row is ignored or irrelevant.'));

  // 4. Missing tenant accepted match returns 'missing_tenant' state and false can_confirm_allocation
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6003' }
  }, mockResPreview);
  assert('Missing tenant match returns missing_tenant status', previewResResult && previewResResult.ready === false && previewResResult.state === 'missing_tenant');
  assert('Missing tenant match has can_confirm_allocation false', previewResResult && previewResResult.confirmation_contract.can_confirm_allocation === false && previewResResult.confirmation_contract.blocking_reasons.includes('Accepted tenant is missing or does not exist.'));

  // 5. Missing invoice accepted match returns 'missing_invoice' state and false can_confirm_allocation
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6004' }
  }, mockResPreview);
  assert('Missing invoice match returns missing_invoice status', previewResResult && previewResResult.ready === false && previewResResult.state === 'missing_invoice');
  assert('Missing invoice match has can_confirm_allocation false', previewResResult && previewResResult.confirmation_contract.can_confirm_allocation === false && previewResResult.confirmation_contract.blocking_reasons.includes('Accepted invoice is missing or does not exist.'));

  // 6. Negative amount returns 'amount_invalid' state and false can_confirm_allocation
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6007' }
  }, mockResPreview);
  assert('Negative amount has can_confirm_allocation false', previewResResult && previewResResult.confirmation_contract.can_confirm_allocation === false && previewResResult.confirmation_contract.blocking_reasons.includes('Payment evidence amount must be positive.'));

  // 7. Valid accepted match returns 'ready_for_draft_allocation' and calculates preview details (partial payment case)
  previewResStatus = null;
  previewResResult = null;
  const initialInvoiceListPreview = JSON.stringify(apiDb.get('invoices'));
  const initialTenantListPreview = JSON.stringify(apiDb.get('tenants'));

  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6005' }
  }, mockResPreview);

  assert('Valid match returns ready_for_draft_allocation status', previewResResult && previewResResult.ready === true && previewResResult.state === 'ready_for_draft_allocation');
  assert('Calculates partial payment allocation amount preview correctly', previewResResult && previewResResult.allocation_amount_preview === 5000);
  assert('Calculates remaining balance preview correctly', previewResResult && previewResResult.remaining_balance_preview === 1000);
  assert('Calculates overpayment preview as zero correctly', previewResResult && previewResResult.overpayment_preview === 0);
  assert('Returns the safety message correctly', previewResResult && previewResResult.safety_message === 'This is a draft allocation preview only. No invoice, tenant balance, ledger, receipt, or payment record has been changed.');

  // Confirmation contract assertions
  assert('Valid match has can_confirm_allocation true', previewResResult && previewResResult.confirmation_contract.can_confirm_allocation === true);
  assert('Confirmation contract returns required confirmation text', previewResResult && previewResResult.confirmation_contract.required_confirmation_text === 'CONFIRM ALLOCATION PREVIEW');
  assert('Confirmation contract returns zero blocking reasons', previewResResult && previewResResult.confirmation_contract.blocking_reasons.length === 0);
  assert('Confirmation contract requires landlord confirmation', previewResResult && previewResResult.confirmation_contract.requires_landlord_confirmation === true);
  assert('Confirmation contract has contract-level safety message', previewResResult && previewResResult.confirmation_contract.safety_message === 'This confirmation contract is read-only. No allocation, invoice, tenant balance, ledger, receipt, or payment record has been changed.');

  // 8. Overpaid accepted match calculates overpayment correctly
  previewResStatus = null;
  previewResResult = null;
  await previewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6006' }
  }, mockResPreview);

  assert('Overpaid match returns ready_for_draft_allocation status', previewResResult && previewResResult.ready === true && previewResResult.state === 'ready_for_draft_allocation');
  assert('Calculates full payment allocation amount preview correctly', previewResResult && previewResResult.allocation_amount_preview === 6000);
  assert('Calculates remaining balance preview as zero correctly', previewResResult && previewResResult.remaining_balance_preview === 0);
  assert('Calculates overpayment preview correctly', previewResResult && previewResResult.overpayment_preview === 2000);

  // Immutability checks: confirm no database state mutations occurred
  assert('Invoices table remains un-mutated', JSON.stringify(apiDb.get('invoices')) === initialInvoiceListPreview);
  assert('Tenants table remains un-mutated', JSON.stringify(apiDb.get('tenants')) === initialTenantListPreview);
  assert('No payment allocation records created', apiDb.get('payment_allocations').length === 0);
  assert('No ledger records created', apiDb.get('transactions').length === 0);
  assert('No receipt records created', apiDb.get('receipts').length === 0);
  assert('payment_evidence.status is unchanged', apiDb.get('payment_evidence')[0].status === 'needs_review');

  // Frontend/Static checks
  assert(
    'PaymentEvidence.jsx renders Draft Allocation Preview section',
    paymentEvidenceContent.includes('Draft Allocation Preview')
  );

  assert(
    'PaymentEvidence.jsx renders Confirmation Requirements header',
    paymentEvidenceContent.includes('Confirmation Requirements')
  );

  assert(
    'PaymentEvidence.jsx renders required confirmation text',
    paymentEvidenceContent.includes('previewData.confirmation_contract.required_confirmation_text')
  );

  assert(
    'PaymentEvidence.jsx renders blocking reasons',
    paymentEvidenceContent.includes('previewData.confirmation_contract.blocking_reasons')
  );

  assert(
    'PaymentEvidence.jsx contains preview safety notice copy',
    paymentEvidenceContent.includes('previewData.safety_message')
  );

  assert(
    'PaymentEvidence.jsx contains contract security notice copy',
    paymentEvidenceContent.includes('previewData.confirmation_contract.safety_message')
  );

  assert(
    'PaymentEvidence.jsx fetches allocation-preview endpoint',
    paymentEvidenceContent.includes('allocation-preview')
  );

  assert(
    'PaymentEvidence.jsx has Refresh Preview button and no forbidden buttons',
    paymentEvidenceContent.includes('Refresh Preview') &&
    !paymentEvidenceContent.includes('Allocate Payment') &&
    !paymentEvidenceContent.includes('Apply Payment') &&
    !paymentEvidenceContent.includes('Finalize Payment')
  );

  // ==========================================
  // Test 14: Confirmed Payment Evidence Allocation Execution
  // ==========================================
  console.log('\n14. Confirmed Payment Evidence Allocation Execution:');

  const executionHandler = getRouteHandler('/payment-evidence/:id/confirm-allocation');
  const executionMiddlewares = getRouteMiddlewares('/payment-evidence/:id/confirm-allocation');

  assert(
    'Allocation Execution endpoint requires landlord or super_admin role',
    executionMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  // Access control checks for execution
  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let blockedStatus = null;
    let blockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware({
      auth: { role: blockedRole, organizationId: 1, userId: 99 }
    }, {
      status(code) { blockedStatus = code; return this; },
      json() { return this; }
    }, () => { blockedNextCalled = true; });

    assert(`Allocation Execution endpoint blocks ${blockedRole}`, blockedStatus === 403 && blockedNextCalled === false);
  }

  let execResStatus = null;
  let execResResult = null;
  const mockResExec = {
    status(code) { execResStatus = code; return this; },
    json(data) { execResResult = data; return this; }
  };

  // 1. Wrong organization is blocked / returns 404
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 2, role: 'landlord', userId: 10 },
    params: { id: '6005' },
    body: { confirmation_text: 'CONFIRM ALLOCATION PREVIEW' }
  }, mockResExec);
  assert('Execution blocks wrong organization with 404', execResStatus === 404 && execResResult.error === 'ROW_NOT_FOUND');

  // 2. Missing confirmation text rejected
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6005' },
    body: {}
  }, mockResExec);
  assert('Missing confirmation text rejected with 400', execResStatus === 400 && execResResult.error === 'CONFIRMATION_TEXT_REQUIRED');

  // 3. Wrong confirmation text rejected
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6005' },
    body: { confirmation_text: 'WRONG_CONFIRM' }
  }, mockResExec);
  assert('Wrong confirmation text rejected with 400', execResStatus === 400 && execResResult.error === 'INVALID_CONFIRMATION_TEXT');

  // 4. Unreviewed evidence rejected
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6001' },
    body: { confirmation_text: 'CONFIRM ALLOCATION PREVIEW' }
  }, mockResExec);
  assert('Unreviewed evidence execution rejected', execResStatus === 400 && execResResult.error === 'INVALID_REVIEW_STATE');

  // 5. Ignored evidence rejected
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6002' },
    body: { confirmation_text: 'CONFIRM ALLOCATION PREVIEW' }
  }, mockResExec);
  assert('Ignored evidence execution rejected', execResStatus === 400 && (execResResult.error === 'ALREADY_ALLOCATED' || execResResult.error === 'INVALID_REVIEW_STATE'));

  // 6. Overpayment rejected if no wallet/credit support exists
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '6006' },
    body: { confirmation_text: 'CONFIRM ALLOCATION PREVIEW' }
  }, mockResExec);
  assert('Overpayment allocation rejected with OVERPAYMENT_NOT_SUPPORTED', execResStatus === 400 && execResResult.error === 'OVERPAYMENT_NOT_SUPPORTED' && execResResult.message === 'Overpayment allocation requires wallet credit support and is not enabled yet.');

  // Reset database state and mock tables for successful execution
  apiDb.seed('payment_evidence', [
    { id: 7001, organization_id: 1, amount: 4000, transaction_date: '2026-06-20', status: 'needs_review', review_status: 'accepted_suggestion', review_decision: 'accepted_suggestion', accepted_tenant_id: 101, accepted_invoice_id: 201 }
  ]);

  apiDb.seed('tenants', [
    { id: 101, organization_id: 1, full_name: 'Alice Tenant', tenant_account_number: 'ACC-T1', status: 'active', currency: 'KES', property_id: 5, unit_id: 2 }
  ]);

  apiDb.seed('invoices', [
    { id: 201, organization_id: 1, tenant_id: 101, invoice_number: 'INV-201', status: 'issued', balance: 6000, total: 6000, amount_paid: 0, due_date: '2026-06-15' }
  ]);

  apiDb.seed('transactions', []);
  apiDb.seed('payment_allocations', []);
  apiDb.seed('payment_evidence_review_audit', []);

  // 7. Valid partial allocation succeeds
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '7001' },
    body: { confirmation_text: 'CONFIRM ALLOCATION PREVIEW' }
  }, mockResExec);

  assert('Valid confirm-allocation returns success true', execResResult && execResResult.success === true);
  assert('Allocation response outputs correctly calculated remaining balance', execResResult && execResResult.remaining_balance === 2000);
  assert('Allocation response outputs zero overpayment', execResResult && execResResult.overpayment_amount === 0);
  assert('Allocation response returns correct safety message', execResResult && execResResult.safety_message === 'Confirmed allocation applied exactly once. Invoice/payment records were updated according to the confirmed preview. No unrelated tenant, ledger, or receipt records were changed.');

  // Verify database updates
  const updatedInvoice = await apiDb.findOne('invoices', { id: 201 });
  assert('Invoice balance decreases correctly', updatedInvoice.balance === 2000);
  assert('Invoice amount_paid increases correctly', updatedInvoice.amount_paid === 4000);
  assert('Invoice status updated to partially_paid', updatedInvoice.status === 'partially_paid');

  const updatedEvidence = await apiDb.findOne('payment_evidence', { id: 7001 });
  assert('Payment evidence status changes to manually_reconciled', updatedEvidence.status === 'manually_reconciled');

  const allTxs = apiDb.get('transactions');
  assert('Allocation creates exactly one transaction record', allTxs.length === 1);
  assert('Created transaction has reconciled status', allTxs[0].status === 'reconciled');
  assert('Created transaction links to correct tenant', allTxs[0].tenant_id === 101);
  assert('Created transaction links to unit and property', allTxs[0].unit_id === 2 && allTxs[0].property_id === 5);

  const allAllocations = apiDb.get('payment_allocations');
  assert('Allocation creates exactly one payment allocation record', allAllocations.length === 1);
  assert('Created allocation has correct allocated amount', allAllocations[0].amount_allocated === 4000);
  assert('Created allocation links to correct transaction and invoice', allAllocations[0].transaction_id === allTxs[0].id && allAllocations[0].invoice_id === 201);

  const allAudits = apiDb.get('payment_evidence_review_audit');
  assert('Execution creates exactly one audit row', allAudits.length === 1);
  assert('Created audit row records confirm_allocation action', allAudits[0].action === 'confirm_allocation');

  // Idempotency: repeated POST for same evidence is rejected
  execResStatus = null;
  execResResult = null;
  await executionHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '7001' },
    body: { confirmation_text: 'CONFIRM ALLOCATION PREVIEW' }
  }, mockResExec);

  assert('Repeated confirm-allocation is rejected', execResStatus === 400 && execResResult.error === 'ALREADY_ALLOCATED');
  assert('Invoice balance remains unchanged on repeated POST', apiDb.get('invoices')[0].balance === 2000);
  assert('No additional transaction records created', apiDb.get('transactions').length === 1);

  // Frontend/Static checks
  assert(
    'PaymentEvidence.jsx renders Confirm Allocation button',
    paymentEvidenceContent.includes('Confirm Allocation')
  );

  assert(
    'PaymentEvidence.jsx requires typed confirmation state',
    paymentEvidenceContent.includes('typedConfirmationText') &&
    paymentEvidenceContent.includes('setTypedConfirmationText')
  );

  assert(
    'PaymentEvidence.jsx calls POST confirm-allocation API endpoint',
    paymentEvidenceContent.includes('confirm-allocation') &&
    paymentEvidenceContent.includes("method: 'POST'")
  );

  assert(
    'PaymentEvidence.jsx uses branded window.showConfirm',
    paymentEvidenceContent.includes('showConfirm(') &&
    !paymentEvidenceContent.includes('window.confirm(')
  );

  assert(
    'PaymentEvidence.jsx does not contain forbidden unsupported buttons/labels',
    !paymentEvidenceContent.includes('Create Receipt') &&
    !paymentEvidenceContent.includes('Post Ledger') &&
    !paymentEvidenceContent.includes('Finalize Payment')
  );

  // ==========================================
  // Test 15: Payment Evidence Allocation Result Visibility + Reversal Readiness
  // ==========================================
  console.log('\n15. Payment Evidence Allocation Result Visibility + Reversal Readiness:');

  const resultHandler = getRouteHandler('/payment-evidence/:id/allocation-result');
  const resultMiddlewares = getRouteMiddlewares('/payment-evidence/:id/allocation-result');

  assert(
    'Allocation Result endpoint requires landlord or super_admin role',
    resultMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  // Access control checks for result lookup
  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let blockedStatus = null;
    let blockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware({
      auth: { role: blockedRole, organizationId: 1, userId: 99 }
    }, {
      status(code) { blockedStatus = code; return this; },
      json() { return this; }
    }, () => { blockedNextCalled = true; });

    assert(`Allocation Result endpoint blocks ${blockedRole}`, blockedStatus === 403 && blockedNextCalled === false);
  }

  let resultResStatus = null;
  let resultResResult = null;
  const mockResResult = {
    status(code) { resultResStatus = code; return this; },
    json(data) { resultResResult = data; return this; }
  };

  // 1. Wrong organization is blocked / returns 404
  resultResStatus = null;
  resultResResult = null;
  await resultHandler({
    auth: { organizationId: 2, role: 'landlord', userId: 10 },
    params: { id: '7001' }
  }, mockResResult);
  assert('Result lookup blocks wrong organization with 404', resultResStatus === 404 && resultResResult.error === 'ROW_NOT_FOUND');

  // 2. Unallocated evidence returns allocated: false
  apiDb.seed('payment_evidence', [
    { id: 8001, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'needs_review', review_status: null }
  ]);

  resultResStatus = null;
  resultResResult = null;
  await resultHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8001' }
  }, mockResResult);

  assert('Unallocated evidence returns allocated false', resultResResult && resultResResult.allocation_result.allocated === false);
  assert('Unallocated evidence returns state not_allocated', resultResResult && resultResResult.allocation_result.state === 'not_allocated');
  assert('Unallocated evidence returns reversal contract as false', resultResResult && resultResResult.reversal_readiness.can_request_reversal === false);

  // 3. Allocated evidence returns allocated: true and all linked details
  apiDb.seed('payment_evidence', [
    { id: 8002, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'manually_reconciled', review_status: 'accepted_suggestion', accepted_tenant_id: 102, accepted_invoice_id: 202 }
  ]);
  apiDb.seed('tenants', [
    { id: 102, organization_id: 1, full_name: 'Bob Tenant', tenant_account_number: 'ACC-T2', status: 'active', currency: 'KES' }
  ]);
  apiDb.seed('invoices', [
    { id: 202, organization_id: 1, tenant_id: 102, invoice_number: 'INV-202', status: 'paid', balance: 0, total: 5000, amount_paid: 5000 }
  ]);
  apiDb.seed('transactions', [
    { id: 501, organization_id: 1, tenant_id: 102, amount: 5000, transaction_type: 'payment', status: 'reconciled', raw_payload: JSON.stringify({ evidence_id: 8002, source: 'payment_evidence_allocation' }) }
  ]);
  apiDb.seed('payment_allocations', [
    { id: 601, organization_id: 1, transaction_id: 501, invoice_id: 202, amount_allocated: 5000, allocated_at: '2026-06-21T12:00:00.000Z' }
  ]);
  apiDb.seed('payment_evidence_review_audit', [
    { id: 901, organization_id: 1, payment_evidence_id: 8002, action: 'confirm_allocation', safety_message: 'test' }
  ]);

  resultResStatus = null;
  resultResResult = null;
  await resultHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8002' }
  }, mockResResult);

  assert('Allocated evidence returns allocated true', resultResResult && resultResResult.allocation_result.allocated === true);
  assert('Allocated result contains transaction_id', resultResResult && resultResResult.allocation_result.transaction_id === 501);
  assert('Allocated result contains payment_allocation_id', resultResResult && resultResResult.allocation_result.payment_allocation_id === 601);
  assert('Allocated result contains tenant_name', resultResResult && resultResResult.allocation_result.tenant_name === 'Bob Tenant');
  assert('Allocated result contains invoice_number', resultResResult && resultResResult.allocation_result.invoice_number === 'INV-202');
  assert('Allocated result contains allocation_amount', resultResResult && resultResResult.allocation_result.allocation_amount === 5000);
  assert('Allocated result contains invoice_balance_after', resultResResult && resultResResult.allocation_result.invoice_balance_after === 0);
  assert('Allocated result contains audit_reference', resultResResult && resultResResult.allocation_result.audit_reference === '901');

  // 4. Reversal readiness checks
  assert('Reversal readiness shows can_request_reversal false', resultResResult && resultResResult.reversal_readiness.can_request_reversal === false);
  assert('Reversal readiness returns state reversal_not_enabled', resultResResult && resultResResult.reversal_readiness.state === 'reversal_not_enabled');
  assert('Reversal readiness contains blocking reason', resultResResult && resultResResult.reversal_readiness.blocking_reasons[0] === 'Reversal execution is not enabled in this release.');
  assert('Reversal readiness future confirmation text is CONFIRM ALLOCATION REVERSAL', resultResResult && resultResResult.reversal_readiness.required_future_confirmation_text === 'CONFIRM ALLOCATION REVERSAL');
  assert('Reversal readiness has safety message', resultResResult && resultResResult.reversal_readiness.safety_message === 'This is reversal readiness only. No allocation, invoice, transaction, ledger, receipt, or tenant record has been changed.');

  // 5. Immutability checks: confirm lookup causes zero mutations
  assert('Result lookup has read-only safety message', resultResResult && resultResResult.safety_message === 'Allocation result is read-only. No financial records were changed by this lookup.');
  assert('Invoices count unchanged', apiDb.get('invoices').length === 1);
  assert('Tenants count unchanged', apiDb.get('tenants').length === 1);
  assert('Transactions count unchanged', apiDb.get('transactions').length === 1);
  assert('Payment allocations count unchanged', apiDb.get('payment_allocations').length === 1);
  assert('Payment evidence count unchanged', apiDb.get('payment_evidence').length === 1);
  assert('No ledger records created', apiDb.get('transactions').filter(t => t.ledger).length === 0);

  // Frontend/Static checks
  assert(
    'PaymentEvidence.jsx renders Allocation Result',
    paymentEvidenceContent.includes('Allocation Result')
  );

  assert(
    'PaymentEvidence.jsx renders Reversal Readiness',
    paymentEvidenceContent.includes('Reversal Readiness')
  );

  assert(
    'PaymentEvidence.jsx renders CONFIRM ALLOCATION REVERSAL',
    paymentEvidenceContent.includes('CONFIRM ALLOCATION REVERSAL')
  );

  assert(
    'PaymentEvidence.jsx renders read-only safety notice',
    paymentEvidenceContent.includes('reversal_readiness.safety_message')
  );

  assert(
    'PaymentEvidence.jsx fetches allocation-result via GET',
    paymentEvidenceContent.includes('allocation-result') &&
    paymentEvidenceContent.includes('fetchAllocationResult')
  );

  assert(
    'PaymentEvidence.jsx has no unsupported final action buttons',
    !paymentEvidenceContent.includes('Reverse Allocation') &&
    !paymentEvidenceContent.includes('Void Payment') &&
    !paymentEvidenceContent.includes('Refund') &&
    !paymentEvidenceContent.includes('Delete Allocation')
  );

  // ==========================================
  // Test 16: Payment Evidence Receipt Readiness + Draft Receipt Preview
  // ==========================================
  console.log('\n16. Payment Evidence Receipt Readiness + Draft Receipt Preview:');

  const receiptPreviewHandler = getRouteHandler('/payment-evidence/:id/receipt-preview');
  const receiptPreviewMiddlewares = getRouteMiddlewares('/payment-evidence/:id/receipt-preview');

  assert(
    'Receipt Preview endpoint requires landlord or super_admin role',
    receiptPreviewMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  // Access control checks for preview lookup
  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let blockedStatus = null;
    let blockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware({
      auth: { role: blockedRole, organizationId: 1, userId: 99 }
    }, {
      status(code) { blockedStatus = code; return this; },
      json() { return this; }
    }, () => { blockedNextCalled = true; });

    assert(`Receipt Preview endpoint blocks ${blockedRole}`, blockedStatus === 403 && blockedNextCalled === false);
  }

  let receiptPreviewResponseStatus = null;
  let receiptPreviewResponse = null;
  const mockResReceiptPreview = {
    status(code) { receiptPreviewResponseStatus = code; return this; },
    json(data) { receiptPreviewResponse = data; return this; }
  };

  apiDb.seed('payment_evidence', [
    { id: 8001, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'needs_review', review_status: null }
  ]);

  // 1. Wrong organization is blocked / returns 404
  receiptPreviewResponseStatus = null;
  receiptPreviewResponse = null;
  await receiptPreviewHandler({
    auth: { organizationId: 2, role: 'landlord', userId: 10 },
    params: { id: '8003' }
  }, mockResReceiptPreview);
  assert('Receipt preview blocks wrong organization with 404', receiptPreviewResponseStatus === 404 && receiptPreviewResponse.error === 'ROW_NOT_FOUND');

  // 2. Unallocated evidence returns eligible: false
  receiptPreviewResponseStatus = null;
  receiptPreviewResponse = null;
  await receiptPreviewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8001' }
  }, mockResReceiptPreview);

  assert('Unallocated evidence returns eligible false', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.eligible === false);
  assert('Unallocated evidence returns state not_allocated', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.state === 'not_allocated');
  assert('Unallocated evidence returns can_issue_receipt as false', receiptPreviewResponse && receiptPreviewResponse.issuance_readiness.can_issue_receipt === false);

  // 3. Allocated evidence returns eligible: true and all resolved details
  apiDb.seed('properties', [
    { id: 301, organization_id: 1, name: 'Premium Heights' }
  ]);
  apiDb.seed('units', [
    { id: 401, organization_id: 1, unit_code: 'U-401' }
  ]);
  apiDb.seed('tenants', [
    { id: 102, organization_id: 1, full_name: 'Bob Tenant', tenant_account_number: 'ACC-T2', status: 'active', currency: 'KES', property_id: 301, unit_id: 401 }
  ]);
  apiDb.seed('payment_evidence', [
    { id: 8001, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'needs_review', review_status: null },
    { id: 8003, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'manually_reconciled', review_status: 'accepted_suggestion', accepted_tenant_id: 102, accepted_invoice_id: 202, collection_channel: 'mpesa', transaction_code: 'MPESA123' }
  ]);
  apiDb.seed('invoices', [
    { id: 202, organization_id: 1, tenant_id: 102, invoice_number: 'INV-202', status: 'paid', balance: 0, total: 5000, amount_paid: 5000 }
  ]);
  apiDb.seed('transactions', [
    { id: 501, organization_id: 1, tenant_id: 102, amount: 5000, transaction_type: 'payment', status: 'reconciled', raw_payload: JSON.stringify({ evidence_id: 8003, source: 'payment_evidence_allocation' }) }
  ]);
  apiDb.seed('payment_allocations', [
    { id: 601, organization_id: 1, transaction_id: 501, invoice_id: 202, amount_allocated: 5000, allocated_at: '2026-06-21T12:00:00.000Z' }
  ]);

  receiptPreviewResponseStatus = null;
  receiptPreviewResponse = null;
  await receiptPreviewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8003' }
  }, mockResReceiptPreview);

  assert('Allocated evidence returns eligible true', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.eligible === true);
  assert('Allocated evidence returns state ready_for_receipt_preview', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.state === 'ready_for_receipt_preview');
  assert('Receipt preview contains tenant id/name', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.tenant_id === 102 && receiptPreviewResponse.receipt_preview.tenant_name === 'Bob Tenant');
  assert('Receipt preview contains invoice id/number', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.invoice_id === 202 && receiptPreviewResponse.receipt_preview.invoice_number === 'INV-202');
  assert('Receipt preview contains transaction_id', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.transaction_id === 501);
  assert('Receipt preview contains payment_allocation_id', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.payment_allocation_id === 601);
  assert('Receipt preview contains payment date', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.payment_date === '2026-06-21');
  assert('Receipt preview contains payment method', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.payment_method === 'mpesa');
  assert('Receipt preview contains amount paid', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.amount_paid === 5000);
  assert('Receipt preview contains invoice balance after', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.invoice_balance_after === 0);
  assert('Receipt preview contains invoice status', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.invoice_status === 'paid');
  assert('Receipt preview contains property name', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.property_name === 'Premium Heights');
  assert('Receipt preview contains unit label', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.unit_label === 'U-401');
  assert('Receipt preview contains draft receipt number preview beginning with DRAFT-', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.receipt_number_preview === 'DRAFT-MPESA123');
  assert('Receipt preview has correct line item amount', receiptPreviewResponse && receiptPreviewResponse.receipt_preview.receipt_lines[0].amount === 5000);

  // 4. Issuance readiness checks
  assert('Receipt issuance readiness shows can_issue_receipt false', receiptPreviewResponse && receiptPreviewResponse.issuance_readiness.can_issue_receipt === false);
  assert('Receipt issuance readiness returns state receipt_issuance_not_enabled', receiptPreviewResponse && receiptPreviewResponse.issuance_readiness.state === 'receipt_issuance_not_enabled');
  assert('Receipt issuance readiness contains blocking reason', receiptPreviewResponse && receiptPreviewResponse.issuance_readiness.blocking_reasons[0] === 'Receipt issuance is not enabled in this release.');
  assert('Receipt issuance readiness future confirmation text is CONFIRM RECEIPT ISSUANCE', receiptPreviewResponse && receiptPreviewResponse.issuance_readiness.required_future_confirmation_text === 'CONFIRM RECEIPT ISSUANCE');
  assert('Receipt issuance readiness has safety message', receiptPreviewResponse && receiptPreviewResponse.issuance_readiness.safety_message === 'This is a receipt preview only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.');

  // 5. Immutability checks: confirm lookup causes zero mutations
  assert('Receipt preview has read-only safety message', receiptPreviewResponse && receiptPreviewResponse.safety_message === 'Receipt preview is read-only. No financial or receipt records were changed by this lookup.');
  assert('Invoices count unchanged', apiDb.get('invoices').length === 1);
  assert('Tenants count unchanged', apiDb.get('tenants').length === 1);
  assert('Transactions count unchanged', apiDb.get('transactions').length === 1);
  assert('Payment allocations count unchanged', apiDb.get('payment_allocations').length === 1);
  assert('Payment evidence count unchanged', apiDb.get('payment_evidence').length === 2);
  assert('No ledger records created', apiDb.get('transactions').filter(t => t.ledger).length === 0);
  assert('No receipt records created', apiDb.get('receipts').length === 0);

  // Frontend/Static checks
  assert(
    'PaymentEvidence.jsx renders Receipt Preview',
    paymentEvidenceContent.includes('Receipt Preview')
  );

  assert(
    'PaymentEvidence.jsx renders Receipt Issuance Readiness',
    paymentEvidenceContent.includes('Receipt Issuance Readiness')
  );

  assert(
    'PaymentEvidence.jsx renders CONFIRM RECEIPT ISSUANCE',
    paymentEvidenceContent.includes('CONFIRM RECEIPT ISSUANCE')
  );

  assert(
    'PaymentEvidence.jsx renders Refresh Receipt Preview',
    paymentEvidenceContent.includes('Refresh Receipt Preview')
  );

  assert(
    'PaymentEvidence.jsx fetches receipt-preview via GET only',
    paymentEvidenceContent.includes('receipt-preview') &&
    paymentEvidenceContent.includes('fetchReceiptPreview')
  );

  assert(
    'PaymentEvidence.jsx has no receipt or ledger issuance API calls',
    !paymentEvidenceContent.includes('/api/receipts') &&
    !paymentEvidenceContent.includes('/api/ledger')
  );

  assert(
    'PaymentEvidence.jsx has no unsupported final action labels for receipts',
    !paymentEvidenceContent.includes('Create Receipt') &&
    !paymentEvidenceContent.includes('Send Receipt') &&
    !paymentEvidenceContent.includes('Download Receipt') &&
    !paymentEvidenceContent.includes('Print Receipt') &&
    !paymentEvidenceContent.includes('Post Ledger') &&
    !paymentEvidenceContent.includes('Finalize Receipt') &&
    !paymentEvidenceContent.includes('Void Receipt')
  );

  // ==========================================
  // Test 17: Receipt Issuance Guardrails + Numbering Contract
  // ==========================================
  console.log('\n17. Receipt Issuance Guardrails + Numbering Contract:');

  const receiptContractHandler = getRouteHandler('/payment-evidence/:id/receipt-preview');
  let receiptContractStatus = null;
  let receiptContractResponse = null;
  const receiptContractMockRes = {
    status(code) { receiptContractStatus = code; return this; },
    json(data) { receiptContractResponse = data; return this; }
  };

  apiDb.seed('payment_evidence', [
    { id: 8101, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'needs_review', review_status: null }
  ]);
  apiDb.seed('invoices', []);
  apiDb.seed('tenants', []);
  apiDb.seed('transactions', []);
  apiDb.seed('payment_allocations', []);

  receiptContractStatus = null;
  receiptContractResponse = null;
  await receiptContractHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8101' }
  }, receiptContractMockRes);

  assert('Receipt preview includes receipt_issuance_contract', receiptContractResponse && Boolean(receiptContractResponse.receipt_issuance_contract));
  assert('Receipt issuance contract confirmation text is CONFIRM RECEIPT ISSUANCE', receiptContractResponse && receiptContractResponse.receipt_issuance_contract.required_confirmation_text === 'CONFIRM RECEIPT ISSUANCE');
  assert('Receipt issuance contract keeps can_issue_receipt false for unallocated evidence', receiptContractResponse && receiptContractResponse.receipt_issuance_contract.can_issue_receipt === false);
  assert('Unallocated evidence contract has blocking reason', receiptContractResponse && receiptContractResponse.receipt_issuance_contract.blocking_reasons.includes('Payment evidence must be allocated before receipt issuance.'));

  apiDb.seed('properties', [
    { id: 311, organization_id: 1, name: 'Contract Towers' }
  ]);
  apiDb.seed('units', [
    { id: 411, organization_id: 1, unit_code: 'C-11' }
  ]);
  apiDb.seed('tenants', [
    { id: 112, organization_id: 1, full_name: 'Contract Tenant', tenant_account_number: 'ACC-C11', status: 'active', currency: 'KES', property_id: 311, unit_id: 411 }
  ]);
  apiDb.seed('payment_evidence', [
    { id: 8101, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'needs_review', review_status: null },
    { id: 8103, organization_id: 1, amount: 5000, transaction_date: '2026-06-21', status: 'manually_reconciled', review_status: 'accepted_suggestion', accepted_tenant_id: 112, accepted_invoice_id: 212, collection_channel: 'mpesa', transaction_code: 'MPESA8103' }
  ]);
  apiDb.seed('invoices', [
    { id: 212, organization_id: 1, tenant_id: 112, invoice_number: 'INV-212', status: 'paid', balance: 0, total: 5000, amount_paid: 5000 }
  ]);
  apiDb.seed('transactions', [
    { id: 511, organization_id: 1, tenant_id: 112, amount: 5000, transaction_type: 'payment', status: 'reconciled', raw_payload: JSON.stringify({ evidence_id: 8103, source: 'payment_evidence_allocation' }) }
  ]);
  apiDb.seed('payment_allocations', [
    { id: 611, organization_id: 1, transaction_id: 511, invoice_id: 212, amount_allocated: 5000, allocated_at: '2026-06-21T12:00:00.000Z' }
  ]);

  const receiptContractInvoiceBefore = JSON.stringify(apiDb.get('invoices'));
  const receiptContractTenantBefore = JSON.stringify(apiDb.get('tenants'));
  const receiptContractEvidenceBefore = JSON.stringify(apiDb.get('payment_evidence'));
  const receiptContractTransactionCountBefore = apiDb.get('transactions').length;
  const receiptContractAllocationCountBefore = apiDb.get('payment_allocations').length;
  const receiptContractReceiptCountBefore = apiDb.get('receipts').length;

  receiptContractStatus = null;
  receiptContractResponse = null;
  await receiptContractHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8103' }
  }, receiptContractMockRes);

  const allocatedReceiptContract = receiptContractResponse && receiptContractResponse.receipt_issuance_contract;
  assert('Allocated evidence includes receipt issuance contract fields', allocatedReceiptContract && allocatedReceiptContract.requires_allocated_payment_evidence === true && allocatedReceiptContract.requires_existing_transaction === true && allocatedReceiptContract.requires_existing_payment_allocation === true && allocatedReceiptContract.requires_existing_invoice === true && allocatedReceiptContract.requires_existing_tenant === true && allocatedReceiptContract.requires_no_existing_receipt === true);
  assert('Allocated contract enables confirmed receipt issuance when no receipt exists', allocatedReceiptContract && allocatedReceiptContract.can_issue_receipt === true);
  assert('Allocated contract reports ready state for confirmed receipt issuance', allocatedReceiptContract && allocatedReceiptContract.state === 'ready_for_confirmed_receipt_issuance');
  assert('Duplicate check state is a supported contract state', allocatedReceiptContract && ['receipt_schema_not_enabled', 'no_existing_receipt', 'existing_receipt_found'].includes(allocatedReceiptContract.duplicate_check_state));
  assert('Duplicate check reports no existing receipt when receipt storage is empty', allocatedReceiptContract && allocatedReceiptContract.duplicate_check_state === 'no_existing_receipt');
  assert('Receipt number strategy is preview_only_not_reserved', allocatedReceiptContract && allocatedReceiptContract.receipt_number_strategy === 'preview_only_not_reserved');
  assert('Receipt number preview begins with DRAFT-', allocatedReceiptContract && String(allocatedReceiptContract.receipt_number_preview).startsWith('DRAFT-'));
  assert('Receipt number format preview is present', allocatedReceiptContract && allocatedReceiptContract.receipt_number_format_preview === 'RCP-{ORG}-{YYYY}-{SEQUENCE}');
  assert('Receipt issuance contract safety message is read-only', allocatedReceiptContract && allocatedReceiptContract.safety_message === 'This receipt issuance contract is read-only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.');

  assert('Contract lookup leaves invoice unchanged', JSON.stringify(apiDb.get('invoices')) === receiptContractInvoiceBefore);
  assert('Contract lookup leaves tenant unchanged', JSON.stringify(apiDb.get('tenants')) === receiptContractTenantBefore);
  assert('Contract lookup leaves payment evidence unchanged', JSON.stringify(apiDb.get('payment_evidence')) === receiptContractEvidenceBefore);
  assert('Contract lookup leaves transaction count unchanged', apiDb.get('transactions').length === receiptContractTransactionCountBefore);
  assert('Contract lookup leaves payment allocation count unchanged', apiDb.get('payment_allocations').length === receiptContractAllocationCountBefore);
  assert('Contract lookup creates no receipt records', apiDb.get('receipts').length === receiptContractReceiptCountBefore);
  assert('Contract lookup creates no ledger records', apiDb.get('transactions').filter(t => t.ledger).length === 0);

  assert(
    'Confirmed receipt issuance route is present for the execution slice',
    routeContent.includes("router.post('/payment-evidence/:id/issue-receipt'")
  );

  assert(
    'PaymentEvidence.jsx renders Receipt Issuance Requirements',
    paymentEvidenceContent.includes('Receipt Issuance Requirements')
  );

  assert(
    'PaymentEvidence.jsx renders Duplicate Check',
    paymentEvidenceContent.includes('Duplicate Check')
  );

  assert(
    'PaymentEvidence.jsx renders Receipt Number Strategy',
    paymentEvidenceContent.includes('Receipt Number Strategy')
  );

  assert(
    'PaymentEvidence.jsx renders Receipt Number Format',
    paymentEvidenceContent.includes('Receipt Number Format')
  );

  assert(
    'PaymentEvidence.jsx renders receipt issuance contract read-only safety message',
    paymentEvidenceContent.includes('receipt_issuance_contract.safety_message')
  );

  assert(
    'PaymentEvidence.jsx still has no receipt or ledger issuance API calls',
    !paymentEvidenceContent.includes('/api/receipts') &&
    !paymentEvidenceContent.includes('/api/ledger')
  );

  assert(
    'PaymentEvidence.jsx still has no unsupported final receipt action labels',
    !paymentEvidenceContent.includes('Create Receipt') &&
    !paymentEvidenceContent.includes('Send Receipt') &&
    !paymentEvidenceContent.includes('Download Receipt') &&
    !paymentEvidenceContent.includes('Print Receipt') &&
    !paymentEvidenceContent.includes('Post Ledger') &&
    !paymentEvidenceContent.includes('Finalize Receipt') &&
    !paymentEvidenceContent.includes('Void Receipt')
  );

  // ==========================================
  // Test 18: Receipt Storage Schema Foundation + Duplicate Check Activation
  // ==========================================
  console.log('\n18. Receipt Storage Schema Foundation + Duplicate Check Activation:');

  const receiptMigrationContent = fs.readFileSync('db/migrations/023_receipts.sql', 'utf8');

  assert(
    'Mock receipt storage exists',
    Object.prototype.hasOwnProperty.call(apiDb.tables, 'receipts') && Array.isArray(apiDb.get('receipts'))
  );

  assert(
    'Receipt migration creates receipts table',
    /CREATE TABLE IF NOT EXISTS receipts/i.test(receiptMigrationContent)
  );

  assert(
    'Receipt migration has unique organization receipt number guard',
    /UNIQUE INDEX[\s\S]*receipt_number/i.test(receiptMigrationContent) &&
    /organization_id,\s*receipt_number/i.test(receiptMigrationContent)
  );

  assert(
    'Receipt migration has unique payment_allocation guard',
    /UNIQUE INDEX[\s\S]*payment_allocation/i.test(receiptMigrationContent) &&
    /organization_id,\s*payment_allocation_id/i.test(receiptMigrationContent)
  );

  assert(
    'Receipt migration has unique payment_evidence guard',
    /UNIQUE INDEX[\s\S]*payment_evidence/i.test(receiptMigrationContent) &&
    /organization_id,\s*payment_evidence_id/i.test(receiptMigrationContent)
  );

  const receiptStorageHandler = getRouteHandler('/payment-evidence/:id/receipt-preview');
  let receiptStorageResponse = null;
  const receiptStorageMockRes = {
    status() { return this; },
    json(data) { receiptStorageResponse = data; return this; }
  };

  apiDb.seed('properties', [
    { id: 321, organization_id: 1, name: 'Storage Court' }
  ]);
  apiDb.seed('units', [
    { id: 421, organization_id: 1, unit_code: 'S-21' }
  ]);
  apiDb.seed('tenants', [
    { id: 122, organization_id: 1, full_name: 'Storage Tenant', tenant_account_number: 'ACC-S21', status: 'active', currency: 'KES', property_id: 321, unit_id: 421 }
  ]);
  apiDb.seed('payment_evidence', [
    { id: 8203, organization_id: 1, amount: 5000, transaction_date: '2026-06-22', status: 'manually_reconciled', review_status: 'accepted_suggestion', accepted_tenant_id: 122, accepted_invoice_id: 222, collection_channel: 'mpesa', transaction_code: 'MPESA8203' }
  ]);
  apiDb.seed('invoices', [
    { id: 222, organization_id: 1, tenant_id: 122, invoice_number: 'INV-222', status: 'paid', balance: 0, total: 5000, amount_paid: 5000 }
  ]);
  apiDb.seed('transactions', [
    { id: 521, organization_id: 1, tenant_id: 122, amount: 5000, transaction_type: 'payment', status: 'reconciled', raw_payload: JSON.stringify({ evidence_id: 8203, source: 'payment_evidence_allocation' }) }
  ]);
  apiDb.seed('payment_allocations', [
    { id: 621, organization_id: 1, transaction_id: 521, invoice_id: 222, amount_allocated: 5000, allocated_at: '2026-06-22T12:00:00.000Z' }
  ]);
  apiDb.seed('receipts', []);

  const receiptStorageInvoiceBefore = JSON.stringify(apiDb.get('invoices'));
  const receiptStorageTenantBefore = JSON.stringify(apiDb.get('tenants'));
  const receiptStorageTransactionBefore = JSON.stringify(apiDb.get('transactions'));
  const receiptStorageAllocationBefore = JSON.stringify(apiDb.get('payment_allocations'));
  const receiptStorageEvidenceBefore = JSON.stringify(apiDb.get('payment_evidence'));
  const receiptStorageReceiptCountBefore = apiDb.get('receipts').length;

  receiptStorageResponse = null;
  await receiptStorageHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8203' }
  }, receiptStorageMockRes);

  const noReceiptContract = receiptStorageResponse && receiptStorageResponse.receipt_issuance_contract;
  assert('Receipt preview contract no longer reports receipt_schema_not_enabled when receipt storage exists', noReceiptContract && noReceiptContract.duplicate_check_state !== 'receipt_schema_not_enabled');
  assert('Allocated evidence with no receipt returns no_existing_receipt', noReceiptContract && noReceiptContract.duplicate_check_state === 'no_existing_receipt');
  assert('No existing receipt contract enables confirmed issuance', noReceiptContract && noReceiptContract.can_issue_receipt === true);
  assert('No existing receipt contract reports confirmed issuance ready state', noReceiptContract && noReceiptContract.state === 'ready_for_confirmed_receipt_issuance');
  assert('Receipt number preview still begins with DRAFT-', noReceiptContract && String(noReceiptContract.receipt_number_preview).startsWith('DRAFT-'));
  assert('Receipt number strategy remains preview_only_not_reserved', noReceiptContract && noReceiptContract.receipt_number_strategy === 'preview_only_not_reserved');
  assert('No receipt lookup does not create receipt', apiDb.get('receipts').length === receiptStorageReceiptCountBefore);

  apiDb.seed('receipts', [
    {
      id: 701,
      organization_id: 1,
      tenant_id: 122,
      invoice_id: 222,
      transaction_id: 521,
      payment_allocation_id: 621,
      payment_evidence_id: 8203,
      receipt_number: 'RCP-1-2026-000001',
      status: 'issued',
      issued_at: '2026-06-22T12:05:00.000Z',
      issued_by_user_id: 10,
      amount: 5000,
      currency: 'KES',
      payment_method: 'mpesa',
      receipt_payload: {},
      metadata: {}
    }
  ]);

  const receiptStorageExistingReceiptCountBefore = apiDb.get('receipts').length;

  receiptStorageResponse = null;
  await receiptStorageHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8203' }
  }, receiptStorageMockRes);

  const existingReceiptContract = receiptStorageResponse && receiptStorageResponse.receipt_issuance_contract;
  assert('Allocated evidence with existing receipt returns existing_receipt_found', existingReceiptContract && existingReceiptContract.duplicate_check_state === 'existing_receipt_found');
  assert('Existing receipt blocks future issuance readiness', existingReceiptContract && existingReceiptContract.blocking_reasons.includes('An existing receipt already references this payment evidence, transaction, or allocation.'));
  assert('Existing receipt contract keeps can_issue_receipt false', existingReceiptContract && existingReceiptContract.can_issue_receipt === false);
  assert('Existing receipt lookup does not create another receipt', apiDb.get('receipts').length === receiptStorageExistingReceiptCountBefore);

  assert('Receipt storage lookup leaves invoice unchanged', JSON.stringify(apiDb.get('invoices')) === receiptStorageInvoiceBefore);
  assert('Receipt storage lookup leaves tenant unchanged', JSON.stringify(apiDb.get('tenants')) === receiptStorageTenantBefore);
  assert('Receipt storage lookup leaves transaction unchanged', JSON.stringify(apiDb.get('transactions')) === receiptStorageTransactionBefore);
  assert('Receipt storage lookup leaves payment allocation unchanged', JSON.stringify(apiDb.get('payment_allocations')) === receiptStorageAllocationBefore);
  assert('Receipt storage lookup leaves payment evidence unchanged', JSON.stringify(apiDb.get('payment_evidence')) === receiptStorageEvidenceBefore);
  assert('Receipt storage lookup creates no ledger records', apiDb.get('transactions').filter(t => t.ledger).length === 0);

  assert(
    'PaymentEvidence.jsx still contains no unsupported final action labels after receipt storage',
    !paymentEvidenceContent.includes('Create Receipt') &&
    !paymentEvidenceContent.includes('Send Receipt') &&
    !paymentEvidenceContent.includes('Download Receipt') &&
    !paymentEvidenceContent.includes('Print Receipt') &&
    !paymentEvidenceContent.includes('Post Ledger') &&
    !paymentEvidenceContent.includes('Finalize Receipt') &&
    !paymentEvidenceContent.includes('Void Receipt')
  );

  assert(
    'Receipt storage keeps ledger route creation disabled',
    !/router\.(post|patch|put|delete)\([^)]*ledger/i.test(routeContent)
  );

  // ==========================================
  // Test 19: Confirmed Receipt Issuance Execution
  // ==========================================
  console.log('\n19. Confirmed Receipt Issuance Execution:');

  const issueReceiptHandler = getRouteHandler('/payment-evidence/:id/issue-receipt');
  const issueReceiptMiddlewares = getRouteMiddlewares('/payment-evidence/:id/issue-receipt');

  assert(
    'Receipt issuance endpoint requires landlord or super_admin role',
    issueReceiptMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let issueBlockedStatus = null;
    let issueBlockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware({
      auth: { role: blockedRole, organizationId: 1, userId: 99 }
    }, {
      status(code) { issueBlockedStatus = code; return this; },
      json() { return this; }
    }, () => { issueBlockedNextCalled = true; });

    assert(`Receipt issuance endpoint blocks ${blockedRole}`, issueBlockedStatus === 403 && issueBlockedNextCalled === false);
  }

  let issueReceiptStatus = null;
  let issueReceiptResponse = null;
  const issueReceiptMockRes = {
    status(code) { issueReceiptStatus = code; return this; },
    json(data) { issueReceiptResponse = data; return this; }
  };

  const seedIssueReceiptFixture = ({
    rowId = 8303,
    tenantId = 132,
    invoiceId = 232,
    transactionId = 531,
    allocationId = 631,
    includeTenant = true,
    includeInvoice = true,
    includeTransaction = true,
    includeAllocation = true,
    evidenceStatus = 'manually_reconciled',
    receipts = []
  } = {}) => {
    apiDb.seed('organizations', [
      { id: 1, account_number: 'SL-ORG-000001', name: 'Smart Landlord Org' }
    ]);
    apiDb.seed('properties', [
      { id: 331, organization_id: 1, name: 'Issuance Place' }
    ]);
    apiDb.seed('units', [
      { id: 431, organization_id: 1, unit_code: 'I-31' }
    ]);
    apiDb.seed('tenants', includeTenant ? [
      { id: tenantId, organization_id: 1, full_name: 'Issued Tenant', tenant_account_number: 'ACC-I31', status: 'active', currency: 'KES', property_id: 331, unit_id: 431 }
    ] : []);
    apiDb.seed('payment_evidence', [
      { id: rowId, organization_id: 1, amount: 5000, transaction_date: '2026-06-23', status: evidenceStatus, review_status: 'accepted_suggestion', accepted_tenant_id: tenantId, accepted_invoice_id: invoiceId, collection_channel: 'mpesa', transaction_code: `MPESA${rowId}` }
    ]);
    apiDb.seed('invoices', includeInvoice ? [
      { id: invoiceId, organization_id: 1, tenant_id: tenantId, invoice_number: `INV-${invoiceId}`, status: 'paid', balance: 0, total: 5000, amount_paid: 5000, currency: 'KES' }
    ] : []);
    apiDb.seed('transactions', includeTransaction ? [
      { id: transactionId, organization_id: 1, tenant_id: tenantId, amount: 5000, transaction_type: 'payment', status: 'reconciled', payment_method: 'mpesa', raw_payload: JSON.stringify({ evidence_id: rowId, source: 'payment_evidence_allocation' }) }
    ] : []);
    apiDb.seed('payment_allocations', includeAllocation ? [
      { id: allocationId, organization_id: 1, transaction_id: transactionId, invoice_id: invoiceId, amount_allocated: 5000, allocated_at: '2026-06-23T12:00:00.000Z' }
    ] : []);
    apiDb.seed('receipts', receipts);
  };

  const runIssueReceiptRequest = async ({ orgId = 1, rowId = 8303, body = { confirmation_text: 'CONFIRM RECEIPT ISSUANCE' } } = {}) => {
    issueReceiptStatus = null;
    issueReceiptResponse = null;
    await issueReceiptHandler({
      auth: { organizationId: orgId, role: 'landlord', userId: 10 },
      params: { id: String(rowId) },
      body
    }, issueReceiptMockRes);
  };

  seedIssueReceiptFixture();
  await runIssueReceiptRequest({ orgId: 2 });
  assert('Receipt issuance blocks wrong organization with 404', issueReceiptStatus === 404 && issueReceiptResponse.error === 'ROW_NOT_FOUND');

  seedIssueReceiptFixture();
  await runIssueReceiptRequest({ body: {} });
  assert('Receipt issuance rejects missing confirmation text', issueReceiptStatus === 400 && issueReceiptResponse.error === 'CONFIRMATION_TEXT_REQUIRED');

  seedIssueReceiptFixture();
  await runIssueReceiptRequest({ body: { confirmation_text: 'CONFIRM RECEIPT' } });
  assert('Receipt issuance rejects wrong confirmation text', issueReceiptStatus === 400 && issueReceiptResponse.error === 'INVALID_CONFIRMATION_TEXT');

  seedIssueReceiptFixture({ rowId: 8304, evidenceStatus: 'needs_review' });
  await runIssueReceiptRequest({ rowId: 8304 });
  assert('Receipt issuance rejects unallocated evidence', issueReceiptStatus === 400 && issueReceiptResponse.error === 'PAYMENT_EVIDENCE_NOT_ALLOCATED');

  seedIssueReceiptFixture({ rowId: 8305, includeTransaction: false });
  await runIssueReceiptRequest({ rowId: 8305 });
  assert('Receipt issuance rejects missing transaction', issueReceiptStatus === 400 && issueReceiptResponse.error === 'MISSING_TRANSACTION');

  seedIssueReceiptFixture({ rowId: 8306, transactionId: 536, includeAllocation: false });
  await runIssueReceiptRequest({ rowId: 8306 });
  assert('Receipt issuance rejects missing payment allocation', issueReceiptStatus === 400 && issueReceiptResponse.error === 'MISSING_PAYMENT_ALLOCATION');

  seedIssueReceiptFixture({ rowId: 8307, transactionId: 537, allocationId: 637, includeInvoice: false });
  await runIssueReceiptRequest({ rowId: 8307 });
  assert('Receipt issuance rejects missing invoice', issueReceiptStatus === 400 && issueReceiptResponse.error === 'MISSING_INVOICE');

  seedIssueReceiptFixture({ rowId: 8308, tenantId: 138, invoiceId: 238, transactionId: 538, allocationId: 638, includeTenant: false });
  await runIssueReceiptRequest({ rowId: 8308 });
  assert('Receipt issuance rejects missing tenant', issueReceiptStatus === 400 && issueReceiptResponse.error === 'MISSING_TENANT');

  seedIssueReceiptFixture({
    rowId: 8309,
    tenantId: 139,
    invoiceId: 239,
    transactionId: 539,
    allocationId: 639,
    receipts: [
      {
        id: 739,
        organization_id: 1,
        tenant_id: 139,
        invoice_id: 239,
        transaction_id: 539,
        payment_allocation_id: 639,
        payment_evidence_id: 8309,
        receipt_number: 'RCP-SL-ORG-000001-2026-000001',
        status: 'issued',
        issued_at: '2026-06-23T12:05:00.000Z',
        issued_by_user_id: 10,
        amount: 5000,
        currency: 'KES',
        payment_method: 'mpesa',
        receipt_payload: {},
        metadata: {}
      }
    ]
  });
  await runIssueReceiptRequest({ rowId: 8309 });
  assert('Receipt issuance rejects existing receipt duplicate', issueReceiptStatus === 409 && issueReceiptResponse.error === 'RECEIPT_ALREADY_ISSUED');
  assert('Duplicate issuance creates no new receipt', apiDb.get('receipts').length === 1);

  seedIssueReceiptFixture({ rowId: 8310, tenantId: 140, invoiceId: 240, transactionId: 540, allocationId: 640 });
  const issueInvoiceBefore = JSON.stringify(apiDb.get('invoices'));
  const issueTenantBefore = JSON.stringify(apiDb.get('tenants'));
  const issueTransactionBefore = JSON.stringify(apiDb.get('transactions'));
  const issueAllocationBefore = JSON.stringify(apiDb.get('payment_allocations'));
  const issueEvidenceBefore = JSON.stringify(apiDb.get('payment_evidence'));

  await runIssueReceiptRequest({ rowId: 8310 });

  const issuedReceipts = apiDb.get('receipts');
  const issuedReceipt = issuedReceipts[0];
  const issuedPayload = issuedReceipt && issuedReceipt.receipt_payload;

  assert('Valid receipt issuance returns success true', issueReceiptResponse && issueReceiptResponse.success === true);
  assert('Valid receipt issuance creates exactly one receipt', issuedReceipts.length === 1);
  assert('Issued receipt number is final and not a draft', issuedReceipt && String(issuedReceipt.receipt_number).startsWith('RCP-') && !String(issuedReceipt.receipt_number).startsWith('DRAFT'));
  assert('Issued receipt status is issued', issuedReceipt && issuedReceipt.status === 'issued');
  assert('Issued receipt amount equals allocated amount', issuedReceipt && Number(issuedReceipt.amount) === 5000);
  assert('Issued receipt response returns receipt summary', issueReceiptResponse && issueReceiptResponse.receipt && issueReceiptResponse.receipt.receipt_number === issuedReceipt.receipt_number);
  assert('Receipt payload snapshots tenant and invoice', issuedPayload && issuedPayload.tenant_name === 'Issued Tenant' && issuedPayload.invoice_number === 'INV-240');
  assert('Receipt payload snapshots transaction, allocation, and evidence IDs', issuedPayload && issuedPayload.transaction_id === 540 && issuedPayload.payment_allocation_id === 640 && issuedPayload.payment_evidence_id === 8310);
  assert('Receipt payload snapshots amount and line item', issuedPayload && issuedPayload.amount_paid === 5000 && issuedPayload.receipt_lines[0].amount === 5000);
  assert('Receipt issuance safety message confirms no financial mutation', issueReceiptResponse && issueReceiptResponse.safety_message === 'Receipt issued exactly once. No ledger, invoice, tenant, transaction, allocation, or payment evidence financial record was changed.');

  await runIssueReceiptRequest({ rowId: 8310 });
  assert('Repeated receipt issuance is rejected', issueReceiptStatus === 409 && issueReceiptResponse.error === 'RECEIPT_ALREADY_ISSUED');
  assert('Repeated receipt issuance creates no second receipt', apiDb.get('receipts').length === 1);

  assert('Receipt issuance creates no ledger records', apiDb.get('transactions').filter(t => t.ledger).length === 0);
  assert('Receipt issuance leaves invoice unchanged', JSON.stringify(apiDb.get('invoices')) === issueInvoiceBefore);
  assert('Receipt issuance leaves tenant unchanged', JSON.stringify(apiDb.get('tenants')) === issueTenantBefore);
  assert('Receipt issuance leaves transaction unchanged', JSON.stringify(apiDb.get('transactions')) === issueTransactionBefore);
  assert('Receipt issuance leaves payment allocation unchanged', JSON.stringify(apiDb.get('payment_allocations')) === issueAllocationBefore);
  assert('Receipt issuance leaves payment evidence financial state unchanged', JSON.stringify(apiDb.get('payment_evidence')) === issueEvidenceBefore);

  const postIssuePreviewHandler = getRouteHandler('/payment-evidence/:id/receipt-preview');
  let postIssuePreviewResponse = null;
  await postIssuePreviewHandler({
    auth: { organizationId: 1, role: 'landlord', userId: 10 },
    params: { id: '8310' }
  }, {
    status() { return this; },
    json(data) { postIssuePreviewResponse = data; return this; }
  });
  assert('Receipt preview reports existing receipt after issuance', postIssuePreviewResponse && postIssuePreviewResponse.receipt_issuance_contract.duplicate_check_state === 'existing_receipt_found');
  assert('Receipt preview blocks second issuance after receipt exists', postIssuePreviewResponse && postIssuePreviewResponse.receipt_issuance_contract.can_issue_receipt === false);

  assert(
    'PaymentEvidence.jsx renders confirmed receipt issuance controls',
    paymentEvidenceContent.includes('Issue Receipt') &&
    paymentEvidenceContent.includes('Confirm Receipt Issuance') &&
    paymentEvidenceContent.includes('receiptIssueConfirmationText')
  );

  assert(
    'PaymentEvidence.jsx calls POST issue-receipt API endpoint',
    paymentEvidenceContent.includes('issue-receipt') &&
    paymentEvidenceContent.includes("method: 'POST'") &&
    paymentEvidenceContent.includes('confirmation_text: receiptIssueConfirmationText')
  );

  assert(
    'PaymentEvidence.jsx uses branded confirmation for receipt issuance',
    paymentEvidenceContent.includes('showConfirm(') &&
    paymentEvidenceContent.includes('Confirm Receipt Issuance') &&
    !paymentEvidenceContent.includes('window.confirm(')
  );

  assert(
    'PaymentEvidence.jsx keeps unsupported receipt output actions disabled',
    !paymentEvidenceContent.includes('Create Receipt') &&
    !paymentEvidenceContent.includes('Send Receipt') &&
    !paymentEvidenceContent.includes('Download Receipt') &&
    !paymentEvidenceContent.includes('Print Receipt') &&
    !paymentEvidenceContent.includes('Post Ledger') &&
    !paymentEvidenceContent.includes('Finalize Receipt') &&
    !paymentEvidenceContent.includes('Void Receipt')
  );

  assert(
    'PaymentEvidence.jsx has no ledger/download/print/send/void API writes',
    !/method:\s*['"](POST|PATCH|PUT|DELETE)['"][\s\S]{0,160}\/api\/ledger/i.test(paymentEvidenceContent) &&
    !/method:\s*['"](POST|PATCH|PUT|DELETE)['"][\s\S]{0,160}(download|print|send|void)/i.test(paymentEvidenceContent)
  );

  // ==========================================
  // Test 20: Receipt Result Visibility + Audit Display
  // ==========================================
  console.log('\n20. Receipt Result Visibility + Audit Display:');

  const receiptResultHandler = getRouteHandler('/payment-evidence/:id/receipt-result');
  const receiptResultMiddlewares = getRouteMiddlewares('/payment-evidence/:id/receipt-result');

  assert(
    'Receipt result endpoint exists',
    typeof receiptResultHandler === 'function'
  );

  assert(
    'Receipt result endpoint requires landlord or super_admin role',
    receiptResultMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let resultBlockedStatus = null;
    let resultBlockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware(
      { auth: { role: blockedRole, organizationId: 1, userId: 99 } },
      {
        status(code) { resultBlockedStatus = code; return this; },
        json() { return this; }
      },
      () => { resultBlockedNextCalled = true; }
    );
    assert(`Receipt result endpoint blocks ${blockedRole}`, resultBlockedStatus === 403 && resultBlockedNextCalled === false);
  }

  let receiptResultStatus = null;
  let receiptResultResponse = null;
  const receiptResultMockRes = {
    status(code) { receiptResultStatus = code; return this; },
    json(data) { receiptResultResponse = data; return this; }
  };

  // Seed: evidence for org 1, receipt for same org
  apiDb.seed('payment_evidence', [
    { id: 9401, organization_id: 1, amount: 6000, transaction_date: '2026-07-01', status: 'manually_reconciled', review_status: 'accepted_suggestion', accepted_tenant_id: 142, accepted_invoice_id: 242, collection_channel: 'mpesa', transaction_code: 'MPESA9401' }
  ]);
  apiDb.seed('receipts', [
    {
      id: 801,
      organization_id: 1,
      tenant_id: 142,
      invoice_id: 242,
      transaction_id: 551,
      payment_allocation_id: 651,
      payment_evidence_id: 9401,
      receipt_number: 'RCP-SL-ORG-000001-2026-000010',
      status: 'issued',
      issued_at: '2026-07-01T12:00:00.000Z',
      issued_by_user_id: 10,
      amount: 6000,
      currency: 'KES',
      payment_method: 'mpesa',
      receipt_payload: JSON.stringify({
        tenant_name: 'Result Tenant',
        invoice_number: 'INV-242',
        payment_date: '2026-07-01',
        invoice_status_at_issue: 'paid',
        invoice_balance_after_allocation: 0,
        receipt_lines: [{ label: 'Rent payment allocation', amount: 6000 }]
      }),
      metadata: {}
    }
  ]);

  // Snapshot state before
  const receiptResultInvoiceBefore = JSON.stringify(apiDb.get('invoices'));
  const receiptResultTenantBefore = JSON.stringify(apiDb.get('tenants'));
  const receiptResultReceiptCountBefore = apiDb.get('receipts').length;
  const receiptResultTransactionCountBefore = apiDb.get('transactions').length;
  const receiptResultAllocationCountBefore = apiDb.get('payment_allocations').length;
  const receiptResultEvidenceBefore = JSON.stringify(apiDb.get('payment_evidence'));

  // Test: wrong org returns 404
  receiptResultStatus = null;
  receiptResultResponse = null;
  await receiptResultHandler(
    { auth: { organizationId: 2, role: 'landlord', userId: 10 }, params: { id: '9401' } },
    receiptResultMockRes
  );
  assert('Receipt result blocks wrong organization with 404', receiptResultStatus === 404 && receiptResultResponse.error === 'ROW_NOT_FOUND');

  // Test: evidence with no receipt returns receipt_issued: false
  apiDb.seed('receipts', []);
  receiptResultStatus = null;
  receiptResultResponse = null;
  await receiptResultHandler(
    { auth: { organizationId: 1, role: 'landlord', userId: 10 }, params: { id: '9401' } },
    receiptResultMockRes
  );
  assert('Receipt result returns receipt_issued false when no receipt exists', receiptResultResponse && receiptResultResponse.receipt_issued === false && receiptResultResponse.receipt === null);
  assert('No-receipt result creates no new receipt', apiDb.get('receipts').length === 0);

  // Test: evidence with existing receipt returns full details
  apiDb.seed('receipts', [
    {
      id: 801,
      organization_id: 1,
      tenant_id: 142,
      invoice_id: 242,
      transaction_id: 551,
      payment_allocation_id: 651,
      payment_evidence_id: 9401,
      receipt_number: 'RCP-SL-ORG-000001-2026-000010',
      status: 'issued',
      issued_at: '2026-07-01T12:00:00.000Z',
      issued_by_user_id: 10,
      amount: 6000,
      currency: 'KES',
      payment_method: 'mpesa',
      receipt_payload: JSON.stringify({
        tenant_name: 'Result Tenant',
        invoice_number: 'INV-242',
        payment_date: '2026-07-01',
        invoice_status_at_issue: 'paid',
        invoice_balance_after_allocation: 0,
        receipt_lines: [{ label: 'Rent payment allocation', amount: 6000 }]
      }),
      metadata: {}
    }
  ]);

  receiptResultStatus = null;
  receiptResultResponse = null;
  await receiptResultHandler(
    { auth: { organizationId: 1, role: 'landlord', userId: 10 }, params: { id: '9401' } },
    receiptResultMockRes
  );

  const rr = receiptResultResponse;
  assert('Receipt result returns success true', rr && rr.success === true);
  assert('Receipt result returns receipt_issued true', rr && rr.receipt_issued === true);
  assert('Receipt result returns correct receipt_number', rr && rr.receipt && rr.receipt.receipt_number === 'RCP-SL-ORG-000001-2026-000010');
  assert('Receipt result returns issued status', rr && rr.receipt && rr.receipt.status === 'issued');
  assert('Receipt result returns correct amount', rr && rr.receipt && Number(rr.receipt.amount) === 6000);
  assert('Receipt result returns tenant_name from payload', rr && rr.receipt && rr.receipt.tenant_name === 'Result Tenant');
  assert('Receipt result returns invoice_number from payload', rr && rr.receipt && rr.receipt.invoice_number === 'INV-242');
  assert('Receipt result returns transaction_id', rr && rr.receipt && rr.receipt.transaction_id === 551);
  assert('Receipt result returns payment_allocation_id', rr && rr.receipt && rr.receipt.payment_allocation_id === 651);
  assert('Receipt result returns receipt_lines from payload', rr && rr.receipt && Array.isArray(rr.receipt.receipt_lines) && rr.receipt.receipt_lines.length === 1);
  assert('Receipt result receipt_lines amount matches', rr && rr.receipt && rr.receipt.receipt_lines[0].amount === 6000);
  assert('Receipt result returns invoice_status_at_issue from payload', rr && rr.receipt && rr.receipt.invoice_status_at_issue === 'paid');
  assert('Receipt result returns invoice_balance_after_allocation', rr && rr.receipt && rr.receipt.invoice_balance_after_allocation === 0);
  assert('Receipt result has safety_message', rr && typeof rr.safety_message === 'string' && rr.safety_message.includes('read-only'));

  // Post-issuance readiness block checks
  const pir = rr && rr.post_issuance_readiness;
  assert('Receipt result returns post_issuance_readiness block', pir && typeof pir === 'object');
  assert('Post-issuance download_pdf is disabled', pir && pir.download_pdf && pir.download_pdf.enabled === false);
  assert('Post-issuance print_receipt is disabled', pir && pir.print_receipt && pir.print_receipt.enabled === false);
  assert('Post-issuance send_receipt is disabled', pir && pir.send_receipt && pir.send_receipt.enabled === false);
  assert('Post-issuance void_receipt is disabled', pir && pir.void_receipt && pir.void_receipt.enabled === false);
  assert('Post-issuance post_ledger is disabled', pir && pir.post_ledger && pir.post_ledger.enabled === false);
  assert('Post-issuance readiness has safety message', pir && typeof pir.safety_message === 'string' && pir.safety_message.length > 0);

  // Read-only safety: no mutations
  assert('Receipt result lookup leaves invoices unchanged', JSON.stringify(apiDb.get('invoices')) === receiptResultInvoiceBefore);
  assert('Receipt result lookup leaves tenants unchanged', JSON.stringify(apiDb.get('tenants')) === receiptResultTenantBefore);
  assert('Receipt result lookup leaves payment evidence unchanged', JSON.stringify(apiDb.get('payment_evidence')) === receiptResultEvidenceBefore);
  assert('Receipt result lookup leaves transaction count unchanged', apiDb.get('transactions').length === receiptResultTransactionCountBefore);
  assert('Receipt result lookup leaves allocation count unchanged', apiDb.get('payment_allocations').length === receiptResultAllocationCountBefore);
  assert('Receipt result lookup creates no new receipts', apiDb.get('receipts').length === receiptResultReceiptCountBefore);
  assert('Receipt result creates no ledger records', apiDb.get('transactions').filter(t => t.ledger).length === 0);

  // Frontend content checks
  assert(
    'PaymentEvidence.jsx renders Issued Receipt section header',
    paymentEvidenceContent.includes('Issued Receipt')
  );

  assert(
    'PaymentEvidence.jsx renders receipt-result API call',
    paymentEvidenceContent.includes('receipt-result')
  );

  assert(
    'PaymentEvidence.jsx renders Post-Issuance Readiness panel',
    paymentEvidenceContent.includes('Post-Issuance Readiness')
  );

  assert(
    'PaymentEvidence.jsx renders receipt result line items',
    paymentEvidenceContent.includes('receipt_lines') && paymentEvidenceContent.includes('Receipt Lines')
  );

  assert(
    'PaymentEvidence.jsx renders receipt_issued flag check',
    paymentEvidenceContent.includes('receipt_issued')
  );

  assert(
    'PaymentEvidence.jsx still has no unsupported final action labels after receipt result',
    !paymentEvidenceContent.includes('Create Receipt') &&
    !paymentEvidenceContent.includes('Send Receipt') &&
    !paymentEvidenceContent.includes('Download Receipt') &&
    !paymentEvidenceContent.includes('Print Receipt') &&
    !paymentEvidenceContent.includes('Post Ledger') &&
    !paymentEvidenceContent.includes('Finalize Receipt') &&
    !paymentEvidenceContent.includes('Void Receipt')
  );

  assert(
    'Receipt result endpoint is GET only (no POST/PATCH/PUT/DELETE)',
    routeContent.includes("router.get('/payment-evidence/:id/receipt-result'") &&
    !routeContent.includes("router.post('/payment-evidence/:id/receipt-result'")
  );

  assert(
    'Receipt result route has no INSERT, UPDATE, or DELETE SQL for receipts',
    (() => {
      const marker = "router.get('/payment-evidence/:id/receipt-result'";
      const startIdx = routeContent.indexOf(marker);
      if (startIdx === -1) return false;
      // Extract just the receipt-result handler block (up to ~3000 chars after the route definition)
      const block = routeContent.slice(startIdx, startIdx + 3000);
      return !/INSERT\s+INTO\s+receipts/i.test(block) &&
             !/UPDATE\s+receipts/i.test(block) &&
             !/DELETE\s+FROM\s+receipts/i.test(block);
    })()
  );

  // ==========================================
  // Test 21: Receipt Print View Foundation
  // ==========================================
  console.log('\n21. Receipt Print View Foundation:');

  const printViewHandler = getRouteHandler('/payment-evidence/:id/receipt-print-view');
  const printViewMiddlewares = getRouteMiddlewares('/payment-evidence/:id/receipt-print-view');

  assert(
    'Receipt print view endpoint exists',
    typeof printViewHandler === 'function'
  );

  assert(
    'Receipt print view endpoint requires landlord or super_admin role',
    printViewMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let pvBlockedStatus = null;
    let pvBlockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware(
      { auth: { role: blockedRole, organizationId: 1, userId: 99 } },
      {
        status(code) { pvBlockedStatus = code; return this; },
        json() { return this; }
      },
      () => { pvBlockedNextCalled = true; }
    );
    assert(`Receipt print view blocks ${blockedRole}`, pvBlockedStatus === 403 && pvBlockedNextCalled === false);
  }

  let pvStatus = null;
  let pvResponse = null;
  const pvMockRes = {
    status(code) { pvStatus = code; return this; },
    json(data) { pvResponse = data; return this; }
  };

  // Seed: evidence + org
  apiDb.seed('payment_evidence', [
    { id: 9501, organization_id: 1, amount: 7500, transaction_date: '2026-07-02', status: 'manually_reconciled', review_status: 'accepted_suggestion', accepted_tenant_id: 143, accepted_invoice_id: 243, collection_channel: 'mpesa', transaction_code: 'MPESA9501' }
  ]);
  apiDb.seed('organizations', [
    { id: 1, name: 'Test Organization Ltd', account_number: 'ACC-ORG-0001' }
  ]);
  apiDb.seed('receipts', []);

  // Snapshot before
  const pvInvoiceBefore = JSON.stringify(apiDb.get('invoices'));
  const pvTenantBefore = JSON.stringify(apiDb.get('tenants'));
  const pvEvidenceBefore = JSON.stringify(apiDb.get('payment_evidence'));
  const pvTransactionCountBefore = apiDb.get('transactions').length;
  const pvAllocationCountBefore = apiDb.get('payment_allocations').length;

  // Wrong org returns 404
  pvStatus = null; pvResponse = null;
  await printViewHandler(
    { auth: { organizationId: 2, role: 'landlord', userId: 10 }, params: { id: '9501' } },
    pvMockRes
  );
  assert('Print view blocks wrong organization with 404', pvStatus === 404 && pvResponse.error === 'ROW_NOT_FOUND');

  // No receipt returns available: false, state: receipt_not_issued
  pvStatus = null; pvResponse = null;
  await printViewHandler(
    { auth: { organizationId: 1, role: 'landlord', userId: 10 }, params: { id: '9501' } },
    pvMockRes
  );
  assert('Print view returns success true when no receipt', pvResponse && pvResponse.success === true);
  assert('Print view available false when no receipt', pvResponse && pvResponse.print_view && pvResponse.print_view.available === false);
  assert('Print view state is receipt_not_issued when no receipt', pvResponse && pvResponse.print_view && pvResponse.print_view.state === 'receipt_not_issued');
  assert('Print view has print_readiness when no receipt', pvResponse && pvResponse.print_readiness && typeof pvResponse.print_readiness === 'object');
  assert('No-receipt print view creates no new receipt', apiDb.get('receipts').length === 0);

  // Seed issued receipt
  apiDb.seed('receipts', [
    {
      id: 901,
      organization_id: 1,
      tenant_id: 143,
      invoice_id: 243,
      transaction_id: 552,
      payment_allocation_id: 652,
      payment_evidence_id: 9501,
      receipt_number: 'RCP-SL-ORG-000001-2026-000011',
      status: 'issued',
      issued_at: '2026-07-02T09:00:00.000Z',
      issued_by_user_id: 10,
      amount: 7500,
      currency: 'KES',
      payment_method: 'mpesa',
      receipt_payload: JSON.stringify({
        tenant_name: 'Print View Tenant',
        invoice_number: 'INV-243',
        payment_date: '2026-07-02',
        invoice_status_at_issue: 'paid',
        invoice_balance_after_allocation: 0,
        receipt_lines: [{ label: 'Monthly rent allocation', amount: 7500 }]
      }),
      metadata: {}
    }
  ]);

  const pvReceiptCountBefore = apiDb.get('receipts').length;

  pvStatus = null; pvResponse = null;
  await printViewHandler(
    { auth: { organizationId: 1, role: 'landlord', userId: 10 }, params: { id: '9501' } },
    pvMockRes
  );

  const pv = pvResponse;
  assert('Print view returns success true', pv && pv.success === true);
  assert('Print view returns payment_evidence_id', pv && pv.payment_evidence_id === 9501);

  const pvi = pv && pv.print_view;
  assert('Print view has print_view object', pvi && typeof pvi === 'object');
  assert('Print view available is true', pvi && pvi.available === true);
  assert('Print view state is ready_for_print_view', pvi && pvi.state === 'ready_for_print_view');
  assert('Print view returns receipt_id', pvi && pvi.receipt_id === 901);
  assert('Print view receipt_number starts with RCP-', pvi && typeof pvi.receipt_number === 'string' && pvi.receipt_number.startsWith('RCP-'));
  assert('Print view returns issued_at', pvi && pvi.issued_at !== undefined && pvi.issued_at !== null);
  assert('Print view returns tenant_name from payload', pvi && pvi.tenant_name === 'Print View Tenant');
  assert('Print view returns invoice_number from payload', pvi && pvi.invoice_number === 'INV-243');
  assert('Print view returns payment_date from payload', pvi && pvi.payment_date === '2026-07-02');
  assert('Print view returns payment_method', pvi && pvi.payment_method === 'mpesa');
  assert('Print view returns correct amount', pvi && Number(pvi.amount) === 7500);
  assert('Print view returns currency', pvi && pvi.currency === 'KES');
  assert('Print view returns invoice_status_at_issue', pvi && pvi.invoice_status_at_issue === 'paid');
  assert('Print view returns invoice_balance_after_allocation', pvi && pvi.invoice_balance_after_allocation === 0);
  assert('Print view returns receipt_lines from payload', pvi && Array.isArray(pvi.receipt_lines) && pvi.receipt_lines.length === 1);
  assert('Print view receipt_lines amount matches', pvi && pvi.receipt_lines[0].amount === 7500);
  assert('Print view returns watermark ISSUED', pvi && pvi.watermark === 'ISSUED');
  assert('Print view returns footer_note', pvi && typeof pvi.footer_note === 'string' && pvi.footer_note.length > 0);
  assert('Print view has safety_message', pv && typeof pv.safety_message === 'string' && pv.safety_message.includes('read-only'));

  // Print readiness checks
  const pr = pv && pv.print_readiness;
  assert('Print view returns print_readiness block', pr && typeof pr === 'object');
  assert('Print view browser_print_enabled is false', pr && pr.browser_print_enabled === false);
  assert('Print view pdf_download_enabled is false', pr && pr.pdf_download_enabled === false);
  assert('Print view send_enabled is false', pr && pr.send_enabled === false);
  assert('Print view ledger_posting_enabled is false', pr && pr.ledger_posting_enabled === false);
  assert('Print view void_enabled is false', pr && pr.void_enabled === false);
  assert('Print view blocking_reasons is non-empty array', pr && Array.isArray(pr.blocking_reasons) && pr.blocking_reasons.length > 0);
  assert('Print view print_readiness has safety_message', pr && typeof pr.safety_message === 'string' && pr.safety_message.length > 0);

  // Read-only safety checks
  assert('Print view lookup leaves invoices unchanged', JSON.stringify(apiDb.get('invoices')) === pvInvoiceBefore);
  assert('Print view lookup leaves tenants unchanged', JSON.stringify(apiDb.get('tenants')) === pvTenantBefore);
  assert('Print view lookup leaves payment evidence unchanged', JSON.stringify(apiDb.get('payment_evidence')) === pvEvidenceBefore);
  assert('Print view lookup leaves transaction count unchanged', apiDb.get('transactions').length === pvTransactionCountBefore);
  assert('Print view lookup leaves allocation count unchanged', apiDb.get('payment_allocations').length === pvAllocationCountBefore);
  assert('Print view lookup creates no new receipts', apiDb.get('receipts').length === pvReceiptCountBefore);
  assert('Print view creates no ledger records', apiDb.get('transactions').filter(t => t.ledger).length === 0);

  // Frontend content checks
  const pvContent = paymentEvidenceContent;
  assert('PaymentEvidence.jsx renders Receipt Print View section header', pvContent.includes('Receipt Print View'));
  assert('PaymentEvidence.jsx renders Print / PDF Readiness subsection', pvContent.includes('Print / PDF Readiness'));
  assert('PaymentEvidence.jsx renders Refresh Receipt Print View button', pvContent.includes('Refresh Receipt Print View'));
  assert('PaymentEvidence.jsx fetches receipt-print-view endpoint', pvContent.includes('receipt-print-view'));
  assert('PaymentEvidence.jsx renders Browser Print disabled', pvContent.includes('Browser Print'));
  assert('PaymentEvidence.jsx renders PDF Download disabled', pvContent.includes('PDF Download'));
  assert('PaymentEvidence.jsx renders Send disabled state', pvContent.includes('Send:') || pvContent.includes('Send'));
  assert('PaymentEvidence.jsx renders Ledger Posting disabled', pvContent.includes('Ledger Posting'));
  assert('PaymentEvidence.jsx renders Void disabled state', pvContent.includes('Void:') || pvContent.includes('Void'));
  assert('PaymentEvidence.jsx renders watermark field', pvContent.includes('watermark'));
  assert('PaymentEvidence.jsx renders footer_note field', pvContent.includes('footer_note'));

  assert(
    'PaymentEvidence.jsx still has no unsupported action labels',
    !pvContent.includes('Print Receipt') &&
    !pvContent.includes('Download Receipt') &&
    !pvContent.includes('Send Receipt') &&
    !pvContent.includes('Post Ledger') &&
    !pvContent.includes('Void Receipt') &&
    !pvContent.includes('Finalize Receipt') &&
    !pvContent.includes('Reverse Receipt')
  );

  assert(
    'PaymentEvidence.jsx does not call window.print',
    !pvContent.includes('window.print')
  );

  assert(
    'Receipt print view endpoint is GET only (no POST/PATCH/PUT/DELETE)',
    routeContent.includes("router.get('/payment-evidence/:id/receipt-print-view'") &&
    !routeContent.includes("router.post('/payment-evidence/:id/receipt-print-view'") &&
    !routeContent.includes("router.patch('/payment-evidence/:id/receipt-print-view'") &&
    !routeContent.includes("router.put('/payment-evidence/:id/receipt-print-view'") &&
    !routeContent.includes("router.delete('/payment-evidence/:id/receipt-print-view'")
  );

  assert(
    'No POST/PATCH/PUT/DELETE routes added for print/download/send/ledger/void',
    !(/router\.(post|patch|put|delete)\s*\(['"`]\/payment-evidence\/:id\/(print|download|send|ledger|void)/i.test(routeContent))
  );

  assert(
    'Receipt print view route has no INSERT/UPDATE/DELETE SQL for receipts in handler block',
    (() => {
      const marker = "router.get('/payment-evidence/:id/receipt-print-view'";
      const startIdx = routeContent.indexOf(marker);
      if (startIdx === -1) return false;
      const block = routeContent.slice(startIdx, startIdx + 4000);
      return !/INSERT\s+INTO\s+receipts/i.test(block) &&
             !/UPDATE\s+receipts/i.test(block) &&
             !/DELETE\s+FROM\s+receipts/i.test(block);
    })()
  );

  // ==========================================
  // Test 22: PDF Statement Upload Readiness + Parser Contract
  // ==========================================
  console.log('\n22. PDF Statement Upload Readiness + Parser Contract:');

  const pdfStatementHandler = getRouteHandler('/payment-evidence/pdf-statement-preview');
  const pdfStatementMiddlewares = getRouteMiddlewares('/payment-evidence/pdf-statement-preview');

  assert(
    'PDF statement preview endpoint exists',
    typeof pdfStatementHandler === 'function'
  );

  assert(
    'PDF statement preview endpoint requires landlord or super_admin role',
    pdfStatementMiddlewares.includes(requireLandlordOrSuperAdminMiddleware)
  );

  for (const allowedRole of ['landlord', 'super_admin']) {
    let pdfAllowedNextCalled = false;
    let pdfAllowedStatus = null;
    await requireLandlordOrSuperAdminMiddleware(
      { auth: { role: allowedRole, organizationId: 1, userId: 10 } },
      {
        status(code) { pdfAllowedStatus = code; return this; },
        json() { return this; }
      },
      () => { pdfAllowedNextCalled = true; }
    );
    assert(`PDF statement preview allows ${allowedRole}`, pdfAllowedNextCalled === true && pdfAllowedStatus === null);
  }

  for (const blockedRole of ['caretaker', 'tenant', 'resident']) {
    let pdfBlockedStatus = null;
    let pdfBlockedNextCalled = false;
    await requireLandlordOrSuperAdminMiddleware(
      { auth: { role: blockedRole, organizationId: 1, userId: 99 } },
      {
        status(code) { pdfBlockedStatus = code; return this; },
        json() { return this; }
      },
      () => { pdfBlockedNextCalled = true; }
    );
    assert(`PDF statement preview blocks ${blockedRole}`, pdfBlockedStatus === 403 && pdfBlockedNextCalled === false);
  }

  let pdfStatementStatus = null;
  let pdfStatementResponse = null;
  const pdfStatementMockRes = {
    status(code) { pdfStatementStatus = code; return this; },
    json(data) { pdfStatementResponse = data; return this; }
  };

  const runPdfStatementRequest = async (file) => {
    pdfStatementStatus = null;
    pdfStatementResponse = null;
    await pdfStatementHandler(
      {
        auth: { organizationId: 1, role: 'landlord', userId: 10 },
        file
      },
      pdfStatementMockRes
    );
  };

  await runPdfStatementRequest(undefined);
  assert('PDF statement preview rejects missing file', pdfStatementStatus === 400 && pdfStatementResponse.error === 'NO_FILE');

  await runPdfStatementRequest({
    originalname: 'statement.txt',
    mimetype: 'text/plain',
    size: 1024,
    buffer: Buffer.from('not a pdf')
  });
  assert('PDF statement preview rejects non-PDF file', pdfStatementStatus === 400 && pdfStatementResponse.error === 'INVALID_FILE_TYPE');

  await runPdfStatementRequest({
    originalname: 'large-statement.pdf',
    mimetype: 'application/pdf',
    size: (5 * 1024 * 1024) + 1,
    buffer: Buffer.alloc(0)
  });
  assert('PDF statement preview rejects files larger than 5 MB', pdfStatementStatus === 400 && pdfStatementResponse.error === 'FILE_TOO_LARGE');

  apiDb.seed('payment_evidence', []);
  apiDb.seed('payment_evidence_batches', []);
  apiDb.seed('transactions', []);
  apiDb.seed('payment_allocations', []);
  apiDb.seed('receipts', []);
  apiDb.seed('invoices', [
    { id: 9901, organization_id: 1, tenant_id: 9902, invoice_number: 'INV-PDF-1', status: 'issued', balance: 12000, amount_paid: 0 }
  ]);
  apiDb.seed('tenants', [
    { id: 9902, organization_id: 1, full_name: 'PDF Readiness Tenant', balance: 0 }
  ]);

  const pdfEvidenceBefore = JSON.stringify(apiDb.get('payment_evidence'));
  const pdfBatchBefore = JSON.stringify(apiDb.get('payment_evidence_batches'));
  const pdfTransactionBefore = JSON.stringify(apiDb.get('transactions'));
  const pdfAllocationBefore = JSON.stringify(apiDb.get('payment_allocations'));
  const pdfReceiptBefore = JSON.stringify(apiDb.get('receipts'));
  const pdfInvoiceBefore = JSON.stringify(apiDb.get('invoices'));
  const pdfTenantBefore = JSON.stringify(apiDb.get('tenants'));

  await runPdfStatementRequest({
    originalname: 'July Statement.pdf',
    mimetype: 'application/pdf',
    size: 12345,
    buffer: Buffer.from('%PDF-1.4 preview-only')
  });

  assert('Valid PDF statement preview returns success true', pdfStatementResponse && pdfStatementResponse.success === true);
  assert('Valid PDF statement preview returns parser contract mode', pdfStatementResponse && pdfStatementResponse.mode === 'parser_contract_only');
  assert('Valid PDF statement preview returns parser_status not_enabled', pdfStatementResponse && pdfStatementResponse.parser_status === 'not_enabled');
  assert('Valid PDF statement preview returns PDF_STATEMENT source', pdfStatementResponse && pdfStatementResponse.document_source === 'PDF_STATEMENT');
  assert('Valid PDF statement preview echoes file metadata', pdfStatementResponse && pdfStatementResponse.file && pdfStatementResponse.file.original_name === 'July Statement.pdf' && pdfStatementResponse.file.mime_type === 'application/pdf' && pdfStatementResponse.file.size_bytes === 12345);
  assert('Valid PDF statement preview returns no preview rows', pdfStatementResponse && Array.isArray(pdfStatementResponse.preview_rows) && pdfStatementResponse.preview_rows.length === 0);
  assert('Valid PDF statement preview returns warnings', pdfStatementResponse && Array.isArray(pdfStatementResponse.warnings) && pdfStatementResponse.warnings.includes('No payment evidence rows were imported.'));
  assert('Valid PDF statement preview returns next parser steps', pdfStatementResponse && Array.isArray(pdfStatementResponse.next_parser_steps) && pdfStatementResponse.next_parser_steps.length === 4);
  assert('Valid PDF statement preview returns safety message', pdfStatementResponse && pdfStatementResponse.safety_message === 'PDF statement upload readiness is preview-only. No payment evidence, invoice, tenant, receipt, ledger, transaction, allocation, or balance record has been changed.');

  assert('PDF statement preview creates no payment evidence rows', JSON.stringify(apiDb.get('payment_evidence')) === pdfEvidenceBefore);
  assert('PDF statement preview creates no batches', JSON.stringify(apiDb.get('payment_evidence_batches')) === pdfBatchBefore);
  assert('PDF statement preview creates no transactions', JSON.stringify(apiDb.get('transactions')) === pdfTransactionBefore);
  assert('PDF statement preview creates no payment allocations', JSON.stringify(apiDb.get('payment_allocations')) === pdfAllocationBefore);
  assert('PDF statement preview creates no receipts', JSON.stringify(apiDb.get('receipts')) === pdfReceiptBefore);
  assert('PDF statement preview creates no ledger records', apiDb.get('transactions').filter(t => t.ledger).length === 0);
  assert('PDF statement preview leaves invoices unchanged', JSON.stringify(apiDb.get('invoices')) === pdfInvoiceBefore);
  assert('PDF statement preview leaves tenants unchanged', JSON.stringify(apiDb.get('tenants')) === pdfTenantBefore);

  assert(
    'PDF statement preview uses memory-only multer storage',
    routeContent.includes('multer.memoryStorage()') &&
    routeContent.includes("pdfUpload.single('statement')")
  );

  assert(
    'PDF statement preview route contains no database write calls in handler block',
    (() => {
      const marker = "router.post(\n    '/payment-evidence/pdf-statement-preview'";
      const startIdx = routeContent.indexOf(marker);
      if (startIdx === -1) return false;
      const block = routeContent.slice(startIdx, startIdx + 3500);
      return !/activeDb\.(insert|update|delete)/i.test(block) &&
             !/INSERT\s+INTO/i.test(block) &&
             !/UPDATE\s+/i.test(block) &&
             !/DELETE\s+FROM/i.test(block);
    })()
  );

  assert(
    'PaymentEvidence.jsx contains PDF Statement import source',
    paymentEvidenceContent.includes('PDF Statement')
  );

  assert(
    'PaymentEvidence.jsx renders PDF parser readiness only panel',
    paymentEvidenceContent.includes('PDF parser readiness only')
  );

  assert(
    'PaymentEvidence.jsx renders Check PDF Parser Readiness action',
    paymentEvidenceContent.includes('Check PDF Parser Readiness')
  );

  assert(
    'PaymentEvidence.jsx calls PDF statement preview endpoint',
    paymentEvidenceContent.includes('/api/payment-evidence/pdf-statement-preview') &&
    paymentEvidenceContent.includes("method: 'POST'")
  );

  assert(
    'PaymentEvidence.jsx accepts PDF files only for PDF readiness input',
    paymentEvidenceContent.includes('accept="application/pdf,.pdf"')
  );

  assert(
    'PaymentEvidence.jsx keeps PDF final import disabled by CSV-only isImportEnabled',
    paymentEvidenceContent.includes("importSource === 'csv'") &&
    paymentEvidenceContent.includes('disabled={!isImportEnabled || importing}') &&
    paymentEvidenceContent.includes('Import CSV to Review Queue')
  );

  assert(
    'PaymentEvidence.jsx keeps PDF readiness separate from CSV preview counters/table',
    paymentEvidenceContent.includes("importSource === 'csv' ?") &&
    !paymentEvidenceContent.includes("importSource === 'csv' || importSource === 'pdf_bank'")
  );

  assert(
    'PaymentEvidence.jsx does not contain forbidden PDF action labels',
    !/\bImport PDF Rows\b/.test(paymentEvidenceContent) &&
    !/\bExtract Transactions\b/.test(paymentEvidenceContent) &&
    !/\bAuto Import\b/.test(paymentEvidenceContent) &&
    !/\bAuto Reconcile\b(?!d)/.test(paymentEvidenceContent) &&
    !/\bPost Ledger\b/.test(paymentEvidenceContent)
  );

  assert(
    'No PDF parser or OCR dependency/import was added',
    !/from\s+['"](pdf-parse|pdfjs-dist|pdf-lib|tesseract\.js)['"]/i.test(routeContent + paymentEvidenceContent) &&
    !/(pdf-parse|pdfjs-dist|pdf-lib|tesseract\.js)/i.test(JSON.stringify(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies || {}))
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
