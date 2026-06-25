import express from 'express';
import { NotificationService } from '../notificationService.js';
import { sendEmailWithConfig } from '../mailerService.js';
import { decryptConfig } from '../crypto.js';
import { maskSmtpConfig, normalizeSmtpConfig, validateSmtpConfig } from '../emailConfigService.js';

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

export function createNotificationRoutes(pgDb) {
  const router = express.Router();
  const notificationService = new NotificationService(pgDb);

  function requireLandlordOrAdmin(req, res, next) {
    const { role } = getContext(req);
    if (role === 'caretaker') {
      return res.status(403).json({
        error: 'ACCESS_DENIED',
        message: 'Caretakers cannot send SMS reminders.'
      });
    }
    if (!role) {
      return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }
    next();
  }

  // =========================================================================
  // POST /notifications/due-tenants/send-reminders
  // Send SMS reminders to one or more tenants by tenant_id.
  // Routes through the active configured SMS provider (Mobitech).
  // =========================================================================
  router.post('/notifications/due-tenants/send-reminders', requireAuthenticatedContext, requireLandlordOrAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { tenant_ids } = req.body;

    // --- Input validation ---
    if (!Array.isArray(tenant_ids) || tenant_ids.length === 0) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'tenant_ids must be a non-empty array of tenant IDs.'
      });
    }
    if (tenant_ids.length > 200) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Maximum 200 tenants can be messaged per request.'
      });
    }

    const parsedIds = tenant_ids.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    if (parsedIds.length === 0) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'No valid tenant IDs provided.'
      });
    }

    // --- Check SMS provider configured ---
    let settings = null;
    try {
      if (pgDb) {
        const settingsRes = await pgDb.query(
          'SELECT * FROM notification_settings WHERE organization_id = $1',
          [orgId]
        );
        settings = settingsRes.rows[0] || null;
      } else {
        const { db } = await import('../db.js');
        settings = db.findOne('notification_settings', { organization_id: orgId });
      }
    } catch (err) {
      console.error('[due-tenants/send-reminders] Failed to fetch notification settings:', err.message);
    }

    const smsProvider = settings?.sms_provider || 'None';
    if (!smsProvider || smsProvider === 'None') {
      return res.status(503).json({
        error: 'SMS_PROVIDER_NOT_CONFIGURED',
        message: 'No SMS provider is configured. Go to Settings → Integrations to set up Mobitech SMS before sending reminders.'
      });
    }

    // --- Fetch tenants, verifying org ownership ---
    let tenants = [];
    try {
      if (pgDb) {
        const result = await pgDb.query(
          `SELECT id, full_name, phone_number, rent_amount, billing_day, tenant_account_number
           FROM tenants
           WHERE organization_id = $1
             AND id = ANY($2::bigint[])
             AND deleted_at IS NULL
             AND status = 'active'`,
          [orgId, parsedIds]
        );
        tenants = result.rows;
      } else {
        const { db } = await import('../db.js');
        tenants = db.find('tenants', { organization_id: orgId, deleted_at: null })
          .filter(t => parsedIds.includes(t.id) && t.status === 'active');
      }
    } catch (err) {
      console.error('[due-tenants/send-reminders] Failed to fetch tenants:', err.message);
      return res.status(500).json({ error: 'Failed to fetch tenant records.' });
    }

    if (tenants.length === 0) {
      return res.status(400).json({
        error: 'NO_VALID_TENANTS',
        message: 'None of the provided tenant IDs matched active tenants in your organization.'
      });
    }

    // --- Compute tenant balances for overdue/reminder classification ---
    let balanceMap = new Map();
    try {
      if (pgDb) {
        const tenantIdList = tenants.map(t => t.id);
        const balRes = await pgDb.query(
          `SELECT tenant_id, COALESCE(SUM(balance) FILTER (WHERE status NOT IN ('paid','void')), 0)::numeric AS balance
           FROM invoices
           WHERE organization_id = $1
             AND tenant_id = ANY($2::bigint[])
           GROUP BY tenant_id`,
          [orgId, tenantIdList]
        );
        balRes.rows.forEach(row => balanceMap.set(row.tenant_id, Number(row.balance)));
      }
    } catch (err) {
      console.warn('[due-tenants/send-reminders] Could not compute balances, defaulting to 0:', err.message);
    }

    // --- Queue SMS for each tenant ---
    const results = [];
    let queued = 0;

    for (const tenant of tenants) {
      const balance = balanceMap.get(tenant.id) ?? 0;
      const notificationType = balance > 0 ? 'overdue_reminder' : 'rent_reminder';
      const today = new Date().toISOString().split('T')[0];

      try {
        const logRow = await notificationService.queue({
          organizationId: orgId,
          tenantId: tenant.id,
          channel: 'sms',
          type: notificationType,
          data: {
            invoice_number: 'N/A',
            balance: balance.toFixed(2),
            amount: Number(tenant.rent_amount || 0).toFixed(2),
            due_date: today,
            account_number: tenant.tenant_account_number || ''
          }
        });

        if (logRow) {
          queued++;
          results.push({ tenant_id: tenant.id, tenant_name: tenant.full_name, status: 'queued', log_id: logRow.id });
        } else {
          results.push({ tenant_id: tenant.id, tenant_name: tenant.full_name, status: 'skipped', reason: 'Blocked by notification settings or missing phone number.' });
        }
      } catch (err) {
        // Log without exposing credentials or sensitive details
        console.error(`[due-tenants/send-reminders] Failed to queue SMS for tenant ${tenant.id}:`, err.message);
        results.push({ tenant_id: tenant.id, tenant_name: tenant.full_name, status: 'skipped', reason: 'Send error — check notification logs.' });
      }
    }

    // Audit log
    try {
      if (pgDb) {
        await pgDb.logAudit(
          orgId, userId, role,
          'due_tenant_sms_reminders_sent',
          'notification_logs',
          null,
          null,
          { queued, total: tenants.length },
          `Sent SMS reminders to ${queued} of ${tenants.length} due tenants.`
        );
      }
    } catch (auditErr) {
      console.warn('[due-tenants/send-reminders] Audit log failed (non-fatal):', auditErr.message);
    }

    res.json({
      queued,
      total: tenants.length,
      results
    });
  }));

  // =========================================================================
  // GET /settings/notifications — Fetch notification settings for the org
  // =========================================================================
  router.get('/settings/notifications', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    if (!orgId) return res.status(400).json({ error: 'Organization ID required.' });

    let settings;
    if (pgDb) {
      const result = await pgDb.query(
        'SELECT * FROM notification_settings WHERE organization_id = $1',
        [orgId]
      );
      settings = result.rows[0];

      // If missing (migration gap), create default settings row
      if (!settings) {
        settings = await pgDb.insert('notification_settings', {
          organization_id: orgId,
          rent_reminders_enabled: true,
          reminder_days_before_due: 3,
          payment_confirmation_enabled: true,
          unmatched_payment_alert_enabled: true,
          meter_reading_alert_enabled: true,
          billing_alerts_enabled: true,
          sms_provider: 'None'
        });
      }
    } else {
      const { db } = await import('../db.js');
      settings = db.findOne('notification_settings', { organization_id: orgId });

      if (!settings) {
        settings = db.insert('notification_settings', {
          organization_id: orgId,
          rent_reminders_enabled: true,
          reminder_days_before_due: 3,
          payment_confirmation_enabled: true,
          unmatched_payment_alert_enabled: true,
          meter_reading_alert_enabled: true,
          billing_alerts_enabled: true,
          sms_provider: 'None'
        });
      }
    }

    res.json(settings);
  }));

  // =========================================================================
  // PUT /settings/notifications — Update notification settings for the org
  // =========================================================================
  router.put('/settings/notifications', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    if (!orgId) return res.status(400).json({ error: 'Organization ID required.' });

    // Restrict settings changes to landlords/owners
    if (role === 'caretaker') {
      return res.status(403).json({ error: 'Access denied. Caretakers cannot edit organization preferences.' });
    }

    const {
      rent_reminders_enabled,
      reminder_days_before_due,
      payment_confirmation_enabled,
      unmatched_payment_alert_enabled,
      meter_reading_alert_enabled,
      billing_alerts_enabled,
      sms_provider
    } = req.body;

    const updates = {
      rent_reminders_enabled: rent_reminders_enabled !== undefined ? Boolean(rent_reminders_enabled) : undefined,
      reminder_days_before_due: reminder_days_before_due !== undefined ? parseInt(reminder_days_before_due) : undefined,
      payment_confirmation_enabled: payment_confirmation_enabled !== undefined ? Boolean(payment_confirmation_enabled) : undefined,
      unmatched_payment_alert_enabled: unmatched_payment_alert_enabled !== undefined ? Boolean(unmatched_payment_alert_enabled) : undefined,
      meter_reading_alert_enabled: meter_reading_alert_enabled !== undefined ? Boolean(meter_reading_alert_enabled) : undefined,
      billing_alerts_enabled: billing_alerts_enabled !== undefined ? Boolean(billing_alerts_enabled) : undefined,
      sms_provider: sms_provider || undefined
    };

    // Filter undefined fields
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

    let updated;
    if (pgDb) {
      const existing = await pgDb.findOne('notification_settings', { organization_id: orgId });
      if (existing) {
        const rows = await pgDb.update('notification_settings', existing.id, updates);
        updated = rows[0] || existing;
      } else {
        updated = await pgDb.insert('notification_settings', {
          organization_id: orgId,
          ...updates
        });
      }
      await pgDb.logAudit(
        orgId, userId, role,
        'notification_settings_updated',
        'notification_settings',
        updated.id,
        existing || null,
        updated,
        'Updated organization notification alerts.'
      );
    } else {
      const { db } = await import('../db.js');
      const existing = db.findOne('notification_settings', { organization_id: orgId });
      if (existing) {
        updated = db.update('notification_settings', existing.id, updates)[0] || existing;
      } else {
        updated = db.insert('notification_settings', {
          organization_id: orgId,
          ...updates
        });
      }
      db.logAudit(
        orgId, userId, role,
        'notification_settings_updated',
        'notification_settings',
        updated.id,
        existing || null,
        updated,
        'Updated organization notification alerts.'
      );
    }

    res.json(updated);
  }));

  // =========================================================================
  // GET /settings/notification-logs — View recent notification logs
  // =========================================================================
  router.get('/settings/notification-logs', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, role } = getContext(req);
    if (!orgId) return res.status(400).json({ error: 'Organization ID required.' });

    let logs = [];
    if (pgDb) {
      // Caretaker restriction: Caretakers must never fetch financial logs
      if (role === 'caretaker') {
        const result = await pgDb.query(
          `
            SELECT * FROM notification_logs 
            WHERE organization_id = $1 
              AND type NOT IN ('unmatched_payment_alert', 'payment_confirmed', 'billing_alert')
            ORDER BY id DESC LIMIT 100
          `,
          [orgId]
        );
        logs = result.rows;
      } else {
        const result = await pgDb.query(
          'SELECT * FROM notification_logs WHERE organization_id = $1 ORDER BY id DESC LIMIT 100',
          [orgId]
        );
        logs = result.rows;
      }
    } else {
      const { db } = await import('../db.js');
      logs = db.find('notification_logs', { organization_id: orgId });
      
      // Caretaker restriction
      if (role === 'caretaker') {
        logs = logs.filter(
          log => !['unmatched_payment_alert', 'payment_confirmed', 'billing_alert'].includes(log.type)
        );
      }
      
      logs = logs.sort((a, b) => b.id - a.id).slice(0, 100);
    }

    res.json(logs);
  }));

  // =========================================================================
  // POST /settings/notification-logs/:id/retry — Retry failed sends
  // =========================================================================
  router.post('/settings/notification-logs/:id/retry', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const logId = parseInt(req.params.id);

    if (role === 'caretaker') {
      return res.status(403).json({ error: 'Access denied. Caretakers cannot retry delivery.' });
    }

    let log;
    if (pgDb) {
      log = await pgDb.findOne('notification_logs', { id: logId, organization_id: orgId });
    } else {
      const { db } = await import('../db.js');
      log = db.findOne('notification_logs', { id: logId, organization_id: orgId });
    }

    if (!log) {
      return res.status(404).json({ error: 'Notification log not found.' });
    }

    // Attempt immediately via the service
    await notificationService.sendImmediately(log);

    // Retrieve fresh status
    let updatedLog;
    if (pgDb) {
      updatedLog = await pgDb.findOne('notification_logs', { id: logId });
      await pgDb.logAudit(
        orgId, userId, role,
        'notification_retry_triggered',
        'notification_logs',
        logId,
        { status: log.status },
        { status: updatedLog.status },
        `Triggered manual retry for notification ${logId}.`
      );
    } else {
      const { db } = await import('../db.js');
      updatedLog = db.findOne('notification_logs', { id: logId });
      db.logAudit(
        orgId, userId, role,
        'notification_retry_triggered',
        'notification_logs',
        logId,
        { status: log.status },
        { status: updatedLog.status },
        `Triggered manual retry for notification ${logId}.`
      );
    }

    res.json(updatedLog);
  }));

  // =========================================================================
  // GET /admin/email-status — Super admin SMTP configuration status
  // =========================================================================
  router.get('/admin/email-status', requireSuperAdminContext, asyncHandler(async (_req, res) => {
    const activeDb = pgDb || (await import('../db.js')).db;
    const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
    if (!settings) {
      return res.json({
        configured: false,
        status: 'not_configured',
        last_tested_at: null,
        config_masked: {}
      });
    }

    const config = settings.smtp_config_encrypted
      ? normalizeSmtpConfig(decryptConfig(settings.smtp_config_encrypted))
      : {};

    res.json({
      configured: Boolean(settings.smtp_config_encrypted),
      status: settings.smtp_status || 'not_configured',
      last_tested_at: settings.smtp_last_tested_at || null,
      config_masked: settings.smtp_config_encrypted ? maskSmtpConfig(config) : {}
    });
  }));

  // =========================================================================
  // POST /admin/email-test — Super admin smoke test for SMTP delivery
  // =========================================================================
  router.post('/admin/email-test', requireSuperAdminContext, asyncHandler(async (req, res) => {
    const { userId } = getContext(req);
    const { to, subject, text, html } = req.body || {};

    let recipient = to;
    if (!recipient) {
      if (pgDb) {
        const user = await pgDb.findOne('users', { id: userId });
        recipient = user?.email;
      } else {
        const { db } = await import('../db.js');
        recipient = db.findOne('users', { id: userId })?.email;
      }
    }

    if (!recipient) {
      return res.status(400).json({
        error: 'EMAIL_RECIPIENT_REQUIRED',
        message: 'Provide a recipient email address.'
      });
    }

    try {
      const activeDb = pgDb || (await import('../db.js')).db;
      const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
      if (!settings?.smtp_config_encrypted) {
        return res.status(503).json({ error: 'email_not_configured' });
      }

      const smtpConfig = normalizeSmtpConfig(decryptConfig(settings.smtp_config_encrypted));
      const missing = validateSmtpConfig(smtpConfig);
      if (missing.length > 0) {
        return res.status(503).json({ error: 'email_not_configured', missing });
      }

      const result = await sendEmailWithConfig(smtpConfig, {
        to: recipient,
        subject: subject || 'Smart Landlord Email Smoke Test',
        text: text || 'Smart Landlord SMTP email delivery is configured.',
        html: html || '<p>Smart Landlord SMTP email delivery is configured.</p>'
      });

      if (pgDb) {
        await pgDb.logAudit(
          null,
          userId,
          'super_admin',
          'email_smoke_test_sent',
          'email',
          null,
          null,
          { to: recipient, message_id: result.messageId },
          'Super admin sent SMTP smoke test email.'
        );
      } else {
        const { db } = await import('../db.js');
        db.logAudit(
          null,
          userId,
          'super_admin',
          'email_smoke_test_sent',
          'email',
          null,
          null,
          { to: recipient, message_id: result.messageId },
          'Super admin sent SMTP smoke test email.'
        );
      }

      res.json({ success: true, message_id: result.messageId });
    } catch (error) {
      if (error.code === 'email_not_configured') {
        return res.status(503).json({
          error: 'email_not_configured'
        });
      }

      throw error;
    }
  }));

  return router;
}

