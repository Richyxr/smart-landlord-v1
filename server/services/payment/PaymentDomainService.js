import { AllocationEligibilityService } from './AllocationEligibilityService.js';

export class PaymentDomainService {
  constructor(dbWrapper) {
    this.db = dbWrapper;
  }

  async capturePayment(input) {
    const {
      organization_id,
      payer_type,
      payer_id,
      payer_name,
      payer_phone,
      source_type,
      source_id,
      source_hash,
      amount,
      currency = 'KES',
      received_at = new Date().toISOString(),
      description,
      reference,
      external_reference,
      provider,
      created_by_user_id,
      metadata_json = {}
    } = input;

    if (!organization_id) {
      throw new Error('organization_id is required.');
    }
    if (!payer_type || !['tenant', 'landlord', 'unknown', 'external'].includes(payer_type)) {
      throw new Error('Invalid payer_type.');
    }
    if (!source_type || !['manual', 'mpesa', 'bank_statement', 'card', 'cash', 'adjustment', 'wallet_credit'].includes(source_type)) {
      throw new Error('Invalid source_type.');
    }
    if (!amount || Number(amount) <= 0) {
      throw new Error('Payment amount must be positive.');
    }

    // Idempotency check:
    // organization_id, source_type, source_hash, external_reference, amount, received_at
    const existing = await this.detectDuplicatePayment({
      organization_id,
      source_type,
      source_hash,
      external_reference,
      amount,
      received_at
    });

    if (existing) {
      return existing; // returns existing payment to ensure idempotency
    }

    const newPayment = await this.db.insert('payments', {
      organization_id: Number(organization_id),
      payer_type,
      payer_id: payer_id ? Number(payer_id) : null,
      payer_name: payer_name || null,
      payer_phone: payer_phone || null,
      source_type,
      source_id: source_id ? Number(source_id) : null,
      source_hash: source_hash || null,
      amount: Number(amount),
      currency,
      received_at,
      verified_at: null,
      status: 'captured',
      allocation_status: 'unallocated',
      description: description || null,
      reference: reference || null,
      external_reference: external_reference || null,
      provider: provider || null,
      created_by_user_id: created_by_user_id ? Number(created_by_user_id) : null,
      metadata_json: typeof metadata_json === 'string' ? metadata_json : JSON.stringify(metadata_json)
    });

    return newPayment;
  }

  async verifyPayment(paymentId, orgId) {
    const payment = await this.db.findOne('payments', { id: Number(paymentId), organization_id: Number(orgId) });
    if (!payment) {
      throw new Error('Payment not found.');
    }
    const updatedList = await this.db.update('payments', payment.id, {
      status: 'verified',
      verified_at: new Date().toISOString()
    });
    return updatedList[0] || { ...payment, status: 'verified', verified_at: new Date().toISOString() };
  }

  async rejectPayment(paymentId, orgId, reason) {
    const payment = await this.db.findOne('payments', { id: Number(paymentId), organization_id: Number(orgId) });
    if (!payment) {
      throw new Error('Payment not found.');
    }
    const meta = typeof payment.metadata_json === 'string' ? JSON.parse(payment.metadata_json) : (payment.metadata_json || {});
    meta.rejection_reason = reason;

    const updatedList = await this.db.update('payments', payment.id, {
      status: 'rejected',
      metadata_json: JSON.stringify(meta)
    });
    return updatedList[0] || { ...payment, status: 'rejected', metadata_json: meta };
  }

  async detectDuplicatePayment(input) {
    const { organization_id, source_type, source_hash, external_reference, amount, received_at } = input;

    // Build filter criteria
    if (source_hash) {
      const match = await this.db.findOne('payments', { organization_id: Number(organization_id), source_hash });
      if (match) return match;
    }
    if (external_reference) {
      // Find payments with same external_ref, amount and received_at (exact or same day)
      const list = await this.db.find('payments', { organization_id: Number(organization_id), external_reference, amount: Number(amount) }) || [];
      if (list.length > 0) {
        if (received_at) {
          const targetDate = new Date(received_at).toDateString();
          const match = list.find(p => new Date(p.received_at).toDateString() === targetDate);
          if (match) return match;
        } else {
          return list[0];
        }
      }
    }
    return null;
  }

