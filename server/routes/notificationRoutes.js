import express from 'express';
import { NotificationService } from '../notificationService.js';

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

export function createNotificationRoutes(pgDb) {
  const router = express.Router();
  const notificationService = new NotificationService(pgDb);
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

  return router;
}

