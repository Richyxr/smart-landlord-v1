import { db } from '../db.js';
import { NotificationService } from '../notificationService.js';

/**
 * Automated Rent Billing & Invoice Dispatch Engine
 * Smart Landlord V1.0
 *
 * Billing Logic (per tenant):
 * ─────────────────────────────────────────────────────────────────────────────
 * Each tenant has their own `billing_day` (e.g. 1, 5, 15, 28).
 * The system evaluates EACH TENANT independently using their own billing cycle:
 *
 *   periodStart = billing_day of the current/upcoming month
 *   dispatchWindowOpen = periodStart − 3 days  (invoice generated & sent 3 days early)
 *   dueDate = 5th of the billing month at 23:59:59
 *
 * Dispatch Window Rule:
 *   TODAY >= dispatchWindowOpen  →  generate invoice for this tenant's current cycle
 *
 * Meter Reading Dependency:
 *   If the org has meter_reading_alert_enabled = true AND the property has any
 *   active meter (water/electricity) units, the system checks whether a reading
 *   for the current billing period exists (status != 'rejected') before issuing
 *   an invoice for that unit.
 *   ▸ Reading present → generate invoice normally.
 *   ▸ Reading missing → BLOCK invoice generation + fire a nudge to caretaker
 *     AND landlord, listing the specific unit(s) that need readings entered.
 *     The nudge links to the meter entry screen so action is immediate.
 *
 * Idempotency:
 *   A non-void rent invoice already in the period window → skip silently.
 *   Unresolved "meter_reading_required" nudge already exists for that unit/period
 *   → skip creating a duplicate nudge.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clamp billing_day to valid day range for the given year/month (0-indexed). */
function clampDay(year, monthIndex, day) {
  const maxDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(Math.max(1, day), maxDays);
}

/** YYYY-MM-DD string from a Date object (UTC). */
function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Derives the billing period START and END for a given tenant billing_day
 * relative to referenceDate. Uses UTC dates throughout to avoid TZ off-by-ones.
 *
 * The current billing cycle is the most recently started cycle:
 *   If today >= billing_day this month  →  cycle started billing_day of this month.
 *   If today < billing_day this month   →  cycle started billing_day of last month.
 */
