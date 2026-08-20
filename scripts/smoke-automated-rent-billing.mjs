import { evaluateAutomatedRentBilling } from '../server/services/automatedBillingService.js';
import assert from 'assert';

console.log('[SMOKE-TEST] Starting Automated Rent Billing Engine Verification...');

async function runTest() {
  // Test reference date: July 31, 2026 (Within 3 days prior window for August 1, 2026 cycle!)
  const refDate = new Date('2026-07-31T10:00:00Z');
  
  console.log(`[SMOKE-TEST] Evaluating automated rent billing for reference date: ${refDate.toISOString()}`);
  const result = await evaluateAutomatedRentBilling(null, refDate);

  console.log('[SMOKE-TEST] Automated Rent Billing Result:', JSON.stringify(result, null, 2));

  assert.strictEqual(result.success, true, 'Result should be successful');
  assert.strictEqual(result.period_month, '2026-08', 'Target period month should be 2026-08');

  if (result.generated_count > 0) {
    for (const inv of result.invoices) {
      assert(inv.due_date.endsWith('-05'), `Invoice due date ${inv.due_date} must end with -05 (5th of the month)`);
      assert(inv.amount > 0, 'Invoice amount must be greater than zero');
      console.log(`[SMOKE-TEST] Verified generated invoice ${inv.invoice_number} for ${inv.tenant_name}: Due ${inv.due_date} 23:59:59, Amount KES ${inv.amount}`);
    }
  }

  // Verify Idempotency: Second run for same date should create 0 duplicate invoices!
  const secondRun = await evaluateAutomatedRentBilling(null, refDate);
  console.log('[SMOKE-TEST] Idempotency Second Run Created Invoices:', secondRun.generated_count);
  assert.strictEqual(secondRun.generated_count, 0, 'Second run must generate 0 duplicate invoices for the same period');

  console.log('✅ [SMOKE-TEST] All Automated Rent Billing Engine checks passed successfully!');
}

runTest().catch(err => {
  console.error('❌ [SMOKE-TEST] Test Failed:', err);
  process.exit(1);
});