  async allocatePayment(input) {
    const {
      organization_id,
      payment_id,
      invoice_id,
      amount,
      allocated_by_user_id,
      allocation_source,
      decision_id,
      bank_transaction_id,
      notes,
      metadata_json = {}
    } = input;

    if (!payment_id || !invoice_id || !organization_id) {
      throw new Error('payment_id, invoice_id, and organization_id are required.');
    }
    if (!amount || Number(amount) <= 0) {
      throw new Error('Allocation amount must be positive.');
    }

    const isPostgres = !!this.db.pool;
    let client = null;
    let dbToUse = this.db;

    if (isPostgres) {
      client = await this.db.pool.connect();
      dbToUse = {
        query: (sql, params) => client.query(sql, params),
        findOne: async (table, filterObj) => {
          const keys = Object.keys(filterObj);
          const values = Object.values(filterObj);
          const whereClause = keys.length ? 'WHERE ' + keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ') : '';
          const res = await client.query(`SELECT * FROM "${table}" ${whereClause} ORDER BY id LIMIT 1`, values);
          return res.rows[0] || null;
        },
        find: async (table, filterObj) => {
          const keys = Object.keys(filterObj);
          const values = Object.values(filterObj);
          const whereClause = keys.length ? 'WHERE ' + keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ') : '';
          const res = await client.query(`SELECT * FROM "${table}" ${whereClause} ORDER BY id`, values);
          return res.rows;
        },
        insert: async (table, rowData) => {
          const entries = Object.entries(rowData || {}).filter(([, val]) => val !== undefined);
          const columns = entries.map(([key]) => `"${key}"`);
          const values = entries.map(([, val]) => val);
          const placeholders = values.map((_, i) => `$${i + 1}`);
          const res = await client.query(
            `INSERT INTO "${table}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
            values
          );
          return res.rows[0];
        },
        update: async (table, query, updates) => {
          const updateEntries = Object.entries(updates || {}).filter(([, val]) => val !== undefined);
          const setParts = [];
          const values = [];
          let index = 1;
          for (const [key, value] of updateEntries) {
            setParts.push(`"${key}" = $${index}`);
            values.push(value);
            index += 1;
          }
          if (!('updated_at' in updates) && ['payments', 'invoices', 'payment_allocations'].includes(table)) {
            setParts.push('updated_at = now()');
          }
          const filterObj = typeof query === 'number' ? { id: query } : query;
          const filterKeys = Object.keys(filterObj);
          const filterValues = Object.values(filterObj);
          const whereParts = filterKeys.map((k) => {
            const part = `"${k}" = $${index}`;
            index += 1;
            return part;
          });
          const res = await client.query(
            `UPDATE "${table}" SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')} RETURNING *`,
            [...values, ...filterValues]
          );
          return res.rows;
        }
      };
    }

    const originalDb = this.db;
    if (isPostgres) {
      await client.query('BEGIN');
    }

    try {
      this.db = dbToUse;

      // Lock row level in Postgres
      if (isPostgres) {
        await client.query('SELECT 1 FROM payments WHERE id = $1 FOR UPDATE', [Number(payment_id)]);
        await client.query('SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE', [Number(invoice_id)]);
      }

      // Idempotency: using payment_id, invoice_id, decision_id, bank_transaction_id, allocation_source
      const filter = {
        organization_id: Number(organization_id),
        payment_id: Number(payment_id),
        invoice_id: Number(invoice_id)
      };
      if (decision_id) filter.decision_id = Number(decision_id);
      if (bank_transaction_id) filter.bank_transaction_id = Number(bank_transaction_id);
      if (allocation_source) filter.allocation_source = allocation_source;

      const existing = await dbToUse.findOne('payment_allocations', filter);
      if (existing) {
        if (isPostgres) {
          await client.query('COMMIT');
        }
        return existing;
      }

      // Eligibility check immediately before mutation
      const eligibilityService = new AllocationEligibilityService(dbToUse);
      const eligibility = await eligibilityService.checkEligibility({
        organization_id,
        payment_id,
        invoice_id,
        amount,
        allocation_source,
        decision_id,
        bank_transaction_id
      });

      if (!eligibility.eligible) {
        throw new Error('Allocation eligibility failed: ' + eligibility.reasons.join('; '));
      }

      const payment = await dbToUse.findOne('payments', { id: Number(payment_id), organization_id: Number(organization_id) });
      const invoice = await dbToUse.findOne('invoices', { id: Number(invoice_id), organization_id: Number(organization_id) });
      const previousInvoiceBalance = Number(invoice.balance || 0);

      // Insert allocation
      const newAllocation = await dbToUse.insert('payment_allocations', {
        organization_id: Number(organization_id),
        payment_id: Number(payment_id),
        invoice_id: Number(invoice_id),
        transaction_id: payment.source_type === 'manual' ? payment.source_id : null,
        amount: Number(amount),
        amount_allocated: Number(amount),
        allocated_by: allocated_by_user_id ? Number(allocated_by_user_id) : null,
        allocated_by_user_id: allocated_by_user_id ? Number(allocated_by_user_id) : null,
        allocated_at: new Date().toISOString(),
        allocation_source: allocation_source || 'system',
        decision_id: decision_id ? Number(decision_id) : null,
        bank_transaction_id: bank_transaction_id ? Number(bank_transaction_id) : null,
        notes: notes || null,
        metadata_json: typeof metadata_json === 'string' ? metadata_json : JSON.stringify(metadata_json)
      });

      // Calculate new allocation status for payment
      const allocations = await dbToUse.find('payment_allocations', { organization_id: Number(organization_id), payment_id: Number(payment_id) }) || [];
      const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount || a.amount_allocated || 0), 0);
      let newAllocStatus = 'partially_allocated';
      if (totalAllocated >= Number(payment.amount)) {
        newAllocStatus = 'fully_allocated';
      } else if (totalAllocated === 0) {
        newAllocStatus = 'unallocated';
      }
      await dbToUse.update('payments', payment.id, { allocation_status: newAllocStatus });

