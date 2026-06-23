import express from 'express';
import crypto from 'crypto';
import { NotificationService } from '../notificationService.js';
import { db } from '../db.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
      JSON.stringify({ ip: 'webhook', device: 'Payment Provider Callback' })
    ]
  );
}

async function logSystemError(pgDb, orgId, source, message, metadata = {}) {
  try {
    await pgDb.insert('system_errors', {
      organization_id: orgId,
      user_id: null,
      source,
      severity: 'error',
      message,
      stack_trace: null,
      metadata,
      status: 'open'
    });
  } catch (error) {
    console.error('Failed to log webhook system error:', error);
  }
}

// ---------------------------------------------------------------------------
// Organization resolution — Phase 6 hardened version
// ---------------------------------------------------------------------------
// Resolves the owning organization from the webhook payload by matching the
// inbound shortcode / provider identifier against the real values stored in
// organization_integrations.  In demo mode, the caller may supply an explicit
// organization_id for testing convenience, falling back to org 1 if nothing
// else matches.  In production, resolution MUST succeed via provider config or
// the callback is rejected.
// ---------------------------------------------------------------------------

/**
 * Resolve the organization that owns the shortcode/paybill in the payload.
 * Returns { orgId, integration } where integration is the matched row (or null
 * in demo-fallback scenarios).
 */
async function resolveOrganization(client, body, providerType, demoMode) {
  // Demo convenience: explicit org override for local testing
  if (demoMode && body.organization_id) {
    return { orgId: parseInt(body.organization_id), integration: null };
  }

  // --- M-Pesa resolution: match on shortcode column ---
  if (providerType === 'mpesa') {
    const shortcode = body.BusinessShortCode || body.ShortCode || body.BillRefShortCode || body.shortcode;
    if (shortcode) {
      const result = await client.query(
        `
          SELECT id, organization_id, webhook_secret, shortcode, account_reference, environment
          FROM organization_integrations
          WHERE provider_type = 'mpesa'
            AND shortcode = $1
            AND is_active = true
            AND (
              status IN ('ready', 'live')
              OR (environment = 'sandbox' AND status = 'draft')
              OR (environment = 'live' AND status IN ('draft', 'test_failed'))
            )
          ORDER BY status = 'live' DESC, id ASC
          LIMIT 1
        `,
        [String(shortcode).trim()]
      );

      if (result.rows.length === 1) {
        return { orgId: result.rows[0].organization_id, integration: result.rows[0] };
      }
    }
  }

  // --- Bank resolution: match on provider_identifier ---
  if (providerType === 'bank') {
    const bankCode = body.bank_code || body.BankCode || body.provider_id || body.provider_identifier;
    if (bankCode) {
      const result = await client.query(
        `
          SELECT id, organization_id, webhook_secret, provider_identifier, environment
          FROM organization_integrations
          WHERE provider_type = 'bank'
            AND provider_identifier = $1
            AND is_active = true
            AND status IN ('ready', 'live')
          ORDER BY status = 'live' DESC, id ASC
          LIMIT 1
        `,
        [String(bankCode).trim()]
      );

      if (result.rows.length === 1) {
        return { orgId: result.rows[0].organization_id, integration: result.rows[0] };
      }
    }
  }

  // Demo fallback — only when explicitly in demo mode
  if (demoMode) {
    return { orgId: 1, integration: null };
  }

  return { orgId: null, integration: null };
}

// ---------------------------------------------------------------------------
// Webhook signature / token validation — Phase 6
// ---------------------------------------------------------------------------
// Each provider type has its own validation strategy:
//
// M-Pesa STK Push:
//   Safaricom STK callbacks include a Password field that is
//   Base64(Shortcode + Passkey + Timestamp).  We recompute this using the
//   stored webhook_secret (= Lipa Na M-Pesa passkey) and compare.
//
// M-Pesa C2B:
//   C2B confirmation callbacks do not carry an HMAC signature.  The standard
//   pattern is to include a secret token in the callback URL registered with
//   Safaricom and verify it on receipt via a query parameter or header.
//
// Bank webhooks:
//   Validated using HMAC-SHA256 of the raw request body, compared against the
//   X-Webhook-Signature header.
// ---------------------------------------------------------------------------

/**
 * Validate the inbound webhook against the integration's stored secret.
 * @returns {{ valid: boolean, reason: string }}
 */
function validateWebhookSignature(req, integration, providerType, callbackType) {
  // No integration row found — skip validation only in demo
  if (!integration) {
    return { valid: true, reason: 'No integration row (demo fallback).' };
  }

  const secret = integration.webhook_secret;

  // If no secret is configured, allow the request through but log a warning.
  // This supports the transition period where integrations exist but haven't
  // had secrets provisioned yet.
  if (!secret) {
    return { valid: true, reason: 'No webhook_secret configured for this integration. Signature validation skipped.' };
  }

  // --- M-Pesa STK Push validation ---
  if (providerType === 'mpesa' && callbackType === 'stk') {
    return validateMpesaStkSignature(req.body, integration.shortcode, secret);
  }

  // --- M-Pesa C2B token validation ---
  if (providerType === 'mpesa' && callbackType === 'c2b') {
    return validateMpesaC2bToken(req, secret);
  }

  // --- Bank HMAC-SHA256 validation ---
  if (providerType === 'bank') {
    return validateBankHmac(req, secret);
  }

  // Generic / unknown — if a secret exists but we don't know the scheme, reject
  return { valid: false, reason: `Unknown provider/callback type: ${providerType}/${callbackType}. Cannot validate.` };
}

