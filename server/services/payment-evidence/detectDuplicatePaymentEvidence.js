import { STATUSES } from './paymentEvidenceRules.js';

/**
 * Detects if a payment evidence row is a duplicate.
 * Checks for transaction_code uniqueness in posted payments (transactions) and imported evidence.
 * Checks for row_hash uniqueness in imported evidence.
 *
 * @param {Object} row - The normalized and classified payment evidence object.
 * @param {Object} activeDb - The active database client (supporting find).
 * @returns {Promise<Object>} The updated payment evidence object.
 */
export async function detectDuplicatePaymentEvidence(row, activeDb) {
  if (!activeDb) {
    return row;
  }

  const result = { ...row };
  const orgId = result.organization_id;

  // 1. Check Row Hash Duplicate
  if (result.row_hash) {
    const hashMatches = await activeDb.find('payment_evidence', {
      organization_id: orgId,
      row_hash: result.row_hash
    });

    const duplicateHash = hashMatches.find(m => m.id !== result.id);
    if (duplicateHash) {
      result.status = STATUSES.DUPLICATE;
      result.ignored_reason = 'duplicate_row_hash';
      return result;
    }
  }

  // 2. Check Transaction Code Duplicate (where present)
  if (result.transaction_code) {
    // Check against posted payments (transactions table)
    const transactionMatches = await activeDb.find('transactions', {
      organization_id: orgId,
      reference_number: result.transaction_code
    });

    const activeTxDuplicate = transactionMatches.find(tx => tx.status !== 'failed');
    if (activeTxDuplicate) {
      result.status = STATUSES.DUPLICATE;
      result.ignored_reason = 'duplicate_transaction_code_posted';
      return result;
    }

    // Check against imported evidence (payment_evidence table)
    const evidenceMatches = await activeDb.find('payment_evidence', {
      organization_id: orgId,
      transaction_code: result.transaction_code
    });

    const duplicateEvidence = evidenceMatches.find(m => m.id !== result.id && m.status !== STATUSES.IGNORED && m.status !== STATUSES.FAILED_VALIDATION);
    if (duplicateEvidence) {
      result.status = STATUSES.DUPLICATE;
      result.ignored_reason = 'duplicate_transaction_code_imported';
      return result;
    }
  }

  return result;
}
