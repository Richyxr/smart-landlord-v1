import express from 'express';
import bcrypt from 'bcryptjs';
import { NotificationService } from '../notificationService.js';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { readDb, writeDb } from '../db.js';
import { StatementParserRegistry } from '../services/payment-evidence/StatementParserRegistry.js';

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

function toNumber(value) {
  return Number(value || 0);
}

function calculateInvoiceStatus(balance) {
  return Number(balance) <= 0 ? 'paid' : 'partially_paid';
}

const VALID_PAYMENT_METHODS = new Set(['mpesa', 'bank', 'cash', 'other']);

function cleanOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizePaymentMethod(value) {
  const method = cleanOptionalText(value).toLowerCase() || 'other';
  return VALID_PAYMENT_METHODS.has(method) ? method : null;
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
  const result = await client.query(
    'SELECT * FROM organizations WHERE id = $1',
    [orgId]
  );

  const org = result.rows[0];
  if (!org || !org.security_pin_hash || !bcrypt.compareSync(pin || '', org.security_pin_hash)) {
    return { valid: false, org };
  }

  return { valid: true, org };
}

async function getDetailedInvoices(pgDb, orgId) {
  const result = await pgDb.query(
    `
      SELECT
        i.*,
        t.full_name AS tenant_name,
        p.name AS property_name,
        u.unit_code
      FROM invoices i
      LEFT JOIN tenants t
        ON t.id = i.tenant_id
       AND t.organization_id = i.organization_id
      LEFT JOIN properties p
        ON p.id = i.property_id
       AND p.organization_id = i.organization_id
      LEFT JOIN units u
        ON u.id = i.unit_id
       AND u.organization_id = i.organization_id
      WHERE i.organization_id = $1
      ORDER BY i.created_at DESC, i.id DESC
    `,
    [orgId]
  );

  return result.rows.map(row => ({
    ...row,
    subtotal: toNumber(row.subtotal),
    total: toNumber(row.total),
    amount_paid: toNumber(row.amount_paid),
    balance: toNumber(row.balance)
  }));
}

async function buildReceiptPayload(client, orgId, transactionId) {
  const txResult = await client.query(
    `
      SELECT
        tx.*,
        o.name AS organization_name,
        t.full_name AS tenant_name,
        t.tenant_account_number,
        p.name AS property_name,
        u.unit_code
      FROM transactions tx
      JOIN organizations o
        ON o.id = tx.organization_id
      LEFT JOIN tenants t
        ON t.id = tx.tenant_id
       AND t.organization_id = tx.organization_id
      LEFT JOIN properties p
        ON p.id = tx.property_id
       AND p.organization_id = tx.organization_id
      LEFT JOIN units u
        ON u.id = tx.unit_id
       AND u.organization_id = tx.organization_id
      WHERE tx.id = $1
        AND tx.organization_id = $2
    `,
    [transactionId, orgId]
  );

  const tx = txResult.rows[0];
  if (!tx) return null;

  const allocationsResult = await client.query(
    `
      SELECT
        pa.id,
        pa.amount_allocated,
        i.id AS invoice_id,
        i.invoice_number,
        i.invoice_type,
        i.status,
        i.total,
        i.amount_paid,
        i.balance,
        i.due_date
      FROM payment_allocations pa
      JOIN invoices i
        ON i.id = pa.invoice_id
       AND i.organization_id = pa.organization_id
      WHERE pa.transaction_id = $1
        AND pa.organization_id = $2
      ORDER BY pa.id ASC
    `,
    [transactionId, orgId]
  );

  const balanceResult = await client.query(
    `
      SELECT COALESCE(SUM(balance), 0)::numeric AS balance_after_payment
      FROM invoices
      WHERE organization_id = $1
        AND tenant_id = $2
        AND status NOT IN ('paid', 'void')
    `,
    [orgId, tx.tenant_id]
  );

  const receiptNumber = tx.reference_number || `TX-${String(tx.id).padStart(6, '0')}`;

  return {
    receipt_number: receiptNumber,
    transaction_id: tx.id,
    transaction_reference: tx.reference_number || null,
    tenant_name: tx.tenant_name || tx.payer_name,
    tenant_account_number: tx.tenant_account_number || tx.account_number || null,
    property_name: tx.property_name || null,
    unit_code: tx.unit_code || null,
    amount: toNumber(tx.amount),
    currency: tx.currency,
    payment_method: tx.payment_method,
    payment_date: tx.transaction_date,
    allocation_summary: allocationsResult.rows.map(allocation => ({
      invoice_id: allocation.invoice_id,
      invoice_number: allocation.invoice_number,
      invoice_type: allocation.invoice_type,
      amount_allocated: toNumber(allocation.amount_allocated),
      invoice_total: toNumber(allocation.total),
      invoice_amount_paid: toNumber(allocation.amount_paid),
      invoice_balance: toNumber(allocation.balance),
      invoice_status: allocation.status,
      due_date: allocation.due_date
    })),
    balance_after_payment: toNumber(balanceResult.rows[0]?.balance_after_payment),
    organization_name: tx.organization_name,
    created_at: tx.created_at
  };
}