function deriveBillingPeriod(billingDay, refDate) {
  const Y = refDate.getUTCFullYear();
  const M = refDate.getUTCMonth(); // 0-indexed
  const D = refDate.getUTCDate();

  const thisMonthClampedDay = clampDay(Y, M, billingDay);
  let periodStart;

  if (D >= thisMonthClampedDay) {
    // Current billing cycle started this month
    periodStart = new Date(Date.UTC(Y, M, thisMonthClampedDay));
  } else {
    // Current billing cycle started last month
    const prevY = M === 0 ? Y - 1 : Y;
    const prevM = M === 0 ? 11 : M - 1;
    periodStart = new Date(Date.UTC(prevY, prevM, clampDay(prevY, prevM, billingDay)));
  }

  // Period ends the day before the NEXT billing_day
  const psY = periodStart.getUTCFullYear();
  const psM = periodStart.getUTCMonth();
  const nextM = psM === 11 ? 0 : psM + 1;
  const nextY = psM === 11 ? psY + 1 : psY;
  const nextCycleStart = new Date(Date.UTC(nextY, nextM, clampDay(nextY, nextM, billingDay)));
  const periodEnd = new Date(nextCycleStart.getTime() - DAY_MS);

  // Due date: 5th of the billing period's start month at 23:59:59
  const dueDay = Math.min(5, clampDay(psY, psM, 5));
  const dueDateStr = `${psY}-${String(psM + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;

  // Dispatch window opens 3 days before period start
  const dispatchWindowOpen = new Date(periodStart.getTime() - 3 * DAY_MS);

  return {
    periodStart,
    periodEnd,
    periodStartStr: toDateStr(periodStart),
    periodEndStr: toDateStr(periodEnd),
    dispatchWindowOpen,
    dueDateStr,
    periodLabel: `${toDateStr(periodStart)} – ${toDateStr(periodEnd)}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTGRES IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────
async function evaluatePostgres(pgDb, refDate) {
  const notificationService = new NotificationService(pgDb);
  const generatedInvoices = [];
  const blockedUnits = []; // units blocked pending meter readings

  const orgsRes = await pgDb.query("SELECT id, name FROM organizations WHERE status = 'active'");

  for (const org of orgsRes.rows) {
    // Fetch notification settings to determine if meter readings gate billing
    const settingsRes = await pgDb.query(
      'SELECT meter_reading_alert_enabled FROM notification_settings WHERE organization_id = $1',
      [org.id]
    );
    const meterGatingEnabled = settingsRes.rows[0]?.meter_reading_alert_enabled !== false;

    // Fetch all active tenants with unit & property details
    const tenantsRes = await pgDb.query(
      `SELECT t.*,
              u.unit_code,
              u.unit_type,
              p.name AS property_name,
              p.billing_currency
       FROM tenants t
       JOIN units u ON t.unit_id = u.id
       JOIN properties p ON t.property_id = p.id
       WHERE t.organization_id = $1
         AND t.status IN ('active', 'notice')
         AND t.deleted_at IS NULL`,
      [org.id]
    );

    // Fetch caretaker/staff user IDs for this org (for nudge targeting)
    const caretakersRes = await pgDb.query(
      `SELECT u.id FROM users u
       JOIN staff_assignments sa ON sa.user_id = u.id
       WHERE sa.organization_id = $1 AND sa.role = 'caretaker' AND sa.status = 'active'
       LIMIT 5`,
      [org.id]
    );
    const landlordRes = await pgDb.query(
      "SELECT id FROM users WHERE organization_id = $1 AND role = 'landlord' LIMIT 1",
      [org.id]
    );

    // Org-level nudge accumulation (report at end per org)
    const orgBlocked = [];

    for (const tenant of tenantsRes.rows) {
      const billingDay = Math.max(1, Math.min(31, parseInt(tenant.billing_day || '1', 10)));
      const rentAmount = parseFloat(tenant.rent_amount) || 0;
      if (rentAmount <= 0) continue;

      const cycle = deriveBillingPeriod(billingDay, refDate);

      // Skip if we're not yet in the dispatch window
      if (refDate < cycle.dispatchWindowOpen) continue;

      // ── Idempotency: check if invoice already exists ──────────────────────
      const existingRes = await pgDb.query(
        `SELECT id FROM invoices
         WHERE organization_id = $1
           AND tenant_id = $2
           AND invoice_type = 'rent'
           AND status != 'void'
           AND (
             (issue_date >= $3 AND issue_date <= $4) OR
             (due_date   >= $3 AND due_date   <= $4)
           )`,
        [org.id, tenant.id, cycle.periodStartStr, cycle.periodEndStr]
      );
      if (existingRes.rows.length > 0) continue; // Already billed

      // ── Meter Reading Dependency Check ────────────────────────────────────
      if (meterGatingEnabled) {
        const readingsRes = await pgDb.query(
          `SELECT meter_type FROM meter_readings
           WHERE organization_id = $1
             AND unit_id = $2
             AND status != 'rejected'
             AND reading_date >= $3
             AND reading_date <= $4`,
          [org.id, tenant.unit_id, cycle.periodStartStr, cycle.periodEndStr]
        );

        // Check if this unit has ANY meter_readings records at all (ever)
        // i.e. are meters tracked for this unit?
        const hasMetersRes = await pgDb.query(
          `SELECT meter_type FROM meter_readings
           WHERE organization_id = $1 AND unit_id = $2
           LIMIT 1`,
          [org.id, tenant.unit_id]
        );

        if (hasMetersRes.rows.length > 0 && readingsRes.rows.length === 0) {
          // Meter readings required but missing → BLOCK & NUDGE
          orgBlocked.push({
            tenant_name: tenant.full_name,
            unit_code: tenant.unit_code,
            property_name: tenant.property_name,
            unit_id: tenant.unit_id,
            tenant_id: tenant.id,
            period: cycle.periodLabel
          });
          continue;
        }
      }

      // ── Generate Invoice ──────────────────────────────────────────────────
      const client = await pgDb.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [`auto-rent:${org.id}:${tenant.id}:${cycle.periodStartStr}`]
        );

        const invoiceNumber = `INV-RENT-${cycle.periodStartStr.replace(/-/g, '')}-${tenant.id}`;
        const periodLabel = `Monthly Rent (${cycle.periodLabel})`;

        const invRes = await client.query(
          `INSERT INTO invoices (
            organization_id, property_id, unit_id, tenant_id, invoice_number,
            invoice_type, status, issue_date, due_date, currency, subtotal,
            total, amount_paid, balance, notes, issued_at
          )
          VALUES ($1,$2,$3,$4,$5,'rent','issued',$6,$7,$8,$9,$9,0,$9,$10,NOW())
          RETURNING *`,
          [
            org.id, tenant.property_id, tenant.unit_id, tenant.id, invoiceNumber,
            toDateStr(refDate), cycle.dueDateStr,
            tenant.billing_currency || tenant.currency || 'KES',
            rentAmount,
            `Automated: ${periodLabel}`
          ]
        );
        const invoice = invRes.rows[0];

        await client.query(
          `INSERT INTO invoice_items (organization_id, invoice_id, description, item_type, quantity, unit_price, total)
           VALUES ($1,$2,$3,'rent',1,$4,$4)`,
          [org.id, invoice.id, periodLabel, rentAmount]
        );

        await client.query('COMMIT');

        // Queue SMS notification to tenant
        try {
          await notificationService.queue({
            organizationId: org.id,
            tenantId: tenant.id,
            channel: 'sms',
            type: 'rent_invoice',
            data: {
              invoice_number: invoiceNumber,
              amount: rentAmount.toFixed(2),
              due_date: `${cycle.dueDateStr} 23:59`,
              period_label: cycle.periodLabel,
              account_number: tenant.tenant_account_number || `ACC-${tenant.property_id}-${tenant.unit_code}`
            }
          });
        } catch (notifErr) {
          console.error(`[AutoBilling] SMS queue failed for tenant ${tenant.id}:`, notifErr.message);
        }

        generatedInvoices.push({
          id: invoice.id,
          invoice_number: invoiceNumber,
          tenant_name: tenant.full_name,
          unit_code: tenant.unit_code,
          amount: rentAmount,
          due_date: cycle.dueDateStr,
          period: cycle.periodLabel
        });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[AutoBilling] Failed to create invoice for tenant ${tenant.id}:`, err.message);
      } finally {
        client.release();
      }
    }

    // ── Fire Blocking Nudges (once per org per evaluation, grouped) ──────────
    if (orgBlocked.length > 0) {
      const unitList = orgBlocked.map(b => `${b.unit_code} (${b.tenant_name})`).join(', ');
      const nudgeTitle = 'Meter Readings Required — Automated Billing Blocked';
      const nudgeMsg = `Automated rent invoices for the current period are BLOCKED for ${orgBlocked.length} unit(s) pending meter readings: ${unitList}. Please enter readings to unblock billing.`;

      // Check if an identical unresolved nudge already fired this period
      const windowStart = toDateStr(new Date(refDate.getTime() - 3 * DAY_MS));
      const existingNudge = await pgDb.query(
        `SELECT id FROM system_nudges
         WHERE organization_id = $1
           AND category = 'meter_reading_required'
           AND is_resolved = false
           AND created_at >= $2`,
        [org.id, windowStart]
      );

      if (existingNudge.rows.length === 0) {
        // Nudge caretaker
        await pgDb.query(
          `INSERT INTO system_nudges
           (organization_id, target_role, category, severity, title, message, action_label, action_url, action_type)
           VALUES ($1,'caretaker','meter_reading_required','critical',$2,$3,'Enter Meter Readings','/caretaker?action=meter_entry','NAVIGATE')`,
          [org.id, nudgeTitle, nudgeMsg]
        );

        // Nudge landlord
        await pgDb.query(
          `INSERT INTO system_nudges
           (organization_id, target_role, category, severity, title, message, action_label, action_url, action_type)
           VALUES ($1,'landlord','meter_reading_required','critical',$2,$3,'Review & Enter Readings','/properties','NAVIGATE')`,
          [org.id, nudgeTitle, nudgeMsg]
        );
      }

      blockedUnits.push(...orgBlocked);
    }

    // ── Success Nudge to Landlord if invoices were auto-generated ────────────
    if (generatedInvoices.length > 0) {
      const total = generatedInvoices.reduce((s, i) => s + i.amount, 0);
      await pgDb.query(
        `INSERT INTO system_nudges
         (organization_id, target_role, category, severity, title, message, action_label, action_url, action_type)
         VALUES ($1,'landlord','billing','success',$2,$3,'View Invoices','/invoices','NAVIGATE')`,
        [
          org.id,
          'Automated Rent Invoices Dispatched',
          `${generatedInvoices.length} rent invoice(s) auto-generated & sent. Total: ${generatedInvoices[0]?.amount ? (org.billing_currency || 'KES') : 'KES'} ${total.toLocaleString()}. Due: 5th at 23:59.`
        ]
      );
    }
  }

  return { generatedInvoices, blockedUnits };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON DB FALLBACK IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────
async function evaluateJsonDb(refDate) {
  const generatedInvoices = [];
  const blockedUnits = [];

  const activeTenants = db.find('tenants', {}).filter(t =>
    (t.status === 'active' || t.status === 'notice') && !t.deleted_at
  );

  for (const tenant of activeTenants) {
    const rentAmount = parseFloat(tenant.rent_amount) || 0;
    if (rentAmount <= 0) continue;

    const billingDay = Math.max(1, Math.min(31, parseInt(tenant.billing_day || '1', 10)));
    const cycle = deriveBillingPeriod(billingDay, refDate);

    if (refDate < cycle.dispatchWindowOpen) continue;

    // Idempotency check
    const existing = db.find('invoices', {}).find(inv =>
      String(inv.tenant_id) === String(tenant.id) &&
      inv.invoice_type === 'rent' &&
      inv.status !== 'void' &&
      ((inv.issue_date >= cycle.periodStartStr && inv.issue_date <= cycle.periodEndStr) ||
       (inv.due_date >= cycle.periodStartStr && inv.due_date <= cycle.periodEndStr))
    );
    if (existing) continue;

    // Meter reading gating (check JSON store notification_settings)
    const settings = db.findOne('notification_settings', { organization_id: tenant.organization_id });
    const meterGatingEnabled = settings?.meter_reading_alert_enabled !== false;

    if (meterGatingEnabled) {
      const allReadings = db.find('meter_readings', { unit_id: tenant.unit_id });
      const hasMeters = allReadings.length > 0;
      const periodReadings = allReadings.filter(r =>
        r.status !== 'rejected' &&
        r.reading_date >= cycle.periodStartStr &&
        r.reading_date <= cycle.periodEndStr
      );

      if (hasMeters && periodReadings.length === 0) {
        blockedUnits.push({
          tenant_name: tenant.full_name,
          unit_id: tenant.unit_id,
          tenant_id: tenant.id,
          period: cycle.periodLabel
        });
        // Insert blocking nudge (check for existing first)
        const existingNudges = db.find('system_nudges', {
          organization_id: tenant.organization_id,
          category: 'meter_reading_required',
          is_resolved: false
        });
        if (existingNudges.length === 0) {
          db.insert('system_nudges', {
            organization_id: tenant.organization_id,
            target_role: 'caretaker',
            category: 'meter_reading_required',
            severity: 'critical',
            title: 'Meter Readings Required — Billing Blocked',
            message: `Automated billing is blocked for unit ${tenant.unit_id} pending meter readings for period ${cycle.periodLabel}.`,
            action_label: 'Enter Meter Readings',
            action_url: '/caretaker?action=meter_entry',
            action_type: 'NAVIGATE',
            is_resolved: false,
            created_at: new Date().toISOString()
          });
          db.insert('system_nudges', {
            organization_id: tenant.organization_id,
            target_role: 'landlord',
            category: 'meter_reading_required',
            severity: 'critical',
            title: 'Meter Readings Required — Billing Blocked',
            message: `Automated billing is blocked for unit ${tenant.unit_id} pending meter readings for period ${cycle.periodLabel}. Inform your caretaker.`,
            action_label: 'Review Readings',
            action_url: '/properties',
            action_type: 'NAVIGATE',
            is_resolved: false,
            created_at: new Date().toISOString()
          });
        }
        continue;
      }
    }

    // Generate invoice
    const invoiceNumber = `INV-RENT-${cycle.periodStartStr.replace(/-/g, '')}-${tenant.id}`;
    const periodLabel = `Monthly Rent (${cycle.periodLabel})`;

    const invoice = db.insert('invoices', {
      organization_id: tenant.organization_id,
      property_id: tenant.property_id,
      unit_id: tenant.unit_id,
      tenant_id: tenant.id,
      invoice_number: invoiceNumber,
      invoice_type: 'rent',
      status: 'issued',
      issue_date: toDateStr(refDate),
      due_date: cycle.dueDateStr,
      currency: tenant.currency || 'KES',
      subtotal: rentAmount,
      total: rentAmount,
      amount_paid: 0,
      balance: rentAmount,
      notes: `Automated: ${periodLabel}`,
      issued_at: new Date().toISOString()
    });

    db.insert('invoice_items', {
      organization_id: tenant.organization_id,
      invoice_id: invoice.id,
      description: periodLabel,
      item_type: 'rent',
      quantity: 1,
      unit_price: rentAmount,
      total: rentAmount
    });

    generatedInvoices.push({
      id: invoice.id,
      invoice_number: invoiceNumber,
      tenant_name: tenant.full_name,
      amount: rentAmount,
      due_date: cycle.dueDateStr,
      period: cycle.periodLabel
    });
  }

  return { generatedInvoices, blockedUnits };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
export async function evaluateAutomatedRentBilling(pgDb = null, referenceDate = new Date()) {
  const refDate = new Date(referenceDate);

  try {
    const { generatedInvoices, blockedUnits } = pgDb
      ? await evaluatePostgres(pgDb, refDate)
      : await evaluateJsonDb(refDate);

    console.log(
      `[AutoBilling] ${toDateStr(refDate)} → generated: ${generatedInvoices.length}, blocked (pending meter readings): ${blockedUnits.length}`
    );

    return {
      success: true,
      evaluated_at: refDate.toISOString(),
      generated_count: generatedInvoices.length,
      blocked_count: blockedUnits.length,
      invoices: generatedInvoices,
      blocked: blockedUnits
    };
  } catch (err) {
    console.error('[AutoBilling] Fatal evaluation error:', err);
    return {
      success: false,
      evaluated_at: refDate.toISOString(),
      error: err.message,
      generated_count: 0,
      blocked_count: 0,
      invoices: [],
      blocked: []
    };
  }
}
