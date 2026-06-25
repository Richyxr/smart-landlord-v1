import express from 'express';
import bcrypt from 'bcryptjs';

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
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

function requireSuperAdminContext(req, res, next) {
  const { userId, role } = getContext(req);

  if (!userId || role !== 'super_admin') {
    return res.status(403).json({
      error: 'SUPER_ADMIN_REQUIRED',
      message: 'Super admin access is required.'
    });
  }

  next();
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createSaasBillingRoutes(pgDb, { demoMode = false, sessionSecret = null, sessionTtlSeconds = 86400, createSessionToken = null } = {}) {
  const router = express.Router();

  const reqDb = () => {
    return import('../db.js').then(m => m.db);
  };

  // =========================================================================
  // GET /api/saas/status
  // =========================================================================
  router.get('/saas/status', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    if (!orgId) {
      return res.status(400).json({ error: 'Missing organization ID.' });
    }

    let org;
    let activeTenantCount = 0;
    let pricePerTenant = 200;
    let invoices = [];

    if (pgDb) {
      org = await pgDb.findOne('organizations', { id: orgId });
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const tenantCountRes = await pgDb.query(
        `SELECT COUNT(*) as count 
         FROM tenants t 
         JOIN organizations o ON t.organization_id = o.id 
         WHERE t.organization_id = $1 
           AND t.status = 'active' 
           AND t.deleted_at IS NULL 
           AND o.status = 'active'`,
        [orgId]
      );
      activeTenantCount = parseInt(tenantCountRes.rows[0]?.count || '0');

      const settingsRes = await pgDb.query('SELECT price_per_active_tenant FROM platform_billing_settings ORDER BY id ASC LIMIT 1');
      if (settingsRes.rows.length > 0) {
        pricePerTenant = parseFloat(settingsRes.rows[0].price_per_active_tenant);
      }

      const invoicesRes = await pgDb.query(
        'SELECT * FROM platform_billing_invoices WHERE organization_id = $1 ORDER BY id DESC',
        [orgId]
      );
      invoices = invoicesRes.rows;
    } else {
      const localDb = await reqDb();
      org = localDb.findOne('organizations', { id: orgId });
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const activeTenants = localDb.find('tenants', { organization_id: orgId, status: 'active', deleted_at: null });
      activeTenantCount = (org.status === 'active') ? activeTenants.length : 0;

      const settings = localDb.findOne('platform_billing_settings', { id: 1 }) || { price_per_active_tenant: 200 };
      pricePerTenant = settings.price_per_active_tenant;

      invoices = localDb.find('platform_billing_invoices', { organization_id: orgId })
        .sort((a, b) => b.id - a.id);
    }

    if (demoMode && org) {
      org = {
        ...org,
        is_locked: false,
        subscription_status: org.subscription_status || 'active'
      };
    }

    res.json({
      organization: org,
      active_tenants: activeTenantCount,
      price_per_active_tenant: pricePerTenant,
      invoices
    });
  }));

  // =========================================================================
  // POST /api/saas/pay
  // =========================================================================
  router.post('/saas/pay', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const { invoice_id, phone_number } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ error: 'Missing invoice_id.' });
    }

    let invoice;
    if (pgDb) {
      invoice = await pgDb.findOne('platform_billing_invoices', { id: parseInt(invoice_id), organization_id: orgId });
    } else {
      const localDb = await reqDb();
      invoice = localDb.findOne('platform_billing_invoices', { id: parseInt(invoice_id), organization_id: orgId });
    }

    if (!invoice) return res.status(404).json({ error: 'SaaS invoice not found' });

    const checkoutRequestId = `ws_CO_${Date.now()}_${Math.floor(100000 + Math.random() * 900000)}`;

    let payment;
    if (pgDb) {
      payment = await pgDb.insert('platform_billing_payments', {
        organization_id: orgId,
        billing_invoice_id: invoice.id,
        amount: invoice.total,
        currency: invoice.billing_currency,
        payment_method: 'mpesa',
        reference_number: checkoutRequestId,
        status: 'pending',
        confirmed_by: null,
        confirmed_at: null
      });
    } else {
      const localDb = await reqDb();
      payment = localDb.insert('platform_billing_payments', {
        organization_id: orgId,
        billing_invoice_id: invoice.id,
        amount: invoice.total,
        currency: invoice.billing_currency,
        payment_method: 'mpesa',
        reference_number: checkoutRequestId,
        status: 'pending',
        confirmed_by: null,
        confirmed_at: null
      });
    }

    // Simulate callback hook in development/demo
    if (process.env.NODE_ENV !== 'production') {
      setTimeout(async () => {
        try {
          const mpesaReceipt = `NL${Math.floor(100000 + Math.random() * 900000).toString(36).toUpperCase()}`;
          const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);

          const payload = {
            Body: {
              stkCallback: {
                MerchantRequestID: `MR-${Math.floor(1000 + Math.random() * 9000)}`,
                CheckoutRequestID: checkoutRequestId,
                ResultCode: 0,
                ResultDesc: 'The service request is processed successfully.',
                CallbackMetadata: {
                  Item: [
                    { Name: 'Amount', Value: invoice.total },
                    { Name: 'MpesaReceiptNumber', Value: mpesaReceipt },
                    { Name: 'TransactionDate', Value: timestamp },
                    { Name: 'PhoneNumber', Value: phone_number || '254700000000' }
                  ]
                }
              }
            }
          };

          const protocol = req.secure ? 'https' : 'http';
          const host = req.get('host');
          await fetch(`${protocol}://${host}/api/webhooks/mpesa/stk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (err) {
          console.error('Failed to trigger simulated STK push callback:', err);
        }
      }, 2000);
    }

    res.json({
      success: true,
      paymentId: payment.id,
      checkoutRequestId,
      message: 'STK push initiated successfully. Awaiting payment confirmation webhook.'
    });
  }));

  // =========================================================================
  // POST /api/saas/trigger-bill-run (Dev only, 404 in production)
  // =========================================================================
  router.post('/saas/trigger-bill-run', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Not Found' });
    }

    const { orgId } = getContext(req);
    const { userId } = getContext(req);

    if (!orgId) {
      return res.status(400).json({ error: 'Missing organization ID.' });
    }

    let activeTenantCount = 0;
    let pricePerTenant = 200;
    let gracePeriodDays = 7;

    if (pgDb) {
      const tenantCountRes = await pgDb.query(
        `SELECT COUNT(*) as count 
         FROM tenants t 
         JOIN organizations o ON t.organization_id = o.id 
         WHERE t.organization_id = $1 
           AND t.status = 'active' 
           AND t.deleted_at IS NULL 
           AND o.status = 'active'`,
        [orgId]
      );
      activeTenantCount = parseInt(tenantCountRes.rows[0]?.count || '0');

      const settingsRes = await pgDb.query('SELECT price_per_active_tenant, grace_period_days FROM platform_billing_settings ORDER BY id ASC LIMIT 1');
      if (settingsRes.rows.length > 0) {
        pricePerTenant = parseFloat(settingsRes.rows[0].price_per_active_tenant);
        gracePeriodDays = parseInt(settingsRes.rows[0].grace_period_days);
      }
    } else {
      const localDb = await reqDb();
      const org = localDb.findOne('organizations', { id: orgId });
      const activeTenants = localDb.find('tenants', { organization_id: orgId, status: 'active', deleted_at: null });
      activeTenantCount = (org && org.status === 'active') ? activeTenants.length : 0;

      const settings = localDb.findOne('platform_billing_settings', { id: 1 }) || { price_per_active_tenant: 200, grace_period_days: 7 };
      pricePerTenant = settings.price_per_active_tenant;
      gracePeriodDays = settings.grace_period_days;
    }

    const subtotal = activeTenantCount * pricePerTenant;
    const tax = subtotal * 0.16;
    const total = subtotal + tax;

    const billingPeriodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const billingPeriodEnd = new Date().toISOString();
    const issuedAt = new Date(Date.now() - (gracePeriodDays + 1) * 24 * 60 * 60 * 1000).toISOString();
    const dueAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const invoiceNumber = `PLAT-INV-${Date.now().toString().substring(7)}`;

    let invoice;
    if (pgDb) {
      const existing = await pgDb.findOne('platform_billing_invoices', {
        organization_id: orgId,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd
      });

      if (existing) {
        invoice = existing;
      } else {
        invoice = await pgDb.insert('platform_billing_invoices', {
          organization_id: orgId,
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
          billing_currency: 'KES',
          active_tenant_count: activeTenantCount,
          price_per_active_tenant: pricePerTenant,
          subtotal,
          tax_amount: tax,
          total,
          status: 'overdue',
          issued_at: issuedAt,
          due_at: dueAt,
          paid_at: null,
          invoice_number: invoiceNumber
        });
      }

      await pgDb.update('organizations', orgId, {
        is_locked: true,
        subscription_status: 'overdue'
      });

      await pgDb.insert('system_audit_logs', {
        admin_user_id: null,
        target_organization_id: orgId,
        action: 'saas_billing_lockout',
        reason: 'Account locked out due to unpaid SaaS invoice.',
        metadata: { invoice_id: invoice.id }
      });

      await pgDb.insert('notifications', {
        organization_id: orgId,
        user_id: userId || 2,
        type: 'BILLING_ALERT',
        priority: 'critical',
        title: 'Account Locked: Billing Outstanding',
        body: `Your platform subscription invoice of KES ${total} is overdue. Pay to restore account access.`,
        action_url: '/saas-billing',
        is_read: false
      });
    } else {
      const localDb = await reqDb();
      const existing = localDb.findOne('platform_billing_invoices', {
        organization_id: orgId,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd
      });

      if (existing) {
        invoice = existing;
      } else {
        invoice = localDb.insert('platform_billing_invoices', {
          organization_id: orgId,
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
          billing_currency: 'KES',
          active_tenant_count: activeTenantCount,
          price_per_active_tenant: pricePerTenant,
          subtotal,
          tax_amount: tax,
          total,
          status: 'overdue',
          issued_at: issuedAt,
          due_at: dueAt,
          paid_at: null,
          invoice_number: invoiceNumber
        });
      }

      localDb.update('organizations', orgId, {
        is_locked: true,
        subscription_status: 'overdue'
      });

      localDb.insert('system_audit_logs', {
        admin_user_id: null,
        target_organization_id: orgId,
        action: 'saas_billing_lockout',
        reason: 'Account locked out due to unpaid SaaS invoice.',
        metadata: JSON.stringify({ invoice_id: invoice.id })
      });

      localDb.insert('notifications', {
        organization_id: orgId,
        user_id: userId || 2,
        type: 'BILLING_ALERT',
        priority: 'critical',
        title: 'Account Locked: Billing Outstanding',
        body: `Your platform subscription invoice of KES ${total} is overdue. Pay to restore account access.`,
        action_url: '/saas-billing',
        is_read: false
      });
    }

    res.json(invoice);
  }));

  // =========================================================================
  // GET /api/admin/stats (Super Admin stats dashboard)
  // =========================================================================
  router.get('/admin/stats', requireSuperAdminContext, asyncHandler(async (req, res) => {
    if (pgDb) {
      const totalOrgsRes = await pgDb.query("SELECT COUNT(*) AS count FROM organizations WHERE status <> 'deleted'");
      const activeOrgsRes = await pgDb.query("SELECT COUNT(*) AS count FROM organizations WHERE status = 'active'");
      const lockedOrgsRes = await pgDb.query("SELECT COUNT(*) AS count FROM organizations WHERE is_locked = true AND status <> 'deleted'");
      const activeTenantsRes = await pgDb.query("SELECT COUNT(*) AS count FROM tenants WHERE status = 'active' AND deleted_at IS NULL");
      
      const revenueRes = await pgDb.query("SELECT COALESCE(SUM(total), 0) AS total FROM platform_billing_invoices WHERE status = 'paid'");
      const pendingRes = await pgDb.query("SELECT COUNT(*) AS count FROM platform_billing_payments WHERE status = 'pending'");
      const errorsRes = await pgDb.query("SELECT COUNT(*) AS count FROM system_errors WHERE status = 'open'");

      res.json({
        total_organizations: toFiniteNumber(totalOrgsRes.rows[0]?.count),
        active_organizations: toFiniteNumber(activeOrgsRes.rows[0]?.count),
        locked_organizations: toFiniteNumber(lockedOrgsRes.rows[0]?.count),
        total_active_tenants: toFiniteNumber(activeTenantsRes.rows[0]?.count),
        monthly_saas_revenue: toFiniteNumber(revenueRes.rows[0]?.total),
        pending_confirmations: toFiniteNumber(pendingRes.rows[0]?.count),
        system_errors_count: toFiniteNumber(errorsRes.rows[0]?.count)
      });
    } else {
      const localDb = await reqDb();
      const orgs = localDb.get('organizations');
      const tenants = localDb.get('tenants');
      const errors = localDb.get('system_errors');
      const invoices = localDb.get('platform_billing_invoices');
      const payments = localDb.get('platform_billing_payments');

      const paidRevenue = invoices
        .filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + toFiniteNumber(i?.total), 0);

      res.json({
        total_organizations: toFiniteNumber(orgs.length),
        active_organizations: toFiniteNumber(orgs.filter(o => o.status === 'active').length),
        locked_organizations: toFiniteNumber(orgs.filter(o => o.is_locked).length),
        total_active_tenants: toFiniteNumber(tenants.filter(t => t.status === 'active' && !t.deleted_at).length),
        monthly_saas_revenue: toFiniteNumber(paidRevenue),
        pending_confirmations: toFiniteNumber(payments.filter(p => p.status === 'pending').length),
        system_errors_count: toFiniteNumber(errors.filter(e => e.status === 'open').length)
      });
    }
  }));

  // =========================================================================
  // GET /api/admin/organizations (Super Admin organizations details)
  // =========================================================================
  router.get('/admin/organizations', requireSuperAdminContext, asyncHandler(async (req, res) => {
    if (pgDb) {
      const result = await pgDb.query(
        `SELECT o.*, COALESCE(t.cnt, 0)::integer as active_tenant_count
         FROM organizations o
         LEFT JOIN (
           SELECT organization_id, COUNT(*) as cnt 
           FROM tenants 
           WHERE status = 'active' AND deleted_at IS NULL 
           GROUP BY organization_id
         ) t ON o.id = t.organization_id
         WHERE o.status <> 'deleted'
         ORDER BY o.id`
      );
      res.json(result.rows);
    } else {
      const localDb = await reqDb();
      const orgs = localDb.get('organizations').filter(o => o.status !== 'deleted');
      const tenants = localDb.get('tenants');

      const detailed = orgs.map(o => {
        const activeT = tenants.filter(t => t.organization_id === o.id && t.status === 'active' && !t.deleted_at).length;
        return {
          ...o,
          active_tenant_count: activeT
        };
      });
      res.json(detailed);
    }
  }));

  // =========================================================================
  // GET /api/admin/platform-payments
  // =========================================================================
  router.get('/admin/platform-payments', requireSuperAdminContext, asyncHandler(async (req, res) => {
    let payments = [];
    if (pgDb) {
      const result = await pgDb.query(
        `SELECT p.*, o.name as organization_name
         FROM platform_billing_payments p
         JOIN organizations o ON p.organization_id = o.id
         ORDER BY p.id DESC`
      );
      payments = result.rows;
    } else {
      const localDb = await reqDb();
      const rawPayments = localDb.get('platform_billing_payments');
      const orgs = localDb.get('organizations');
      payments = rawPayments.map(p => {
        const org = orgs.find(o => o.id === p.organization_id);
        return {
          ...p,
          organization_name: org ? org.name : 'Unknown Organization'
        };
      }).sort((a, b) => b.id - a.id);
    }

    res.json(payments);
  }));

  // =========================================================================
  // POST /api/admin/confirm-payment
  // =========================================================================
  router.post('/admin/confirm-payment', requireSuperAdminContext, asyncHandler(async (req, res) => {
    const { payment_id } = req.body;
    const { userId: adminId } = getContext(req);

    if (!payment_id) {
      return res.status(400).json({ error: 'Missing payment_id.' });
    }

    let payment;
    if (pgDb) {
      payment = await pgDb.findOne('platform_billing_payments', { id: parseInt(payment_id) });
    } else {
      const localDb = await reqDb();
      payment = localDb.findOne('platform_billing_payments', { id: parseInt(payment_id) });
    }

    if (!payment) return res.status(404).json({ error: 'Payment record not found.' });

    if (pgDb) {
      await pgDb.update('platform_billing_payments', parseInt(payment.id), {
        status: 'confirmed',
        confirmed_by: adminId,
        confirmed_at: new Date().toISOString()
      });

      await pgDb.update('platform_billing_invoices', parseInt(payment.billing_invoice_id), {
        status: 'paid',
        paid_at: new Date().toISOString()
      });

      const org = await pgDb.findOne('organizations', { id: parseInt(payment.organization_id) });
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

      await pgDb.update('organizations', parseInt(payment.organization_id), {
        is_locked: false,
        subscription_status: 'active',
        subscription_expires_at: newExpires
      });

      await pgDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        target_organization_id: payment.organization_id,
        action: 'saas_payment_confirmed_manually',
        reason: `Confirmed bank pay ref: ${payment.reference_number}`,
        metadata: { payment_id: payment.id }
      });
    } else {
      const localDb = await reqDb();
      localDb.update('platform_billing_payments', payment.id, {
        status: 'confirmed',
        confirmed_by: adminId,
        confirmed_at: new Date().toISOString()
      });

      localDb.update('platform_billing_invoices', payment.billing_invoice_id, {
        status: 'paid',
        paid_at: new Date().toISOString()
      });

      const org = localDb.findOne('organizations', { id: payment.organization_id });
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

      localDb.update('organizations', payment.organization_id, {
        is_locked: false,
        subscription_status: 'active',
        subscription_expires_at: newExpires
      });

      localDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        target_organization_id: payment.organization_id,
        action: 'saas_payment_confirmed_manually',
        reason: `Confirmed bank pay ref: ${payment.reference_number}`,
        metadata: JSON.stringify({ payment_id: payment.id })
      });
    }

    res.json({ success: true, message: 'Payment confirmed successfully. Organization unlocked.' });
  }));

  // =========================================================================
  // POST /api/admin/pricing
  // =========================================================================
  router.post('/admin/pricing', requireSuperAdminContext, asyncHandler(async (req, res) => {
    const { price_per_active_tenant, grace_period_days } = req.body;
    const { userId: adminId } = getContext(req);

    if (price_per_active_tenant === undefined || grace_period_days === undefined) {
      return res.status(400).json({ error: 'Missing price_per_active_tenant or grace_period_days.' });
    }

    const parsedPricePerTenant = Number(price_per_active_tenant);
    const parsedGracePeriodDays = Number(grace_period_days);

    if (!Number.isFinite(parsedPricePerTenant) || parsedPricePerTenant < 0) {
      return res.status(400).json({ error: 'price_per_active_tenant must be a finite number greater than or equal to 0.' });
    }

    if (!Number.isFinite(parsedGracePeriodDays) || !Number.isInteger(parsedGracePeriodDays) || parsedGracePeriodDays < 0) {
      return res.status(400).json({ error: 'grace_period_days must be a finite integer greater than or equal to 0.' });
    }

    let updated;
    if (pgDb) {
      const result = await pgDb.query(
        `UPDATE platform_billing_settings
         SET price_per_active_tenant = $1,
             grace_period_days = $2,
             updated_at = now()
         WHERE id = 1
         RETURNING *`,
        [parsedPricePerTenant, parsedGracePeriodDays]
      );
      updated = result.rows[0];

      await pgDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        action: 'changed_pricing_settings',
        reason: 'Admin price adjustment',
        metadata: updated
      });
    } else {
      const localDb = await reqDb();
      const resUpdated = localDb.update('platform_billing_settings', 1, {
        price_per_active_tenant: parsedPricePerTenant,
        grace_period_days: parsedGracePeriodDays,
        updated_at: new Date().toISOString()
      });
      updated = resUpdated[0];

      localDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        action: 'changed_pricing_settings',
        reason: 'Admin price adjustment',
        metadata: JSON.stringify(updated)
      });
    }

    res.json(updated);
  }));

  // =========================================================================
  // POST /api/admin/impersonate/start
  // =========================================================================
  router.post('/admin/impersonate/start', requireSuperAdminContext, asyncHandler(async (req, res) => {
    const { organization_id, reason } = req.body;
    const { userId: adminId } = getContext(req);

    if (!organization_id || !reason) {
      return res.status(400).json({ error: 'Missing organization target or access reason.' });
    }

    let session;
    let targetOrg;
    let owner;

    if (pgDb) {
      session = await pgDb.insert('support_access_sessions', {
        admin_user_id: adminId,
        target_organization_id: parseInt(organization_id),
        reason,
        started_at: new Date().toISOString(),
        ended_at: null,
        status: 'active'
      });

      await pgDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        target_organization_id: parseInt(organization_id),
        action: 'impersonation_started',
        reason,
        impersonation_session_id: session.id,
        metadata: { ip: '127.0.0.1' }
      });

      targetOrg = await pgDb.findOne('organizations', { id: parseInt(organization_id) });
      owner = await pgDb.findOne('users', { id: targetOrg.owner_user_id });
    } else {
      const localDb = await reqDb();
      session = localDb.insert('support_access_sessions', {
        admin_user_id: adminId,
        target_organization_id: parseInt(organization_id),
        reason,
        started_at: new Date().toISOString(),
        ended_at: null,
        status: 'active'
      });

      localDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        target_organization_id: parseInt(organization_id),
        action: 'impersonation_started',
        reason,
        impersonation_session_id: session.id,
        metadata: JSON.stringify({ ip: '127.0.0.1' })
      });

      targetOrg = localDb.findOne('organizations', { id: parseInt(organization_id) });
      owner = localDb.findOne('users', { id: targetOrg.owner_user_id });
    }

    if (!owner) return res.status(404).json({ error: 'Target owner user not found.' });

    const authToken = createSessionToken ? createSessionToken(owner, 'landlord', targetOrg) : null;

    res.json({
      session,
      targetOrg,
      ownerUser: owner,
      auth_token: authToken
    });
  }));

  // =========================================================================
  // POST /api/admin/impersonate/stop
  // =========================================================================
  router.post('/api/admin/impersonate/stop', requireSuperAdminContext, asyncHandler(async (req, res) => {
    const { session_id } = req.body;
    const { userId: adminId } = getContext(req);

    if (!session_id) return res.status(400).json({ error: 'Missing session_id.' });

    let session;
    if (pgDb) {
      session = await pgDb.findOne('support_access_sessions', { id: parseInt(session_id) });
      if (!session) return res.status(404).json({ error: 'Session not found' });

      await pgDb.update('support_access_sessions', parseInt(session.id), {
        status: 'completed',
        ended_at: new Date().toISOString()
      });

      await pgDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        target_organization_id: session.target_organization_id,
        action: 'impersonation_ended',
        reason: 'Completed support session',
        impersonation_session_id: session.id,
        metadata: null
      });
    } else {
      const localDb = await reqDb();
      session = localDb.findOne('support_access_sessions', { id: parseInt(session_id) });
      if (!session) return res.status(404).json({ error: 'Session not found' });

      localDb.update('support_access_sessions', session.id, {
        status: 'completed',
        ended_at: new Date().toISOString()
      });

      localDb.insert('system_audit_logs', {
        admin_user_id: adminId,
        target_organization_id: session.target_organization_id,
        action: 'impersonation_ended',
        reason: 'Completed support session',
        impersonation_session_id: session.id,
        metadata: null
      });
    }

    res.json({ success: true });
  }));

  // =========================================================================
  // GET /api/admin/system-audits
  // =========================================================================
  router.get('/admin/system-audits', requireSuperAdminContext, asyncHandler(async (req, res) => {
    if (pgDb) {
      const result = await pgDb.query(
        `SELECT a.*, o.name as org_name
         FROM system_audit_logs a
         LEFT JOIN organizations o ON a.target_organization_id = o.id
         ORDER BY a.created_at DESC`
      );
      res.json(result.rows);
    } else {
      const localDb = await reqDb();
      const audits = localDb.get('system_audit_logs');
      const orgs = localDb.get('organizations');
      const detailed = audits.map(a => {
        const org = orgs.find(o => o.id === a.target_organization_id);
        return {
          ...a,
          org_name: org ? org.name : 'Platform-Wide'
        };
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      res.json(detailed);
    }
  }));

  // =========================================================================
  // GET /api/admin/system-errors
  // =========================================================================
  router.get('/admin/system-errors', requireSuperAdminContext, asyncHandler(async (req, res) => {
    if (pgDb) {
      const result = await pgDb.query('SELECT * FROM system_errors ORDER BY created_at DESC');
      res.json(result.rows);
    } else {
      const localDb = await reqDb();
      const errors = localDb.get('system_errors')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      res.json(errors);
    }
  }));

  return router;
}

