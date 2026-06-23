import crypto from 'crypto';
import { db } from './db.js';
import { EmailNotConfiguredError, sendEmail } from './mailerService.js';

// Predefined templates for various notification types
const TEMPLATES = {
  rent_reminder: (data) => 
    `Dear ${data.tenant_name}, this is a friendly reminder that your rent of KES ${data.amount} for unit ${data.unit_code} is due on ${data.due_date}. Please pay via M-Pesa Paybill ${data.paybill || '174379'} Acc ${data.account_number}. Thank you.`,
  
  invoice_issued: (data) => 
    `Dear ${data.tenant_name}, your rent invoice ${data.invoice_number} of KES ${data.amount} has been issued. Due date: ${data.due_date}. Pay via Paybill ${data.paybill || '174379'} Account: ${data.account_number}.`,
  
  payment_confirmed: (data) => 
    `Payment Confirmed: KES ${data.amount} received for account ${data.account_number}. Reference: ${data.reference}. Thank you.`,
  
  overdue_reminder: (data) => 
    `URGENT NOTICE: Your rent invoice ${data.invoice_number} is overdue. Balance: KES ${data.balance}. Please pay via Paybill ${data.paybill || '174379'} Acc ${data.account_number} immediately.`,
  
  unmatched_payment_alert: (data) => 
    `ALERT: Unmatched payment of KES ${data.amount} from ${data.payer_name || 'unknown'} (${data.phone_number || 'N/A'}) with reference ${data.reference}. Please reconcile manually.`,
  
  meter_reading_submitted: (data) => 
    `Meter reading for unit ${data.unit_code} submitted: ${data.reading_type} reading ${data.value}. Charge: KES ${data.charge}.`,
  
  billing_alert: (data) => 
    `Dear Landlord, your SaaS invoice ${data.invoice_number} of KES ${data.amount} is due on ${data.due_date}. Please pay to avoid lockout.`,
  
  security_alert: (data) => 
    `SECURITY ALERT: ${data.message} at ${data.timestamp || new Date().toISOString()}.`
};

export class NotificationService {
  constructor(pgDb = null) {
    this.pgDb = pgDb;
  }