/**
 * M-Pesa STK Push: validate the Password field.
 * Password = Base64(Shortcode + Passkey + Timestamp)
 */
function validateMpesaStkSignature(body, shortcode, passkey) {
  // The STK callback body is wrapped in Body.stkCallback by Safaricom
  const stkData = body?.Body?.stkCallback || body;
  const timestamp = body.Timestamp || stkData.Timestamp;
  const password = body.Password || stkData.Password;

  if (!timestamp || !password) {
    // Not all STK callbacks include Password (result callbacks may not).
    // If absent, we validate by checking the CheckoutRequestID format instead.
    const checkoutId = stkData.CheckoutRequestID || body.CheckoutRequestID;
    if (checkoutId && typeof checkoutId === 'string' && checkoutId.startsWith('ws_')) {
      return { valid: true, reason: 'STK result callback accepted (CheckoutRequestID format valid).' };
    }
    return { valid: false, reason: 'M-Pesa STK callback missing Timestamp/Password and no valid CheckoutRequestID.' };
  }

  const expectedPassword = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  if (password === expectedPassword) {
    return { valid: true, reason: 'M-Pesa STK Password validated.' };
  }

  // Use timing-safe comparison for the base64 strings
  try {
    const a = Buffer.from(password);
    const b = Buffer.from(expectedPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, reason: 'M-Pesa STK Password validated.' };
    }
  } catch (_ignored) {
    // length mismatch — fall through to rejection
  }

  return { valid: false, reason: 'M-Pesa STK Password mismatch. Possible forged callback.' };
}

/**
 * M-Pesa C2B: validate a secret token passed as a query parameter or header.
 * The token is included in the callback URL registered with Safaricom, e.g.:
 *   https://api.example.com/api/webhooks/mpesa/c2b?token=<secret>
 */
function validateMpesaC2bToken(req, secret) {
  const token = req.query.token || req.headers['x-callback-token'] || '';

  if (!token) {
    return { valid: false, reason: 'M-Pesa C2B callback missing token query parameter or X-Callback-Token header.' };
  }

  // Timing-safe comparison
  try {
    const a = Buffer.from(String(token));
    const b = Buffer.from(String(secret));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, reason: 'M-Pesa C2B token validated.' };
    }
  } catch (_ignored) {
    // length mismatch
  }

  return { valid: false, reason: 'M-Pesa C2B token mismatch. Possible forged callback.' };
}

/**
 * Bank webhook: validate HMAC-SHA256 signature.
 * The bank provider computes HMAC-SHA256(body, secret) and sends it in
 * the X-Webhook-Signature header.  We recompute and compare.
 */
function validateBankHmac(req, secret) {
  const signature = req.headers['x-webhook-signature'] || '';

  if (!signature) {
    return { valid: false, reason: 'Bank webhook missing X-Webhook-Signature header.' };
  }

  // We need the raw body for HMAC computation.  Express's json() middleware
  // parses the body, so we rely on the rawBody property if configured, or
  // re-serialize from the parsed object (acceptable when the provider sends
  // JSON and we haven't altered it).
  const rawBody = req.rawBody || JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Support both raw hex and "sha256=" prefixed formats
  const normalizedSignature = signature.replace(/^sha256=/, '');

  try {
    const a = Buffer.from(normalizedSignature);
    const b = Buffer.from(expectedSignature);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, reason: 'Bank webhook HMAC-SHA256 signature validated.' };
    }
  } catch (_ignored) {
    // length mismatch
  }

  return { valid: false, reason: 'Bank webhook HMAC-SHA256 signature mismatch. Possible forged callback.' };
}

// ---------------------------------------------------------------------------
// Payload normalization
// ---------------------------------------------------------------------------

