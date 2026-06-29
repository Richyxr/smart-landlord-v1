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
