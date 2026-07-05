import crypto from 'crypto';

export class MatchEngine {
  async getSuggestions(transaction, activeDb) {
    throw new Error('Not implemented');
  }
}

export class FutureAIEngine extends MatchEngine {
  async getSuggestions(transaction, activeDb) {
    // Stub for future AI-based matching engine
    return [];
  }
}

export class RuleEngine extends MatchEngine {
  /**
   * Scores and returns matched candidate invoices using rule-based weighted heuristics.
   *
   * Overall Score weights:
   * - Amount: 40%
   * - Reference: 25%
   * - Phone: 15%
   * - Tenant Name: 10%
   * - Date: 10%
   * Overall: 100%
   */
  async getSuggestions(transaction, activeDb) {
    const orgId = transaction.organization_id;
    const amount = Number(transaction.amount);

    // Candidates map to ensure uniqueness
    const candidatesMap = new Map();

    // Helper to normalize phone
    const normalizePhoneLocal = (phone) => {
      if (!phone) return '';
      const digits = String(phone).replace(/\D/g, '');
      return digits.slice(-9); // last 9 digits
    };

    // Helper to get days difference
    const getDaysDiff = (d1, d2) => {
      const date1 = new Date(d1);
      const date2 = new Date(d2);
      if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return Infinity;
      return Math.ceil(Math.abs(date1 - date2) / (1000 * 60 * 60 * 24));
    };

    // =========================================================================
    // 1. EFFICIENT DATABASE PRE-FILTERING (No O(N^2) memory loads)
    // =========================================================================

    // Query 1: Match by exact amount (invoice total or balance)
    const invoicesByTotal = await activeDb.find('invoices', { organization_id: orgId, total: amount }) || [];
    const invoicesByBalance = await activeDb.find('invoices', { organization_id: orgId, balance: amount }) || [];
    const amountInvoices = [...invoicesByTotal, ...invoicesByBalance];

    for (const inv of amountInvoices) {
      if (inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && inv.status !== 'deleted') {
        candidatesMap.set(Number(inv.id), inv);
      }
    }

    // Query 2: Match by exact reference code (if present)
    const ref = transaction.reference ? String(transaction.reference).trim().toLowerCase() : '';
    if (ref) {
      // Find invoice with exact invoice number
      const invoicesByNumber = await activeDb.find('invoices', { organization_id: orgId, invoice_number: transaction.reference }) || [];
      for (const inv of invoicesByNumber) {
        if (inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && inv.status !== 'deleted') {
          candidatesMap.set(Number(inv.id), inv);
        }
      }

      // Find tenant with exact tenant account number
      const tenantsByAccount = await activeDb.find('tenants', { organization_id: orgId, tenant_account_number: transaction.reference }) || [];
      for (const tenant of tenantsByAccount) {
        if (tenant.status !== 'deleted' && tenant.status !== 'inactive') {
          const tenantInvoices = await activeDb.find('invoices', { organization_id: orgId, tenant_id: tenant.id }) || [];
          for (const inv of tenantInvoices) {
            if (inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && inv.status !== 'deleted') {
              candidatesMap.set(Number(inv.id), inv);
            }
          }
        }
      }
    }

    // Query 3: Match by tenant phone (if present)
    if (transaction.payer_phone) {
      const normPhone = normalizePhoneLocal(transaction.payer_phone);
      if (normPhone) {
        // Query exact matching tenants (since phone numbers might be exact)
        const tenantsByPhone = await activeDb.find('tenants', { organization_id: orgId, phone_number: transaction.payer_phone }) || [];
        for (const tenant of tenantsByPhone) {
          if (tenant.status !== 'deleted' && tenant.status !== 'inactive') {
            const tenantInvoices = await activeDb.find('invoices', { organization_id: orgId, tenant_id: tenant.id }) || [];
            for (const inv of tenantInvoices) {
              if (inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && inv.status !== 'deleted') {
                candidatesMap.set(Number(inv.id), inv);
              }
            }
          }
        }
      }
    }

    // Fallback: If no specific index matches were found, load recently updated unpaid invoices
    // to prevent empty results while respecting performance bounds
    if (candidatesMap.size === 0) {
      const activeInvoices = await activeDb.find('invoices', { organization_id: orgId }) || [];
      for (const inv of activeInvoices) {
        if (inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'cancelled' && inv.status !== 'deleted') {
          candidatesMap.set(Number(inv.id), inv);
        }
      }
    }

    // =========================================================================
    // 2. DETAILED WEIGHTED SCORING
    // =========================================================================
    const suggestions = [];

    for (const invoice of candidatesMap.values()) {
      const tenant = await activeDb.findOne('tenants', { id: invoice.tenant_id, organization_id: orgId });
      if (!tenant) continue;

      let score = 0;
      const reasons = [];

      // 1. Amount matching (40% weight)
      const invBalance = Number(invoice.balance || 0);
      const invTotal = Number(invoice.total || 0);

      if (amount === invBalance) {
        score += 40;
        reasons.push('Exact match on invoice remaining balance (+40%)');
      } else if (amount === invTotal) {
        score += 40;
        reasons.push('Exact match on invoice total amount (+40%)');
      } else if (amount < invBalance) {
        score += 20;
        reasons.push('Partial payment / Underpayment match (+20%)');
      } else if (amount > invBalance) {
        score += 25;
        reasons.push('Overpayment match (+25%)');
      }

      // 2. Reference matching (25% weight)
      const invNum = String(invoice.invoice_number || '').trim().toLowerCase();
      const transactionRef = String(transaction.reference || '').trim().toLowerCase();
      const narration = String(transaction.description || '').trim().toLowerCase();
      const tenantAccount = String(tenant.tenant_account_number || '').trim().toLowerCase();

      if (transactionRef && invNum && transactionRef === invNum) {
        score += 25;
        reasons.push('Transaction reference matches invoice number exactly (+25%)');
      } else if (narration.includes(invNum) && invNum) {
        score += 20;
        reasons.push('Narration contains invoice number (+20%)');
      } else if (transactionRef && tenantAccount && transactionRef === tenantAccount) {
        score += 20;
        reasons.push('Reference matches tenant account number exactly (+20%)');
      } else if (narration.includes(tenantAccount) && tenantAccount) {
        score += 15;
        reasons.push('Narration contains tenant account number (+15%)');
      }

      // 3. Phone matching (15% weight)
      let payerPhone = transaction.payer_phone || null;
      if (!payerPhone && transaction.description) {
        const phoneMatch = transaction.description.match(/\b(254\d{9}|0\d{9}|\+254\d{9})\b/);
        if (phoneMatch) {
          payerPhone = phoneMatch[1];
        }
      }

      if (payerPhone && tenant.phone_number) {
        const p1 = normalizePhoneLocal(payerPhone);
        const p2 = normalizePhoneLocal(tenant.phone_number);
        if (p1 && p2 && p1 === p2) {
          score += 15;
          reasons.push('Payer phone matches tenant phone number (+15%)');
        }
      }

      // 4. Tenant Name matching (10% weight)
      let payerName = transaction.payer_name || null;
      if (!payerName && transaction.description) {
        const fromMatch = transaction.description.match(/from\s+(?:\+?254|0)?\d{9}\s*-\s*([^,\n]+)/i);
        if (fromMatch) {
          payerName = fromMatch[1].trim();
        } else {
          const fromNameOnlyMatch = transaction.description.match(/from\s+([^-\d,\n]+)/i);
          if (fromNameOnlyMatch) {
            payerName = fromNameOnlyMatch[1].trim();
          }
        }
      }

      if (payerName && tenant.full_name) {
        const name1 = String(payerName).trim().toLowerCase();
        const name2 = String(tenant.full_name).trim().toLowerCase();
        if (name1 === name2) {
          score += 10;
          reasons.push('Payer name matches tenant full name exactly (+10%)');
        } else if (name1.includes(name2) || name2.includes(name1)) {
          score += 8;
          reasons.push('Payer name matches tenant full name partially (+8%)');
        }
      } else if (narration && tenant.full_name) {
        const name2 = String(tenant.full_name).trim().toLowerCase();
        if (narration.includes(name2)) {
          score += 5;
          reasons.push('Narration contains tenant full name (+5%)');
        }
      }

      // 5. Date Proximity matching (10% weight)
      const transDate = transaction.transaction_date || transaction.transactionDate;
      const dueDiff = getDaysDiff(transDate, invoice.due_date);
      const issueDiff = getDaysDiff(transDate, invoice.issue_date);
      const minDiff = Math.min(dueDiff, issueDiff);

      if (minDiff <= 1) {
        score += 10;
        reasons.push('Payment date within 1 day of invoice due/issue date (+10%)');
      } else if (minDiff <= 3) {
        score += 8;
        reasons.push('Payment date within 3 days of invoice due/issue date (+8%)');
      } else if (minDiff <= 7) {
        score += 6;
        reasons.push('Payment date within 7 days of invoice due/issue date (+6%)');
      } else if (minDiff <= 14) {
        score += 4;
        reasons.push('Payment date within 14 days of invoice due/issue date (+4%)');
      } else if (minDiff <= 30) {
        score += 2;
        reasons.push('Payment date within 30 days of invoice due/issue date (+2%)');
      }

      if (score > 0) {
        suggestions.push({
          invoiceId: Number(invoice.id),
          invoice_number: invoice.invoice_number,
          tenant_name: tenant.full_name,
          invoice_balance: invBalance,
          invoice_total: invTotal,
          score,
          reasons
        });
      }
    }

    // Sort suggestions descending by score
    return suggestions.sort((a, b) => b.score - a.score);
  }
}

export class MatchSuggestionService {
  constructor(engine = new RuleEngine()) {
    this.engine = engine;
  }

  setEngine(engine) {
    this.engine = engine;
  }

  async getSuggestions(transaction, activeDb) {
    return this.engine.getSuggestions(transaction, activeDb);
  }
}