function normalizeWebhookPayload(body) {
  const providerHint = String(body.provider_type || body.provider || body.payment_method || '').toLowerCase();
  const isMpesa = providerHint.includes('mpesa') || Boolean(body.TransID || body.MSISDN);
  const provider = isMpesa ? 'mpesa' : 'bank';
  const reference = body.TransID || body.transaction_id || body.transactionId || body.reference_number || body.reference || body.BankRef || body.bank_reference;
  const amount = body.TransAmount || body.amount || body.Amount || body.transaction_amount || body.TransactionAmount;
  const accountNumber = body.BillRefNumber || body.account_number || body.AccountNumber || body.account || body.narration_account || '';
  const payerPhone = body.MSISDN || body.phone_number || body.phone || body.payer_phone || '';
  const firstName = body.FirstName || body.first_name || '';
  const middleName = body.MiddleName || body.middle_name || '';
  const lastName = body.LastName || body.last_name || '';
  const payerName = body.payer_name || body.customer_name || body.CustomerName || `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, ' ').trim() || `${provider.toUpperCase()} Payer`;

  return {
    provider,
    paymentMethod: provider === 'mpesa' ? 'mpesa' : 'bank',
    source: provider === 'mpesa' ? 'mpesa_callback' : 'bank_callback',
    reference: reference ? String(reference).trim() : '',
    amount: Number(amount),
    accountNumber: accountNumber ? String(accountNumber).trim() : '',
    cleanRef: accountNumber ? String(accountNumber).trim().toUpperCase() : '',
    payerName,
    payerPhone: payerPhone ? String(payerPhone).trim() : ''
  };
}

/**
 * Normalize M-Pesa STK Push result callback body.
 * Safaricom wraps STK results in Body.stkCallback with CallbackMetadata items.
 */
function normalizeStkPayload(body) {
  const stk = body?.Body?.stkCallback || body;
  const items = stk?.CallbackMetadata?.Item || [];

  const getValue = (name) => {
    const item = items.find(i => i.Name === name);
    return item ? item.Value : undefined;
  };

  const amount = getValue('Amount') || body.TransAmount || body.amount;
  const reference = getValue('MpesaReceiptNumber') || body.TransID || body.reference;
  const phone = getValue('PhoneNumber') || body.MSISDN || body.phone_number || '';

  return {
    provider: 'mpesa',
    paymentMethod: 'mpesa',
    source: 'mpesa_callback',
    reference: reference ? String(reference).trim() : '',
    amount: Number(amount),
    accountNumber: body.AccountReference || body.BillRefNumber || '',
    cleanRef: (body.AccountReference || body.BillRefNumber || '').trim().toUpperCase(),
    payerName: body.payer_name || `M-Pesa Payer`,
    payerPhone: phone ? String(phone).trim() : ''
  };
}

// ---------------------------------------------------------------------------
// Tenant / invoice matching
// ---------------------------------------------------------------------------

async function findMatch(client, orgId, cleanRef, msisdn) {
  const invoicesResult = await client.query(
    "SELECT * FROM invoices WHERE organization_id = $1 AND status NOT IN ('paid', 'void')",
    [orgId]
  );
  const tenantsResult = await client.query(
    'SELECT * FROM tenants WHERE organization_id = $1 AND deleted_at IS NULL',
    [orgId]
  );

  const invoices = invoicesResult.rows;
  const tenants = tenantsResult.rows;
  let matchedTenant = null;
  let matchedInvoice = null;

  if (cleanRef.startsWith('INV-')) {
    matchedInvoice = invoices.find(invoice => invoice.invoice_number.toUpperCase() === cleanRef);
    if (matchedInvoice) {
      matchedTenant = tenants.find(tenant => tenant.id === matchedInvoice.tenant_id);
    }
  }

  if (!matchedTenant && cleanRef.startsWith('ACC-')) {
    matchedTenant = tenants.find(tenant => tenant.tenant_account_number.toUpperCase() === cleanRef);
  }

  if (!matchedTenant && cleanRef) {
    const unitsResult = await client.query('SELECT * FROM units WHERE organization_id = $1 AND deleted_at IS NULL', [orgId]);
    const unitsById = new Map(unitsResult.rows.map(unit => [unit.id, unit]));
    matchedTenant = tenants.find(tenant => {
      const unit = unitsById.get(tenant.unit_id);
      return unit && unit.unit_code.toUpperCase() === cleanRef;
    });
  }

  if (!matchedTenant && msisdn) {
    const cleanPhone = String(msisdn).replace('+', '');
    matchedTenant = tenants.find(tenant => tenant.phone_number.includes(cleanPhone) || cleanPhone.includes(tenant.phone_number.replace('+', '')));
  }

  if (matchedTenant && !matchedInvoice) {
    const tenantInvoices = invoices
      .filter(invoice => invoice.tenant_id === matchedTenant.id)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    matchedInvoice = tenantInvoices[0] || null;
  }

  return { matchedTenant, matchedInvoice };
}

// ---------------------------------------------------------------------------
// Payment allocation
// ---------------------------------------------------------------------------

async function allocatePayment(client, orgId, transactionId, tenantId, amount, preferredInvoiceId = null) {
  let remainingAmount = Number(amount);

  if (preferredInvoiceId) {
    const invoiceResult = await client.query(
      `
        SELECT *
        FROM invoices
        WHERE id = $1
          AND organization_id = $2
          AND tenant_id = $3
          AND status IN ('issued', 'partially_paid', 'overdue')
        FOR UPDATE
      `,
      [preferredInvoiceId, orgId, tenantId]
    );

    if (invoiceResult.rows[0]) {
      remainingAmount = await allocateToInvoice(client, orgId, transactionId, invoiceResult.rows[0], remainingAmount);
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
      if (preferredInvoiceId && invoice.id === preferredInvoiceId) continue;
      remainingAmount = await allocateToInvoice(client, orgId, transactionId, invoice, remainingAmount);
    }
  }

  return remainingAmount;
}

async function allocateToInvoice(client, orgId, transactionId, invoice, remainingAmount) {
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
      VALUES ($1, $2, $3, $4, NULL, now())
    `,
    [orgId, transactionId, invoice.id, toAllocate]
  );

  return remainingAmount - toAllocate;
}

// ---------------------------------------------------------------------------
// Core webhook processing pipeline
// ---------------------------------------------------------------------------
// This is the shared logic that all provider-specific endpoints funnel into
// after org resolution and signature validation have succeeded.
// ---------------------------------------------------------------------------

