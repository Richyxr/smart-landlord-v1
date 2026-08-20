export const RENT_INVOICE_CONFIRMATION_TEXT = 'GENERATE RENT INVOICES';

const ACTIVE_RENT_STATUSES = new Set(['active', 'notice']);
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toId(value) {
  return value === null || value === undefined ? '' : String(value);
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function clampedUtcDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, Math.min(Math.max(1, day), daysInUtcMonth(year, monthIndex))));
  return date;
}

export function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

export function resolvePeriodMonth(periodMonth, serverDate = new Date()) {
  if (periodMonth === undefined || periodMonth === null || String(periodMonth).trim() === '') {
    return `${serverDate.getFullYear()}-${String(serverDate.getMonth() + 1).padStart(2, '0')}`;
  }

  const normalized = String(periodMonth).trim();
  const match = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    const error = new Error('period_month must use YYYY-MM format.');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

export function calculateRentBillingPeriod(periodMonth, billingDay, dueDayOffset = 4) {
  const normalizedMonth = resolvePeriodMonth(periodMonth);
  const [year, month] = normalizedMonth.split('-').map(Number);
  const monthIndex = month - 1;
  const parsedBillingDay = Number.parseInt(billingDay, 10);
  const effectiveBillingDay = Number.isInteger(parsedBillingDay) && parsedBillingDay >= 1 && parsedBillingDay <= 31
    ? parsedBillingDay
    : 1;

  const periodStart = clampedUtcDate(year, monthIndex, effectiveBillingDay);
  const nextPeriodStart = clampedUtcDate(year, monthIndex + 1, effectiveBillingDay);
  const periodEnd = new Date(nextPeriodStart.getTime() - DAY_MS);
  
  // Invoice date is 3 days prior to billing period start
  const dispatchDate = new Date(periodStart.getTime() - 3 * DAY_MS);
  
  // Due date is strictly the 5th of the billing period month
  const dueDateStr = `${year}-${String(month).padStart(2, '0')}-05`;

  return {
    billing_day: effectiveBillingDay,
    billing_period_start: formatUtcDate(periodStart),
    billing_period_end: formatUtcDate(periodEnd),
    invoice_date: formatUtcDate(dispatchDate),
    due_date: dueDateStr,
    due_day_offset: 4
  };
}

export function formatRentPeriodDescription(periodStart, periodEnd) {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  return `Rent for ${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTH_LABELS[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

export function isExistingRentInvoiceForPeriod(invoice, tenantId, periodStart, periodEnd, organizationId = null) {
  if (!invoice || toId(invoice.tenant_id) !== toId(tenantId)) return false;
  if (organizationId !== null && toId(invoice.organization_id) !== toId(organizationId)) return false;
  if (String(invoice.invoice_type || '').toLowerCase() !== 'rent') return false;
  if (String(invoice.status || '').toLowerCase() === 'void') return false;

  const issueDate = dateOnly(invoice.issue_date);
  const dueDate = dateOnly(invoice.due_date);
  const windowStart = dateOnly(new Date(new Date(`${periodStart}T00:00:00Z`).getTime() - 4 * DAY_MS));

  return Boolean(
    (issueDate && issueDate >= windowStart && issueDate <= periodEnd) ||
    (dueDate && dueDate >= periodStart && dueDate <= periodEnd)
  );
}

export function buildRentInvoiceGenerationPreview({
  organizationId,
  periodMonth,
  tenants = [],
  units = [],
  properties = [],
  invoices = [],
  meterReadings = [],
  serverDate = new Date()
}) {
  const normalizedMonth = resolvePeriodMonth(periodMonth, serverDate);
  const isInOrganization = row =>
    organizationId === null || organizationId === undefined || toId(row.organization_id) === toId(organizationId);
  const unitsById = new Map(units.filter(isInOrganization).map(unit => [toId(unit.id), unit]));
  const propertiesById = new Map(properties.filter(isInOrganization).map(property => [toId(property.id), property]));
  const scopedTenants = tenants.filter(tenant =>
    isInOrganization(tenant)
  );
  const scopedInvoices = invoices.filter(invoice =>
    isInOrganization(invoice)
  );

  const rows = scopedTenants.map(tenant => {
    const warnings = [];
    const status = String(tenant.status || '').toLowerCase();
    const rentAmount = Number(tenant.rent_amount);
    const parsedBillingDay = Number.parseInt(tenant.billing_day, 10);
    const hasValidBillingDay = Number.isInteger(parsedBillingDay) && parsedBillingDay >= 1 && parsedBillingDay <= 31;
    const billingDay = hasValidBillingDay ? parsedBillingDay : 1;
    const unit = unitsById.get(toId(tenant.unit_id));
    const property = propertiesById.get(toId(tenant.property_id));
    const cycle = calculateRentBillingPeriod(normalizedMonth, billingDay, tenant.due_day_offset);
    let rowStatus = 'ready_to_create';

    if (tenant.deleted_at) {
      rowStatus = 'skipped';
      warnings.push('Tenant record is deleted.');
    } else if (!ACTIVE_RENT_STATUSES.has(status)) {
      rowStatus = 'skipped';
      warnings.push(`Tenant status is ${status || 'missing'}.`);
    }
    if (!Number.isFinite(rentAmount) || rentAmount <= 0) {
      rowStatus = 'skipped';
      warnings.push('Rent amount must be greater than zero.');
    }
    if (!tenant.unit_id || !unit) {
      rowStatus = 'skipped';
      warnings.push('Tenant unit is missing or unavailable.');
    }
    if (!tenant.property_id || !property) {
      rowStatus = 'skipped';
      warnings.push('Tenant property is missing or unavailable.');
    }
    if (unit && property && toId(unit.property_id) !== toId(property.id)) {
      rowStatus = 'skipped';
      warnings.push('Tenant unit does not belong to the selected property.');
    }
    if (!hasValidBillingDay) {
      warnings.push('Billing day was missing or invalid and defaulted to 1.');
    }

    const existingInvoice = scopedInvoices.find(invoice =>
      isExistingRentInvoiceForPeriod(
        invoice,
        tenant.id,
        cycle.billing_period_start,
        cycle.billing_period_end,
        organizationId
      )
    );

    if (rowStatus === 'ready_to_create' && existingInvoice) {
      rowStatus = 'already_invoiced';
      warnings.push('A non-void rent invoice already exists for this billing period.');
    }

    const unitReadings = (meterReadings || []).filter(r => toId(r.unit_id) === toId(tenant.unit_id));
    const hasMeterConfig = unitReadings.length > 0;
    const periodReading = unitReadings.find(r =>
      String(r.status || '').toLowerCase() !== 'rejected' &&
      r.reading_date >= cycle.billing_period_start &&
      r.reading_date <= cycle.billing_period_end
    );

    if (rowStatus === 'ready_to_create' && hasMeterConfig && !periodReading) {
      rowStatus = 'waiting_for_meter';
      warnings.push('Meter reading required for period before billing can proceed. Caretaker and Landlord notified.');
    }

    return {
      tenant_id: tenant.id,
      tenant_name: tenant.full_name || 'Unnamed tenant',
      unit_id: tenant.unit_id || null,
      unit_label: unit?.unit_code || null,
      property_id: tenant.property_id || null,
      property_name: property?.name || null,
      billing_day: cycle.billing_day,
      billing_period_start: cycle.billing_period_start,
      billing_period_end: cycle.billing_period_end,
      invoice_date: cycle.invoice_date,
      due_date: cycle.due_date,
      rent_amount: Number.isFinite(rentAmount) ? rentAmount : 0,
      currency: tenant.currency || 'KES',
      description: formatRentPeriodDescription(cycle.billing_period_start, cycle.billing_period_end),
      status: rowStatus,
      existing_invoice_id: existingInvoice?.id || null,
      existing_invoice_number: existingInvoice?.invoice_number || null,
      warnings
    };
  });

  const readyRows = rows.filter(row => row.status === 'ready_to_create');
  return {
    success: true,
    mode: 'rent_invoice_generation_preview',
    period_month: normalizedMonth,
    financial_mutation: false,
    summary: {
      active_tenants: scopedTenants.filter(tenant =>
        !tenant.deleted_at && ACTIVE_RENT_STATUSES.has(String(tenant.status || '').toLowerCase())
      ).length,
      ready_to_create: readyRows.length,
      already_invoiced: rows.filter(row => row.status === 'already_invoiced').length,
      skipped: rows.filter(row => row.status === 'skipped').length,
      total_amount_to_create: readyRows.reduce((sum, row) => sum + row.rent_amount, 0)
    },
    rows,
    safety_message: 'Preview only. No invoices have been created.'
  };
}

export function validateRentInvoiceConfirmation(confirmationText) {
  if (confirmationText !== RENT_INVOICE_CONFIRMATION_TEXT) {
    const error = new Error(`confirmation_text must exactly match "${RENT_INVOICE_CONFIRMATION_TEXT}".`);
    error.statusCode = 400;
    throw error;
  }
}

export function nextRentInvoiceNumber(periodMonth, tenantId, usedInvoiceNumbers = new Set()) {
  const base = `INV-RENT-${periodMonth.replace('-', '')}-${tenantId}`;
  let candidate = base;
  let suffix = 2;
  while (usedInvoiceNumbers.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedInvoiceNumbers.add(candidate);
  return candidate;
}

export async function executeRentInvoiceGeneration({
  confirmationText,
  organizationId,
  periodMonth,
  tenants,
  units,
  properties,
  invoices,
  serverDate = new Date(),
  createInvoice
}) {
  validateRentInvoiceConfirmation(confirmationText);
  const preview = buildRentInvoiceGenerationPreview({
    organizationId,
    periodMonth,
    tenants,
    units,
    properties,
    invoices,
    serverDate
  });
  const usedInvoiceNumbers = new Set(invoices.map(invoice => invoice.invoice_number).filter(Boolean));
  const created = [];

  for (const row of preview.rows.filter(item => item.status === 'ready_to_create')) {
    const invoiceNumber = nextRentInvoiceNumber(preview.period_month, row.tenant_id, usedInvoiceNumbers);
    const invoice = await createInvoice(row, invoiceNumber);
    created.push({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      total: row.rent_amount,
      issue_date: row.invoice_date,
      due_date: row.due_date
    });
  }

  const skipped = preview.rows
    .filter(row => row.status !== 'ready_to_create')
    .map(row => ({
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      status: row.status,
      existing_invoice_id: row.existing_invoice_id,
      existing_invoice_number: row.existing_invoice_number,
      warnings: row.warnings
    }));

  return {
    success: true,
    mode: 'rent_invoice_generation_confirmed',
    period_month: preview.period_month,
    financial_mutation: created.length > 0,
    summary: {
      created: created.length,
      skipped: skipped.length,
      already_invoiced: preview.summary.already_invoiced,
      total_amount_created: created.reduce((sum, invoice) => sum + invoice.total, 0)
    },
    created,
    skipped
  };
}