  /**
   * Queue a new notification by creating a pending notification_log.
   * Runs settings and role checks before queueing.
   */
  async queue({ organizationId, tenantId, recipientUserId, channel, type, data }, dbClient = null) {
    try {
      const orgId = parseInt(organizationId);
      if (!orgId) throw new Error('organizationId is required.');

      const executor = dbClient || this.pgDb;

      // 1. Respect organization notification settings
      const settings = await this._getNotificationSettings(orgId, executor);
      if (settings && !this._isNotificationEnabled(type, settings)) {
        console.log(`[NotificationService] Notification type ${type} is disabled for org ${orgId}. Skipping.`);
        return null;
      }

      // 2. Resolve destination contact information
      let phoneNumber = data?.phone_number || null;
      let email = data?.email || null;
      let recipientName = data?.tenant_name || data?.recipient_name || 'Valued Customer';

      if (tenantId) {
        const tenant = await this._findOne('tenants', { id: parseInt(tenantId) }, executor);
        if (tenant) {
          phoneNumber = phoneNumber || tenant.phone_number;
          email = email || tenant.email;
          recipientName = tenant.full_name;
        }
      } else if (recipientUserId) {
        const user = await this._findOne('users', { id: parseInt(recipientUserId) }, executor);
        if (user) {
          phoneNumber = phoneNumber || user.phone_number;
          email = email || user.email;
          recipientName = user.name;
          
          // Caretaker Restriction: Caretakers must never receive financial alerts.
          const isFinancialType = ['unmatched_payment_alert', 'payment_confirmed', 'billing_alert'].includes(type);
          if (isFinancialType) {
            const member = await this._findOne('organization_members', { organization_id: orgId, user_id: user.id }, executor);
            if (member && member.role === 'caretaker') {
              console.warn(`[NotificationService] CAUTION: Attempted to send financial notification ${type} to caretaker user ${user.id}. Blocked.`);
              return null;
            }
          }
        }
      }

      // 3. Resolve message text from templates
      const templateFn = TEMPLATES[type];
      if (!templateFn) {
        throw new Error(`Unknown notification type: ${type}`);
      }

      const templateData = {
        tenant_name: recipientName,
        recipient_name: recipientName,
        phone_number: phoneNumber,
        email: email,
        ...data
      };
      const message = templateFn(templateData);

      // 4. Create the pending log row
      const logData = {
        organization_id: orgId,
        recipient_user_id: recipientUserId ? parseInt(recipientUserId) : null,
        tenant_id: tenantId ? parseInt(tenantId) : null,
        phone_number: channel === 'email' ? (email || '') : (phoneNumber || email || 'System Alert'),
        channel: channel || 'sms',
        type,
        message,
        status: 'pending',
        retry_count: 0,
        max_retries: 3
      };

      let loggedRow;
      if (executor) {
        const result = await executor.query(
          `
            INSERT INTO notification_logs (
              organization_id, recipient_user_id, tenant_id, phone_number,
              channel, type, message, status, retry_count, max_retries
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
          `,
          [
            logData.organization_id, logData.recipient_user_id, logData.tenant_id,
            logData.phone_number, logData.channel, logData.type, logData.message,
            logData.status, logData.retry_count, logData.max_retries
          ]
        );
        loggedRow = result.rows[0];
      } else {
        loggedRow = db.insert('notification_logs', logData);
      }

      console.log(`[NotificationService] Queued pending notification ${loggedRow.id} (Channel: ${channel}, Type: ${type})`);

      // 5. Asynchronously process the queue (non-blocking)
      setImmediate(() => {
        this.processPending().catch(err => {
          console.error('[NotificationService] Error in async processPending:', err);
        });
      });

      return loggedRow;
    } catch (error) {
      console.error('[NotificationService] Failed to queue notification:', error.message);
      if (this.pgDb) {
        await this.pgDb.logError(organizationId, recipientUserId, 'NotificationService.queue', error.message, error.stack);
      }
      return null;
    }
  }

  /**
   * Process all pending notifications in the database.
   */
  async processPending() {
    let pendingLogs = [];
    if (this.pgDb) {
      const result = await this.pgDb.query(
        "SELECT * FROM notification_logs WHERE status = 'pending' ORDER BY id ASC"
      );
      pendingLogs = result.rows;
    } else {
      pendingLogs = db.find('notification_logs', { status: 'pending' });
    }

    for (const log of pendingLogs) {
      await this.sendImmediately(log);
    }
  }