async function processWebhookPayment(pgDb, req, res, payment, orgId, integration, providerLabel) {
  try {
    const result = await withTransaction(pgDb, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)', [orgId, payment.reference]);

      const duplicateTransaction = await client.query(
        'SELECT id FROM transactions WHERE organization_id = $1 AND reference_number = $2 AND status <> $3 LIMIT 1',
        [orgId, payment.reference, 'failed']
      );
      if (duplicateTransaction.rows.length > 0) {
        await logAudit(client, orgId, null, 'system', 'webhook_duplicate_blocked', 'webhook', null, null, null, `Blocked duplicate ${providerLabel} webhook transaction ${payment.reference}`);
        return { duplicate: true, orgId };
      }

      const duplicateStaging = await client.query(
        'SELECT id FROM reconciliation_staging_rows WHERE organization_id = $1 AND reference_number = $2 AND status <> $3 LIMIT 1',
        [orgId, payment.reference, 'ignored']
      );
      if (duplicateStaging.rows.length > 0) {
        await logAudit(client, orgId, null, 'system', 'webhook_duplicate_blocked', 'reconciliation_staging_rows', duplicateStaging.rows[0].id, null, null, `Blocked duplicate unmatched ${providerLabel} webhook transaction ${payment.reference}`);
        return { duplicate: true, orgId };
      }

      // --- LIVE ENVIRONMENT GUARD ---
      if (integration && integration.environment === 'live') {
        const stagingResult = await client.query(
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
              payer_phone,
              status,
              error_message
            )
            VALUES ($1, NULL, $2::jsonb, now(), $3, $4, $5, $6, $7, $8, 'unmatched', $9)
            RETURNING *
          `,
          [
            orgId,
            JSON.stringify(req.body),
            payment.amount,
            payment.reference,
            payment.accountNumber,
            `Live ${payment.provider.toUpperCase()} callback received. Securely staged without allocation.`,
            payment.payerName,
            payment.payerPhone,
            'Live payment processing is not enabled. Staged securely without allocation.'
          ]
        );

        const stagingRow = stagingResult.rows[0];
        await logAudit(
          client,
          orgId,
          null,
          'system',
          'webhook_live_staged_without_allocation',
          'reconciliation_staging_rows',
          stagingRow.id,
          null,
          stagingRow,
          `Live ${providerLabel} payment callback staged securely without allocation (readiness verification mode).`
        );

        const ownerResult = await client.query('SELECT owner_user_id FROM organizations WHERE id = $1', [orgId]);
        const ownerUserId = ownerResult.rows[0]?.owner_user_id || null;
        if (ownerUserId) {
          const notificationService = new NotificationService(pgDb);
          await notificationService.queue({
            organizationId: orgId,
            recipientUserId: ownerUserId,
            channel: 'in_app',
            type: 'unmatched_payment_alert',
            data: {
              amount: payment.amount,
              payer_name: payment.payerName,
              phone_number: payment.payerPhone,
              reference: payment.reference
            }
          }, client);
        }

        return { duplicate: false, matched: false, orgId };
      }
      // --- END OF LIVE ENVIRONMENT GUARD ---

      const { matchedTenant, matchedInvoice } = await findMatch(client, orgId, payment.cleanRef, payment.payerPhone);

      if (matchedTenant) {
        const transactionResult = await client.query(
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
              created_by,
              reconciled_by,
              reconciled_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'payment', $8, $9, $10, $11, $12, $13, now(), 'reconciled', $14::jsonb, NULL, NULL, now())
            RETURNING *
          `,
          [
            orgId,
            matchedTenant.id,
            matchedTenant.property_id,
            matchedTenant.unit_id,
            matchedInvoice ? matchedInvoice.id : null,
            payment.amount,
            matchedTenant.currency || 'KES',
            payment.paymentMethod,
            payment.source,
            payment.reference,
            payment.accountNumber || matchedTenant.tenant_account_number,
            payment.payerName,
            payment.payerPhone || matchedTenant.phone_number,
            JSON.stringify(req.body)
          ]
        );

        const transaction = transactionResult.rows[0];
        await allocatePayment(client, orgId, transaction.id, matchedTenant.id, payment.amount, matchedInvoice ? matchedInvoice.id : null);

        const notificationService = new NotificationService(pgDb);
        await notificationService.queue({
          organizationId: orgId,
          tenantId: matchedTenant.id,
          channel: 'sms',
          type: 'payment_confirmed',
          data: {
            amount: payment.amount,
            account_number: matchedTenant.tenant_account_number,
            reference: payment.reference
          }
        }, client);

        await logAudit(client, orgId, null, 'system', 'webhook_auto_matched', 'transaction', transaction.id, null, transaction, `${providerLabel} webhook auto-matched ref ${payment.reference} to tenant ${matchedTenant.full_name}`);
        return { duplicate: false, matched: true, orgId };
      }

      // Unmatched — route to reconciliation staging
      const stagingResult = await client.query(
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
            payer_phone,
            status,
            error_message
          )
          VALUES ($1, NULL, $2::jsonb, now(), $3, $4, $5, $6, $7, $8, 'unmatched', $9)
          RETURNING *
        `,
        [
          orgId,
          JSON.stringify(req.body),
          payment.amount,
          payment.reference,
          payment.accountNumber,
          `${payment.provider.toUpperCase()} webhook payment from ${payment.payerPhone || payment.payerName || 'unknown'}`,
          payment.payerName,
          payment.payerPhone,
          'Auto-matching failed: no matching account, invoice or phone number.'
        ]
      );

      const stagingRow = stagingResult.rows[0];
      await logAudit(client, orgId, null, 'system', 'webhook_unmatched', 'reconciliation_staging_rows', stagingRow.id, null, stagingRow, `${providerLabel} webhook payment ${payment.reference} unmatched. Sent to staging.`);

      const ownerResult = await client.query('SELECT owner_user_id FROM organizations WHERE id = $1', [orgId]);
      const ownerUserId = ownerResult.rows[0]?.owner_user_id || null;
      if (ownerUserId) {
        const notificationService = new NotificationService(pgDb);
        await notificationService.queue({
          organizationId: orgId,
          recipientUserId: ownerUserId,
          channel: 'in_app',
          type: 'unmatched_payment_alert',
          data: {
            amount: payment.amount,
            payer_name: payment.payerName,
            phone_number: payment.payerPhone,
            reference: payment.reference
          }
        }, client);
      }

      return { duplicate: false, matched: false, orgId };
    });

    if (result.duplicate) {
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Duplicate Transaction' });
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accept Service Success' });
  } catch (error) {
    await logSystemError(pgDb, null, `${providerLabel.toLowerCase()}_webhook`, error.message, req.body);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createWebhookRoutes(pgDb, { demoMode = false } = {}) {
  const router = express.Router();

  // =========================================================================
  // POST /webhooks/mpesa/c2b — M-Pesa C2B Confirmation Callback
  // =========================================================================
  // Safaricom sends C2B confirmations to the URL registered via the
  // RegisterURL API.  The URL includes a secret token as a query parameter.
  // =========================================================================
  // POST /webhooks/mpesa/c2b — M-Pesa C2B Confirmation Callback
  // =========================================================================
  // Safaricom sends C2B confirmations to the URL registered via the
  // RegisterURL API.  The URL includes a secret token as a query parameter.
  // =========================================================================
  router.post('/webhooks/mpesa/c2b', asyncHandler(async (req, res) => {
    const payment = normalizeWebhookPayload(req.body);

    if (!payment.reference || !payment.amount || payment.amount <= 0) {
      await logSystemError(pgDb, null, 'mpesa_c2b_webhook', 'Invalid M-Pesa C2B payload received.', req.body);
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    // --- SaaS Platform Billing C2B Check ---
    let platformSettings;
    if (pgDb) {
      const settingsRes = await pgDb.query('SELECT mpesa_shortcode FROM platform_billing_settings ORDER BY id ASC LIMIT 1');
      platformSettings = settingsRes.rows[0] || { mpesa_shortcode: '174379' };
    } else {
      platformSettings = db.findOne('platform_billing_settings', { id: 1 }) || { mpesa_shortcode: '174379' };
    }

    const inboundShortcode = String(req.body.BusinessShortCode || req.body.ShortCode || req.body.BillRefShortCode || '').trim();
    const platformShortcode = String(platformSettings.mpesa_shortcode || '174379').trim();

    if (inboundShortcode) {
      const client = await pgDb.pool.connect();
      let resolved;
      try {
        resolved = await resolveOrganization(client, req.body, 'mpesa', false);
      } finally {
        client.release();
      }

      if (resolved.orgId && resolved.integration) {
        const validation = validateWebhookSignature(req, resolved.integration, 'mpesa', 'c2b');
        if (!validation.valid) {
          await logSystemError(pgDb, resolved.orgId, 'mpesa_c2b_webhook', `Signature validation failed: ${validation.reason}`, req.body);
          return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected' });
        }

        return processWebhookPayment(pgDb, req, res, payment, resolved.orgId, resolved.integration, 'M-Pesa C2B');
      }
    }

    if (inboundShortcode === platformShortcode) {
      // This is a C2B payment to the platform itself!
      const billRefNumber = req.body.BillRefNumber || req.body.account_number || '';
      const cleanRef = billRefNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      
      let matchedOrgId = null;
      if (pgDb) {
        const orgsRes = await pgDb.query("SELECT id, name FROM organizations WHERE status <> 'deleted'");
        const orgs = orgsRes.rows;
        for (const org of orgs) {
          const cleanOrgName = org.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 12);
          if (cleanRef.includes(cleanOrgName) || cleanOrgName.includes(cleanRef)) {
            matchedOrgId = org.id;
            break;
          }
        }
      } else {
        const orgs = db.get('organizations');
        for (const org of orgs) {
          const cleanOrgName = org.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 12);
          if (cleanRef.includes(cleanOrgName) || cleanOrgName.includes(cleanRef)) {
            matchedOrgId = org.id;
            break;
          }
        }
      }

      if (!matchedOrgId) {
        await logSystemError(pgDb, null, 'platform_mpesa_c2b_webhook', `Could not match platform organization name from BillRefNumber: ${billRefNumber}`, req.body);
        return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected - Org not found' });
      }

      // Validate signature/token for platform billing
      const platformSecret = process.env.PLATFORM_WEBHOOK_SECRET || process.env.SESSION_SECRET || 'platform-default-secret';
      const virtualIntegration = {
        shortcode: platformSettings.mpesa_shortcode,
        webhook_secret: platformSecret
      };

      const validation = validateWebhookSignature(req, virtualIntegration, 'mpesa', 'c2b');
      if (!validation.valid) {
        await logSystemError(pgDb, matchedOrgId, 'platform_mpesa_c2b_webhook', `Platform C2B Signature validation failed: ${validation.reason}`, req.body);
        return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected' });
      }

      // Find oldest unpaid invoice
      let oldestInvoice = null;
      if (pgDb) {
        const invoiceRes = await pgDb.query(
          "SELECT * FROM platform_billing_invoices WHERE organization_id = $1 AND status IN ('issued', 'overdue') ORDER BY id ASC LIMIT 1",
          [matchedOrgId]
        );
        oldestInvoice = invoiceRes.rows[0] || null;
      } else {
        const invoices = db.find('platform_billing_invoices', { organization_id: matchedOrgId });
        oldestInvoice = invoices.filter(inv => inv.status === 'issued' || inv.status === 'overdue')
          .sort((a, b) => a.id - b.id)[0] || null;
      }

      if (!oldestInvoice) {
        await logSystemError(pgDb, matchedOrgId, 'platform_mpesa_c2b_webhook', 'Platform billing C2B received but no outstanding platform invoices found.', req.body);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'No invoice to clear' });
      }

      const mpesaReceiptNumber = payment.reference || `MPESA-${Math.floor(100000 + Math.random() * 900000)}`;

      if (pgDb) {
        const paymentRecord = await pgDb.insert('platform_billing_payments', {
          organization_id: matchedOrgId,
          billing_invoice_id: oldestInvoice.id,
          amount: payment.amount,
          currency: 'KES',
          payment_method: 'mpesa',
          reference_number: mpesaReceiptNumber,
          status: 'confirmed',
          confirmed_by: null,
          confirmed_at: new Date().toISOString()
        });

        await pgDb.update('platform_billing_invoices', parseInt(oldestInvoice.id), {
          status: 'paid',
          paid_at: new Date().toISOString()
        });

        const org = await pgDb.findOne('organizations', { id: parseInt(matchedOrgId) });
        let baseTime = Date.now();
        if (org) {
          if (org.subscription_status === 'trial' && org.trial_ends_at) {
            const trialEnd = new Date(org.trial_ends_at).getTime();
            if (!isNaN(trialEnd) && trialEnd > Date.now()) {
              baseTime = trialEnd;
            }
          } else if (org.subscription_status === 'active' && org.subscription_expires_at) {
            const currentExpires = new Date(org.subscription_expires_at).getTime();
            if (!isNaN(currentExpires) && currentExpires > Date.now()) {
              baseTime = currentExpires;
            }
          }
        }
        const newExpires = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();

        await pgDb.update('organizations', parseInt(matchedOrgId), {
          is_locked: false,
          subscription_status: 'active',
          subscription_expires_at: newExpires
        });

        await pgDb.insert('system_audit_logs', {
          admin_user_id: null,
          target_organization_id: matchedOrgId,
          action: 'saas_payment_confirmed_c2b',
          reason: `SaaS Invoice paid via C2B. Org unlocked. Ref: ${mpesaReceiptNumber}`,
          metadata: { payment_id: paymentRecord.id, reference_number: mpesaReceiptNumber }
        });
      } else {
        const paymentRecord = db.insert('platform_billing_payments', {
          organization_id: matchedOrgId,
          billing_invoice_id: oldestInvoice.id,
          amount: payment.amount,
          currency: 'KES',
          payment_method: 'mpesa',
          reference_number: mpesaReceiptNumber,
          status: 'confirmed',
          confirmed_by: null,
          confirmed_at: new Date().toISOString()
        });

        db.update('platform_billing_invoices', oldestInvoice.id, {
          status: 'paid',
          paid_at: new Date().toISOString()
        });

        const org = db.findOne('organizations', { id: matchedOrgId });
        let baseTime = Date.now();
        if (org) {
          if (org.subscription_status === 'trial' && org.trial_ends_at) {
            const trialEnd = new Date(org.trial_ends_at).getTime();
            if (!isNaN(trialEnd) && trialEnd > Date.now()) {
              baseTime = trialEnd;
            }
          } else if (org.subscription_status === 'active' && org.subscription_expires_at) {
            const currentExpires = new Date(org.subscription_expires_at).getTime();
            if (!isNaN(currentExpires) && currentExpires > Date.now()) {
              baseTime = currentExpires;
            }
          }
        }
        const newExpires = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();

        db.update('organizations', matchedOrgId, {
          is_locked: false,
          subscription_status: 'active',
          subscription_expires_at: newExpires
        });

        db.insert('system_audit_logs', {
          admin_user_id: null,
          target_organization_id: matchedOrgId,
          action: 'saas_payment_confirmed_c2b',
          reason: `SaaS Invoice paid via C2B. Org unlocked. Ref: ${mpesaReceiptNumber}`,
          metadata: JSON.stringify({ payment_id: paymentRecord.id, reference_number: mpesaReceiptNumber })
        });
      }

      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accept Service Success' });
    }

    // Resolve organization from shortcode
    const client = await pgDb.pool.connect();
    let resolved;
    try {
      resolved = await resolveOrganization(client, req.body, 'mpesa', demoMode);
    } finally {
      client.release();
    }

    if (!resolved.orgId) {
      await logSystemError(pgDb, null, 'mpesa_c2b_webhook', 'Could not resolve organization from M-Pesa C2B shortcode.', req.body);
      return res.status(400).json({ error: 'Webhook organization could not be resolved.' });
    }

    // Validate C2B token
    const validation = validateWebhookSignature(req, resolved.integration, 'mpesa', 'c2b');
    if (!validation.valid) {
      await logSystemError(pgDb, resolved.orgId, 'mpesa_c2b_webhook', `Signature validation failed: ${validation.reason}`, req.body);
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected' });
    }

    return processWebhookPayment(pgDb, req, res, payment, resolved.orgId, resolved.integration, 'M-Pesa C2B');
  }));

  // =========================================================================
  // POST /webhooks/mpesa/stk — M-Pesa STK Push Result Callback
  // =========================================================================
  // Safaricom sends STK push results with a nested Body.stkCallback structure.
  // The Password field is validated against Shortcode + Passkey + Timestamp.
  // =========================================================================
  router.post('/webhooks/mpesa/stk', asyncHandler(async (req, res) => {
    const stkData = req.body?.Body?.stkCallback || req.body;

    // STK callbacks may report failures (ResultCode != 0)
    if (stkData.ResultCode !== undefined && stkData.ResultCode !== 0) {
      await logSystemError(pgDb, null, 'mpesa_stk_webhook', `STK push failed with ResultCode ${stkData.ResultCode}: ${stkData.ResultDesc || 'Unknown'}`, req.body);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Acknowledged' });
    }

    // --- SaaS Platform Billing STK Check ---
    const checkoutId = stkData.CheckoutRequestID || req.body.CheckoutRequestID;
    if (checkoutId) {
      let platformPayment = null;
      if (pgDb) {
        const platformPaymentRes = await pgDb.query(
          "SELECT * FROM platform_billing_payments WHERE reference_number = $1 AND status = 'pending' LIMIT 1",
          [checkoutId]
        );
        platformPayment = platformPaymentRes.rows[0] || null;
      } else {
        platformPayment = db.findOne('platform_billing_payments', { reference_number: checkoutId, status: 'pending' });
      }

      if (platformPayment) {
        let platformSettings;
        if (pgDb) {
          const settingsRes = await pgDb.query('SELECT mpesa_shortcode FROM platform_billing_settings ORDER BY id ASC LIMIT 1');
          platformSettings = settingsRes.rows[0] || { mpesa_shortcode: '174379' };
        } else {
          platformSettings = db.findOne('platform_billing_settings', { id: 1 }) || { mpesa_shortcode: '174379' };
        }

        const platformSecret = process.env.PLATFORM_WEBHOOK_SECRET || process.env.SESSION_SECRET || 'platform-default-secret';
        const virtualIntegration = {
          shortcode: platformSettings.mpesa_shortcode,
          webhook_secret: platformSecret
        };

        const validation = validateWebhookSignature(req, virtualIntegration, 'mpesa', 'stk');
        if (!validation.valid) {
          await logSystemError(pgDb, platformPayment.organization_id, 'platform_mpesa_stk_webhook', `Platform STK Signature validation failed: ${validation.reason}`, req.body);
          return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected' });
        }

        const mpesaReceiptNumber = normalizeStkPayload(req.body).reference || `MPESA-${Math.floor(100000 + Math.random() * 900000)}`;

        if (pgDb) {
          await pgDb.update('platform_billing_payments', parseInt(platformPayment.id), {
            status: 'confirmed',
            reference_number: mpesaReceiptNumber,
            confirmed_at: new Date().toISOString()
          });

          await pgDb.update('platform_billing_invoices', parseInt(platformPayment.billing_invoice_id), {
            status: 'paid',
            paid_at: new Date().toISOString()
          });

          const org = await pgDb.findOne('organizations', { id: parseInt(platformPayment.organization_id) });
          let baseTime = Date.now();
          if (org) {
            if (org.subscription_status === 'trial' && org.trial_ends_at) {
              const trialEnd = new Date(org.trial_ends_at).getTime();
              if (!isNaN(trialEnd) && trialEnd > Date.now()) {
                baseTime = trialEnd;
              }
            } else if (org.subscription_status === 'active' && org.subscription_expires_at) {
              const currentExpires = new Date(org.subscription_expires_at).getTime();
              if (!isNaN(currentExpires) && currentExpires > Date.now()) {
                baseTime = currentExpires;
              }
            }
          }
          const newExpires = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();

          await pgDb.update('organizations', parseInt(platformPayment.organization_id), {
            is_locked: false,
            subscription_status: 'active',
            subscription_expires_at: newExpires
          });

          await pgDb.insert('system_audit_logs', {
            admin_user_id: null,
            target_organization_id: platformPayment.organization_id,
            action: 'saas_payment_confirmed_stk',
            reason: `SaaS Invoice paid via STK push. Org unlocked. Ref: ${mpesaReceiptNumber}`,
            metadata: { payment_id: platformPayment.id, reference_number: mpesaReceiptNumber }
          });
        } else {
          db.update('platform_billing_payments', platformPayment.id, {
            status: 'confirmed',
            reference_number: mpesaReceiptNumber,
            confirmed_at: new Date().toISOString()
          });

          db.update('platform_billing_invoices', platformPayment.billing_invoice_id, {
            status: 'paid',
            paid_at: new Date().toISOString()
          });

          const org = db.findOne('organizations', { id: platformPayment.organization_id });
          let baseTime = Date.now();
          if (org) {
            if (org.subscription_status === 'trial' && org.trial_ends_at) {
              const trialEnd = new Date(org.trial_ends_at).getTime();
              if (!isNaN(trialEnd) && trialEnd > Date.now()) {
                baseTime = trialEnd;
              }
            } else if (org.subscription_status === 'active' && org.subscription_expires_at) {
              const currentExpires = new Date(org.subscription_expires_at).getTime();
              if (!isNaN(currentExpires) && currentExpires > Date.now()) {
                baseTime = currentExpires;
              }
            }
          }
          const newExpires = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();

          db.update('organizations', platformPayment.organization_id, {
            is_locked: false,
            subscription_status: 'active',
            subscription_expires_at: newExpires
          });

          db.insert('system_audit_logs', {
            admin_user_id: null,
            target_organization_id: platformPayment.organization_id,
            action: 'saas_payment_confirmed_stk',
            reason: `SaaS Invoice paid via STK push. Org unlocked. Ref: ${mpesaReceiptNumber}`,
            metadata: JSON.stringify({ payment_id: platformPayment.id, reference_number: mpesaReceiptNumber })
          });
        }

        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accept Service Success' });
      }
    }

    const payment = normalizeStkPayload(req.body);

    if (!payment.reference || !payment.amount || payment.amount <= 0) {
      await logSystemError(pgDb, null, 'mpesa_stk_webhook', 'Invalid M-Pesa STK payload received.', req.body);
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    // Resolve organization from shortcode
    const client = await pgDb.pool.connect();
    let resolved;
    try {
      resolved = await resolveOrganization(client, req.body, 'mpesa', demoMode);
    } finally {
      client.release();
    }

    if (!resolved.orgId) {
      await logSystemError(pgDb, null, 'mpesa_stk_webhook', 'Could not resolve organization from M-Pesa STK shortcode.', req.body);
      return res.status(400).json({ error: 'Webhook organization could not be resolved.' });
    }

    // Validate STK signature
    const validation = validateWebhookSignature(req, resolved.integration, 'mpesa', 'stk');
    if (!validation.valid) {
      await logSystemError(pgDb, resolved.orgId, 'mpesa_stk_webhook', `Signature validation failed: ${validation.reason}`, req.body);
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected' });
    }

    return processWebhookPayment(pgDb, req, res, payment, resolved.orgId, resolved.integration, 'M-Pesa STK');
  }));

  // =========================================================================
  // POST /webhooks/bank — Bank Transfer / Statement Webhook
  // =========================================================================
  // Bank providers send an HMAC-SHA256 signature in the X-Webhook-Signature
  // header, computed over the raw JSON body using the shared secret.
  // =========================================================================
  router.post('/webhooks/bank', asyncHandler(async (req, res) => {
    const payment = normalizeWebhookPayload(req.body);

    if (!payment.reference || !payment.amount || payment.amount <= 0) {
      await logSystemError(pgDb, null, 'bank_webhook', 'Invalid bank webhook payload received.', req.body);
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    // Resolve organization from bank provider identifier
    const client = await pgDb.pool.connect();
    let resolved;
    try {
      resolved = await resolveOrganization(client, req.body, 'bank', demoMode);
    } finally {
      client.release();
    }

    if (!resolved.orgId) {
      await logSystemError(pgDb, null, 'bank_webhook', 'Could not resolve organization from bank webhook provider identifier.', req.body);
      return res.status(400).json({ error: 'Webhook organization could not be resolved.' });
    }

    // Validate HMAC signature
    const validation = validateWebhookSignature(req, resolved.integration, 'bank', 'bank');
    if (!validation.valid) {
      await logSystemError(pgDb, resolved.orgId, 'bank_webhook', `Signature validation failed: ${validation.reason}`, req.body);
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    return processWebhookPayment(pgDb, req, res, payment, resolved.orgId, resolved.integration, 'Bank');
  }));

  // =========================================================================
  // POST /webhooks/payment — Generic / backward-compatible endpoint
  // =========================================================================
  // Kept for demo compatibility and as a fallback for providers that don't
  // have a dedicated endpoint.  Auto-detects provider type from payload.
  // In production with a resolved integration, still validates signatures.
  // =========================================================================
  router.post('/webhooks/payment', asyncHandler(async (req, res) => {
    const payment = normalizeWebhookPayload(req.body);

    if (!payment.reference || !payment.amount || payment.amount <= 0) {
      await logSystemError(pgDb, null, 'payment_webhook', 'Invalid webhook payload received.', req.body);
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    // Resolve organization — tries mpesa first, then bank
    const client = await pgDb.pool.connect();
    let resolved;
    try {
      resolved = await resolveOrganization(client, req.body, payment.provider, demoMode);
    } finally {
      client.release();
    }

    if (!resolved.orgId) {
      await logSystemError(pgDb, null, 'payment_webhook', 'Webhook organization could not be resolved.', req.body);
      const error = new Error('Webhook organization could not be resolved.');
      error.statusCode = 400;
      throw error;
    }

    // Validate signature if an integration was found
    if (resolved.integration) {
      const callbackType = payment.provider === 'mpesa' ? 'c2b' : 'bank';
      const validation = validateWebhookSignature(req, resolved.integration, payment.provider, callbackType);
      if (!validation.valid) {
        await logSystemError(pgDb, resolved.orgId, 'payment_webhook', `Signature validation failed: ${validation.reason}`, req.body);
        return res.status(200).json({ ResultCode: 1, ResultDesc: 'Rejected' });
      }
    }

    return processWebhookPayment(pgDb, req, res, payment, resolved.orgId, resolved.integration, payment.provider.toUpperCase());
  }));

  return router;
}
