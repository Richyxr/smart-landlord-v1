import { evaluateAutomatedRentBilling } from '../server/services/automatedBillingService.js';

console.log('[AUTO-BILLING-TRIGGER] Executing automated rent billing for active database store...');

async function run() {
  const result = await evaluateAutomatedRentBilling(null, new Date());
  console.log('[AUTO-BILLING-TRIGGER] Result:', JSON.stringify(result, null, 2));
}

run().catch(console.error);
