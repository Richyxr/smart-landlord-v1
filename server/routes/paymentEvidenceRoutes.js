import express from 'express';
import crypto from 'crypto';
import { db as localDb } from '../db.js';
import { normalizePaymentEvidence } from '../services/payment-evidence/normalizePaymentEvidence.js';

function asyncHandler(handler) {
  return (req, res, next) => {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const normalizePhone = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-9);
};

const getDaysDifference = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return Infinity;
  const diffTime = Math.abs(d1.getTime() - d2.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const RECEIPT_ISSUANCE_CONTRACT_SAFETY_MESSAGE = 'This receipt issuance contract is read-only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.';

function buildDraftReceiptNumberPreview(orgId, row) {
  const parsedDate = row && row.transaction_date ? new Date(row.transaction_date) : new Date();
  const year = isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear();
  return `DRAFT-RCP-${orgId}-${year}-PREVIEW`;
}

function safeReceiptOrgIdentifier(orgId, organization) {
  const raw = organization && organization.account_number ? organization.account_number : orgId;
  const cleaned = String(raw || orgId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return cleaned || String(orgId);
}

function receiptYearFromEvidence(row) {
  const parsedDate = row && row.transaction_date ? new Date(row.transaction_date) : new Date();
  return isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear();
}

function buildFinalReceiptNumber(orgIdentifier, year, sequence) {
  return `RCP-${orgIdentifier}-${year}-${String(sequence).padStart(6, '0')}`;
}

async function hasReceiptSchema(activeDb) {
  if (activeDb && activeDb.tables && Object.prototype.hasOwnProperty.call(activeDb.tables, 'receipts')) {
    return true;
  }

  if (activeDb && typeof activeDb.query === 'function') {
    const result = await activeDb.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'receipts') AS exists"
    );
    return Boolean(result.rows && result.rows[0] && result.rows[0].exists);
  }

  if (activeDb && typeof activeDb.get === 'function') {
    const receipts = await activeDb.get('receipts');
    return Array.isArray(receipts);
  }

  return false;
}

async function getReceiptDuplicateCheckState(activeDb, orgId, rowId, transaction, allocation) {
  const receiptSchemaEnabled = await hasReceiptSchema(activeDb);
  if (!receiptSchemaEnabled) {
    return 'receipt_schema_not_enabled';
  }

  if (activeDb && typeof activeDb.query === 'function') {
    const columnsResult = await activeDb.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'receipts'"
    );
    const columns = new Set((columnsResult.rows || []).map(row => row.column_name));
    const clauses = [];
    const values = [];

    const addCandidate = (column, value) => {
      if (!columns.has(column) || value === null || value === undefined) return;
      values.push(value);
      clauses.push(`${column} = $${values.length}`);
    };

    addCandidate('transaction_id', transaction ? transaction.id : null);
    addCandidate('payment_allocation_id', allocation ? allocation.id : null);
    addCandidate('payment_evidence_id', rowId);
    addCandidate('source_payment_evidence_id', rowId);

    if (clauses.length === 0) {
      return 'receipt_schema_not_enabled';
    }

    let sql = `SELECT id FROM receipts WHERE (${clauses.join(' OR ')})`;
    if (columns.has('organization_id')) {
      values.push(orgId);
      sql += ` AND organization_id = $${values.length}`;
    }
    sql += ' LIMIT 1';

    const duplicateResult = await activeDb.query(sql, values);
    return duplicateResult.rows && duplicateResult.rows.length > 0 ? 'existing_receipt_found' : 'no_existing_receipt';
  }

  const receipts = typeof activeDb.get === 'function'
    ? await activeDb.get('receipts')
    : [];
  const duplicate = receipts.find(receipt => {
    if (receipt.organization_id !== undefined && Number(receipt.organization_id) !== Number(orgId)) return false;
    return (
      (transaction && Number(receipt.transaction_id) === Number(transaction.id)) ||
      (allocation && Number(receipt.payment_allocation_id) === Number(allocation.id)) ||
      Number(receipt.payment_evidence_id) === Number(rowId) ||
      Number(receipt.source_payment_evidence_id) === Number(rowId)
    );
  });

  return duplicate ? 'existing_receipt_found' : 'no_existing_receipt';
}

function buildReceiptIssuanceContract({
  orgId,
  row,
  isAllocated,
  transaction,
  allocation,
  invoice,
  tenant,
  duplicateCheckState
}) {
  const blockingReasons = [];

  if (!isAllocated) {
    blockingReasons.push('Payment evidence must be allocated before receipt issuance.');
  }
  if (!transaction) {
    blockingReasons.push('An existing reconciled transaction is required before receipt issuance.');
  }
  if (!allocation) {
    blockingReasons.push('An existing payment allocation is required before receipt issuance.');
  }
  if (!invoice) {
    blockingReasons.push('An existing invoice is required before receipt issuance.');
  }
  if (!tenant) {
    blockingReasons.push('An existing tenant is required before receipt issuance.');
  }
  if (duplicateCheckState === 'existing_receipt_found') {
    blockingReasons.push('An existing receipt already references this payment evidence, transaction, or allocation.');
  }
  if (duplicateCheckState === 'receipt_schema_not_enabled') {
    blockingReasons.push('Receipt storage schema is not enabled yet.');
  }

  const canIssueReceipt = blockingReasons.length === 0;

  return {
    can_issue_receipt: canIssueReceipt,
    state: canIssueReceipt ? 'ready_for_confirmed_receipt_issuance' : 'issuance_blocked',
    required_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
    requires_allocated_payment_evidence: true,
    requires_existing_transaction: true,
    requires_existing_payment_allocation: true,
    requires_existing_invoice: true,
    requires_existing_tenant: true,
    requires_no_existing_receipt: true,
    duplicate_check_state: duplicateCheckState,
    receipt_number_strategy: 'preview_only_not_reserved',
    receipt_number_format_preview: 'RCP-{ORG}-{YYYY}-{SEQUENCE}',
    receipt_number_preview: buildDraftReceiptNumberPreview(orgId, row),
    blocking_reasons: blockingReasons,
    safety_message: RECEIPT_ISSUANCE_CONTRACT_SAFETY_MESSAGE
  };
}

async function getAllocatedReceiptContext(activeDb, orgId, rowId) {
  const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
  if (!row) {
    return { row: null };
  }

  const isAllocated = row.status === 'manually_reconciled' || row.status === 'auto_reconciled';
  const txs = await activeDb.find('transactions', { organization_id: orgId });
  const transaction = txs.find(t => {
    try {
      const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
      return payload && Number(payload.evidence_id) === Number(rowId);
    } catch (e) {
      return false;
    }
  });

  const allocation = transaction
    ? await activeDb.findOne('payment_allocations', { transaction_id: transaction.id, organization_id: orgId })
    : null;

  const tenant = row.accepted_tenant_id
    ? await activeDb.findOne('tenants', { id: Number(row.accepted_tenant_id), organization_id: orgId })
    : null;

  const invoice = row.accepted_invoice_id
    ? await activeDb.findOne('invoices', { id: Number(row.accepted_invoice_id), organization_id: orgId })
    : null;

  const organization = await activeDb.findOne('organizations', { id: Number(orgId) });
  const duplicateCheckState = await getReceiptDuplicateCheckState(activeDb, orgId, rowId, transaction, allocation);
  const receiptIssuanceContract = buildReceiptIssuanceContract({
    orgId,
    row,
    isAllocated,
    transaction,
    allocation,
    invoice,
    tenant,
    duplicateCheckState
  });

  return {
    row,
    isAllocated,
    transaction,
    allocation,
    tenant,
    invoice,
    organization,
    duplicateCheckState,
    receiptIssuanceContract
  };
}

function buildReceiptPayload({ orgId, userId, row, transaction, allocation, tenant, invoice, receiptNumber, issuedAt }) {
  const amountPaid = Number(allocation.amount_allocated);
  const receiptLines = [
    {
      label: 'Rent payment allocation',
      amount: amountPaid
    }
  ];

  return {
    organization_id: Number(orgId),
    tenant_id: tenant.id,
    tenant_name: tenant.full_name,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    transaction_id: transaction.id,
    payment_allocation_id: allocation.id,
    payment_evidence_id: row.id,
    payment_date: row.transaction_date,
    payment_method: row.collection_channel || transaction.payment_method || 'other',
    amount_paid: amountPaid,
    invoice_status_at_issue: invoice.status,
    invoice_balance_after_allocation: Number(invoice.balance),
    receipt_number: receiptNumber,
    issued_at: issuedAt,
    issued_by_user_id: userId,
    receipt_lines: receiptLines
  };
}

function mapReceiptResponse(receipt, tenant, invoice, transaction, allocation) {
  const payload = typeof receipt.receipt_payload === 'string'
    ? JSON.parse(receipt.receipt_payload)
    : (receipt.receipt_payload || {});

  return {
    id: receipt.id,
    receipt_number: receipt.receipt_number,
    status: receipt.status,
    issued_at: receipt.issued_at,
    amount: Number(receipt.amount),
    tenant_id: receipt.tenant_id,
    tenant_name: payload.tenant_name || (tenant ? tenant.full_name : null),
    invoice_id: receipt.invoice_id,
    invoice_number: payload.invoice_number || (invoice ? invoice.invoice_number : null),
    transaction_id: receipt.transaction_id || (transaction ? transaction.id : null),
    payment_allocation_id: receipt.payment_allocation_id || (allocation ? allocation.id : null)
  };
}

