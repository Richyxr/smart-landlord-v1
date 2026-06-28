import { PERSPECTIVES, STATUSES, EVIDENCE_STRENGTHS, MATCHER_WINDOWS } from './paymentEvidenceRules.js';

export function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-9); // Get last 9 digits (e.g. 712345678)
}

export function getDaysDifference(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return Infinity;
  const diffTime = Math.abs(d1.getTime() - d2.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Scores a payment evidence row against possible candidates (tenants, invoices, unmatched transactions)
 * and determines if it can be auto-reconciled or needs review.
 *
 * @param {Object} row - The normalized and classified payment evidence object.
 * @param {Object} activeDb - The active database client (supporting find).
 * @returns {Promise<Object>} The scored payment evidence object.
 */
export async function scorePaymentEvidenceMatch(row, activeDb) {
  if (!activeDb) {
    return row;
  }

  const result = { ...row };
  const orgId = result.organization_id;
  const candidates = [];

  // =========================================================================
  // 1. PRELOAD DATA TO AVOID N+1 QUERIES
  // =========================================================================
  const allTenants = await activeDb.find('tenants', { organization_id: orgId });
  const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');

  const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
  const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

  // Build O(1) in-memory lookup maps
  const tenantsById = new Map();
  const tenantsByAccount = new Map();
  const tenantsByPhone = new Map();

  for (const tenant of activeTenants) {
    tenantsById.set(tenant.id, tenant);

    if (tenant.tenant_account_number) {
      tenantsByAccount.set(tenant.tenant_account_number.toLowerCase(), tenant);
    }

    if (tenant.phone_number) {
      const norm = normalizePhone(tenant.phone_number);
      if (norm) {
        if (!tenantsByPhone.has(norm)) {
          tenantsByPhone.set(norm, []);
        }
        tenantsByPhone.get(norm).push(tenant);
      }
    }
  }

  const invoicesByTenantId = new Map();
  const invoicesByNumber = new Map();
  for (const inv of eligibleInvoices) {
    if (!invoicesByTenantId.has(inv.tenant_id)) {
      invoicesByTenantId.set(inv.tenant_id, []);
    }
    invoicesByTenantId.get(inv.tenant_id).push(inv);

    if (inv.invoice_number) {
      invoicesByNumber.set(inv.invoice_number.toLowerCase(), inv);
    }
  }

  // =========================================================================
  // 2. RUN MATCHERS
  // =========================================================================

  // --- MATCHER A: Transaction Code Match (unmatched transaction) ---
  if (result.transaction_code) {
    const unmatchedTxs = await activeDb.find('transactions', {
      organization_id: orgId,
      reference_number: result.transaction_code
    });

    const matchingTx = unmatchedTxs.find(tx =>
      (tx.status === 'unmatched' || tx.status === 'pending') &&
      tx.transaction_type === 'payment'
    );

    if (matchingTx) {
      candidates.push({
        type: 'transaction_code',
        strength: EVIDENCE_STRENGTHS.VERIFIED,
        confidence: 100,
        suggested_tenant_id: matchingTx.tenant_id,
        suggested_invoice_id: matchingTx.invoice_id,
        matched_transaction_id: matchingTx.id
      });
    }
  }

  // --- MATCHER B: Reference Account Match ---
  if (result.reference_account) {
    const tenant = tenantsByAccount.get(result.reference_account.toLowerCase());
    if (tenant) {
      const tenantInvoices = invoicesByTenantId.get(tenant.id) || [];
      for (const inv of tenantInvoices) {
        const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
        const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
        const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

        const isWithinWindow = (MATCHER_WINDOWS.REFERENCE_ACCOUNT_WINDOW === null) ||
          (dueDays <= MATCHER_WINDOWS.REFERENCE_ACCOUNT_WINDOW || issueDays <= MATCHER_WINDOWS.REFERENCE_ACCOUNT_WINDOW);

        if (isAmountMatch && isWithinWindow) {
          candidates.push({
            type: 'reference_account',
            strength: EVIDENCE_STRENGTHS.VERIFIED,
            confidence: 95,
            suggested_tenant_id: tenant.id,
            suggested_invoice_id: inv.id
          });
        }
      }
    }
  }

  // --- MATCHER C: Invoice Reference Match ---
  if (result.invoice_reference) {
    const inv = invoicesByNumber.get(result.invoice_reference.toLowerCase());
    if (inv) {
      const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
      const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
      const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

      const isWithinWindow = (MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW === null) ||
        (dueDays <= MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW || issueDays <= MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW);

      if (isAmountMatch && isWithinWindow) {
        candidates.push({
          type: 'invoice_reference',
          strength: EVIDENCE_STRENGTHS.VERIFIED,
          confidence: 95,
          suggested_tenant_id: inv.tenant_id,
          suggested_invoice_id: inv.id
        });
      }
    }
  }

  // --- MATCHER D: PayBill Reference Match ---
  if (result.paybill_reference) {
    // Check if paybill reference is an invoice number
    const inv = invoicesByNumber.get(result.paybill_reference.toLowerCase());
    if (inv) {
      const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
      const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
      const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

      const isWithinWindow = (MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW === null) ||
        (dueDays <= MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW || issueDays <= MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW);

      if (isAmountMatch && isWithinWindow) {
        candidates.push({
          type: 'paybill_reference',
          strength: EVIDENCE_STRENGTHS.VERIFIED,
          confidence: 95,
          suggested_tenant_id: inv.tenant_id,
          suggested_invoice_id: inv.id
        });
      }
    }

    // Check if paybill reference is a tenant account number
    const tenant = tenantsByAccount.get(result.paybill_reference.toLowerCase());
    if (tenant) {
      const tenantInvoices = invoicesByTenantId.get(tenant.id) || [];
      for (const inv of tenantInvoices) {
        const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
        const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
        const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

        const isWithinWindow = (MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW === null) ||
          (dueDays <= MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW || issueDays <= MATCHER_WINDOWS.PAYBILL_REFERENCE_WINDOW);

        if (isAmountMatch && isWithinWindow) {
          candidates.push({
            type: 'paybill_reference',
            strength: EVIDENCE_STRENGTHS.VERIFIED,
            confidence: 95,
            suggested_tenant_id: tenant.id,
            suggested_invoice_id: inv.id
          });
        }
      }
    }
  }

  // --- MATCHER E: Phone Match ---
  if (result.payer_phone) {
    const norm = normalizePhone(result.payer_phone);
    const matchedTenants = tenantsByPhone.get(norm) || [];
    for (const tenant of matchedTenants) {
      const tenantInvoices = invoicesByTenantId.get(tenant.id) || [];
      for (const inv of tenantInvoices) {
        const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
        const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
        const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

        const isWithinWindow = (MATCHER_WINDOWS.PHONE_MATCH_WINDOW === null) ||
          (dueDays <= MATCHER_WINDOWS.PHONE_MATCH_WINDOW || issueDays <= MATCHER_WINDOWS.PHONE_MATCH_WINDOW);

        if (isAmountMatch && isWithinWindow) {
          candidates.push({
            type: 'phone_match',
            strength: EVIDENCE_STRENGTHS.HIGH,
            confidence: 90,
            suggested_tenant_id: tenant.id,
            suggested_invoice_id: inv.id
          });
        }
      }
    }
  }

  // --- MATCHER F: Name Match ---
  if (result.payer_name) {
    const cleanedPayerName = result.payer_name.toLowerCase();
    // Substring name check
    const matchedTenants = activeTenants.filter(t =>
      t.full_name && (t.full_name.toLowerCase().includes(cleanedPayerName) || cleanedPayerName.includes(t.full_name.toLowerCase()))
    );

    for (const tenant of matchedTenants) {
      const tenantInvoices = invoicesByTenantId.get(tenant.id) || [];
      for (const inv of tenantInvoices) {
        const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
        const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
        const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

        const isWithinWindow = (MATCHER_WINDOWS.NAME_MATCH_WINDOW === null) ||
          (dueDays <= MATCHER_WINDOWS.NAME_MATCH_WINDOW || issueDays <= MATCHER_WINDOWS.NAME_MATCH_WINDOW);

        if (isAmountMatch && isWithinWindow) {
          candidates.push({
            type: 'name_match',
            strength: EVIDENCE_STRENGTHS.MEDIUM,
            confidence: 70,
            suggested_tenant_id: tenant.id,
            suggested_invoice_id: inv.id
          });
        }
      }
    }
  }

  // --- MATCHER G: Amount Only Match ---
  if (candidates.length === 0) {
    for (const inv of eligibleInvoices) {
      const isAmountMatch = Number(inv.balance) === result.amount || Number(inv.total) === result.amount;
      const dueDays = getDaysDifference(inv.due_date, result.transaction_date);
      const issueDays = getDaysDifference(inv.issue_date, result.transaction_date);

      const isWithinWindow = (MATCHER_WINDOWS.AMOUNT_ONLY_WINDOW === null) ||
        (dueDays <= MATCHER_WINDOWS.AMOUNT_ONLY_WINDOW || issueDays <= MATCHER_WINDOWS.AMOUNT_ONLY_WINDOW);

      if (isAmountMatch && isWithinWindow) {
        const tenant = tenantsById.get(inv.tenant_id);
        if (tenant) {
          candidates.push({
            type: 'amount_only',
            strength: EVIDENCE_STRENGTHS.LOW,
            confidence: 50,
            suggested_tenant_id: tenant.id,
            suggested_invoice_id: inv.id
          });
        }
      }
    }
  }

  // --- FUTURE MATCHERS PLACEHOLDERS ---
  // 1. Recipient Phone / Recipient Account Matching Check placeholder
  if (result.recipient_phone || result.recipient_account) {
    // Placeholder block: Recipient phone/account can match landlord records in future.
  }
  // 2. Till Number / Agent Number Matching Check placeholder
  if (result.till_number || result.agent_number) {
    // Placeholder block: Till/Agent can match property collection details in future.
  }
  // 3. Bank Reference / Landlord Account Number Matching Check placeholder
  if (result.bank_reference || result.landlord_account_number) {
    // Placeholder block: Bank reference / Account can match organizational bank settings.
  }

  // =========================================================================
  // 3. EVALUATE CANDIDATES
  // =========================================================================

  // Deduplicate candidates (keep the one with the highest confidence per unique tenant/invoice)
  const uniqueCandidatesMap = new Map();
  for (const c of candidates) {
    const key = `${c.suggested_tenant_id}_${c.suggested_invoice_id}`;
    if (!uniqueCandidatesMap.has(key) || uniqueCandidatesMap.get(key).confidence < c.confidence) {
      uniqueCandidatesMap.set(key, c);
    }
  }
  const uniqueCandidates = Array.from(uniqueCandidatesMap.values());

  if (uniqueCandidates.length === 0) {
    result.status = STATUSES.IMPORTED;
    result.confidence = 0;
    result.evidence_strength = EVIDENCE_STRENGTHS.UNKNOWN;
  } else if (uniqueCandidates.length === 1) {
    const candidate = uniqueCandidates[0];
    result.confidence = candidate.confidence;
    result.evidence_strength = candidate.strength;
    result.suggested_tenant_id = candidate.suggested_tenant_id || null;
    result.suggested_invoice_id = candidate.suggested_invoice_id || null;
    if (candidate.matched_transaction_id) {
      result.matched_transaction_id = candidate.matched_transaction_id;
    }

    // Auto-reconciliation eligibility:
    // ONLY VERIFIED match strengths can auto-reconcile, AND perspective must NOT be unknown.
    const isVerified = candidate.strength === EVIDENCE_STRENGTHS.VERIFIED;
    const isUnknownPerspective = result.source_perspective === PERSPECTIVES.UNKNOWN;
    const canAutoReconcile = isVerified && !isUnknownPerspective;

    if (canAutoReconcile) {
      result.status = STATUSES.AUTO_RECONCILED;
    } else {
      result.status = STATUSES.NEEDS_REVIEW; // Phone, name, amount-only match, and unknown perspective all go to Needs Review!
    }
  } else {
    // Competing candidates: force Needs Review
    result.status = STATUSES.NEEDS_REVIEW;

    // Sort by confidence descending
    const sorted = [...uniqueCandidates].sort((a, b) => b.confidence - a.confidence);
    const top = sorted[0];
    result.confidence = top.confidence;
    result.evidence_strength = top.strength;
    result.suggested_tenant_id = top.suggested_tenant_id || null;
    result.suggested_invoice_id = top.suggested_invoice_id || null;
    if (top.matched_transaction_id) {
      result.matched_transaction_id = top.matched_transaction_id;
    }
  }

  return result;
}
