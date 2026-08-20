/**
 * Tenant Billing Cycle Utility Helpers
 * Smart Landlord V1.0 - Phase 1 Safety Patch
 */

/**
 * Safely clamps a day to the maximum number of days in a given year and month (0-indexed month).
 */
export function getClampedDate(year, month, day) {
  const maxDays = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(1, parseInt(day) || 1), maxDays);
  return new Date(year, month, clampedDay);
}

/**
 * Formats a Date object as YYYY-MM-DD string using local time representation.
 */
export function formatDateISO(date) {
  if (!date || isNaN(new Date(date).getTime())) return null;
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns ordinal string for a day (e.g. 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 15 -> "15th").
 */
export function getOrdinalDay(day) {
  const d = parseInt(day) || 1;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = d % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${d}${suffix}`;
}

/**
 * Formats date range as "MMM D – MMM D, YYYY" (e.g., "Jul 1 – Jul 31, 2026").
 */
export function formatPeriodRange(startDate, endDate) {
  if (!startDate || !endDate) return 'Not available';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sM = months[startDate.getMonth()];
  const sD = startDate.getDate();
  const eM = months[endDate.getMonth()];
  const eD = endDate.getDate();
  const eY = endDate.getFullYear();
  return `${sM} ${sD} – ${eM} ${eD}, ${eY}`;
}

/**
 * Formats a single date into a readable string "MMM D, YYYY" (e.g. "Aug 1, 2026").
 */
export function formatReadableDate(dateInput) {
  if (!dateInput) return 'Not available';
  let d;
  if (typeof dateInput === 'string') {
    const cleanStr = dateInput.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
      const [y, m, day] = cleanStr.split('-').map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(dateInput);
    }
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return 'Not available';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Calculates complete billing cycle metadata for a tenant.
 */
export function calculateTenantBillingCycle(tenant, invoices = [], referenceDate = new Date()) {
  const billingDay = tenant.billing_day ? parseInt(tenant.billing_day) : null;
  const effectiveBillingDay = billingDay || 1;
  const isVacatedOrInactive = tenant.status === 'vacated' || tenant.status === 'inactive' || tenant.status === 'deleted';
  const rentAmount = parseFloat(tenant.rent_amount) || 0;

  const refDate = new Date(referenceDate);
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const refY = today.getFullYear();
  const refM = today.getMonth();
  const refD = today.getDate();

  // 1. Current Billing Period
  let periodStart;
  let periodEnd;

  if (effectiveBillingDay === 1) {
    periodStart = new Date(refY, refM, 1);
    periodEnd = new Date(refY, refM + 1, 0); // Last day of current month
  } else {
    if (refD >= effectiveBillingDay) {
      periodStart = getClampedDate(refY, refM, effectiveBillingDay);
      const nextCycleStart = getClampedDate(refY, refM + 1, effectiveBillingDay);
      periodEnd = new Date(nextCycleStart.getTime() - 24 * 60 * 60 * 1000);
    } else {
      periodStart = getClampedDate(refY, refM - 1, effectiveBillingDay);
      const currentCycleStart = getClampedDate(refY, refM, effectiveBillingDay);
      periodEnd = new Date(currentCycleStart.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  // 2. Next Billing Date
  let nextBillDate = null;
  if (!isVacatedOrInactive) {
    if (effectiveBillingDay === 1) {
      if (refD === 1) {
        nextBillDate = new Date(refY, refM, 1);
      } else {
        nextBillDate = new Date(refY, refM + 1, 1);
      }
    } else {
      if (refD <= effectiveBillingDay) {
        nextBillDate = getClampedDate(refY, refM, effectiveBillingDay);
      } else {
        nextBillDate = getClampedDate(refY, refM + 1, effectiveBillingDay);
      }
    }
  }

  // 3. Fallback Period Rent Invoice Match
  const periodStartStr = formatDateISO(periodStart);
  const periodEndStr = formatDateISO(periodEnd);
  const windowStartDate = new Date(periodStart.getTime() - 5 * 24 * 60 * 60 * 1000);
  const windowStartStr = formatDateISO(windowStartDate);

  const currentPeriodRentInvoice = (Array.isArray(invoices) ? invoices : []).find(inv => {
    if (String(inv.tenant_id) !== String(tenant.id)) return false;
    if (String(inv.invoice_type || '').toLowerCase() !== 'rent') return false;
    if (String(inv.status || '').toLowerCase() === 'void') return false;

    const issueDateStr = inv.issue_date ? String(inv.issue_date).substring(0, 10) : null;
    const dueDateStr = inv.due_date ? String(inv.due_date).substring(0, 10) : null;
    const createdDateStr = inv.created_at ? String(inv.created_at).substring(0, 10) : null;

    const isIssueInWindow = issueDateStr && issueDateStr >= windowStartStr && issueDateStr <= periodEndStr;
    const isDueInPeriod = dueDateStr && dueDateStr >= periodStartStr && dueDateStr <= periodEndStr;
    const isCreatedInWindow = createdDateStr && createdDateStr >= windowStartStr && createdDateStr <= periodEndStr;

    return isIssueInWindow || isDueInPeriod || isCreatedInWindow;
  });

  const hasCurrentPeriodInvoice = Boolean(currentPeriodRentInvoice);

  // 4. Unbilled Rent Warning Detection
  // Show warning if: active tenant, rent > 0, period has started (today >= periodStart), and no rent invoice found for current period
  const hasUnbilledWarning = !isVacatedOrInactive &&
    rentAmount > 0 &&
    today >= periodStart &&
    !hasCurrentPeriodInvoice;

  return {
    hasBillingDayConfigured: Boolean(billingDay),
    billingDay: effectiveBillingDay,
    billingDayLabel: billingDay ? `${getOrdinalDay(effectiveBillingDay)} of every month` : 'Not configured',
    periodStart,
    periodEnd,
    periodStartStr,
    periodEndStr,
    currentPeriodLabel: formatPeriodRange(periodStart, periodEnd),
    nextBillDate,
    nextBillDateStr: nextBillDate ? formatDateISO(nextBillDate) : null,
    nextBillDisplay: isVacatedOrInactive ? 'Not active' : (nextBillDate ? formatReadableDate(nextBillDate) : 'Not available'),
    isVacatedOrInactive,
    hasCurrentPeriodInvoice,
    currentPeriodInvoiceNumber: currentPeriodRentInvoice ? currentPeriodRentInvoice.invoice_number : null,
    hasUnbilledWarning
  };
}