  /**
   * Sends a specific notification immediately, simulating external gateways and handling in-app writes.
   */
  async sendImmediately(log) {
    const nowStr = new Date().toISOString();
    try {
      console.log(`[NotificationService] Attempting delivery of log ${log.id} via ${log.channel}...`);
      
      // Update attempt time and retry count
      const attemptData = {
        last_attempt_at: nowStr,
        retry_count: (log.retry_count || 0) + 1
      };

      if (log.channel === 'in_app') {
        // Create actual notification row for in-app alert
        const isFinancial = ['unmatched_payment_alert', 'payment_confirmed', 'billing_alert'].includes(log.type);
        const priority = isFinancial ? 'critical' : 'informational';
        const title = log.type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        const notificationData = {
          organization_id: log.organization_id,
          user_id: log.recipient_user_id,
          type: log.type,
          priority,
          title,
          body: log.message,
          is_read: false
        };

        if (this.pgDb) {
          await this.pgDb.insert('notifications', notificationData);
        } else {
          db.insert('notifications', notificationData);
        }

        // Complete the log
        await this._updateLog(log.id, {
          ...attemptData,
          status: 'sent',
          sent_at: nowStr,
          provider_reference: `in-app-${log.id}`
        });

        console.log(`[NotificationService] In-app notification delivered for log ${log.id}`);
      } else if (log.channel === 'email') {
        if (!log.phone_number) {
          const error = new Error('email_recipient_missing');
          error.code = 'email_recipient_missing';
          throw error;
        }

        const subject = log.type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const result = await sendEmail({
          to: log.phone_number,
          subject,
          text: log.message,
          html: `<p>${escapeHtml(log.message).replace(/\n/g, '<br>')}</p>`
        });

        await this._updateLog(log.id, {
          ...attemptData,
          status: 'sent',
          sent_at: nowStr,
          provider_reference: result.messageId || `email-${log.id}`
        });

        console.log(`[NotificationService] Email notification delivered for log ${log.id}`);
      } else {
        // Retrieve settings to check preferred provider
        const settings = await this._getNotificationSettings(log.organization_id);

        if (log.channel === 'sms' && settings && settings.sms_provider === 'Mobitech') {
          // Route through Mobitech SMS provider
          let integration;
          if (this.pgDb) {
            const result = await this.pgDb.query(
              "SELECT * FROM organization_integrations WHERE organization_id = $1 AND provider_type = 'sms'",
              [log.organization_id]
            );
            integration = result.rows[0];
          } else {
            integration = db.findOne('organization_integrations', {
              organization_id: log.organization_id,
              provider_type: 'sms'
            });
          }

          if (!integration || !integration.is_active || integration.provider_name !== 'Mobitech') {
            throw new Error('Mobitech SMS gateway is selected but has no active credentials saved.');
          }

          // Decrypt credentials
          let credentials = {};
          if (this.pgDb) {
            const { decryptConfig } = await import('./crypto.js');
            credentials = decryptConfig(integration.config_json_encrypted);
          } else {
            credentials = JSON.parse(integration.config_json_encrypted || '{}');
          }

          if (!credentials.api_key || !credentials.partner_id) {
            throw new Error('Mobitech configuration credentials (api_key, partner_id) are incomplete.');
          }

          const recipientNum = normalizePhoneNumber(log.phone_number);
          const isMock = String(credentials.api_key).startsWith('mock') || String(credentials.api_key).startsWith('test') || credentials.api_key === 'dummy';

          if (isMock) {
            console.log(`[NotificationService MOCK MOBITECH SUCCESS] SMS sent to ${recipientNum}: "${log.message}"`);
            await this._updateLog(log.id, {
              ...attemptData,
              status: 'sent',
              sent_at: nowStr,
              provider_reference: `mobitech-mock-${crypto.randomBytes(4).toString('hex')}`
            });
          } else {
            const payload = {
              apikey: credentials.api_key,
              partnerID: credentials.partner_id,
              message: log.message,
              shortcode: credentials.sender_id || 'SMARTLAND',
              mobile: recipientNum
            };

            const apiRes = await fetch('https://sms.textsms.co.ke/api/services/sendsms/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(5000)
            });

            const text = await apiRes.text();
            let apiData = null;
            try {
              apiData = JSON.parse(text);
            } catch {}

            if (!apiRes.ok) {
              throw new Error(`HTTP Error Status ${apiRes.status}: ${text.substring(0, 100)}`);
            }

            const firstResponse = apiData?.responses?.[0];
            const responseCode = firstResponse?.['respose-code'];
            const responseDesc = firstResponse?.['response-description'] || 'No description';

            if (responseCode !== 200 && responseCode !== '200') {
              throw new Error(`Mobitech Gateway Error ${responseCode}: ${responseDesc}`);
            }

            console.log(`[NotificationService MOBITECH SUCCESS] SMS delivered for log ${log.id}`);
            await this._updateLog(log.id, {
              ...attemptData,
              status: 'sent',
              sent_at: nowStr,
              provider_reference: firstResponse?.messageid ? String(firstResponse.messageid) : `mobitech-${log.id}`
            });
          }
        } else {
          // Fallback to generic simulated external gateway (Sema/Twilio/Africa's Talking simulator)
          const shouldFail = Math.random() < 0.10;
          
          // Add fake network delay
          await new Promise(resolve => setTimeout(resolve, 50));

          if (shouldFail) {
            throw new Error('Simulated external gateway network timeout.');
          }

          // Simulated Success
          console.log(`[NotificationService SUCCESS] ${log.channel.toUpperCase()} sent to ${log.phone_number}: "${log.message}"`);
          
          await this._updateLog(log.id, {
            ...attemptData,
            status: 'sent',
            sent_at: nowStr,
            provider_reference: `${log.channel}-${crypto.randomBytes(4).toString('hex')}`
          });
        }
      }
    } catch (error) {
      const publicError = error instanceof EmailNotConfiguredError ? error.code : error.message;
      console.error(`[NotificationService ERROR] Log ${log.id} failed:`, publicError);
      
      const newRetryCount = (log.retry_count || 0) + 1;
      const isFailedPermanently = newRetryCount >= (log.max_retries || 3);
      const nextStatus = isFailedPermanently ? 'failed' : 'failed'; // We keep failed but update count

      await this._updateLog(log.id, {
        last_attempt_at: nowStr,
        retry_count: newRetryCount,
        status: nextStatus,
        error_message: publicError
      });

      if (this.pgDb) {
        await this.pgDb.logError(
          log.organization_id,
          log.recipient_user_id,
          `NotificationService.sendImmediately:${log.channel}`,
          `Delivery failure for log ${log.id}: ${publicError}`,
          null,
          { log_id: log.id }
        );
      }
    }
  }

  /**
   * Helper to fetch settings (supports both backends)
   */
  async _getNotificationSettings(orgId, executor = null) {
    const activeExecutor = executor || this.pgDb;
    if (activeExecutor) {
      const result = await activeExecutor.query('SELECT * FROM notification_settings WHERE organization_id = $1', [orgId]);
      return result.rows[0] || null;
    }
    return db.findOne('notification_settings', { organization_id: orgId });
  }

  /**
   * Helper to perform database findOne
   */
  async _findOne(table, filter, executor = null) {
    const activeExecutor = executor || this.pgDb;
    if (activeExecutor) {
      const entries = Object.entries(filter);
      const clauses = entries.map(([key], index) => `"${key}" = $${index + 1}`);
      const values = entries.map(([, val]) => val);
      const result = await activeExecutor.query(
        `SELECT * FROM "${table}" WHERE ${clauses.join(' AND ')} LIMIT 1`,
        values
      );
      return result.rows[0] || null;
    }
    return db.findOne(table, filter);
  }

  /**
   * Helper to update notification logs
   */
  async _updateLog(logId, updates) {
    if (this.pgDb) {
      await this.pgDb.update('notification_logs', logId, updates);
    } else {
      db.update('notification_logs', logId, updates);
    }
  }

  /**
   * Helper to check if a specific notification type is enabled in settings
   */
  _isNotificationEnabled(type, settings) {
    switch (type) {
      case 'rent_reminder':
      case 'overdue_reminder':
      case 'invoice_issued':
        return Boolean(settings.rent_reminders_enabled);
      case 'payment_confirmed':
        return Boolean(settings.payment_confirmation_enabled);
      case 'unmatched_payment_alert':
        return Boolean(settings.unmatched_payment_alert_enabled);
      case 'meter_reading_submitted':
        return Boolean(settings.meter_reading_alert_enabled);
      case 'billing_alert':
        return Boolean(settings.billing_alerts_enabled);
      case 'security_alert':
        return true; // Security alerts are critical and cannot be turned off
      default:
        return true;
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  }
  if (cleaned.length === 9 && cleaned.startsWith('7')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}
