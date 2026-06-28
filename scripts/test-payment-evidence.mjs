import { normalizePaymentEvidence, generateRowHash } from '../server/services/payment-evidence/normalizePaymentEvidence.js';
import { classifyPaymentEvidenceRow } from '../server/services/payment-evidence/classifyPaymentEvidenceRow.js';
import { detectDuplicatePaymentEvidence } from '../server/services/payment-evidence/detectDuplicatePaymentEvidence.js';
import { scorePaymentEvidenceMatch } from '../server/services/payment-evidence/scorePaymentEvidenceMatch.js';
import { PERSPECTIVES, DIRECTIONS, STATUSES, COLLECTION_CHANNELS, DOCUMENT_SOURCES, EVIDENCE_STRENGTHS } from '../server/services/payment-evidence/paymentEvidenceRules.js';
import { db as jsonDb } from '../server/db.js';

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
      payment_evidence: []
    };
  }

  seed(table, data) {
    this.tables[table] = data;
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
