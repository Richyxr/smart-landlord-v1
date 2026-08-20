import { db } from '../server/db.js';

console.log('[CLEANUP] Inspecting database for duplicate rent invoices...');

const invoices = db.get('invoices');
const tenants = db.get('tenants');

const seenPeriodMap = new Map(); // tenant_id + period -> keepFirstInvoiceId
const toVoidIds = [];

for (const inv of invoices) {
  if (inv.invoice_type !== 'rent' || inv.status === 'void') continue;
  
  const issueDateStr = inv.issue_date || (inv.created_at ? String(inv.created_at).substring(0, 10) : '');
  const key = `${inv.tenant_id}_${issueDateStr}`;

  if (seenPeriodMap.has(key)) {
    // Duplicate invoice for same tenant & issue_date!
    toVoidIds.push(inv.id);
  } else {
    seenPeriodMap.set(key, inv.id);
  }
}

console.log(`[CLEANUP] Found ${toVoidIds.length} duplicate rent invoice(s) to void:`, toVoidIds);

for (const id of toVoidIds) {
  db.update('invoices', id, { status: 'void', voided_at: new Date().toISOString() });
}

// Recalculate tenant balances based on unvoided invoices minus payments
for (const tenant of tenants) {
  const activeTenantInvoices = db.find('invoices', { tenant_id: tenant.id })
    .filter(inv => inv.status !== 'void');
  
  const totalInvoiced = activeTenantInvoices.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
  const totalPaid = activeTenantInvoices.reduce((sum, inv) => sum + (parseFloat(inv.amount_paid) || 0), 0);
  const trueBalance = Math.max(0, totalInvoiced - totalPaid);

  db.update('tenants', tenant.id, { balance: trueBalance });
  console.log(`[CLEANUP] Tenant ${tenant.full_name} (ID ${tenant.id}) balance updated to: KES ${trueBalance}`);
}

console.log('✅ [CLEANUP] Duplicate invoice cleanup complete!');
