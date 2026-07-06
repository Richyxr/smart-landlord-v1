export class AllocationEligibilityService {
  constructor(dbWrapper) {
    this.db = dbWrapper;
  }

  async checkEligibility(input) {
    const {
      organization_id,
      payment_id,
      invoice_id,
      amount,
      allocation_source,
      decision_id,
      bank_transaction_id
    } = input;

    const orgId = Number(organization_id);
    const paymentId = Number(payment_id);
    const invoiceId = Number(invoice_id);

    const reasons = [];
    const warnings = [];
    const checks = {
      paymentExists: false,
      paymentVerifiedOrCaptured: false,
      paymentHasAvailableBalance: false,
      invoiceExists: false,
      sameOrganization: false,
      invoiceAllocatable: false,
      decisionValid: true, // defaults to true unless bank_reconciliation source checks fail
      notAlreadyAllocated: false,
      sourceHashUnused: true // defaults to true unless bank transaction checks fail
    };

    if (!orgId) {
      reasons.push('organization_id is required.');
      return { eligible: false, reasons, warnings, checks };
    }

    // 1. Fetch Payment
    const payment = await this.db.findOne('payments', { id: paymentId, organization_id: orgId });
    let availableBalance = 0;
    if (payment) {
      checks.paymentExists = true;
      
      const paymentStatus = String(payment.status || '').toLowerCase();
      if (['captured', 'verified'].includes(paymentStatus)) {
        checks.paymentVerifiedOrCaptured = true;
      } else {
        reasons.push(`Payment has invalid status: ${payment.status}.`);
      }

      // Calculate available balance
      const allocations = await this.db.find('payment_allocations', { organization_id: orgId, payment_id: paymentId }) || [];
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount || a.amount_allocated || 0), 0);
      availableBalance = Number(payment.amount) - totalAllocated;

      if (payment.allocation_status !== 'fully_allocated' && availableBalance > 0) {
        checks.paymentHasAvailableBalance = true;
      } else {
        reasons.push('Payment is already fully allocated or has no available balance.');
      }
    } else {
      reasons.push('Payment not found.');
    }

    // 2. Fetch Invoice
    const invoice = await this.db.findOne('invoices', { id: invoiceId, organization_id: orgId });
    let outstandingBalance = 0;
    if (invoice) {
      checks.invoiceExists = true;
      outstandingBalance = Number(invoice.balance || 0);

      if (payment && payment.organization_id === invoice.organization_id) {
        checks.sameOrganization = true;
      } else if (payment) {
        reasons.push('Payment and invoice belong to different organizations.');
      }

      const invStatus = String(invoice.status || '').toLowerCase();
      const isBlocked = ['void', 'cancelled', 'deleted'].includes(invStatus);
      if (!isBlocked && outstandingBalance > 0) {
        checks.invoiceAllocatable = true;
      } else {
        if (isBlocked) {
          reasons.push(`Invoice has void or cancelled status: ${invoice.status}.`);
        } else {
          reasons.push('Invoice already has zero outstanding balance.');
        }
      }
    } else {
      reasons.push('Invoice not found.');
    }

    // 3. Check Decision Valid (for bank_reconciliation)
    if (allocation_source === 'bank_reconciliation' || decision_id || bank_transaction_id) {
      if (decision_id) {
        const decision = await this.db.findOne('bank_reconciliation_decisions', { id: Number(decision_id), organization_id: orgId });
        if (!decision) {
          checks.decisionValid = false;
          reasons.push('Matching decision not found.');
        } else if (decision.status !== 'pending') {
          checks.decisionValid = false;
          reasons.push(`Matching decision status is not pending: ${decision.status}.`);
        } else if (Number(decision.invoice_id) !== invoiceId) {
          checks.decisionValid = false;
          reasons.push('Matching decision is registered for a different invoice.');
        }
      } else if (bank_transaction_id) {
        // Find if there is a pending decision for this bank transaction
        const decision = await this.db.findOne('bank_reconciliation_decisions', { 
          organization_id: orgId,
          bank_transaction_id: Number(bank_transaction_id),
          invoice_id: invoiceId
        });
        if (!decision) {
          checks.decisionValid = false;
          reasons.push('No matching reconciliation decision found for this transaction and invoice.');
        } else if (decision.status !== 'pending') {
          checks.decisionValid = false;
          reasons.push(`Associated matching decision status is not pending: ${decision.status}.`);
        }
      }
    }

    // 4. Check Already Allocated (idempotency/duplicate allocation checks)
    if (checks.paymentExists && checks.invoiceExists) {
      const existingAlloc = await this.db.findOne('payment_allocations', {
        organization_id: orgId,
        payment_id: paymentId,
        invoice_id: invoiceId
      });
      if (!existingAlloc) {
        checks.notAlreadyAllocated = true;
      } else {
        reasons.push('This payment has already been allocated to this invoice.');
      }
    }

    // 5. Check Bank Transaction Source Hash Unused
    if (bank_transaction_id) {
      const existingBankAlloc = await this.db.findOne('payment_allocations', {
        organization_id: orgId,
        bank_transaction_id: Number(bank_transaction_id)
      });
      if (!existingBankAlloc) {
        // Verify bank transaction status
        const tx = await this.db.findOne('confirmed_statement_transactions', { id: Number(bank_transaction_id), organization_id: orgId });
        if (!tx) {
          checks.sourceHashUnused = false;
          reasons.push('Associated bank transaction not found.');
        } else if (!['Match Approved', 'Ready for Allocation'].includes(tx.status)) {
          checks.sourceHashUnused = false;
          reasons.push(`Bank transaction status must be Match Approved or Ready for Allocation, got: ${tx.status}.`);
        }
      } else {
        checks.sourceHashUnused = false;
        reasons.push('The bank transaction has already been allocated.');
      }
    }

    // 6. Validate Amount and Overpayment/Underpayment Limits
    if (amount !== undefined) {
      const allocAmt = Number(amount);
      if (isNaN(allocAmt) || allocAmt <= 0) {
        reasons.push('Allocation amount must be positive.');
      } else {
        if (allocAmt > availableBalance) {
          reasons.push(`Allocation amount (${allocAmt}) exceeds available payment balance (${availableBalance}).`);
        }
        if (allocAmt > outstandingBalance) {
          reasons.push(`Overpayment blocked: Allocation amount (${allocAmt}) exceeds invoice outstanding balance (${outstandingBalance}). Wallet credit is unsupported.`);
        } else if (allocAmt < outstandingBalance && allocAmt <= availableBalance) {
          warnings.push(`Underpayment: Allocation of KES ${allocAmt} is less than invoice outstanding balance of KES ${outstandingBalance}. Invoice status will remain partially paid.`);
        }
        if (payment && availableBalance - allocAmt > 0) {
          warnings.push(`Partial Allocation: KES ${availableBalance - allocAmt} will remain unallocated on the payment.`);
        }
      }
    }

    // Aggregate eligible flag
    const eligible =
      checks.paymentExists &&
      checks.paymentVerifiedOrCaptured &&
      checks.paymentHasAvailableBalance &&
      checks.invoiceExists &&
      checks.sameOrganization &&
      checks.invoiceAllocatable &&
      checks.decisionValid &&
      checks.notAlreadyAllocated &&
      checks.sourceHashUnused &&
      reasons.length === 0;

    return {
      eligible,
      reasons,
      warnings,
      checks
    };
  }
}
