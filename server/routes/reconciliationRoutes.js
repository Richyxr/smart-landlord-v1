import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { NotificationService } from '../notificationService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024
  }
});

const uploadedCsvFiles = new Map();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(error => {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      next(error);
    });
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

function requireLandlord(req, res, next) {
  const { role } = getContext(req);
  if (role !== 'landlord') {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'You do not have permission to access this financial feature.'
    });
  }
  next();
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    const error = new Error('Empty or invalid CSV file.');
    error.statusCode = 400;
    throw error;
  }

  const headers = splitCsvLine(lines[0]).map(header => header.trim());
  const rows = lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line).map(value => value.replace(/^"|"$/g, '').trim());
    const data = {};
    headers.forEach((header, headerIndex) => {
      data[header] = values[headerIndex] || '';
    });
    return {
      id: index + 1,
      line,
      data
    };
  });

  return { headers, rows };
}

function splitCsvLine(line) {
  return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
}

function calculateInvoiceStatus(balance) {
  return Number(balance) <= 0 ? 'paid' : 'partially_paid';
}

async function withTransaction(pgDb, callback) {
  const client = await pgDb.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function logAudit(client, orgId, actorUserId, actorRole, actionType, targetType, targetId, oldValues = null, newValues = null, reason = '', pinValidated = null) {
  await client.query(
    `
      INSERT INTO audit_logs (
        organization_id,
        actor_user_id,
        actor_role,
        action_type,
        target_type,
        target_id,
        old_values,
        new_values,
        reason,
        pin_validation_status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb)
    `,
    [
      orgId,
      actorUserId,
      actorRole,
      actionType,
      targetType,
      targetId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      reason,
      pinValidated,
      JSON.stringify({ ip: '127.0.0.1', device: 'Mobile Admin Web' })
    ]
  );
}

async function verifyPin(client, orgId, pin) {
  const result = await client.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  const org = result.rows[0];
  if (!org || !org.security_pin_hash || !bcrypt.compareSync(pin || '', org.security_pin_hash)) {
    return false;
  }
  return true;
}

async function allocatePayment(client, orgId, userId, transactionId, tenantId, amount, preferredInvoiceId = null) {
  let remainingAmount = Number(amount);

  if (preferredInvoiceId) {
    const preferredResult = await client.query(
      `
        SELECT *
        FROM invoices
        WHERE id = $1
          AND organization_id = $2
          AND tenant_id = $3
          AND status IN ('issued', 'partially_paid', 'overdue')
        FOR UPDATE
      `,
      [parseInt(preferredInvoiceId), orgId, tenantId]
    );

    if (preferredResult.rows[0] && remainingAmount > 0) {
      remainingAmount = await allocateToInvoice(client, orgId, userId, transactionId, preferredResult.rows[0], remainingAmount);
    }
  }

  if (remainingAmount > 0) {
    const invoicesResult = await client.query(
      `
        SELECT *
        FROM invoices
        WHERE organization_id = $1
          AND tenant_id = $2
          AND status IN ('issued', 'partially_paid', 'overdue')
        ORDER BY due_date ASC, id ASC
        FOR UPDATE
      `,
      [orgId, tenantId]
    );

    for (const invoice of invoicesResult.rows) {
      if (remainingAmount <= 0) break;
      if (preferredInvoiceId && invoice.id === parseInt(preferredInvoiceId)) continue;
      remainingAmount = await allocateToInvoice(client, orgId, userId, transactionId, invoice, remainingAmount);
    }
  }

  return remainingAmount;
}

async function allocateToInvoice(client, orgId, userId, transactionId, invoice, remainingAmount) {
  const toAllocate = Math.min(Number(invoice.balance), remainingAmount);
  if (toAllocate <= 0) return remainingAmount;

  const newPaid = Number(invoice.amount_paid) + toAllocate;
  const newBalance = Number(invoice.balance) - toAllocate;

  await client.query(
    `
      UPDATE invoices
      SET amount_paid = $1,
          balance = $2,
          status = $3,
          updated_at = now()
      WHERE id = $4
        AND organization_id = $5
    `,
    [newPaid, newBalance, calculateInvoiceStatus(newBalance), invoice.id, orgId]
  );

  await client.query(
    `
      INSERT INTO payment_allocations (
        organization_id,
        transaction_id,
        invoice_id,
        amount_allocated,
        allocated_by,
        allocated_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
    `,
    [orgId, transactionId, invoice.id, toAllocate, userId]
  );

  return remainingAmount - toAllocate;
}

function findMatch({ rowData, tenants, invoices, unitsById, mappings }) {
  const dateVal = rowData[mappings.date];
  const amountVal = parseFloat(rowData[mappings.amount]) || 0;
  const refVal = rowData[mappings.reference] || '';
  const accVal = rowData[mappings.account_number] || '';
  const descVal = rowData[mappings.description] || '';
  const payerVal = rowData[mappings.payer_name] || '';

  let matchedTenant = null;
  let matchedInvoice = null;
  let confidence = 0;

  if (accVal) {
    matchedTenant = tenants.find(tenant => tenant.tenant_account_number.toLowerCase() === accVal.toLowerCase());
    if (matchedTenant) confidence = 95;
  }

  if (!matchedTenant) {
    const invNumMatch = descVal.match(/INV-[A-Z0-9-]+/i);
    if (invNumMatch) {
      const invNum = invNumMatch[0].toUpperCase();
      matchedInvoice = invoices.find(invoice => invoice.invoice_number.toUpperCase() === invNum);
      if (matchedInvoice) {
        matchedTenant = tenants.find(tenant => tenant.id === matchedInvoice.tenant_id);
        confidence = 95;
      }
    }
  }

  if (!matchedTenant && descVal) {
    for (const tenant of tenants) {
      const unit = unitsById.get(tenant.unit_id);
      if (unit && descVal.toLowerCase().includes(unit.unit_code.toLowerCase())) {
        matchedTenant = tenant;
        confidence = 80;
        break;
      }
    }
  }

  if (!matchedTenant && payerVal) {
    matchedTenant = tenants.find(tenant => tenant.full_name.toLowerCase().includes(payerVal.toLowerCase()) || payerVal.toLowerCase().includes(tenant.full_name.toLowerCase()));
    if (matchedTenant) confidence = 70;
  }

  if (matchedTenant && !matchedInvoice) {
    const tenantInvoices = invoices
      .filter(invoice => invoice.tenant_id === matchedTenant.id)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    if (tenantInvoices.length > 0) {
      matchedInvoice = tenantInvoices[0];
      confidence = Math.max(confidence, 90);
    } else {
      confidence = Math.max(confidence, 50);
    }
  }

  return {
    dateVal,
    amountVal,
    refVal,
    accVal,
    descVal,
    payerVal,
    matchedTenant,
    matchedInvoice,
    confidence
  };
}

export function createReconciliationRoutes(pgDb) {
  const router = express.Router();

  router.use(requireAuthenticatedContext);

  router.get('/reconciliation/staging', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rows = await pgDb.find('reconciliation_staging_rows', { organization_id: orgId });
    res.json(rows);
  }));

  router.get('/reconciliation/sample-csv', requireLandlord, (req, res) => {
    const csvContent = `Date,Amount,Reference,Account number,Description,Payer name
2026-06-15,45000,KCB-TR-88881,ACC-0010-A1,David Rent,David Kiprop
2026-06-15,30000,KCB-TR-88882,ACC-0010-A2,Rent payment,Alice Wambui
2026-06-16,15000,KCB-TR-88883,ACC-0020-G01,Bedsitter G01,John Mwangi
2026-06-16,10000,KCB-TR-88884,ACC-0010-A2,Partial Payment,Alice Wambui
2026-06-16,5000,KCB-TR-88885,,Cash Deposit,Samuel Nderitu`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sample_bank_statement.csv');
    res.send(csvContent);
  });

  router.post('/reconciliation/upload', requireLandlord, upload.single('file'), asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const content = req.file.buffer.toString('utf8');
    const { headers, rows } = parseCsv(content);
    const uploadId = crypto.randomUUID();

    uploadedCsvFiles.set(uploadId, {
      organization_id: orgId,
      uploaded_by: userId,
      fileName: req.file.originalname,
      content,
      created_at: Date.now()
    });

    res.json({
      headers,
      rows: rows.map(row => ({ id: row.id, data: row.data })),
      fileName: req.file.originalname,
      tempPath: uploadId
    });
  }));

  router.post('/reconciliation/import-finalize', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { tempPath, fileName, mappings } = req.body;

    if (!tempPath || !mappings) {
      return res.status(400).json({ error: 'Missing upload token or column mappings.' });
    }

    const uploaded = uploadedCsvFiles.get(tempPath);
    if (!uploaded || uploaded.organization_id !== orgId) {
      return res.status(400).json({ error: 'Upload token is invalid or expired.' });
    }

    const result = await withTransaction(pgDb, async client => {
      const { headers, rows } = parseCsv(uploaded.content);

      const batchResult = await client.query(
        `
          INSERT INTO reconciliation_batches (
            organization_id,
            uploaded_by,
            source_type,
            original_file_name,
            status,
            total_rows,
            matched_rows,
            unmatched_rows,
            duplicate_rows,
            invalid_rows
          )
          VALUES ($1, $2, 'bank_csv', $3, 'uploaded', $4, 0, 0, 0, 0)
          RETURNING *
        `,
        [orgId, userId, fileName || uploaded.fileName || 'statement.csv', rows.length]
      );

      const batch = batchResult.rows[0];
      const tenantsResult = await client.query('SELECT * FROM tenants WHERE organization_id = $1 AND deleted_at IS NULL', [orgId]);
      const invoicesResult = await client.query("SELECT * FROM invoices WHERE organization_id = $1 AND status NOT IN ('paid', 'void')", [orgId]);
      const unitsResult = await client.query('SELECT * FROM units WHERE organization_id = $1 AND deleted_at IS NULL', [orgId]);
      const tenants = tenantsResult.rows;
      const invoices = invoicesResult.rows;
      const unitsById = new Map(unitsResult.rows.map(unit => [unit.id, unit]));

      let autoMatchedCount = 0;
      let unmatchedCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;

      for (const row of rows) {
        const match = findMatch({ rowData: row.data, tenants, invoices, unitsById, mappings });
        const isInvalid = !match.dateVal || !match.refVal || match.amountVal <= 0;

        const duplicateLedger = await client.query(
          'SELECT id FROM transactions WHERE organization_id = $1 AND reference_number = $2 AND status <> $3 LIMIT 1',
          [orgId, match.refVal, 'failed']
        );
        const duplicateStaging = await client.query(
          'SELECT id FROM reconciliation_staging_rows WHERE organization_id = $1 AND reference_number = $2 AND status <> $3 LIMIT 1',
          [orgId, match.refVal, 'ignored']
        );

        let status = 'unmatched';
        let errorMessage = null;
        let referenceNumber = match.refVal;

        if (isInvalid) {
          status = 'invalid';
          errorMessage = 'Missing required date, amount, or reference.';
          invalidCount += 1;
        } else if (duplicateLedger.rows.length > 0 || duplicateStaging.rows.length > 0) {
          status = 'duplicate';
          errorMessage = 'Duplicate reference number.';
          duplicateCount += 1;
          if (duplicateStaging.rows.length > 0) {
            referenceNumber = null;
          }
        } else if (match.matchedTenant) {
          status = match.confidence >= 80 ? 'needs_review' : 'needs_review';
          autoMatchedCount += 1;
        } else {
          unmatchedCount += 1;
        }

        await client.query(
          `
            INSERT INTO reconciliation_staging_rows (
              organization_id,
              batch_id,
              raw_row_data,
              transaction_date,
              amount,
              reference_number,
              account_number,
              description,
              payer_name,
              status,
              suggested_tenant_id,
              suggested_unit_id,
              suggested_invoice_id,
              confidence_score,
              error_message
            )
            VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `,
          [
            orgId,
            batch.id,
            JSON.stringify(row.data),
            match.dateVal || null,
            match.amountVal,
            referenceNumber,
            match.accVal,
            match.descVal,
            match.payerVal,
            status,
            match.matchedTenant ? match.matchedTenant.id : null,
            match.matchedTenant ? match.matchedTenant.unit_id : null,
            match.matchedInvoice ? match.matchedInvoice.id : null,
            match.confidence,
            errorMessage
          ]
        );
      }

      await client.query(
        `
          UPDATE reconciliation_batches
          SET status = 'reviewed',
              matched_rows = $1,
              unmatched_rows = $2,
              duplicate_rows = $3,
              invalid_rows = $4
          WHERE id = $5
            AND organization_id = $6
        `,
        [autoMatchedCount, unmatchedCount, duplicateCount, invalidCount, batch.id, orgId]
      );

      await logAudit(client, orgId, userId, role, 'csv_uploaded', 'reconciliation_batch', batch.id, null, null, `Imported CSV statement: ${fileName || uploaded.fileName}`);

      return { success: true, batchId: batch.id, headers };
    });

    uploadedCsvFiles.delete(tempPath);
    res.json(result);
  }));

  router.post('/reconciliation/match', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { row_id, tenant_id, invoice_id, pin } = req.body;

    const result = await withTransaction(pgDb, async client => {
      const pinValid = await verifyPin(client, orgId, pin);
      if (!pinValid) {
        await logAudit(client, orgId, userId, role, 'pin_verification_failed', 'reconciliation_staging_rows', parseInt(row_id), null, null, 'Failed reconciliation PIN verification', 'failed');
        const error = new Error('Wrong security PIN.');
        error.statusCode = 400;
        throw error;
      }

      const rowResult = await client.query(
        `
          SELECT *
          FROM reconciliation_staging_rows
          WHERE id = $1
            AND organization_id = $2
          FOR UPDATE
        `,
        [parseInt(row_id), orgId]
      );
      const row = rowResult.rows[0];
      if (!row) {
        const error = new Error('Staging row not found.');
        error.statusCode = 404;
        throw error;
      }
      if (row.status === 'reconciled') {
        const error = new Error('Staging row has already been reconciled.');
        error.statusCode = 400;
        throw error;
      }
      if (['duplicate', 'invalid'].includes(row.status)) {
        const error = new Error(`Cannot reconcile a ${row.status} staging row.`);
        error.statusCode = 400;
        throw error;
      }

      const duplicateResult = await client.query(
        'SELECT id FROM transactions WHERE organization_id = $1 AND reference_number = $2 AND status <> $3 LIMIT 1',
        [orgId, row.reference_number, 'failed']
      );
      if (duplicateResult.rows.length > 0) {
        const error = new Error('This transaction reference already exists and cannot be posted again.');
        error.statusCode = 400;
        throw error;
      }

      const tenantResult = await client.query(
        'SELECT * FROM tenants WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
        [parseInt(tenant_id), orgId]
      );
      const tenant = tenantResult.rows[0];
      if (!tenant) {
        const error = new Error('Tenant not found.');
        error.statusCode = 404;
        throw error;
      }

      const txResult = await client.query(
        `
          INSERT INTO transactions (
            organization_id,
            tenant_id,
            property_id,
            unit_id,
            amount,
            currency,
            transaction_type,
            payment_method,
            source,
            reference_number,
            account_number,
            payer_name,
            payer_phone,
            transaction_date,
            status,
            raw_payload,
            created_by,
            reconciled_by,
            reconciled_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'payment', 'bank', 'bank_csv', $7, $8, $9, $10, $11, 'reconciled', $12::jsonb, $13, $13, now())
          RETURNING *
        `,
        [
          orgId,
          tenant.id,
          tenant.property_id,
          tenant.unit_id,
          Number(row.amount),
          tenant.currency || 'KES',
          row.reference_number,
          row.account_number || tenant.tenant_account_number,
          row.payer_name || tenant.full_name,
          tenant.phone_number,
          row.transaction_date,
          JSON.stringify(row.raw_row_data || {}),
          userId
        ]
      );

      const transaction = txResult.rows[0];
      await allocatePayment(client, orgId, userId, transaction.id, tenant.id, Number(row.amount), invoice_id);

      await client.query(
        `
          UPDATE reconciliation_staging_rows
          SET status = 'reconciled',
              matched_transaction_id = $1,
              reviewed_by = $2,
              reviewed_at = now(),
              updated_at = now()
          WHERE id = $3
            AND organization_id = $4
        `,
        [transaction.id, userId, row.id, orgId]
      );

      const notificationService = new NotificationService(pgDb);
      await notificationService.queue({
        organizationId: orgId,
        tenantId: tenant.id,
        channel: 'sms',
        type: 'payment_confirmed',
        data: {
          amount: row.amount,
          account_number: tenant.tenant_account_number,
          reference: row.reference_number
        }
      }, client);

      await logAudit(client, orgId, userId, role, 'csv_row_matched', 'reconciliation_staging_rows', row.id, row, transaction, `Manually matched transaction ref ${row.reference_number} to tenant ${tenant.full_name}`, 'success');

      return { success: true, transactionId: transaction.id };
    });

    res.json(result);
  }));

  router.post('/reconciliation/ignore', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { row_id } = req.body;

    const result = await withTransaction(pgDb, async client => {
      const rowResult = await client.query(
        `
          SELECT *
          FROM reconciliation_staging_rows
          WHERE id = $1
            AND organization_id = $2
          FOR UPDATE
        `,
        [parseInt(row_id), orgId]
      );
      const row = rowResult.rows[0];
      if (!row) {
        const error = new Error('Staging row not found.');
        error.statusCode = 404;
        throw error;
      }

      const nextStatus = row.status === 'ignored' ? 'unmatched' : 'ignored';
      await client.query(
        `
          UPDATE reconciliation_staging_rows
          SET status = $1,
              reviewed_by = $2,
              reviewed_at = now(),
              updated_at = now()
          WHERE id = $3
            AND organization_id = $4
        `,
        [nextStatus, userId, row.id, orgId]
      );

      await logAudit(client, orgId, userId, role, nextStatus === 'ignored' ? 'csv_row_ignored' : 'csv_row_restored', 'reconciliation_staging_rows', row.id, row, { status: nextStatus }, `Set statement row ${row.id} to ${nextStatus}`);
      return { success: true };
    });

    res.json(result);
  }));

  return router;
}