async function insertIssuedReceipt(activeDb, context, orgId, userId) {
  const { row, transaction, allocation, tenant, invoice, organization } = context;
  const issuedAt = new Date().toISOString();
  const year = receiptYearFromEvidence(row);
  const orgIdentifier = safeReceiptOrgIdentifier(orgId, organization);
  const prefix = `RCP-${orgIdentifier}-${year}-`;
  const amount = Number(allocation.amount_allocated);
  const paymentMethod = row.collection_channel || transaction.payment_method || 'other';

  if (activeDb.pool && typeof activeDb.pool.connect === 'function') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await activeDb.pool.connect();
      try {
        await client.query('BEGIN');
        const duplicate = await client.query(
          `
            SELECT id FROM receipts
            WHERE organization_id = $1
              AND (
                payment_allocation_id = $2
                OR payment_evidence_id = $3
                OR transaction_id = $4
              )
            LIMIT 1
          `,
          [orgId, allocation.id, row.id, transaction.id]
        );
        if (duplicate.rows.length > 0) {
          await client.query('ROLLBACK');
          return { duplicate: true };
        }

        const countResult = await client.query(
          'SELECT COUNT(*)::int AS count FROM receipts WHERE organization_id = $1 AND receipt_number LIKE $2',
          [orgId, `${prefix}%`]
        );
        const receiptNumber = buildFinalReceiptNumber(orgIdentifier, year, Number(countResult.rows[0].count) + 1 + attempt);
        const payload = buildReceiptPayload({ orgId, userId, row, transaction, allocation, tenant, invoice, receiptNumber, issuedAt });

        const insertResult = await client.query(
          `
            INSERT INTO receipts (
              organization_id,
              tenant_id,
              invoice_id,
              transaction_id,
              payment_allocation_id,
              payment_evidence_id,
              receipt_number,
              status,
              issued_at,
              issued_by_user_id,
              amount,
              currency,
              payment_method,
              receipt_payload,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued', $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
            RETURNING *
          `,
          [
            orgId,
            tenant.id,
            invoice.id,
            transaction.id,
            allocation.id,
            row.id,
            receiptNumber,
            issuedAt,
            userId,
            amount,
            tenant.currency || invoice.currency || transaction.currency || 'KES',
            paymentMethod,
            JSON.stringify(payload),
            JSON.stringify({
              source: 'payment_evidence_issue_receipt',
              payment_evidence_id: row.id,
              immutable_snapshot: true
            })
          ]
        );

        await client.query('COMMIT');
        return { receipt: insertResult.rows[0] };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error && error.code === '23505') {
          const constraint = String(error.constraint || '');
          if (constraint.includes('receipt_number') && attempt < 2) {
            continue;
          }
          return { duplicate: true };
        }
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error('Unable to generate a unique receipt number after retries.');
  }

  const existingReceipts = await activeDb.get('receipts');
  const duplicate = existingReceipts.find(receipt => (
    Number(receipt.organization_id) === Number(orgId) &&
    (
      Number(receipt.payment_allocation_id) === Number(allocation.id) ||
      Number(receipt.payment_evidence_id) === Number(row.id) ||
      Number(receipt.transaction_id) === Number(transaction.id)
    )
  ));
  if (duplicate) {
    return { duplicate: true };
  }

  const sequence = existingReceipts.filter(receipt => (
    Number(receipt.organization_id) === Number(orgId) &&
    String(receipt.receipt_number || '').startsWith(prefix)
  )).length + 1;
  const receiptNumber = buildFinalReceiptNumber(orgIdentifier, year, sequence);
  const payload = buildReceiptPayload({ orgId, userId, row, transaction, allocation, tenant, invoice, receiptNumber, issuedAt });
  const receipt = await activeDb.insert('receipts', {
    organization_id: orgId,
    tenant_id: tenant.id,
    invoice_id: invoice.id,
    transaction_id: transaction.id,
    payment_allocation_id: allocation.id,
    payment_evidence_id: row.id,
    receipt_number: receiptNumber,
    status: 'issued',
    issued_at: issuedAt,
    issued_by_user_id: userId,
    amount,
    currency: tenant.currency || invoice.currency || transaction.currency || 'KES',
    payment_method: paymentMethod,
    receipt_payload: payload,
    metadata: {
      source: 'payment_evidence_issue_receipt',
      payment_evidence_id: row.id,
      immutable_snapshot: true
    }
  });

  return { receipt };
}

function calculateCandidateScore(row, tenant, invoice, unit, property) {
  const reasons = [];
  const warnings = [];
  let score = 0;
  let confidence = 'low';

  const amount = Number(row.amount);
  const invBalance = Number(invoice.balance);
  const invTotal = Number(invoice.total);
  const isAmountMatch = (amount === invBalance || amount === invTotal);

  // 1. Reference Account / Tenant Account Number Match
  let refAccMatch = false;
  if (row.reference_account && tenant.tenant_account_number) {
    if (row.reference_account.trim().toLowerCase() === tenant.tenant_account_number.trim().toLowerCase()) {
      refAccMatch = true;
    }
  }

  // 2. Invoice Number Match
  let invNumMatch = false;
  const invNum = String(invoice.invoice_number || '').trim().toLowerCase();
  if (invNum) {
    if (row.transaction_code && String(row.transaction_code).trim().toLowerCase() === invNum) {
      invNumMatch = true;
    }
    if (row.paybill_reference && String(row.paybill_reference).trim().toLowerCase() === invNum) {
      invNumMatch = true;
    }
    if (row.invoice_reference && String(row.invoice_reference).trim().toLowerCase() === invNum) {
      invNumMatch = true;
    }
    if (row.description && String(row.description).trim().toLowerCase().includes(invNum)) {
      invNumMatch = true;
    }
  }

  // 3. Phone Match
  let phoneMatch = false;
  if (row.payer_phone && tenant.phone_number) {
    const p1 = normalizePhone(row.payer_phone);
    const p2 = normalizePhone(tenant.phone_number);
    if (p1 && p2 && p1 === p2) {
      phoneMatch = true;
    }
  }

  // 4. Name Match
  let nameMatch = false;
  if (row.payer_name && tenant.full_name) {
    const n1 = row.payer_name.trim().toLowerCase();
    const n2 = tenant.full_name.trim().toLowerCase();
    if (n1.includes(n2) || n2.includes(n1)) {
      nameMatch = true;
    }
  }

  // 5. Unit Match
  let unitMatch = false;
  if (unit && unit.unit_code) {
    const uc = unit.unit_code.trim().toLowerCase();
    if (row.description && row.description.toLowerCase().includes(uc)) {
      unitMatch = true;
    }
    if (row.reference_account && row.reference_account.toLowerCase().includes(uc)) {
      unitMatch = true;
    }
    if (row.payer_name && row.payer_name.toLowerCase().includes(uc)) {
      unitMatch = true;
    }
  }

  // Determine score and confidence
  if (refAccMatch) {
    if (isAmountMatch) {
      score = 95;
      confidence = 'high';
      reasons.push('Reference account matches tenant account number and amount matches invoice balance.');
    } else {
      score = 75;
      confidence = 'medium';
      reasons.push('Reference account matches tenant account number but amount does not match invoice balance.');
      warnings.push('Amount mismatch with matching tenant account reference.');
    }
  } else if (invNumMatch) {
    if (isAmountMatch) {
      score = 95;
      confidence = 'high';
      reasons.push('Invoice number matches payment evidence reference and amount matches invoice balance.');
    } else {
      score = 75;
      confidence = 'medium';
      reasons.push('Invoice number matches payment evidence reference but amount does not match invoice balance.');
      warnings.push('Amount mismatch with matching invoice number reference.');
    }
  } else if (phoneMatch && isAmountMatch) {
    const diffDays = getDaysDifference(row.transaction_date, invoice.due_date);
    if (diffDays <= 30) {
      score = 90;
      confidence = 'high';
      reasons.push('Tenant phone matches payer phone and amount matches invoice balance within date window.');
    } else {
      score = 70;
      confidence = 'medium';
      reasons.push('Tenant phone matches payer phone and amount matches invoice balance outside date window.');
      warnings.push('Date difference between payment and invoice exceeds 30 days.');
    }
  } else if (phoneMatch) {
    score = 65;
    confidence = 'medium';
    reasons.push('Tenant phone matches payer phone but amount does not match invoice balance.');
    warnings.push('Amount mismatch with matching phone number.');
  } else if (nameMatch && isAmountMatch) {
    score = 70;
    confidence = 'medium';
    reasons.push('Payer name is similar to tenant full name and amount matches invoice balance.');
  } else if (unitMatch && isAmountMatch) {
    score = 70;
    confidence = 'medium';
    reasons.push('Unit code matches payment narration / reference and amount matches invoice balance.');
  } else if (nameMatch) {
    score = 40;
    confidence = 'low';
    reasons.push('Payer name is similar to tenant full name but amount does not match invoice balance.');
    warnings.push('Name similarity match only (amount mismatch).');
  } else if (unitMatch) {
    score = 35;
    confidence = 'low';
    reasons.push('Unit code is mentioned in payment narration / reference but amount does not match invoice balance.');
    warnings.push('Unit code match only (amount mismatch).');
  } else if (isAmountMatch) {
    score = 50;
    confidence = 'low';
    reasons.push('Amount matches invoice balance exactly (no other matching signals).');
    warnings.push('Amount-only match; high risk of false positive.');
  }

  if (score === 0) {
    return null;
  }

  const propertyPrefix = property ? `${property.name} - ` : '';
  const unitLabel = unit ? `${propertyPrefix}${unit.unit_code}` : 'N/A';

  return {
    tenant_id: tenant.id,
    tenant_name: tenant.full_name,
    tenant_phone: tenant.phone_number || 'N/A',
    unit_label: unitLabel,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    invoice_status: invoice.status,
    invoice_balance: Number(invoice.balance),
    invoice_due_date: invoice.due_date,
    match_score: score,
    match_confidence: confidence,
    match_reasons: reasons,
    match_warnings: warnings
  };
}