export function createFinancialRoutes(pgDb) {
  const router = express.Router();

  router.use(['/invoices', '/payments'], (req, res, next) => {
    if (!pgDb) {
      return res.status(404).json({ error: 'Invoicing and payment features are only supported in PostgreSQL database mode.' });
    }
    next();
  });

  router.use(['/invoices', '/payments'], requireAuthenticatedContext);

  router.get('/invoices', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    res.json(await getDetailedInvoices(pgDb, orgId));
  }));

  router.post('/invoices', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { tenant_id, invoice_type, issue_date, due_date, items = [], notes } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invoice must include at least one item.' });
    }

    const invoice = await withTransaction(pgDb, async client => {
      const tenantResult = await client.query(
        'SELECT * FROM tenants WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
        [parseInt(tenant_id), orgId]
      );
      const tenant = tenantResult.rows[0];
      if (!tenant) {
        const error = new Error('Tenant not found.');
        error.statusCode = 400;
        throw error;
      }

      const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity || 1) * parseFloat(item.unit_price || 0)), 0);
      const total = subtotal;
      const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const invoiceResult = await client.query(
        `
          INSERT INTO invoices (
            organization_id,
            property_id,
            unit_id,
            tenant_id,
            invoice_number,
            invoice_type,
            status,
            issue_date,
            due_date,
            currency,
            subtotal,
            total,
            amount_paid,
            balance,
            notes,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, 0, $12, $13, $14)
          RETURNING *
        `,
        [
          orgId,
          tenant.property_id,
          tenant.unit_id,
          tenant.id,
          invoiceNumber,
          invoice_type || 'rent',
          issue_date,
          due_date,
          tenant.currency || 'KES',
          subtotal,
          total,
          total,
          notes || '',
          userId
        ]
      );

      const createdInvoice = invoiceResult.rows[0];
      for (const item of items) {
        const quantity = parseFloat(item.quantity || 1);
        const unitPrice = parseFloat(item.unit_price || 0);
        await client.query(
          `
            INSERT INTO invoice_items (
              organization_id,
              invoice_id,
              description,
              item_type,
              quantity,
              unit_price,
              total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            orgId,
            createdInvoice.id,
            item.description,
            item.item_type || 'other',
            quantity,
            unitPrice,
            quantity * unitPrice
          ]
        );
      }

      await logAudit(client, orgId, userId, role, 'invoice_created', 'invoice', createdInvoice.id, null, createdInvoice);
      return createdInvoice;
    });

    res.status(201).json(invoice);
  }));

  router.put('/invoices/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const invoiceId = parseInt(req.params.id);
    const { items = [], notes, due_date, issue_date, invoice_type } = req.body;

    const updatedInvoice = await withTransaction(pgDb, async client => {
      const invoiceResult = await client.query(
        'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [invoiceId, orgId]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        const error = new Error('Invoice not found');
        error.statusCode = 404;
        throw error;
      }
      if (invoice.status !== 'draft') {
        const error = new Error('Only draft invoices can be edited.');
        error.statusCode = 400;
        throw error;
      }

      const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity || 1) * parseFloat(item.unit_price || 0)), 0);

      await client.query(
        'DELETE FROM invoice_items WHERE invoice_id = $1 AND organization_id = $2',
        [invoiceId, orgId]
      );

      for (const item of items) {
        const quantity = parseFloat(item.quantity || 1);
        const unitPrice = parseFloat(item.unit_price || 0);
        await client.query(
          `
            INSERT INTO invoice_items (
              organization_id,
              invoice_id,
              description,
              item_type,
              quantity,
              unit_price,
              total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [orgId, invoiceId, item.description, item.item_type || 'other', quantity, unitPrice, quantity * unitPrice]
        );
      }

      const updateResult = await client.query(
        `
          UPDATE invoices
          SET subtotal = $1,
              total = $2,
              balance = $3,
              notes = $4,
              due_date = $5,
              issue_date = $6,
              invoice_type = $7,
              updated_at = now()
          WHERE id = $8
            AND organization_id = $9
          RETURNING *
        `,
        [
          subtotal,
          subtotal,
          subtotal,
          notes || '',
          due_date || invoice.due_date,
          issue_date || invoice.issue_date,
          invoice_type || invoice.invoice_type,
          invoiceId,
          orgId
        ]
      );

      const updated = updateResult.rows[0];
      await logAudit(client, orgId, userId, role, 'invoice_updated', 'invoice', invoiceId, invoice, updated);
      return updated;
    });

    res.json(updatedInvoice);
  }));

  router.get('/invoices/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const invoiceId = parseInt(req.params.id);

    const invoiceResult = await pgDb.query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
      [invoiceId, orgId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const [items, tenant, property, unit] = await Promise.all([
      pgDb.find('invoice_items', { invoice_id: invoiceId, organization_id: orgId }),
      pgDb.findOne('tenants', { id: invoice.tenant_id, organization_id: orgId }),
      pgDb.findOne('properties', { id: invoice.property_id, organization_id: orgId }),
      pgDb.findOne('units', { id: invoice.unit_id, organization_id: orgId })
    ]);

    res.json({
      ...invoice,
      subtotal: toNumber(invoice.subtotal),
      total: toNumber(invoice.total),
      amount_paid: toNumber(invoice.amount_paid),
      balance: toNumber(invoice.balance),
      items,
      tenant,
      property,
      unit
    });
  }));

  router.post('/invoices/:id/issue', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const invoiceId = parseInt(req.params.id);

    const updated = await withTransaction(pgDb, async client => {
      const invoiceResult = await client.query(
        'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [invoiceId, orgId]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        const error = new Error('Invoice not found');
        error.statusCode = 404;
        throw error;
      }

      const updateResult = await client.query(
        `
          UPDATE invoices
          SET status = 'issued',
              issued_at = now(),
              updated_at = now()
          WHERE id = $1
            AND organization_id = $2
          RETURNING *
        `,
        [invoiceId, orgId]
      );

      const issuedInvoice = updateResult.rows[0];
      await logAudit(client, orgId, userId, role, 'invoice_issued', 'invoice', invoiceId, invoice, issuedInvoice);

      const tenantResult = await client.query(
        'SELECT * FROM tenants WHERE id = $1 AND organization_id = $2',
        [invoice.tenant_id, orgId]
      );
      const tenant = tenantResult.rows[0];
      if (tenant) {
        const notificationService = new NotificationService(pgDb);
        await notificationService.queue({
          organizationId: orgId,
          tenantId: tenant.id,
          channel: 'sms',
          type: 'invoice_issued',
          data: {
            invoice_number: invoice.invoice_number,
            amount: invoice.total,
            due_date: invoice.due_date,
            account_number: tenant.tenant_account_number
          }
        }, client);
      }

      return issuedInvoice;
    });

    res.json(updated);
  }));

  router.post('/invoices/:id/void', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const invoiceId = parseInt(req.params.id);
    const { pin } = req.body;

    const updated = await withTransaction(pgDb, async client => {
      const pinResult = await verifyPin(client, orgId, pin);
      if (!pinResult.valid) {
        await logAudit(client, orgId, userId, role, 'pin_verification_failed', 'invoice', invoiceId, null, null, 'Failed invoice void PIN verification', 'failed');
        const error = new Error('Wrong security PIN.');
        error.statusCode = 400;
        throw error;
      }

      const invoiceResult = await client.query(
        'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [invoiceId, orgId]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        const error = new Error('Invoice not found');
        error.statusCode = 404;
        throw error;
      }
      if (invoice.status === 'paid') {
        const error = new Error('Paid invoices cannot be voided.');
        error.statusCode = 400;
        throw error;
      }

      const updateResult = await client.query(
        `
          UPDATE invoices
          SET status = 'void',
              voided_at = now(),
              voided_by = $1,
              updated_at = now()
          WHERE id = $2
            AND organization_id = $3
          RETURNING *
        `,
        [userId, invoiceId, orgId]
      );

      const voided = updateResult.rows[0];
      await logAudit(client, orgId, userId, role, 'invoice_voided', 'invoice', invoiceId, invoice, voided, 'Voided issued invoice', 'success');
      return voided;
    });

    res.json(updated);
  }));

  router.post('/invoices/:id/send-reminder', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const invoiceId = parseInt(req.params.id);
    const { channel = 'sms' } = req.body;
    const validChannels = ['sms', 'email', 'whatsapp'];

    if (!validChannels.includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel. Choose sms, email, or whatsapp.' });
    }

    const result = await withTransaction(pgDb, async client => {
      const invoiceResult = await client.query(
        'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2',
        [invoiceId, orgId]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        const error = new Error('Invoice not found.');
        error.statusCode = 404;
        throw error;
      }
      if (['draft', 'void', 'paid'].includes(invoice.status)) {
        const error = new Error(`Cannot send reminder for a ${invoice.status} invoice.`);
        error.statusCode = 400;
        throw error;
      }

      const tenantResult = await client.query(
        'SELECT * FROM tenants WHERE id = $1 AND organization_id = $2',
        [invoice.tenant_id, orgId]
      );
      const tenant = tenantResult.rows[0];
      if (!tenant) {
        const error = new Error('Tenant not found.');
        error.statusCode = 404;
        throw error;
      }

      const daysOverdue = Math.max(0, Math.floor((Date.now() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24)));
      const notificationService = new NotificationService(pgDb);
      const logRow = await notificationService.queue({
        organizationId: orgId,
        tenantId: tenant.id,
        channel: channel,
        type: daysOverdue > 0 ? 'overdue_reminder' : 'rent_reminder',
        data: {
          invoice_number: invoice.invoice_number,
          amount: invoice.total,
          balance: invoice.balance,
          due_date: invoice.due_date,
          account_number: tenant.tenant_account_number
        }
      }, client);

      await client.query(
        `
          UPDATE invoices
          SET last_reminder_sent_at = now(),
              last_reminder_channel = $1,
              updated_at = now()
          WHERE id = $2
            AND organization_id = $3
        `,
        [channel, invoiceId, orgId]
      );

      await logAudit(client, orgId, userId, role, 'reminder_sent', 'invoice', invoiceId, null, { channel, message }, `Payment reminder sent via ${channel}`);

      return {
        log: logRow || { id: 0, sent_at: new Date().toISOString() },
        tenant,
        message: logRow ? logRow.message : 'Reminder alerts are disabled in settings.'
      };
    });

    res.json({
      success: true,
      channel,
      log_id: result.log.id,
      phone: result.tenant.phone_number,
      email: result.tenant.email || null,
      tenant_name: result.tenant.full_name,
      message: result.message,
      sent_at: result.log.sent_at
    });
  }));

  router.get('/payments', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const result = await pgDb.query(
      `
        SELECT
          tx.*,
          t.full_name AS tenant_name,
          p.name AS property_name,
          u.unit_code
        FROM transactions tx
        LEFT JOIN tenants t
          ON t.id = tx.tenant_id
         AND t.organization_id = tx.organization_id
        LEFT JOIN properties p
          ON p.id = tx.property_id
         AND p.organization_id = tx.organization_id
        LEFT JOIN units u
          ON u.id = tx.unit_id
         AND u.organization_id = tx.organization_id
        WHERE tx.organization_id = $1
        ORDER BY tx.transaction_date DESC, tx.id DESC
      `,
      [orgId]
    );

    res.json(result.rows.map(row => ({
      ...row,
      amount: toNumber(row.amount)
    })));
  }));

  router.post('/payments', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const {
      tenant_id,
      amount,
      payment_method,
      reference_number,
      transaction_date,
      note
    } = req.body;

    const tenantId = Number(tenant_id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: 'A valid tenant is required.' });
    }

    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    }

    const paymentMethod = normalizePaymentMethod(payment_method);
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method must be mpesa, bank, cash, or other.' });
    }

    const referenceNumber = cleanOptionalText(reference_number);
    const paymentNote = cleanOptionalText(note);
    if (!referenceNumber && !paymentNote) {
      return res.status(400).json({ error: 'Payment reference or note is required.' });
    }

    const paymentDate = transaction_date ? new Date(transaction_date) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      return res.status(400).json({ error: 'Payment date is invalid.' });
    }

    const result = await withTransaction(pgDb, async client => {
      if (referenceNumber) {
        const duplicateResult = await client.query(
          'SELECT id FROM transactions WHERE organization_id = $1 AND reference_number = $2 AND status <> $3',
          [orgId, referenceNumber, 'failed']
        );
        if (duplicateResult.rows.length > 0) {
          const error = new Error('This transaction reference already exists and cannot be posted again.');
          error.statusCode = 400;
          throw error;
        }
      }

      const tenantResult = await client.query(
        'SELECT * FROM tenants WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
        [tenantId, orgId]
      );
      const tenant = tenantResult.rows[0];
      if (!tenant) {
        const error = new Error('Tenant not found.');
        error.statusCode = 400;
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
          VALUES ($1, $2, $3, $4, $5, $6, 'payment', $7, 'manual', $8, $9, $10, $11, $12, 'reconciled', $13::jsonb, $14, $14, now())
          RETURNING *
        `,
        [
          orgId,
          tenant.id,
          tenant.property_id,
          tenant.unit_id,
          paymentAmount,
          tenant.currency || 'KES',
          paymentMethod,
          referenceNumber || null,
          tenant.tenant_account_number,
          tenant.full_name,
          tenant.phone_number,
          paymentDate.toISOString(),
          JSON.stringify({
            entry_type: 'MANUAL_ENTRY',
            note: paymentNote || null
          }),
          userId
        ]
      );

      const createdTransaction = txResult.rows[0];
      let remainingAmount = paymentAmount;

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
        [orgId, tenant.id]
      );

      for (const invoice of invoicesResult.rows) {
        if (remainingAmount <= 0) break;

        const toAllocate = Math.min(Number(invoice.balance), remainingAmount);
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
          [orgId, createdTransaction.id, invoice.id, toAllocate, userId]
        );

        remainingAmount -= toAllocate;
      }

      const notificationService = new NotificationService(pgDb);
      await notificationService.queue({
        organizationId: orgId,
        tenantId: tenant.id,
        channel: 'sms',
        type: 'payment_confirmed',
        data: {
          amount: paymentAmount,
          account_number: tenant.tenant_account_number,
          reference: referenceNumber || `TX-${createdTransaction.id}`
        }
      }, client);

      await logAudit(client, orgId, userId, role, 'payment_recorded', 'transaction', createdTransaction.id, null, createdTransaction);
      const receipt = await buildReceiptPayload(client, orgId, createdTransaction.id);

      return {
        transaction: {
          ...createdTransaction,
          amount: toNumber(createdTransaction.amount)
        },
        receipt
      };
    });

    res.status(201).json(result);
  }));

  router.post('/payments/:id/reverse', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const txId = parseInt(req.params.id);
    const { pin, reason } = req.body;

    const result = await withTransaction(pgDb, async client => {
      const pinResult = await verifyPin(client, orgId, pin);
      if (!pinResult.valid) {
        await logAudit(client, orgId, userId, role, 'pin_verification_failed', 'transaction', txId, null, null, 'Failed payment reversal PIN verification', 'failed');
        const error = new Error('Wrong security PIN.');
        error.statusCode = 400;
        throw error;
      }

      const txResult = await client.query(
        'SELECT * FROM transactions WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [txId, orgId]
      );
      const tx = txResult.rows[0];
      if (!tx) {
        const error = new Error('Transaction not found.');
        error.statusCode = 404;
        throw error;
      }
      if (tx.status === 'reversed') {
        const error = new Error('Transaction already reversed.');
        error.statusCode = 400;
        throw error;
      }

      const allocationsResult = await client.query(
        'SELECT * FROM payment_allocations WHERE transaction_id = $1 AND organization_id = $2',
        [txId, orgId]
      );

      for (const allocation of allocationsResult.rows) {
        const invoiceResult = await client.query(
          'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [allocation.invoice_id, orgId]
        );
        const invoice = invoiceResult.rows[0];
        if (!invoice) continue;

        const newPaid = Math.max(0, Number(invoice.amount_paid) - Number(allocation.amount_allocated));
        const newBalance = Number(invoice.balance) + Number(allocation.amount_allocated);
        const newStatus = newPaid === 0 ? 'issued' : 'partially_paid';

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
          [newPaid, newBalance, newStatus, invoice.id, orgId]
        );
      }

      await client.query(
        `
          UPDATE transactions
          SET status = 'reversed',
              updated_at = now()
          WHERE id = $1
            AND organization_id = $2
        `,
        [txId, orgId]
      );

      const reversalResult = await client.query(
        `
          INSERT INTO transactions (
            organization_id,
            tenant_id,
            property_id,
            unit_id,
            invoice_id,
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
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'reversal', $8, 'manual', $9, $10, $11, $12, now(), 'reconciled', $13::jsonb, $14)
          RETURNING *
        `,
        [
          orgId,
          tx.tenant_id,
          tx.property_id,
          tx.unit_id,
          tx.invoice_id,
          Number(tx.amount),
          tx.currency,
          tx.payment_method,
          `REV-${tx.reference_number || tx.id}`,
          tx.account_number,
          tx.payer_name,
          tx.payer_phone,
          JSON.stringify({ reversed_transaction_id: txId, reason }),
          userId
        ]
      );

      const reversal = reversalResult.rows[0];
      await logAudit(client, orgId, userId, role, 'payment_reversed', 'transaction', txId, tx, reversal, `Reversal reason: ${reason}`, 'success');

      return { success: true, reversal };
    });

    res.json(result);
  }));

  const statementUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
  });

  // DB abstraction helpers
  const dbFind = async (table, filterObj) => {
    if (pgDb) {
      return pgDb.find(table, filterObj);
    } else {
      const dbData = readDb();
      const list = dbData[table] || [];
      return list.filter(row => {
        for (const [key, val] of Object.entries(filterObj)) {
          if (row[key] !== val) return false;
        }
        return true;
      });
    }
  };

  const dbFindOne = async (table, filterObj) => {
    if (pgDb) {
      return pgDb.findOne(table, filterObj);
    } else {
      const list = await dbFind(table, filterObj);
      return list[0] || null;
    }
  };

  const dbInsert = async (table, rowData) => {
    if (pgDb) {
      return pgDb.insert(table, rowData);
    } else {
      const dbData = readDb();
      const list = dbData[table] || [];
      const newId = list.length > 0 ? Math.max(...list.map(r => r.id)) + 1 : 1;
      const newRow = { id: newId, ...rowData, created_at: new Date(), updated_at: new Date() };
      list.push(newRow);
      dbData[table] = list;
      writeDb(dbData);
      return newRow;
    }
  };

  const dbUpdate = async (table, id, updates) => {
    if (pgDb) {
      return pgDb.update(table, id, updates);
    } else {
      const dbData = readDb();
      const list = dbData[table] || [];
      const idx = list.findIndex(r => r.id === Number(id));
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...updates, updated_at: new Date() };
        writeDb(dbData);
        return [list[idx]];
      }
      return [];
    }
  };

  const dbDelete = async (table, id) => {
    if (pgDb) {
      return pgDb.delete(table, id);
    } else {
      const dbData = readDb();
      const list = dbData[table] || [];
      const beforeLen = list.length;
      dbData[table] = list.filter(r => r.id !== Number(id));
      writeDb(dbData);
      return dbData[table].length < beforeLen;
    }
  };

  const processUpload = async (uploadId, buffer, filename, orgId, file_type) => {
    try {
      const { rawRows, rawText } = await StatementParserRegistry.parse({ buffer, filename });
      const provider = StatementParserRegistry.detectProvider({ filename }, rawText);

      // Normalize
      const normalized = StatementParserRegistry.normalize(rawRows, file_type, provider);

      // Validate
      const activeDbWrapper = {
        find: (t, f) => dbFind(t, f)
      };
      const validated = await StatementParserRegistry.validate(normalized, orgId, activeDbWrapper);

      // Save extracted rows
      let rows_detected = validated.length;
      let rows_ready_for_review = 0;
      let rows_needing_attention = 0;
      let rows_ignored = 0;
      let rows_duplicates = 0;
      let rows_unreadable = 0;

      for (const row of validated) {
        if (row.validationFlags.includes('invalid_both_debit_credit') || 
            row.validationFlags.includes('incomplete_no_amount') ||
            row.validationFlags.includes('missing_date')) {
          rows_unreadable++;
        } else if (row.duplicate_candidate) {
          rows_duplicates++;
        } else if (row.validationFlags.length > 0) {
          rows_needing_attention++;
        } else {
          rows_ready_for_review++;
        }

        await dbInsert('statement_extracted_transactions', {
          statement_upload_id: uploadId,
          organization_id: orgId,
          row_index: row.row_index,
          transaction_date: row.transactionDate || new Date().toISOString().split('T')[0],
          value_date: row.valueDate || null,
          description: row.description,
          reference: row.reference || null,
          debit_amount: row.debitAmount,
          credit_amount: row.creditAmount,
          running_balance: row.runningBalance,
          normalized_amount: row.normalizedAmount,
          transaction_type: row.transactionType,
          currency: row.currency || 'KES',
          confidence_score: row.confidenceScore,
          raw_row_json: row.rawRow,
          duplicate_candidate: row.duplicate_candidate || false,
          validation_flags_json: row.validationFlags
        });
      }

      // Update upload status
      const parseSummary = {
        rows_detected,
        rows_ready_for_review,
        rows_needing_attention,
        rows_ignored,
        rows_duplicates,
        rows_unreadable
      };

      const finalStatus = (rows_detected === 0 || rows_unreadable === rows_detected) ? 'failed' : (rows_duplicates > 0 || rows_needing_attention > 0 ? 'needs_review' : 'parsed');

      const updateData = {
        status: finalStatus,
        provider_guess: provider,
        parse_summary_json: parseSummary
      };

      if (finalStatus === 'failed') {
        updateData.error_message = rows_detected === 0
          ? 'No transaction rows could be parsed from this file.'
          : 'All transaction rows failed parsing validation.';
      }

      await dbUpdate('statement_uploads', uploadId, updateData);

    } catch (err) {
      console.error('Async statement parsing failed:', err);
      await dbUpdate('statement_uploads', uploadId, {
        status: 'failed',
        error_message: err.message || 'An error occurred during statement parsing.'
      });
    }
  };

  // POST /api/billing/statement-uploads
  router.post(
    '/billing/statement-uploads',
    requireAuthenticatedContext,
    requireLandlord,
    statementUpload.single('file'),
    asyncHandler(async (req, res) => {
      const { orgId, userId } = getContext(req);

      if (!req.file) {
        return res.status(400).json({ error: 'No statement file was attached.' });
      }

      const filename = req.file.originalname;
      const ext = path.extname(filename).toLowerCase();
      if (ext !== '.pdf' && ext !== '.csv' && ext !== '.xlsx') {
        return res.status(400).json({ error: 'Unsupported file type. Only PDF, CSV, and XLSX are accepted.' });
      }

      // Compute SHA-256 hash
      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      // Check duplicate uploads for same organization
      const existingUpload = await dbFindOne('statement_uploads', {
        organization_id: orgId,
        sha256_hash: sha256
      });

      if (existingUpload && existingUpload.status !== 'failed') {
        return res.status(400).json({ error: 'This file has already been uploaded for this organization.' });
      }

      // Write to storage named as its hash
      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.mkdir(uploadsDir, { recursive: true });
      const storagePath = path.join(uploadsDir, sha256);
      await fs.writeFile(storagePath, req.file.buffer);

      const file_type = ext.slice(1).toUpperCase();

      // Insert record
      const uploadRecord = await dbInsert('statement_uploads', {
        organization_id: orgId,
        uploaded_by_user_id: userId,
        provider_guess: 'generic_bank_statement',
        file_name: filename,
        file_type,
        file_size: req.file.size,
        storage_path: storagePath,
        sha256_hash: sha256,
        status: 'parsing',
        parse_engine: 'node_parse_registry'
      });

      // Async or Sync parsing
      const isLarge = req.file.size > 1 * 1024 * 1024; // > 1 MB is considered large
      if (isLarge) {
        // Run in next tick asynchronously
        setImmediate(() => {
          processUpload(uploadRecord.id, req.file.buffer, filename, orgId, file_type);
        });
        return res.status(202).json({
          message: 'Statement uploaded and queued for parsing.',
          upload_id: uploadRecord.id,
          status: 'parsing'
        });
      } else {
        // Parse synchronously
        await processUpload(uploadRecord.id, req.file.buffer, filename, orgId, file_type);
        const updated = await dbFindOne('statement_uploads', { id: uploadRecord.id });
        let summary = updated.parse_summary_json;
        if (typeof summary === 'string') {
          try {
            summary = JSON.parse(summary);
          } catch (_) {}
        }
        return res.status(201).json({
          message: 'Statement uploaded and parsed successfully.',
          upload_id: updated.id,
          status: updated.status,
          provider_guess: updated.provider_guess,
          summary
        });
      }
    })
  );

  // GET /api/billing/statement-uploads
  router.get(
    '/billing/statement-uploads',
    requireAuthenticatedContext,
    requireLandlord,
    asyncHandler(async (req, res) => {
      const { orgId } = getContext(req);
      const uploads = await dbFind('statement_uploads', { organization_id: orgId });
      for (const u of uploads) {
        if (typeof u.parse_summary_json === 'string') {
          try {
            u.parse_summary_json = JSON.parse(u.parse_summary_json);
          } catch (_) {}
        }
      }
      uploads.sort((a, b) => b.id - a.id);
      res.json(uploads);
    })
  );

  // GET /api/billing/statement-uploads/:id
  router.get(
    '/billing/statement-uploads/:id',
    requireAuthenticatedContext,
    requireLandlord,
    asyncHandler(async (req, res) => {
      const { orgId } = getContext(req);
      const uploadId = Number(req.params.id);

      const upload = await dbFindOne('statement_uploads', { id: uploadId, organization_id: orgId });
      if (!upload) {
        return res.status(404).json({ error: 'Statement upload not found.' });
      }

      if (typeof upload.parse_summary_json === 'string') {
        try {
          upload.parse_summary_json = JSON.parse(upload.parse_summary_json);
        } catch (_) {}
      }

      const rows = await dbFind('statement_extracted_transactions', { statement_upload_id: uploadId, organization_id: orgId });
      for (const r of rows) {
        if (typeof r.validation_flags_json === 'string') {
          try {
            r.validation_flags_json = JSON.parse(r.validation_flags_json);
          } catch (_) {
            r.validation_flags_json = [];
          }
        }
        if (typeof r.raw_row_json === 'string') {
          try {
            r.raw_row_json = JSON.parse(r.raw_row_json);
          } catch (_) {
            r.raw_row_json = {};
          }
        }
      }
      rows.sort((a, b) => a.row_index - b.row_index);

      res.json({
        ...upload,
        extracted_rows: rows
      });
    })
  );

  // DELETE /api/billing/statement-uploads/:id
  router.delete(
    '/billing/statement-uploads/:id',
    requireAuthenticatedContext,
    requireLandlord,
    asyncHandler(async (req, res) => {
      const { orgId } = getContext(req);
      const uploadId = Number(req.params.id);

      const upload = await dbFindOne('statement_uploads', { id: uploadId, organization_id: orgId });
      if (!upload) {
        return res.status(404).json({ error: 'Statement upload not found.' });
      }

      // Delete storage file if exists
      try {
        if (upload.storage_path) {
          await fs.unlink(upload.storage_path);
        }
      } catch (_) {}

      await dbDelete('statement_uploads', uploadId);
      res.json({ success: true, message: 'Statement upload rejected and deleted.' });
    })
  );

  // POST /api/billing/statement-uploads/:id/confirm
  router.post(
    '/billing/statement-uploads/:id/confirm',
    requireAuthenticatedContext,
    requireLandlord,
    asyncHandler(async (req, res) => {
      const { orgId } = getContext(req);
      const uploadId = Number(req.params.id);
      const includeDuplicates = req.body.include_duplicates === true;

      const upload = await dbFindOne('statement_uploads', { id: uploadId, organization_id: orgId });
      if (!upload) {
        return res.status(404).json({ error: 'Statement upload not found.' });
      }

      if (upload.status === 'confirmed') {
        return res.status(400).json({ error: 'This statement upload has already been confirmed.' });
      }

      if (upload.status === 'failed') {
        return res.status(400).json({ error: 'Failed statement uploads cannot be confirmed.' });
      }

      const rows = await dbFind('statement_extracted_transactions', { statement_upload_id: uploadId, organization_id: orgId });

      let imported_count = 0;
      let skipped_duplicate_count = 0;
      let skipped_invalid_count = 0;
      let total_money_in = 0;
      let total_money_out = 0;

      for (const row of rows) {
        let flags = row.validation_flags_json || [];
        if (typeof flags === 'string') {
          try {
            flags = JSON.parse(flags);
          } catch (_err) {
            flags = [];
          }
        }

        let rawRow = row.raw_row_json || {};
        if (typeof rawRow === 'string') {
          try {
            rawRow = JSON.parse(rawRow);
          } catch (_err) {
            rawRow = {};
          }
        }

        // Validate invalid flags
        const isInvalid = flags.includes('invalid_both_debit_credit') || 
                          flags.includes('incomplete_no_amount') ||
                          flags.includes('missing_date');

        if (isInvalid) {
          skipped_invalid_count++;
          continue;
        }

        // Validate duplicates
        if (row.duplicate_candidate && !includeDuplicates) {
          skipped_duplicate_count++;
          continue;
        }

        // Generate source hash if missing
        const cleanAmount = Number(row.normalized_amount || 0);
        const cleanDate = row.transaction_date instanceof Date
          ? `${row.transaction_date.getFullYear()}-${String(row.transaction_date.getMonth() + 1).padStart(2, '0')}-${String(row.transaction_date.getDate()).padStart(2, '0')}`
          : String(row.transaction_date).split('T')[0];
        const sourceHashStr = `${cleanDate}_${cleanAmount}_${row.reference || ''}_${row.description}`;
        const sourceHash = rawRow.sourceHash || crypto
          .createHash('sha256')
          .update(sourceHashStr)
          .digest('hex');

        // Prevent duplicate confirmed source hashes at the service/database level
        const existingConfirmed = await dbFindOne('confirmed_statement_transactions', {
          organization_id: orgId,
          source_hash: sourceHash
        });

        if (existingConfirmed) {
          skipped_duplicate_count++;
          continue;
        }

        // Confirm the transaction
        const direction = row.normalized_amount >= 0 ? 'money_in' : 'money_out';
        await dbInsert('confirmed_statement_transactions', {
          organization_id: orgId,
          statement_upload_id: uploadId,
          extracted_transaction_id: row.id,
          transaction_date: row.transaction_date,
          description: row.description,
          reference: row.reference || null,
          amount: Math.abs(row.normalized_amount),
          direction,
          running_balance: row.running_balance,
          source_provider: upload.provider_guess,
          source_hash: sourceHash
        });

        imported_count++;
        if (direction === 'money_in') {
          total_money_in += Math.abs(row.normalized_amount);
        } else {
          total_money_out += Math.abs(row.normalized_amount);
        }
      }

      // Mark upload as confirmed
      await dbUpdate('statement_uploads', uploadId, { status: 'confirmed' });

      res.json({
        success: true,
        imported_count,
        skipped_duplicate_count,
        skipped_invalid_count,
        total_money_in,
        total_money_out
      });
    })
  );

  return router;
}

