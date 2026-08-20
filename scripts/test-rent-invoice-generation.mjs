import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  RENT_INVOICE_CONFIRMATION_TEXT,
  buildRentInvoiceGenerationPreview,
  calculateRentBillingPeriod,
  executeRentInvoiceGeneration
} from '../server/services/rentInvoiceGeneration.js';
import { calculateTenantBillingCycle } from '../src/utils/billingCycle.js';

console.log('Running Rent Invoice Generation Test Suite...\n');

let passes = 0;
let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passes += 1;
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${error.message}`);
    failures += 1;
  }
}

const organizationId = 1;
const properties = [
  { id: 10, organization_id: organizationId, name: 'Mzee Moja' }
];
const units = [
  { id: 20, organization_id: organizationId, property_id: 10, unit_code: 'A3' },
  { id: 21, organization_id: organizationId, property_id: 10, unit_code: 'B1' },
  { id: 22, organization_id: organizationId, property_id: 10, unit_code: 'C1' },
  { id: 23, organization_id: organizationId, property_id: 10, unit_code: 'D1' },
  { id: 24, organization_id: organizationId, property_id: 10, unit_code: 'E1' }
];
const tenants = [
  { id: 100, organization_id: organizationId, property_id: 10, unit_id: 20, full_name: 'Ready Day One', status: 'active', rent_amount: 24000, billing_day: 1 },
  { id: 101, organization_id: organizationId, property_id: 10, unit_id: 21, full_name: 'Already Billed', status: 'active', rent_amount: 18000, billing_day: 1 },
  { id: 102, organization_id: organizationId, property_id: 10, unit_id: 22, full_name: 'Vacated Tenant', status: 'vacated', rent_amount: 15000, billing_day: 1 },
  { id: 103, organization_id: organizationId, property_id: 10, unit_id: 23, full_name: 'Zero Rent', status: 'active', rent_amount: 0, billing_day: 1 },
  { id: 104, organization_id: organizationId, property_id: 10, unit_id: 24, full_name: 'Mid Month', status: 'notice', rent_amount: 30000, billing_day: 15 },
  { id: 999, organization_id: 2, property_id: 999, unit_id: 999, full_name: 'Other Organization', status: 'active', rent_amount: 99999, billing_day: 1 }
];
const existingInvoices = [
  {
    id: 500,
    organization_id: organizationId,
    tenant_id: 101,
    invoice_number: 'INV-EXISTING',
    invoice_type: 'rent',
    status: 'issued',
    issue_date: '2026-07-01',
    due_date: '2026-07-05',
    balance: 18000
  },
  {
    id: 501,
    organization_id: 2,
    tenant_id: 100,
    invoice_number: 'INV-OTHER-ORG',
    invoice_type: 'rent',
    status: 'issued',
    issue_date: '2026-07-01',
    due_date: '2026-07-05',
    balance: 24000
  }
];

function preview(overrides = {}) {
  return buildRentInvoiceGenerationPreview({
    organizationId,
    periodMonth: '2026-07',
    tenants,
    units,
    properties,
    invoices: existingInvoices,
    ...overrides
  });
}

await test('preview is read-only and creates no invoices', () => {
  const before = JSON.stringify(existingInvoices);
  const result = preview();
  assert.equal(result.financial_mutation, false);
  assert.equal(result.safety_message, 'Preview only. No invoices have been created.');
  assert.equal(JSON.stringify(existingInvoices), before);
});

await test('active tenant with no current invoice is ready_to_create', () => {
  const row = preview().rows.find(item => item.tenant_id === 100);
  assert.equal(row.status, 'ready_to_create');
  assert.equal(row.rent_amount, 24000);
});

await test('tenant with an existing rent invoice is already_invoiced', () => {
  const row = preview().rows.find(item => item.tenant_id === 101);
  assert.equal(row.status, 'already_invoiced');
  assert.equal(row.existing_invoice_id, 500);
});

await test('inactive or vacated tenant is skipped', () => {
  const row = preview().rows.find(item => item.tenant_id === 102);
  assert.equal(row.status, 'skipped');
});

await test('zero-rent tenant is skipped', () => {
  const row = preview().rows.find(item => item.tenant_id === 103);
  assert.equal(row.status, 'skipped');
  assert(row.warnings.some(warning => warning.includes('greater than zero')));
});

await test('billing day 1 calculates a calendar-month period', () => {
  const cycle = calculateRentBillingPeriod('2026-07', 1);
  assert.equal(cycle.billing_period_start, '2026-07-01');
  assert.equal(cycle.billing_period_end, '2026-07-31');
});

await test('billing day 15 calculates the 15th through the 14th', () => {
  const cycle = calculateRentBillingPeriod('2026-07', 15);
  assert.equal(cycle.billing_period_start, '2026-07-15');
  assert.equal(cycle.billing_period_end, '2026-08-14');
});

await test('billing day 31 clamps safely across short months', () => {
  const cycle = calculateRentBillingPeriod('2026-02', 31);
  assert.equal(cycle.billing_period_start, '2026-02-28');
  assert.equal(cycle.billing_period_end, '2026-03-30');
});

await test('due date defaults to 5th of the billing month', () => {
  assert.equal(calculateRentBillingPeriod('2026-07', 1).due_date, '2026-07-05');
  assert.equal(calculateRentBillingPeriod('2026-07', 15).due_date, '2026-07-05');
});

await test('confirmation requires the exact safety text', async () => {
  await assert.rejects(
    executeRentInvoiceGeneration({
      confirmationText: 'generate rent invoices',
      organizationId,
      periodMonth: '2026-07',
      tenants,
      units,
      properties,
      invoices: existingInvoices,
      createInvoice: async () => ({})
    }),
    /must exactly match/
  );
});

await test('confirm creates missing invoices and repeated confirm is idempotent', async () => {
  const invoices = existingInvoices.map(invoice => ({ ...invoice }));
  const invoiceItems = [];
  const receipts = [];
  const ledger = [];
  const paymentAllocations = [];
  let nextId = 600;

  const confirm = () => executeRentInvoiceGeneration({
    confirmationText: RENT_INVOICE_CONFIRMATION_TEXT,
    organizationId,
    periodMonth: '2026-07',
    tenants,
    units,
    properties,
    invoices,
    createInvoice: async (row, invoiceNumber) => {
      const invoice = {
        id: nextId++,
        organization_id: organizationId,
        tenant_id: row.tenant_id,
        property_id: row.property_id,
        unit_id: row.unit_id,
        invoice_number: invoiceNumber,
        invoice_type: 'rent',
        status: 'issued',
        issue_date: row.invoice_date,
        due_date: row.due_date,
        subtotal: row.rent_amount,
        total: row.rent_amount,
        balance: row.rent_amount,
        notes: row.description
      };
      invoices.push(invoice);
      invoiceItems.push({ invoice_id: invoice.id, item_type: 'rent', unit_price: row.rent_amount });
      return invoice;
    }
  });

  const beforeOutstanding = invoices
    .filter(invoice =>
      invoice.organization_id === organizationId &&
      invoice.tenant_id === 100 &&
      !['paid', 'void'].includes(invoice.status)
    )
    .reduce((sum, invoice) => sum + invoice.balance, 0);
  const first = await confirm();
  const second = await confirm();
  const generatedForReadyTenant = invoices.filter(invoice =>
    invoice.organization_id === organizationId &&
    invoice.tenant_id === 100 &&
    invoice.invoice_type === 'rent' &&
    (invoice.issue_date === '2026-06-28' || invoice.due_date === '2026-07-05')
  );
  const afterOutstanding = invoices
    .filter(invoice =>
      invoice.organization_id === organizationId &&
      invoice.tenant_id === 100 &&
      !['paid', 'void'].includes(invoice.status)
    )
    .reduce((sum, invoice) => sum + invoice.balance, 0);

  assert.equal(first.summary.created, 2);
  assert.equal(second.summary.created, 0);
  assert.equal(generatedForReadyTenant.length, 1);
  assert.equal(beforeOutstanding, 0);
  assert.equal(afterOutstanding, 24000);
  assert.equal(invoiceItems.length, 2);
  assert.equal(receipts.length, 0);
  assert.equal(ledger.length, 0);
  assert.equal(paymentAllocations.length, 0);

  const billingCycle = calculateTenantBillingCycle(
    tenants.find(tenant => tenant.id === 100),
    invoices,
    new Date('2026-07-20T10:00:00Z')
  );
  assert.equal(billingCycle.hasUnbilledWarning, false);
});

await test('preview summary is organization-scoped', () => {
  const result = preview();
  assert.equal(result.rows.some(row => row.tenant_id === 999), false);
  assert.equal(result.summary.active_tenants, 4);
  assert.equal(result.summary.ready_to_create, 2);
  assert.equal(result.summary.already_invoiced, 1);
  assert.equal(result.summary.skipped, 2);
  assert.equal(result.summary.total_amount_to_create, 54000);
});

await test('server endpoints contain no notification, receipt, ledger, allocation, or transaction writes', () => {
  const server = fs.readFileSync('server/server.js', 'utf8');
  const start = server.indexOf("app.post('/api/invoices/rent-generation-preview'");
  const end = server.indexOf('\nif (pgDb) {', start);
  assert(start >= 0 && end > start, 'rent generation endpoint block should exist');
  const endpointBlock = server.slice(start, end);
  assert(!endpointBlock.includes('NotificationService'));
  assert(!endpointBlock.includes("db.insert('receipts'"));
  assert(!endpointBlock.includes("db.insert('transactions'"));
  assert(!endpointBlock.includes("db.insert('payment_allocations'"));
  assert(!endpointBlock.includes('INSERT INTO receipts'));
  assert(!endpointBlock.includes('INSERT INTO transactions'));
  assert(!endpointBlock.includes('INSERT INTO payment_allocations'));
});

await test('Invoices UI includes preview safety copy and exact confirmation text', () => {
  const ui = fs.readFileSync('src/pages/Invoices.jsx', 'utf8');
  assert(ui.includes('Generate Rent Invoices'));
  assert(ui.includes('This preview does not create invoices. Invoices are created only after confirmation.'));
  assert(ui.includes(RENT_INVOICE_CONFIRMATION_TEXT));
});

console.log(`\nRent Invoice Generation Tests Completed: ${passes} passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