      // Recompute invoice payment status and balance
      await this.recomputeInvoicePaymentState(invoice.id, organization_id);

      // Fetch updated invoice to find the new balance
      const updatedInvoice = await dbToUse.findOne('invoices', { id: invoice.id, organization_id: Number(organization_id) });
      const newInvoiceBalance = Number(updatedInvoice.balance || 0);

      // Mark bank decision as 'allocated'
      let resolvedDecisionId = decision_id ? Number(decision_id) : null;
      if (!resolvedDecisionId && bank_transaction_id) {
        const dec = await dbToUse.findOne('bank_reconciliation_decisions', {
          organization_id: Number(organization_id),
          bank_transaction_id: Number(bank_transaction_id),
          invoice_id: Number(invoice_id),
          status: 'pending'
        });
        if (dec) {
          resolvedDecisionId = dec.id;
        }
      }
      if (resolvedDecisionId) {
        await dbToUse.update('bank_reconciliation_decisions', resolvedDecisionId, { status: 'allocated' });
      }

      // Mark bank transaction status as 'Matched'
      if (bank_transaction_id) {
        await dbToUse.update('confirmed_statement_transactions', Number(bank_transaction_id), { status: 'Matched' });
      }

      // Log audit event in payment_allocation_audit_events
      await dbToUse.insert('payment_allocation_audit_events', {
        organization_id: Number(organization_id),
        user_id: allocated_by_user_id ? Number(allocated_by_user_id) : null,
        payment_id: Number(payment_id),
        invoice_id: Number(invoice_id),
        allocation_id: newAllocation.id,
        decision_id: resolvedDecisionId || null,
        bank_transaction_id: bank_transaction_id ? Number(bank_transaction_id) : null,
        previous_invoice_balance: previousInvoiceBalance,
        new_invoice_balance: newInvoiceBalance,
        allocated_amount: Number(amount),
        allocation_source: allocation_source || 'system',
        source_hash: payment.source_hash || null,
        action: 'allocate',
        metadata_json: {}
      });

      if (isPostgres) {
        await client.query('COMMIT');
      }

      return newAllocation;
    } catch (error) {
      if (isPostgres) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      this.db = originalDb;
      if (client) {
        client.release();
      }
    }
  }

  async getPaymentAllocationSummary(paymentId, orgId) {
    const allocations = await this.db.find('payment_allocations', { organization_id: Number(orgId), payment_id: Number(paymentId) }) || [];
    const payment = await this.db.findOne('payments', { id: Number(paymentId), organization_id: Number(orgId) });
    const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount || a.amount_allocated || 0), 0);
    return {
      payment_id: Number(paymentId),
      payment_amount: payment ? Number(payment.amount) : 0,
      total_allocated: totalAllocated,
      remaining_balance: payment ? Number(payment.amount) - totalAllocated : 0,
      allocations
    };
  }

  async getInvoicePaymentSummary(invoiceId, orgId) {
    const allocations = await this.db.find('payment_allocations', { organization_id: Number(orgId), invoice_id: Number(invoiceId) }) || [];
    const state = await this.recomputeInvoicePaymentState(invoiceId, orgId);
    return {
      invoice_id: Number(invoiceId),
      invoice_state: state,
      allocations
    };
  }

  async recomputeInvoicePaymentState(invoiceId, orgId) {
    const invoice = await this.db.findOne('invoices', { id: Number(invoiceId), organization_id: Number(orgId) });
    if (!invoice) {
      throw new Error('Invoice not found.');
    }

    const allocations = await this.db.find('payment_allocations', { organization_id: Number(orgId), invoice_id: Number(invoiceId) }) || [];
    
    // Sum active/valid allocations (excluding those belonging to rejected/reversed/duplicate payments)
    let allocatedAmount = 0;
    for (const alloc of allocations) {
      let active = true;
      if (alloc.payment_id) {
        const payment = await this.db.findOne('payments', { id: Number(alloc.payment_id), organization_id: Number(orgId) });
        if (payment && ['rejected', 'reversed', 'duplicate'].includes(payment.status)) {
          active = false;
        }
      }
      if (active) {
        allocatedAmount += Number(alloc.amount || alloc.amount_allocated || 0);
      }
    }

    const total = Number(invoice.total || 0);
    const balance = Math.max(0, total - allocatedAmount);

    let paymentStatus = invoice.status; // default keep current status (e.g. draft, void, cancelled)
    if (balance <= 0) {
      paymentStatus = 'paid';
    } else if (allocatedAmount > 0 && balance > 0) {
      paymentStatus = 'partially_paid';
    } else if (allocatedAmount === 0) {
      // Revert paid/partially_paid status back to issued
      if (['paid', 'partially_paid'].includes(invoice.status)) {
        paymentStatus = 'issued';
      }
    }

    const updatedList = await this.db.update('invoices', invoice.id, {
      amount_paid: allocatedAmount,
      balance: balance,
      status: paymentStatus,
      updated_at: new Date().toISOString()
    });

    return updatedList[0] || {
      ...invoice,
      amount_paid: allocatedAmount,
      balance: balance,
      status: paymentStatus
    };
  }
}
