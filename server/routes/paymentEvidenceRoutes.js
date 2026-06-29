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
      batch_id
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

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));
    const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
    const unitsMap = new Map(allUnits.map(u => [u.id, u]));
    const userMap = new Map(allUsers.map(u => [u.id, u.name]));

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

    // Filter by date range (transaction_date format: YYYY-MM-DD)
    if (start_date) {
      rows = rows.filter(r => r.transaction_date >= start_date);
    }
    if (end_date) {
      rows = rows.filter(r => r.transaction_date <= end_date);
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
        suggestions
      };
    });

    res.json(enrichedRows);
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
    const { orgId, userId } = getContext(req);
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

    const [updatedRow] = await activeDb.update('payment_evidence', rowId, updates);

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

  return router;
}
