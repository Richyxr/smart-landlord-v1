import { PERSPECTIVES, DIRECTIONS, STATUSES, COLLECTION_CHANNELS, IGNORE_KEYWORDS } from './paymentEvidenceRules.js';

/**
 * Classifies a normalized payment evidence row.
 * Sets the direction, collection channel, status, and ignored_reason.
 *
 * @param {Object} row - The normalized payment evidence object.
 * @returns {Object} The classified payment evidence object.
 */
export function classifyPaymentEvidenceRow(row) {
  const result = { ...row };

  // 1. Classify Direction (Credit vs Debit) if not explicitly set
  if (!result.direction || result.direction === DIRECTIONS.UNKNOWN) {
    const textToCheck = `${result.description || ''} ${result.raw_text || ''}`.toLowerCase();

    // Signed amount check
    if (result.amount < 0) {
      result.direction = DIRECTIONS.DEBIT;
      result.amount = Math.abs(result.amount);
    } else {
      const debitKeywords = ['sent', 'withdraw', 'paybill', 'till', 'payment', 'debit', 'paid', 'transfer out', 'charge', 'fee'];
      const creditKeywords = ['received', 'credit', 'deposit', 'refund', 'money in', 'incoming'];

      let debitScore = 0;
      let creditScore = 0;

      debitKeywords.forEach(kw => { if (textToCheck.includes(kw)) debitScore++; });
      creditKeywords.forEach(kw => { if (textToCheck.includes(kw)) creditScore++; });

      if (debitScore > creditScore) {
        result.direction = DIRECTIONS.DEBIT;
      } else if (creditScore > debitScore) {
        result.direction = DIRECTIONS.CREDIT;
      } else {
        // Fallback for landlord perspective: usually we assume credit (incoming rent)
        if (result.source_perspective === PERSPECTIVES.LANDLORD) {
          result.direction = DIRECTIONS.CREDIT;
        } else if (result.source_perspective === PERSPECTIVES.TENANT) {
          // Tenant perspective: usually payments sent out are debit
          result.direction = DIRECTIONS.DEBIT;
        } else {
          result.direction = DIRECTIONS.CREDIT; // default to credit
        }
      }
    }
  }

  // 2. Classify Collection Channel to the refined enum
  if (!result.collection_channel || result.collection_channel === 'transfer' || result.collection_channel === 'unknown') {
    const provider = String(result.source_provider || '').toLowerCase();
    const textToCheck = `${result.description || ''} ${result.raw_text || ''}`.toLowerCase();

    if (result.paybill_number || textToCheck.includes('paybill')) {
      if (provider.includes('mpesa')) {
        result.collection_channel = COLLECTION_CHANNELS.MPESA_PAYBILL;
      } else {
        result.collection_channel = COLLECTION_CHANNELS.BANK_PAYBILL;
      }
    } else if (result.till_number || textToCheck.includes('till') || textToCheck.includes('buy goods')) {
      result.collection_channel = COLLECTION_CHANNELS.MPESA_TILL;
    } else if (result.agent_number || textToCheck.includes('agent')) {
      result.collection_channel = COLLECTION_CHANNELS.MPESA_AGENT;
    } else if (textToCheck.includes('pesalink')) {
      result.collection_channel = COLLECTION_CHANNELS.PESALINK;
    } else if (textToCheck.includes('cheque') || textToCheck.includes('check')) {
      result.collection_channel = COLLECTION_CHANNELS.CHEQUE;
    } else if (textToCheck.includes('cash')) {
      result.collection_channel = COLLECTION_CHANNELS.CASH;
    } else if (textToCheck.includes('deposit')) {
      result.collection_channel = COLLECTION_CHANNELS.BANK_DEPOSIT;
    } else if (result.payer_phone || result.recipient_phone || textToCheck.includes('sent to') || textToCheck.includes('send money')) {
      if (provider.includes('mpesa')) {
        result.collection_channel = COLLECTION_CHANNELS.MPESA_SEND_MONEY;
      } else {
        result.collection_channel = COLLECTION_CHANNELS.UNKNOWN;
      }
    } else if (textToCheck.includes('transfer') || textToCheck.includes('eft') || textToCheck.includes('rtgs') || textToCheck.includes('bank')) {
      result.collection_channel = COLLECTION_CHANNELS.BANK_TRANSFER;
    } else {
      result.collection_channel = COLLECTION_CHANNELS.UNKNOWN;
    }
  }

  // 3. Check for Ignore Keywords
  const textToScan = `${result.description || ''} ${result.raw_text || ''} ${result.payer_name || ''}`.toLowerCase();
  const matchedKeyword = IGNORE_KEYWORDS.find(keyword => textToScan.includes(keyword));

  if (matchedKeyword) {
    result.status = STATUSES.IGNORED;
    result.ignored_reason = `contains_ignored_keyword: ${matchedKeyword}`;
    return result;
  }

  // 4. Perspective-based Ignore Rules
  if (result.source_perspective === PERSPECTIVES.LANDLORD) {
    // Landlord money-out (debit) is ignored by default
    if (result.direction === DIRECTIONS.DEBIT) {
      result.status = STATUSES.IGNORED;
      result.ignored_reason = 'landlord_debit_ignored';
    }
  }

  // Note: Tenant money-out (debit) is NOT ignored (it is possible proof of payment).

  return result;
}
