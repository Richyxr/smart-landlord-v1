import express from 'express';
import crypto from 'crypto';
import { db as localDb } from '../db.js';
import { normalizePaymentEvidence } from '../services/payment-evidence/normalizePaymentEvidence.js';

function asyncHandler(handler) {
  return (req, res, next) => {
    return Promise.resolve(handler(req, res, next)).catch(next);
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

    // Preload active tenants and invoices for metadata injection
    const allTenants = await activeDb.find('tenants', { organization_id: orgId });
    const allInvoices = await activeDb.find('invoices', { organization_id: orgId });

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));

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

    // Map rows to include preloaded tenant/invoice metadata
    const enrichedRows = rows.map(r => {
      const tenant = r.suggested_tenant_id ? tenantMap.get(r.suggested_tenant_id) : null;
      const invoice = r.suggested_invoice_id ? invoiceMap.get(r.suggested_invoice_id) : null;
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
        } : null
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

  return router;
}