function getContext(req) {
  return {
    orgId: req.auth?.organizationId,
    userId: req.auth?.userId,
    role: req.auth?.role
  };
}

function requireAuthenticatedContext(req, res, next) {
  const { orgId, userId, role } = getContext(req);
  if (!orgId || !userId || !role) {
    return res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'A valid Smart Landlord session is required.'
    });
  }
  next();
}

function requireLandlordOrSuperAdmin(req, res, next) {
  const { role } = getContext(req);
  if (role !== 'landlord' && role !== 'super_admin') {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Only landlords and admins are permitted to access payment evidence.'
    });
  }
  next();
}

export function createPaymentEvidenceRoutes(pgDb) {
  const router = express.Router();
  const activeDb = pgDb || localDb;

  // GET /api/payment-evidence/batches
  router.get('/payment-evidence/batches', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const batches = await activeDb.find('payment_evidence_batches', { organization_id: orgId });
    batches.sort((a, b) => b.id - a.id);
    res.json(batches);
  }));

  // GET /api/payment-evidence/rows
  router.get('/payment-evidence/rows', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const {
      status,
      evidence_strength,
      collection_channel,
      start_date,
      end_date,
      min_amount,
      max_amount,
      search,
      batch_id,
      review_status,
      review_decision,
      has_suggestions,
      match_confidence,
      has_audit_history,
      min_match_score,
      max_match_score,
      reviewed_from,
      reviewed_to,
      imported_from,
      imported_to
    } = req.query;

    /*
     * TODO: Replace in-memory filtering with PostgreSQL WHERE clauses.
     * TODO: Support LIMIT/OFFSET pagination.
     * TODO: Move sorting into SQL ORDER BY.
     * TODO: Add server-side pagination for large datasets.
     * TODO: Support indexed search.
     */
    let rows = await activeDb.find('payment_evidence', { organization_id: orgId });

    // Preload active tenants, invoices, properties, units, and users for metadata injection
    const allTenants = await activeDb.find('tenants', { organization_id: orgId });
    const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
    const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
    const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];
    const allUsers = await activeDb.find('users', {}) || [];
    const allAuditRows = await activeDb.find('payment_evidence_review_audit', { organization_id: orgId }) || [];

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));
    const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
    const unitsMap = new Map(allUnits.map(u => [u.id, u]));
    const userMap = new Map(allUsers.map(u => [u.id, u.name]));
    const auditCountMap = new Map();
    allAuditRows.forEach(a => {
      const key = Number(a.payment_evidence_id);
      auditCountMap.set(key, (auditCountMap.get(key) || 0) + 1);
    });

    const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
    const activeTenantMap = new Map(activeTenants.map(t => [t.id, t]));
    const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

    // Filter by batch_id
    if (batch_id) {
      const bId = Number(batch_id);
      rows = rows.filter(r => r.batch_id && Number(r.batch_id) === bId);
    }

    // Filter by status
    if (status) {
      rows = rows.filter(r => r.status === status);
    }

    // Filter by evidence_strength
    if (evidence_strength) {
      rows = rows.filter(r => r.evidence_strength === evidence_strength);
    }

    // Filter by collection_channel
    if (collection_channel) {
      rows = rows.filter(r => r.collection_channel === collection_channel);
    }

    // Filter by manual review metadata. Null/empty review status means "unreviewed".
    if (review_status) {
      rows = rows.filter(r => {
        const normalizedReviewStatus = r.review_status || 'unreviewed';
        return normalizedReviewStatus === review_status;
      });
    }

    if (review_decision) {
      rows = rows.filter(r => r.review_decision === review_decision);
    }

    // Filter by date range (transaction_date format: YYYY-MM-DD)
    if (start_date) {
      rows = rows.filter(r => r.transaction_date >= start_date);
    }
    if (end_date) {
      rows = rows.filter(r => r.transaction_date <= end_date);
    }

    // Filter by imported date range. TODO: move this to SQL WHERE clauses for production scale.
    if (imported_from) {
      rows = rows.filter(r => (r.created_at || r.imported_at || r.transaction_date) >= imported_from);
    }
    if (imported_to) {
      rows = rows.filter(r => (r.created_at || r.imported_at || r.transaction_date) <= imported_to);
    }

    // Filter by reviewed date range. TODO: move this to SQL WHERE clauses for production scale.
    if (reviewed_from) {
      rows = rows.filter(r => r.reviewed_at && r.reviewed_at >= reviewed_from);
    }
    if (reviewed_to) {
      rows = rows.filter(r => r.reviewed_at && r.reviewed_at <= reviewed_to);
    }

    // Filter by amount
    if (min_amount) {
      const min = Number(min_amount);
      rows = rows.filter(r => r.amount >= min);
    }
    if (max_amount) {
      const max = Number(max_amount);
      rows = rows.filter(r => r.amount <= max);
    }

    // Search query substring check (case insensitive)
    if (search) {
      const query = search.toLowerCase();
      rows = rows.filter(r =>
        (r.transaction_code && r.transaction_code.toLowerCase().includes(query)) ||
        (r.reference_account && r.reference_account.toLowerCase().includes(query)) ||
        (r.payer_phone && r.payer_phone.toLowerCase().includes(query)) ||
        (r.payer_name && r.payer_name.toLowerCase().includes(query)) ||
        (r.description && r.description.toLowerCase().includes(query))
      );
    }

    // Sort descending by transaction_date, then descending by ID
    rows.sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) {
        return b.transaction_date.localeCompare(a.transaction_date);
      }
      return b.id - a.id;
    });

    // Map rows to include preloaded tenant/invoice metadata and matching suggestions
    const enrichedRows = rows.map(r => {
      const tenant = r.suggested_tenant_id ? tenantMap.get(r.suggested_tenant_id) : null;
      const invoice = r.suggested_invoice_id ? invoiceMap.get(r.suggested_invoice_id) : null;

      let suggestions = [];
      if (r.status !== 'ignored') {
        for (const inv of eligibleInvoices) {
          const activeTenant = activeTenantMap.get(inv.tenant_id);
          if (!activeTenant) continue;
          const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
          const property = unit ? propertiesMap.get(unit.property_id) : null;

          const match = calculateCandidateScore(r, activeTenant, inv, unit, property);
          if (match) {
            suggestions.push(match);
          }
        }

        // Sort suggestions:
        // 1. match_score descending
        // 2. confidence high -> medium -> low
        // 3. newest/open invoice priority (newest due date, then newest invoice id)
        suggestions.sort((a, b) => {
          if (b.match_score !== a.match_score) {
            return b.match_score - a.match_score;
          }
          const confWeight = { high: 3, medium: 2, low: 1 };
          const weightA = confWeight[a.match_confidence] || 0;
          const weightB = confWeight[b.match_confidence] || 0;
          if (weightB !== weightA) {
            return weightB - weightA;
          }
          if (a.invoice_due_date !== b.invoice_due_date) {
            return b.invoice_due_date.localeCompare(a.invoice_due_date);
          }
          return b.invoice_id - a.invoice_id;
        });

        // Limit to maximum 5 suggestions
        suggestions = suggestions.slice(0, 5);
      }

      const acceptedTenant = r.accepted_tenant_id ? tenantMap.get(r.accepted_tenant_id) : null;
      const acceptedInvoice = r.accepted_invoice_id ? invoiceMap.get(r.accepted_invoice_id) : null;

      return {
        ...r,
        suggested_tenant: tenant ? {
          id: tenant.id,
          full_name: tenant.full_name,
          tenant_account_number: tenant.tenant_account_number
        } : null,
        suggested_invoice: invoice ? {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          total: invoice.total,
          balance: invoice.balance
        } : null,
        accepted_tenant: acceptedTenant ? {
          id: acceptedTenant.id,
          full_name: acceptedTenant.full_name,
          tenant_account_number: acceptedTenant.tenant_account_number
        } : null,
        accepted_invoice: acceptedInvoice ? {
          id: acceptedInvoice.id,
          invoice_number: acceptedInvoice.invoice_number,
          total: acceptedInvoice.total,
          balance: acceptedInvoice.balance
        } : null,
        reviewer_name: r.reviewed_by ? (userMap.get(r.reviewed_by) || 'Unknown') : null,
        audit_count: auditCountMap.get(Number(r.id)) || 0,
        has_audit_history: (auditCountMap.get(Number(r.id)) || 0) > 0,
        suggestions
      };
    });

    let filteredEnrichedRows = enrichedRows;

    // Enriched filters that depend on suggestions/audit metadata.
    // TODO: move suggestion/audit filters to SQL/materialized summaries for production-scale datasets.
    if (has_suggestions === 'true') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => r.suggestions && r.suggestions.length > 0);
    } else if (has_suggestions === 'false') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => !r.suggestions || r.suggestions.length === 0);
    }

    if (has_audit_history === 'true') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => r.has_audit_history === true);
    } else if (has_audit_history === 'false') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => r.has_audit_history !== true);
    }

    if (match_confidence) {
      filteredEnrichedRows = filteredEnrichedRows.filter(r =>
        r.suggestions && r.suggestions.some(s => s.match_confidence === match_confidence)
      );
    }

    if (min_match_score) {
      const minScore = Number(min_match_score);
      filteredEnrichedRows = filteredEnrichedRows.filter(r =>
        r.suggestions && r.suggestions.some(s => Number(s.match_score) >= minScore)
      );
    }

    if (max_match_score) {
      const maxScore = Number(max_match_score);
      filteredEnrichedRows = filteredEnrichedRows.filter(r =>
        r.suggestions && r.suggestions.some(s => Number(s.match_score) <= maxScore)
      );
    }

    res.json(filteredEnrichedRows);
  }));

  // POST /api/payment-evidence/import-csv-preview
  router.post('/payment-evidence/import-csv-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const {
      source_provider,
      source_perspective,
      document_source,
      collection_channel,
      original_filename,
      preview_rows
    } = req.body;

    if (!Array.isArray(preview_rows)) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'preview_rows must be an array.'
      });
    }

    if (preview_rows.length > 2000) {
      return res.status(400).json({
        error: 'LIMIT_EXCEEDED',
        message: 'Import limited to maximum of 2,000 rows.'
      });
    }

    let imported_count = 0;
    let ignored_count = 0;
    let duplicate_count = 0;
    let needs_review_count = 0;
    let failed_validation_count = 0;

    // Create the batch record first
    const batchRow = await activeDb.insert('payment_evidence_batches', {
      organization_id: orgId,
      upload_filename: original_filename || 'unknown.csv',
      import_timestamp: new Date().toISOString(),
      uploaded_by: userId,
      detected_provider: source_provider || 'unknown',
      detected_format: 'CSV',
      parser_version: '1.0',
      total_rows: preview_rows.length,
      rows_imported: 0,
      rows_ignored: 0,
      rows_duplicated: 0,
      rows_reconciled: 0,
      rows_needing_review: 0,
      rows_failed_validation: 0
    });

    const batch_id = batchRow.id;
    const insertedRows = [];

    const normalizePhone = (phone) => {
      if (!phone) return null;
      let p = String(phone).replace(/\D/g, '');
      if (p.startsWith('0')) {
        p = '254' + p.slice(1);
      } else if (p.length === 9 && (p.startsWith('7') || p.startsWith('1'))) {
        p = '254' + p;
      }
      return p;
    };

    const processedHashes = new Set();
    const processedCodes = new Set();

    // TODO: If using PostgreSQL in production, wrap the batch creation and row inserts in a transaction block to ensure atomicity.
    for (let i = 0; i < preview_rows.length; i++) {
      const row = preview_rows[i];
      const rawPayload = row.raw_fields || row;

      let normalizedRow;
      try {
        normalizedRow = normalizePaymentEvidence(rawPayload, {
          organization_id: orgId,
          batch_id,
          source_provider: source_provider || 'unknown',
          source_type: 'CSV_STATEMENT',
          source_perspective: source_perspective || 'landlord',
          document_source: document_source || 'CSV'
        });
      } catch (err) {
        console.error('Normalization validation failed:', err);
        failed_validation_count++;
        continue;
      }

      // Overwrite / ensure values
      const amount = normalizedRow.amount;
      const transaction_date = normalizedRow.transaction_date;
      const direction = row.direction || normalizedRow.direction || 'credit';

      const isEmptyRow = row.warnings && row.warnings.includes('empty rows');
      if (!transaction_date || isNaN(amount) || amount <= 0 || isEmptyRow) {
        failed_validation_count++;
        continue;
      }

      // Normalize phone number
      normalizedRow.payer_phone = normalizePhone(normalizedRow.payer_phone);

      const transaction_code = normalizedRow.transaction_code;
      const reference_account = normalizedRow.reference_account;

      // Re-evaluate warnings
      const warnings = [];
      if (!transaction_code && !reference_account) {
        warnings.push('missing transaction code and missing reference account');
      }

      if (transaction_code) {
        const isDuplicateInBatch = preview_rows.some((r, idx) => {
          if (idx === i) return false;
          const rPayload = r.raw_fields || r;
          const rCode = rPayload.transaction_code || rPayload.transactionCode || rPayload.reference || rPayload.mpesa_code || null;
          return rCode && String(rCode).toUpperCase() === transaction_code;
        });
        if (isDuplicateInBatch) {
          warnings.push('duplicate transaction codes');
        }
      }

      // Check duplicate rows in this batch
      const rowStr = JSON.stringify(rawPayload);
      const isDuplicateRow = preview_rows.some((r, idx) => idx !== i && JSON.stringify(r.raw_fields || r) === rowStr);
      if (isDuplicateRow) {
        warnings.push('duplicate rows');
      }

      if (direction === 'debit') {
        warnings.push('debit rows on landlord statements');
      }

      if (Array.isArray(row.warnings)) {
        row.warnings.forEach(w => {
          if (!warnings.includes(w)) {
            warnings.push(w);
          }
        });
      }

      const row_hash = normalizedRow.row_hash;

      // Duplicate checking in database and processed batch items
      const existingHash = await activeDb.findOne('payment_evidence', { organization_id: orgId, row_hash });
      if (existingHash || processedHashes.has(row_hash)) {
        duplicate_count++;
        continue;
      }

      if (transaction_code) {
        const existingCode = await activeDb.findOne('payment_evidence', { organization_id: orgId, transaction_code });
        if (existingCode || processedCodes.has(transaction_code)) {
          duplicate_count++;
          continue;
        }
      }

      // Track processed keys to prevent duplicate insertions inside the batch
      processedHashes.add(row_hash);
      if (transaction_code) {
        processedCodes.add(transaction_code);
      }

      // Determine status
      let status = 'imported';
      if (direction === 'debit') {
        status = 'ignored';
        ignored_count++;
      } else if (warnings.length > 0) {
        status = 'needs_review';
        needs_review_count++;
      } else {
        imported_count++;
      }

      try {
        const inserted = await activeDb.insert('payment_evidence', {
          organization_id: orgId,
          batch_id,
          source_provider: normalizedRow.source_provider,
          source_type: normalizedRow.source_type,
          source_perspective: normalizedRow.source_perspective,
          collection_channel: collection_channel || normalizedRow.collection_channel || 'unknown',
          document_source: normalizedRow.document_source,
          transaction_date,
          transaction_time: normalizedRow.transaction_time || null,
          amount,
          direction,
          transaction_code,
          payer_name: normalizedRow.payer_name,
          payer_phone: normalizedRow.payer_phone,
          recipient_name: normalizedRow.recipient_name,
          recipient_phone: normalizedRow.recipient_phone,
          paybill_number: normalizedRow.paybill_number,
          till_number: normalizedRow.till_number,
          agent_number: normalizedRow.agent_number,
          reference_account,
          description: normalizedRow.description || '',
          raw_text: normalizedRow.raw_text,
          raw_fields: normalizedRow.raw_fields,
          row_hash,
          confidence: 0,
          evidence_strength: transaction_code ? 'high' : 'unknown',
          status,
          ignored_reason: status === 'ignored' ? 'debit_row_on_landlord_statement' : null,
          paybill_reference: normalizedRow.paybill_reference,
          bank_reference: normalizedRow.bank_reference,
          recipient_account: normalizedRow.recipient_account,
          invoice_reference: normalizedRow.invoice_reference,
          landlord_account_number: normalizedRow.landlord_account_number
        });

        insertedRows.push(inserted);
      } catch (err) {
        console.error('Failed to insert record:', err);
        failed_validation_count++;
      }
    }

    // Update batch record with final counts
    await activeDb.update('payment_evidence_batches', batch_id, {
      rows_imported: imported_count,
      rows_ignored: ignored_count,
      rows_duplicated: duplicate_count,
      rows_needing_review: needs_review_count,
      rows_failed_validation: failed_validation_count
    });

    res.json({
      success: true,
      batch_id,
      imported_count,
      ignored_count,
      duplicate_count,
      needs_review_count,
      failed_validation_count,
      rows: insertedRows
    });
  }));

  // POST /api/payment-evidence/:id/review-decision
  // HARDENING REVIEW & SECURITY BOUNDARY:
  // - This endpoint is strictly for logging manual review decisions (metadata-only audit trail).
  // - It does NOT reconcile payments, allocate funds, mark invoices as paid, create receipts,
  //   or perform any write operations on financial ledgers/transactions.
  // - Access is restricted to authenticated Landlord or Super Admin roles only.
  router.post('/payment-evidence/:id/review-decision', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { decision, review_notes, rejected_reason, accepted_tenant_id, accepted_invoice_id } = req.body;

    const allowedDecisions = ['accepted_suggestion', 'rejected_suggestion', 'needs_more_evidence', 'marked_irrelevant'];
    if (!decision || !allowedDecisions.includes(decision)) {
      return res.status(400).json({
        error: 'INVALID_DECISION',
        message: `The decision must be one of: ${allowedDecisions.join(', ')}`
      });
    }

    if (row.status === 'ignored' && decision === 'accepted_suggestion') {
      return res.status(400).json({
        error: 'IGNORED_ROW_BLOCKED',
        message: 'Ignored payment evidence rows cannot accept match suggestions.'
      });
    }

    let acceptedScore = null;
    let acceptedConf = null;
    if (decision === 'accepted_suggestion') {
      if (!accepted_tenant_id || !accepted_invoice_id) {
        return res.status(400).json({
          error: 'MISSING_ACCEPTED_REFS',
          message: 'Both accepted_tenant_id and accepted_invoice_id are required for accepting a suggestion.'
        });
      }

      const allTenants = await activeDb.find('tenants', { organization_id: orgId });
      const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
      const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
      const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];

      const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
      const unitsMap = new Map(allUnits.map(u => [u.id, u]));

      const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
      const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

      let suggestions = [];
      for (const inv of eligibleInvoices) {
        const activeTenant = activeTenants.find(t => t.id === inv.tenant_id);
        if (!activeTenant) continue;
        const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
        const property = unit ? propertiesMap.get(unit.property_id) : null;

        const match = calculateCandidateScore(row, activeTenant, inv, unit, property);
        if (match) {
          suggestions.push(match);
        }
      }

      const matchingSugg = suggestions.find(s => s.tenant_id === Number(accepted_tenant_id) && s.invoice_id === Number(accepted_invoice_id));
      if (!matchingSugg) {
        return res.status(400).json({
          error: 'SUGGESTION_NOT_FOUND',
          message: 'The selected tenant and invoice combination is not among the suggested match candidates for this row.'
        });
      }

      acceptedScore = matchingSugg.match_score;
      acceptedConf = matchingSugg.match_confidence;
    }

    if (review_notes && String(review_notes).length > 1000) {
      return res.status(400).json({
        error: 'NOTES_TOO_LONG',
        message: 'Review notes must not exceed 1000 characters.'
      });
    }
    if (rejected_reason && String(rejected_reason).length > 500) {
      return res.status(400).json({
        error: 'REASON_TOO_LONG',
        message: 'Rejected reason must not exceed 500 characters.'
      });
    }

    const updates = {
      review_status: decision,
      review_decision: decision,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null,
      accepted_tenant_id: decision === 'accepted_suggestion' ? Number(accepted_tenant_id) : null,
      accepted_invoice_id: decision === 'accepted_suggestion' ? Number(accepted_invoice_id) : null,
      accepted_match_score: acceptedScore,
      accepted_match_confidence: acceptedConf,
      rejected_reason: (decision === 'rejected_suggestion' || decision === 'marked_irrelevant') ? (rejected_reason || null) : null
    };

    const previousReviewMetadata = {
      review_status: row.review_status ?? null,
      review_decision: row.review_decision ?? null,
      reviewed_by: row.reviewed_by ?? null,
      reviewed_at: row.reviewed_at ?? null,
      review_notes: row.review_notes ?? null,
      accepted_tenant_id: row.accepted_tenant_id ?? null,
      accepted_invoice_id: row.accepted_invoice_id ?? null,
      accepted_match_score: row.accepted_match_score ?? null,
      accepted_match_confidence: row.accepted_match_confidence ?? null,
      rejected_reason: row.rejected_reason ?? null
    };

    const auditRow = {
      organization_id: orgId,
      payment_evidence_id: rowId,
      action: row.review_status ? 'update_decision' : 'create_decision',
      previous_review_status: row.review_status || null,
      new_review_status: updates.review_status,
      previous_review_decision: row.review_decision || null,
      new_review_decision: updates.review_decision,
      previous_accepted_tenant_id: row.accepted_tenant_id == null ? null : Number(row.accepted_tenant_id),
      new_accepted_tenant_id: updates.accepted_tenant_id,
      previous_accepted_invoice_id: row.accepted_invoice_id == null ? null : Number(row.accepted_invoice_id),
      new_accepted_invoice_id: updates.accepted_invoice_id,
      previous_accepted_match_score: row.accepted_match_score == null ? null : Number(row.accepted_match_score),
      new_accepted_match_score: updates.accepted_match_score,
      previous_accepted_match_confidence: row.accepted_match_confidence || null,
      new_accepted_match_confidence: updates.accepted_match_confidence,
      previous_rejected_reason: row.rejected_reason || null,
      new_rejected_reason: updates.rejected_reason,
      previous_review_notes: row.review_notes || null,
      new_review_notes: updates.review_notes,
      actor_user_id: userId,
      actor_role: role,
      actor_ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      user_agent: (req.headers && req.headers['user-agent']) || 'Unknown',
      safety_message: 'Manual review audit only. No payment has been reconciled, allocated, or applied.'
    };

    // TODO: PostgreSQL production should wrap the review metadata update and audit insert in a single real transaction.
    // The current generic DB wrapper exposes CRUD helpers but no same-client transaction helper.
    let updatedRow;
    let reviewMetadataUpdated = false;

    try {
      const rows = await activeDb.update('payment_evidence', rowId, updates);
      updatedRow = rows[0];
      if (!updatedRow) {
        throw new Error('Target payment evidence row was not updated.');
      }
      reviewMetadataUpdated = true;

      await activeDb.insert('payment_evidence_review_audit', auditRow);
    } catch (err) {
      if (reviewMetadataUpdated) {
        try {
          await activeDb.update('payment_evidence', rowId, previousReviewMetadata);
        } catch (rollbackErr) {
          console.error('Failed to restore review metadata after audit write failure:', rollbackErr);
        }
      }

      console.error('Failed to save payment evidence review audit:', err);
      return res.status(500).json({
        error: 'AUDIT_WRITE_FAILED',
        message: 'Review decision was not saved because the audit history could not be written. No payment has been reconciled, allocated, or applied.'
      });
    }

    const tenant = updatedRow.suggested_tenant_id ? (await activeDb.findOne('tenants', { id: updatedRow.suggested_tenant_id })) : null;
    const invoice = updatedRow.suggested_invoice_id ? (await activeDb.findOne('invoices', { id: updatedRow.suggested_invoice_id })) : null;

    const allTenants = await activeDb.find('tenants', { organization_id: orgId });
    const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
    const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
    const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];

    const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
    const unitsMap = new Map(allUnits.map(u => [u.id, u]));

    const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
    const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

    let suggestions = [];
    if (updatedRow.status !== 'ignored') {
      for (const inv of eligibleInvoices) {
        const activeTenant = activeTenants.find(t => t.id === inv.tenant_id);
        if (!activeTenant) continue;
        const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
        const property = unit ? propertiesMap.get(unit.property_id) : null;

        const match = calculateCandidateScore(updatedRow, activeTenant, inv, unit, property);
        if (match) {
          suggestions.push(match);
        }
      }
      suggestions.sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        const confWeight = { high: 3, medium: 2, low: 1 };
        const weightA = confWeight[a.match_confidence] || 0;
        const weightB = confWeight[b.match_confidence] || 0;
        if (weightB !== weightA) return weightB - weightA;
        if (a.invoice_due_date !== b.invoice_due_date) return b.invoice_due_date.localeCompare(a.invoice_due_date);
        return b.invoice_id - a.invoice_id;
      });
      suggestions = suggestions.slice(0, 5);
    }

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));

    const acceptedTenant = updatedRow.accepted_tenant_id ? tenantMap.get(updatedRow.accepted_tenant_id) : null;
    const acceptedInvoice = updatedRow.accepted_invoice_id ? invoiceMap.get(updatedRow.accepted_invoice_id) : null;

    const reviewUser = await activeDb.findOne('users', { id: userId });

    const finalRow = {
      ...updatedRow,
      suggested_tenant: tenant ? {
        id: tenant.id,
        full_name: tenant.full_name,
        tenant_account_number: tenant.tenant_account_number
      } : null,
      suggested_invoice: invoice ? {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        total: invoice.total,
        balance: invoice.balance
      } : null,
      accepted_tenant: acceptedTenant ? {
        id: acceptedTenant.id,
        full_name: acceptedTenant.full_name,
        tenant_account_number: acceptedTenant.tenant_account_number
      } : null,
      accepted_invoice: acceptedInvoice ? {
        id: acceptedInvoice.id,
        invoice_number: acceptedInvoice.invoice_number,
        total: acceptedInvoice.total,
        balance: acceptedInvoice.balance
      } : null,
      suggestions,
      reviewer_name: reviewUser ? reviewUser.name : 'Unknown Reviewer'
    };

    res.json({
      success: true,
      message: 'Review decision saved. No payment has been reconciled or applied.',
      row: finalRow
    });
  }));

  // GET /api/payment-evidence/:id/review-audit
  router.get('/payment-evidence/:id/review-audit', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const auditRows = await activeDb.find('payment_evidence_review_audit', {
      organization_id: orgId,
      payment_evidence_id: rowId
    });

    // Resolve user names using users table mapping for actor_name
    const allUsers = await activeDb.find('users', {}) || [];
    const userMap = new Map(allUsers.map(u => [u.id, u.name]));

    const enrichedAudit = auditRows.map(item => ({
      action: item.action,
      previous_review_status: item.previous_review_status,
      new_review_status: item.new_review_status,
      previous_review_decision: item.previous_review_decision,
      new_review_decision: item.new_review_decision,
      previous_accepted_tenant_id: item.previous_accepted_tenant_id,
      new_accepted_tenant_id: item.new_accepted_tenant_id,
      previous_accepted_invoice_id: item.previous_accepted_invoice_id,
      new_accepted_invoice_id: item.new_accepted_invoice_id,
      previous_accepted_match_score: item.previous_accepted_match_score,
      new_accepted_match_score: item.new_accepted_match_score,
      previous_accepted_match_confidence: item.previous_accepted_match_confidence,
      new_accepted_match_confidence: item.new_accepted_match_confidence,
      previous_rejected_reason: item.previous_rejected_reason,
      new_rejected_reason: item.new_rejected_reason,
      previous_review_notes: item.previous_review_notes,
      new_review_notes: item.new_review_notes,
      actor_user_id: item.actor_user_id,
      actor_name: item.actor_user_id ? (userMap.get(item.actor_user_id) || 'Unknown') : 'Unknown',
      actor_role: item.actor_role,
      created_at: item.created_at,
      safety_message: item.safety_message
    }));

    // Sort newest first
    enrichedAudit.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      success: true,
      audit: enrichedAudit
    });
  }));

  // GET /api/payment-evidence/:id/allocation-preview
  router.get('/payment-evidence/:id/allocation-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    let ready = false;
    let state = 'not_reviewed';
    let message = 'This evidence row has not been reviewed yet.';
    let tenant = null;
    let invoice = null;

    const reviewDecision = row.review_status || row.review_decision || '';

    if (!reviewDecision) {
      ready = false;
      state = 'not_reviewed';
      message = 'This evidence row has not been reviewed yet.';
    } else if (row.status === 'ignored' || reviewDecision === 'marked_irrelevant') {
      ready = false;
      state = 'ignored';
      message = 'This evidence row has been marked as ignored/irrelevant.';
    } else if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      ready = false;
      state = 'already_reconciled';
      message = 'This payment evidence row has already been allocated or reconciled.';
    } else if (reviewDecision === 'rejected_suggestion' || reviewDecision === 'needs_more_evidence') {
      ready = false;
      state = 'no_accepted_match';
      message = 'This evidence row does not have an accepted match suggestion.';
    } else if (reviewDecision === 'accepted_suggestion') {
      const tenantId = row.accepted_tenant_id;
      const invoiceId = row.accepted_invoice_id;

      if (!tenantId) {
        ready = false;
        state = 'missing_tenant';
        message = 'The accepted tenant is missing or does not exist.';
      } else {
        tenant = await activeDb.findOne('tenants', { id: Number(tenantId), organization_id: orgId });
        if (!tenant) {
          ready = false;
          state = 'missing_tenant';
          message = 'The accepted tenant is missing or does not exist.';
        } else if (!invoiceId) {
          ready = false;
          state = 'missing_invoice';
          message = 'The accepted invoice is missing or does not exist.';
        } else {
          invoice = await activeDb.findOne('invoices', { id: Number(invoiceId), organization_id: orgId });
          if (!invoice) {
            ready = false;
            state = 'missing_invoice';
            message = 'The accepted invoice is missing or does not exist.';
          } else if (invoice.status === 'paid' || invoice.status === 'void') {
            ready = false;
            state = 'invoice_not_payable';
            message = 'The accepted invoice is already paid or void.';
          } else if (Number(row.amount) <= 0 || isNaN(Number(row.amount))) {
            ready = false;
            state = 'amount_invalid';
            message = 'The payment evidence amount is invalid.';
          } else {
            ready = true;
            state = 'ready_for_draft_allocation';
            message = 'This evidence row is ready for draft allocation.';
          }
        }
      }
    }

    const amount = Number(row.amount);
    const invoice_balance = invoice ? Number(invoice.balance) : 0;

    let allocation_amount_preview = 0;
    let remaining_balance_preview = 0;
    let overpayment_preview = 0;

    if (ready && invoice) {
      allocation_amount_preview = Math.min(amount, invoice_balance);
      remaining_balance_preview = Math.max(0, invoice_balance - amount);
      overpayment_preview = Math.max(0, amount - invoice_balance);
    }

    const blocking_reasons = [];
    if (!reviewDecision) {
      blocking_reasons.push('Evidence row has not been reviewed yet.');
    }
    if (row.status === 'ignored' || reviewDecision === 'marked_irrelevant') {
      blocking_reasons.push('Evidence row is ignored or irrelevant.');
    }
    if (reviewDecision === 'rejected_suggestion' || reviewDecision === 'needs_more_evidence') {
      blocking_reasons.push('No accepted match suggestion for this evidence row.');
    }
    if (reviewDecision === 'accepted_suggestion') {
      if (!row.accepted_tenant_id || !tenant) {
        blocking_reasons.push('Accepted tenant is missing or does not exist.');
      }
      if (!row.accepted_invoice_id || !invoice) {
        blocking_reasons.push('Accepted invoice is missing or does not exist.');
      } else if (invoice.status === 'paid' || invoice.status === 'void') {
        blocking_reasons.push('Accepted invoice is already paid or void.');
      }
    }
    if (amount <= 0 || isNaN(amount)) {
      blocking_reasons.push('Payment evidence amount must be positive.');
    }
    if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      blocking_reasons.push('An allocation or reconciliation already exists for this evidence row.');
    }

    const can_confirm_allocation = ready && blocking_reasons.length === 0;

    const confirmation_contract = {
      can_confirm_allocation,
      required_confirmation_text: 'CONFIRM ALLOCATION PREVIEW',
      blocking_reasons,
      requires_landlord_confirmation: true,
      requires_current_preview_state: true,
      requires_accepted_review_decision: true,
      requires_invoice_payable: true,
      requires_positive_amount: true,
      requires_no_existing_allocation: true,
      safety_message: 'This confirmation contract is read-only. No allocation, invoice, tenant balance, ledger, receipt, or payment record has been changed.'
    };

    res.json({
      ready,
      state,
      message,
      evidence_id: row.id,
      amount,
      accepted_tenant_id: tenant ? tenant.id : null,
      accepted_tenant_name: tenant ? tenant.full_name : null,
      accepted_invoice_id: invoice ? invoice.id : null,
      accepted_invoice_number: invoice ? invoice.invoice_number : null,
      invoice_status: invoice ? invoice.status : null,
      invoice_balance: invoice ? invoice_balance : null,
      allocation_amount_preview,
      remaining_balance_preview,
      overpayment_preview,
      confirmation_contract,
      required_confirmation_text: 'CONFIRM ALLOCATION PREVIEW',
      can_confirm_allocation,
      blocking_reasons,
      safety_message: 'This is a draft allocation preview only. No invoice, tenant balance, ledger, receipt, or payment record has been changed.'
    });
  }));

  // POST /api/payment-evidence/:id/confirm-allocation
  router.post('/payment-evidence/:id/confirm-allocation', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { confirmation_text } = req.body;
    if (!confirmation_text) {
      return res.status(400).json({
        error: 'CONFIRMATION_TEXT_REQUIRED',
        message: 'Confirmation text is required.'
      });
    }
    if (confirmation_text !== 'CONFIRM ALLOCATION PREVIEW') {
      return res.status(400).json({
        error: 'INVALID_CONFIRMATION_TEXT',
        message: 'Confirmation text is invalid. Please type "CONFIRM ALLOCATION PREVIEW".'
      });
    }

    if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      return res.status(400).json({
        error: 'ALREADY_ALLOCATED',
        message: 'This payment evidence row has already been allocated or reconciled.'
      });
    }

    const reviewDecision = row.review_status || row.review_decision || '';
    if (reviewDecision !== 'accepted_suggestion') {
      return res.status(400).json({
        error: 'INVALID_REVIEW_STATE',
        message: 'Only reviewed rows with accepted suggestions can be confirmed for allocation.'
      });
    }

    const tenantId = row.accepted_tenant_id;
    const invoiceId = row.accepted_invoice_id;

    if (!tenantId) {
      return res.status(400).json({ error: 'MISSING_TENANT', message: 'The accepted tenant is missing.' });
    }
    const tenant = await activeDb.findOne('tenants', { id: Number(tenantId), organization_id: orgId });
    if (!tenant) {
      return res.status(400).json({ error: 'MISSING_TENANT', message: 'The accepted tenant does not exist or is outside organization.' });
    }

    if (!invoiceId) {
      return res.status(400).json({ error: 'MISSING_INVOICE', message: 'The accepted invoice is missing.' });
    }
    const invoice = await activeDb.findOne('invoices', { id: Number(invoiceId), organization_id: orgId });
    if (!invoice) {
      return res.status(400).json({ error: 'MISSING_INVOICE', message: 'The accepted invoice does not exist or is outside organization.' });
    }

    if (invoice.status === 'paid' || invoice.status === 'void') {
      return res.status(400).json({ error: 'INVOICE_NOT_PAYABLE', message: 'The accepted invoice is already paid or void.' });
    }

    const amount = Number(row.amount);
    if (amount <= 0 || isNaN(amount)) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'The payment evidence amount is invalid.' });
    }

    const invoice_balance = Number(invoice.balance);
    if (amount > invoice_balance) {
      return res.status(400).json({
        error: 'OVERPAYMENT_NOT_SUPPORTED',
        message: 'Overpayment allocation requires wallet credit support and is not enabled yet.'
      });
    }

    const allocation_amount = amount;
    const remaining_balance = invoice_balance - allocation_amount;
    const overpayment_amount = 0;
    const invoice_status_before = invoice.status;
    const invoice_status_after = remaining_balance <= 0 ? 'paid' : 'partially_paid';

    // Perform database operations
    const txData = {
      organization_id: orgId,
      tenant_id: tenant.id,
      property_id: tenant.property_id || null,
      unit_id: tenant.unit_id || null,
      amount: allocation_amount,
      currency: tenant.currency || 'KES',
      transaction_type: 'payment',
      payment_method: row.collection_channel || 'other',
      source: 'manual',
      reference_number: row.transaction_code || null,
      account_number: tenant.tenant_account_number || null,
      payer_name: tenant.full_name || null,
      payer_phone: tenant.phone_number || null,
      transaction_date: row.transaction_date,
      status: 'reconciled',
      raw_payload: JSON.stringify({
        evidence_id: row.id,
        source: 'payment_evidence_allocation'
      }),
      created_by: userId
    };

    const createdTx = await activeDb.insert('transactions', txData);

    const allocationData = {
      organization_id: orgId,
      transaction_id: createdTx.id,
      invoice_id: invoice.id,
      amount_allocated: allocation_amount,
      allocated_by: userId,
      allocated_at: new Date().toISOString()
    };

    await activeDb.insert('payment_allocations', allocationData);

    const updatedAmountPaid = Number(invoice.amount_paid) + allocation_amount;
    await activeDb.update('invoices', invoice.id, {
      amount_paid: updatedAmountPaid,
      balance: remaining_balance,
      status: invoice_status_after,
      updated_at: new Date().toISOString()
    });

    await activeDb.update('payment_evidence', row.id, {
      status: 'manually_reconciled',
      updated_at: new Date().toISOString()
    });

    const auditRow = {
      organization_id: orgId,
      payment_evidence_id: row.id,
      action: 'confirm_allocation',
      previous_review_status: row.review_status || null,
      new_review_status: row.review_status || null,
      previous_review_decision: row.review_decision || null,
      new_review_decision: row.review_decision || null,
      previous_accepted_tenant_id: row.accepted_tenant_id ? Number(row.accepted_tenant_id) : null,
      new_accepted_tenant_id: row.accepted_tenant_id ? Number(row.accepted_tenant_id) : null,
      previous_accepted_invoice_id: row.accepted_invoice_id ? Number(row.accepted_invoice_id) : null,
      new_accepted_invoice_id: row.accepted_invoice_id ? Number(row.accepted_invoice_id) : null,
      previous_accepted_match_score: row.accepted_match_score ? Number(row.accepted_match_score) : null,
      new_accepted_match_score: row.accepted_match_score ? Number(row.accepted_match_score) : null,
      previous_accepted_match_confidence: row.accepted_match_confidence || null,
      new_accepted_match_confidence: row.accepted_match_confidence || null,
      actor_user_id: userId,
      actor_role: role,
      actor_ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      user_agent: (req.headers && req.headers['user-agent']) || 'Unknown',
      safety_message: 'Confirmed allocation applied exactly once. Invoice/payment records were updated according to the confirmed preview. No unrelated tenant, ledger, or receipt records were changed.'
    };

    const createdAudit = await activeDb.insert('payment_evidence_review_audit', auditRow);

    res.json({
      success: true,
      message: 'Payment evidence allocation executed and invoice balance updated.',
      payment_evidence_id: row.id,
      invoice_id: invoice.id,
      tenant_id: tenant.id,
      allocation_amount,
      remaining_balance,
      overpayment_amount,
      invoice_status_before,
      invoice_status_after,
      safety_message: 'Confirmed allocation applied exactly once. Invoice/payment records were updated according to the confirmed preview. No unrelated tenant, ledger, or receipt records were changed.',
      audit_reference: createdAudit ? String(createdAudit.id) : null
    });
  }));

  // GET /api/payment-evidence/:id/allocation-result
  router.get('/payment-evidence/:id/allocation-result', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const isAllocated = row.status === 'manually_reconciled' || row.status === 'auto_reconciled';
    if (!isAllocated) {
      return res.json({
        success: true,
        payment_evidence_id: row.id,
        allocation_result: {
          allocated: false,
          state: 'not_allocated',
          message: 'This payment evidence row has not been allocated or reconciled yet.'
        },
        reversal_readiness: {
          can_request_reversal: false,
          state: 'reversal_not_enabled',
          blocking_reasons: [
            'Reversal execution is not enabled in this release.'
          ],
          required_future_confirmation_text: 'CONFIRM ALLOCATION REVERSAL',
          safety_message: 'This is reversal readiness only. No allocation, invoice, transaction, ledger, receipt, or tenant record has been changed.'
        },
        safety_message: 'Allocation result is read-only. No financial records were changed by this lookup.'
      });
    }

    const txs = await activeDb.find('transactions', { organization_id: orgId });
    const transaction = txs.find(t => {
      try {
        const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
        return payload && Number(payload.evidence_id) === Number(rowId);
      } catch (e) {
        return false;
      }
    });

    let allocation = null;
    if (transaction) {
      allocation = await activeDb.findOne('payment_allocations', { transaction_id: transaction.id, organization_id: orgId });
    }

    const tenant = row.accepted_tenant_id
      ? await activeDb.findOne('tenants', { id: Number(row.accepted_tenant_id), organization_id: orgId })
      : null;

    const invoice = row.accepted_invoice_id
      ? await activeDb.findOne('invoices', { id: Number(row.accepted_invoice_id), organization_id: orgId })
      : null;

    const audits = await activeDb.find('payment_evidence_review_audit', { payment_evidence_id: rowId, action: 'confirm_allocation', organization_id: orgId });
    audits.sort((a, b) => b.id - a.id);
    const auditRow = audits[0];

    res.json({
      success: true,
      payment_evidence_id: row.id,
      allocation_result: {
        allocated: true,
        state: 'allocated',
        transaction_id: transaction ? transaction.id : null,
        payment_allocation_id: allocation ? allocation.id : null,
        tenant_id: tenant ? tenant.id : null,
        tenant_name: tenant ? tenant.full_name : null,
        invoice_id: invoice ? invoice.id : null,
        invoice_number: invoice ? invoice.invoice_number : null,
        invoice_status: invoice ? invoice.status : null,
        allocation_amount: allocation ? Number(allocation.amount_allocated) : (transaction ? Number(transaction.amount) : 0),
        invoice_balance_after: invoice ? Number(invoice.balance) : 0,
        payment_evidence_status: row.status,
        allocated_at: allocation ? allocation.allocated_at : (transaction ? transaction.created_at : null),
        audit_reference: auditRow ? String(auditRow.id) : null
      },
      reversal_readiness: {
        can_request_reversal: false,
        state: 'reversal_not_enabled',
        blocking_reasons: [
          'Reversal execution is not enabled in this release.'
        ],
        required_future_confirmation_text: 'CONFIRM ALLOCATION REVERSAL',
        safety_message: 'This is reversal readiness only. No allocation, invoice, transaction, ledger, receipt, or tenant record has been changed.'
      },
      safety_message: 'Allocation result is read-only. No financial records were changed by this lookup.'
    });
  }));

  // GET /api/payment-evidence/:id/receipt-preview
  router.get('/payment-evidence/:id/receipt-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const isAllocated = row.status === 'manually_reconciled' || row.status === 'auto_reconciled';
    if (!isAllocated) {
      const duplicateCheckState = await getReceiptDuplicateCheckState(activeDb, orgId, rowId, null, null);
      const receiptIssuanceContract = buildReceiptIssuanceContract({
        orgId,
        row,
        isAllocated,
        transaction: null,
        allocation: null,
        invoice: null,
        tenant: null,
        duplicateCheckState
      });

      return res.json({
        success: true,
        payment_evidence_id: row.id,
        receipt_preview: {
          eligible: false,
          state: 'not_allocated',
          message: 'This payment evidence row has not been allocated or reconciled yet.'
        },
        issuance_readiness: {
          can_issue_receipt: false,
          state: 'receipt_issuance_not_enabled',
          blocking_reasons: [
            'Receipt issuance is not enabled in this release.'
          ],
          required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
          safety_message: 'This is a receipt preview only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
        },
        receipt_issuance_contract: receiptIssuanceContract,
        safety_message: 'Receipt preview is read-only. No financial or receipt records were changed by this lookup.'
      });
    }

    const txs = await activeDb.find('transactions', { organization_id: orgId });
    const transaction = txs.find(t => {
      try {
        const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
        return payload && Number(payload.evidence_id) === Number(rowId);
      } catch (e) {
        return false;
      }
    });

    let allocation = null;
    if (transaction) {
      allocation = await activeDb.findOne('payment_allocations', { transaction_id: transaction.id, organization_id: orgId });
    }

    const tenant = row.accepted_tenant_id
      ? await activeDb.findOne('tenants', { id: Number(row.accepted_tenant_id), organization_id: orgId })
      : null;

    const invoice = row.accepted_invoice_id
      ? await activeDb.findOne('invoices', { id: Number(row.accepted_invoice_id), organization_id: orgId })
      : null;

    const property = tenant && tenant.property_id
      ? await activeDb.findOne('properties', { id: Number(tenant.property_id), organization_id: orgId })
      : null;

    const unit = tenant && tenant.unit_id
      ? await activeDb.findOne('units', { id: Number(tenant.unit_id), organization_id: orgId })
      : null;

    const amountPaid = allocation ? Number(allocation.amount_allocated) : (transaction ? Number(transaction.amount) : 0);
    const duplicateCheckState = await getReceiptDuplicateCheckState(activeDb, orgId, rowId, transaction, allocation);
    const receiptIssuanceContract = buildReceiptIssuanceContract({
      orgId,
      row,
      isAllocated,
      transaction,
      allocation,
      invoice,
      tenant,
      duplicateCheckState
    });

    res.json({
      success: true,
      payment_evidence_id: row.id,
      receipt_preview: {
        eligible: true,
        state: 'ready_for_receipt_preview',
        tenant_id: tenant ? tenant.id : null,
        tenant_name: tenant ? tenant.full_name : null,
        invoice_id: invoice ? invoice.id : null,
        invoice_number: invoice ? invoice.invoice_number : null,
        transaction_id: transaction ? transaction.id : null,
        payment_allocation_id: allocation ? allocation.id : null,
        payment_date: row.transaction_date,
        payment_method: row.collection_channel || 'other',
        amount_paid: amountPaid,
        invoice_balance_after: invoice ? Number(invoice.balance) : 0,
        invoice_status: invoice ? invoice.status : null,
        property_name: property ? property.name : 'N/A',
        unit_label: unit ? unit.unit_code : 'N/A',
        receipt_number_preview: 'DRAFT-' + (row.transaction_code || `TX-${rowId}`),
        receipt_title: 'Payment Receipt Preview',
        receipt_lines: [
          {
            label: 'Rent payment allocation',
            amount: amountPaid
          }
        ]
      },
      issuance_readiness: {
        can_issue_receipt: false,
        state: 'receipt_issuance_not_enabled',
        blocking_reasons: [
          'Receipt issuance is not enabled in this release.'
        ],
        required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
        safety_message: 'This is a receipt preview only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
      },
      receipt_issuance_contract: receiptIssuanceContract,
      safety_message: 'Receipt preview is read-only. No financial or receipt records were changed by this lookup.'
    });
  }));

  // POST /api/payment-evidence/:id/issue-receipt
  router.post('/payment-evidence/:id/issue-receipt', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const rowId = Number(req.params.id);

    const context = await getAllocatedReceiptContext(activeDb, orgId, rowId);
    if (!context.row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { confirmation_text } = req.body || {};
    if (!confirmation_text) {
      return res.status(400).json({
        error: 'CONFIRMATION_TEXT_REQUIRED',
        message: 'Confirmation text is required.'
      });
    }
    if (confirmation_text !== 'CONFIRM RECEIPT ISSUANCE') {
      return res.status(400).json({
        error: 'INVALID_CONFIRMATION_TEXT',
        message: 'Confirmation text is invalid. Please type "CONFIRM RECEIPT ISSUANCE".'
      });
    }

    if (!context.isAllocated) {
      return res.status(400).json({
        error: 'PAYMENT_EVIDENCE_NOT_ALLOCATED',
        message: 'Payment evidence must be allocated before receipt issuance.'
      });
    }
    if (!context.transaction) {
      return res.status(400).json({
        error: 'MISSING_TRANSACTION',
        message: 'An existing reconciled transaction is required before receipt issuance.'
      });
    }
    if (!context.allocation) {
      return res.status(400).json({
        error: 'MISSING_PAYMENT_ALLOCATION',
        message: 'An existing payment allocation is required before receipt issuance.'
      });
    }
    if (!context.invoice) {
      return res.status(400).json({
        error: 'MISSING_INVOICE',
        message: 'An existing invoice is required before receipt issuance.'
      });
    }
    if (!context.tenant) {
      return res.status(400).json({
        error: 'MISSING_TENANT',
        message: 'An existing tenant is required before receipt issuance.'
      });
    }
    if (context.duplicateCheckState === 'receipt_schema_not_enabled') {
      return res.status(400).json({
        error: 'RECEIPT_SCHEMA_NOT_ENABLED',
        message: 'Receipt storage schema is not enabled yet.'
      });
    }
    if (context.duplicateCheckState === 'existing_receipt_found') {
      return res.status(409).json({
        error: 'RECEIPT_ALREADY_ISSUED',
        message: 'A receipt already exists for this payment evidence, transaction, or allocation.'
      });
    }

    const issued = await insertIssuedReceipt(activeDb, context, orgId, userId);
    if (issued.duplicate) {
      return res.status(409).json({
        error: 'RECEIPT_ALREADY_ISSUED',
        message: 'A receipt already exists for this payment evidence, transaction, or allocation.'
      });
    }

    const receipt = mapReceiptResponse(issued.receipt, context.tenant, context.invoice, context.transaction, context.allocation);
    res.json({
      success: true,
      message: 'Receipt issued successfully.',
      payment_evidence_id: context.row.id,
      receipt,
      safety_message: 'Receipt issued exactly once. No ledger, invoice, tenant, transaction, allocation, or payment evidence financial record was changed.'
    });
  }));

  // GET /api/payment-evidence/:id/receipt-result
  router.get('/payment-evidence/:id/receipt-result', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    // Org-scoped row lookup
    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    // Find issued receipt for this evidence row
    let issuedReceipt = null;
    if (activeDb.pool && typeof activeDb.pool.connect === 'function') {
      const result = await activeDb.pool.connect().then(async (client) => {
        try {
          return await client.query(
            `SELECT * FROM receipts WHERE organization_id = $1 AND payment_evidence_id = $2 ORDER BY issued_at DESC LIMIT 1`,
            [orgId, rowId]
          );
        } finally {
          client.release();
        }
      });
      issuedReceipt = result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } else {
      const receipts = typeof activeDb.get === 'function' ? await activeDb.get('receipts') : [];
      const matches = receipts.filter(r =>
        Number(r.organization_id) === Number(orgId) &&
        Number(r.payment_evidence_id) === Number(rowId)
      );
      issuedReceipt = matches.length > 0 ? matches[matches.length - 1] : null;
    }

    if (!issuedReceipt) {
      return res.json({
        success: true,
        payment_evidence_id: rowId,
        receipt_issued: false,
        receipt: null,
        post_issuance_readiness: null,
        safety_message: 'Receipt result is read-only. No financial or receipt records were changed by this lookup.'
      });
    }

    // Parse the stored receipt payload snapshot
    const payload = typeof issuedReceipt.receipt_payload === 'string'
      ? JSON.parse(issuedReceipt.receipt_payload)
      : (issuedReceipt.receipt_payload || {});

    const receiptResult = {
      id: issuedReceipt.id,
      receipt_number: issuedReceipt.receipt_number,
      status: issuedReceipt.status,
      issued_at: issuedReceipt.issued_at,
      amount: Number(issuedReceipt.amount),
      currency: issuedReceipt.currency || 'KES',
      payment_method: issuedReceipt.payment_method || null,
      tenant_id: issuedReceipt.tenant_id,
      tenant_name: payload.tenant_name || null,
      invoice_id: issuedReceipt.invoice_id,
      invoice_number: payload.invoice_number || null,
      transaction_id: issuedReceipt.transaction_id,
      payment_allocation_id: issuedReceipt.payment_allocation_id,
      payment_evidence_id: issuedReceipt.payment_evidence_id,
      payment_date: payload.payment_date || null,
      invoice_status_at_issue: payload.invoice_status_at_issue || null,
      invoice_balance_after_allocation: payload.invoice_balance_after_allocation !== undefined ? Number(payload.invoice_balance_after_allocation) : null,
      receipt_lines: Array.isArray(payload.receipt_lines) ? payload.receipt_lines : []
    };

    // Post-issuance readiness block: all output actions are explicitly disabled
    const postIssuanceReadiness = {
      state: 'receipt_issued',
      download_pdf: { enabled: false, reason: 'PDF download is not supported in this release.' },
      print_receipt: { enabled: false, reason: 'Receipt printing is not supported in this release.' },
      send_receipt: { enabled: false, reason: 'Receipt sending is not supported in this release.' },
      void_receipt: { enabled: false, reason: 'Receipt voiding is not supported in this release.' },
      post_ledger: { enabled: false, reason: 'Ledger posting is not supported in this release.' },
      safety_message: 'Receipt has been issued. No further mutations are allowed via this endpoint. Download, print, send, void, and ledger posting are disabled.'
    };

    res.json({
      success: true,
      payment_evidence_id: rowId,
      receipt_issued: true,
      receipt: receiptResult,
      post_issuance_readiness: postIssuanceReadiness,
      safety_message: 'Receipt result is read-only. No financial or receipt records were changed by this lookup.'
    });
  }));

  // GET /api/payment-evidence/:id/receipt-print-view
  router.get('/payment-evidence/:id/receipt-print-view', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    // Org-scoped row lookup
    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    // Lookup organization for display name
    const organization = await activeDb.findOne('organizations', { id: Number(orgId) });

    // Find issued receipt for this evidence row
    let issuedReceipt = null;
    if (activeDb.pool && typeof activeDb.pool.connect === 'function') {
      const result = await activeDb.pool.connect().then(async (client) => {
        try {
          return await client.query(
            `SELECT * FROM receipts WHERE organization_id = $1 AND payment_evidence_id = $2 ORDER BY issued_at DESC LIMIT 1`,
            [orgId, rowId]
          );
        } finally {
          client.release();
        }
      });
      issuedReceipt = result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } else {
      const receipts = typeof activeDb.get === 'function' ? await activeDb.get('receipts') : [];
      const matches = receipts.filter(r =>
        Number(r.organization_id) === Number(orgId) &&
        Number(r.payment_evidence_id) === Number(rowId)
      );
      issuedReceipt = matches.length > 0 ? matches[matches.length - 1] : null;
    }

    // Print readiness block — all output actions disabled in this release
    const printReadiness = {
      browser_print_enabled: false,
      pdf_download_enabled: false,
      send_enabled: false,
      ledger_posting_enabled: false,
      void_enabled: false,
      blocking_reasons: [
        'Browser print, PDF download, sending, ledger posting, and void workflows are not enabled in this release.'
      ],
      safety_message: 'Receipt print view is read-only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
    };

    if (!issuedReceipt) {
      return res.json({
        success: true,
        payment_evidence_id: rowId,
        print_view: {
          available: false,
          state: 'receipt_not_issued',
          message: 'No issued receipt found for this payment evidence record. Issue a receipt first.'
        },
        print_readiness: printReadiness,
        safety_message: 'Receipt print view lookup is read-only. No records were changed by this lookup.'
      });
    }

    // Parse the stored receipt payload snapshot
    const payload = typeof issuedReceipt.receipt_payload === 'string'
      ? JSON.parse(issuedReceipt.receipt_payload)
      : (issuedReceipt.receipt_payload || {});

    const printView = {
      available: true,
      state: 'ready_for_print_view',
      receipt_id: issuedReceipt.id,
      receipt_number: issuedReceipt.receipt_number,
      status: issuedReceipt.status,
      issued_at: issuedReceipt.issued_at,
      organization_name: organization ? organization.name : null,
      organization_account_number: organization ? organization.account_number : null,
      tenant_name: payload.tenant_name || null,
      invoice_number: payload.invoice_number || null,
      payment_date: payload.payment_date || null,
      payment_method: issuedReceipt.payment_method || payload.payment_method || null,
      amount: Number(issuedReceipt.amount),
      currency: issuedReceipt.currency || 'KES',
      invoice_status_at_issue: payload.invoice_status_at_issue || null,
      invoice_balance_after_allocation: payload.invoice_balance_after_allocation !== undefined
        ? Number(payload.invoice_balance_after_allocation)
        : null,
      receipt_lines: Array.isArray(payload.receipt_lines) ? payload.receipt_lines : [],
      footer_note: 'This is a system-generated receipt view.',
      watermark: 'ISSUED'
    };

    res.json({
      success: true,
      payment_evidence_id: rowId,
      print_view: printView,
      print_readiness: printReadiness,
      safety_message: 'Receipt print view lookup is read-only. No records were changed by this lookup.'
    });
  }));

  return router;
}
