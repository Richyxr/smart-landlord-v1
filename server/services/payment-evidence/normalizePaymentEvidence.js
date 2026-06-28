import crypto from 'crypto';
import { PERSPECTIVES, DIRECTIONS, STATUSES, DOCUMENT_SOURCES, EVIDENCE_STRENGTHS } from './paymentEvidenceRules.js';

export function generateRowHash(rawData) {
  const content = typeof rawData === 'string'
    ? rawData
    : JSON.stringify(rawData, Object.keys(rawData || {}).sort());
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Normalizes a raw payment evidence row into the standard normalized structure.
 *
 * @param {Object} rawData - The raw row data object.
 * @param {Object} context - Context information (organization_id, batch_id, source_provider, source_type, source_perspective, document_source, mappings).
 * @returns {Object} Normalized payment evidence object.
 */
export function normalizePaymentEvidence(rawData, context = {}) {
  const orgId = context.organization_id || rawData.organization_id;
  if (!orgId) {
    throw new Error('Normalization failed: organization_id is required.');
  }

  // Resolve mappings or fallback to defaults
  const mappings = context.mappings || {};
  const getMapped = (field, fallbackKeys = []) => {
    if (mappings[field] && rawData[mappings[field]] !== undefined) {
      return rawData[mappings[field]];
    }
    if (rawData[field] !== undefined) {
      return rawData[field];
    }
    for (const key of fallbackKeys) {
      if (rawData[key] !== undefined) {
        return rawData[key];
      }
    }
    return null;
  };

  // 1. Amount validation & parsing
  const rawAmount = getMapped('amount', ['Amount', 'value']);
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') {
    throw new Error('Normalization failed: amount is required.');
  }
  const amount = parseFloat(rawAmount);
  if (isNaN(amount) || amount < 0) {
    throw new Error('Normalization failed: amount must be a non-negative number.');
  }

  // 2. Date validation & parsing
  const rawDate = getMapped('transaction_date', ['Date', 'transaction_date_time', 'date']);
  if (!rawDate) {
    throw new Error('Normalization failed: transaction_date is required.');
  }

  let transaction_date = null;
  let transaction_time = null;

  try {
    const parsedDate = new Date(rawDate);
    if (isNaN(parsedDate.getTime())) {
      throw new Error();
    }
    transaction_date = parsedDate.toISOString().split('T')[0];

    // Check if time is in rawDate or separately
    const rawTime = getMapped('transaction_time', ['Time', 'time']);
    if (rawTime) {
      transaction_time = String(rawTime).trim();
    } else if (typeof rawDate === 'string' && rawDate.includes('T')) {
      const parts = rawDate.split('T')[1];
      if (parts) {
        transaction_time = parts.split('.')[0].split('+')[0].split('Z')[0];
      }
    } else if (typeof rawDate === 'string' && rawDate.includes(' ')) {
      const parts = rawDate.split(' ')[1];
      if (parts) {
        transaction_time = parts;
      }
    }
  } catch (_err) {
    throw new Error(`Normalization failed: invalid transaction_date format '${rawDate}'.`);
  }

  // 3. Other fields
  const source_provider = context.source_provider || rawData.source_provider || 'unknown';
  const source_type = context.source_type || rawData.source_type || 'unknown';
  const source_perspective = context.source_perspective || rawData.source_perspective || PERSPECTIVES.UNKNOWN;
  const document_source = context.document_source || rawData.document_source || DOCUMENT_SOURCES.UNKNOWN;

  // Clean strings
  const cleanStr = (val) => {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s ? s : null;
  };

  const transaction_code = cleanStr(getMapped('transaction_code', ['Reference', 'reference', 'receipt', 'reference_number', 'Transaction Code', 'TxCode']));
  const payer_name = cleanStr(getMapped('payer_name', ['Payer name', 'Payer Name', 'CustomerName', 'name']));
  const payer_phone = cleanStr(getMapped('payer_phone', ['Payer phone', 'Payer Phone', 'MSISDN', 'phone']));
  const recipient_name = cleanStr(getMapped('recipient_name', ['Recipient Name', 'Recipient name']));
  const recipient_phone = cleanStr(getMapped('recipient_phone', ['Recipient Phone', 'Recipient phone']));

  const paybill_number = cleanStr(getMapped('paybill_number', ['Paybill', 'PayBill', 'paybill']));
  const till_number = cleanStr(getMapped('till_number', ['Till', 'TillNumber', 'till']));
  const agent_number = cleanStr(getMapped('agent_number', ['Agent', 'AgentNumber', 'agent']));

  const reference_account = cleanStr(getMapped('reference_account', ['Account number', 'Account Number', 'account_number', 'BillRefNumber', 'reference_account']));
  const description = cleanStr(getMapped('description', ['Description', 'desc', 'Notes', 'notes']));

  const raw_text = cleanStr(rawData.raw_text || rawData.rawText || JSON.stringify(rawData));
  const row_hash = generateRowHash(rawData);

  // Preserve raw fields exactly
  let raw_fields = null;
  try {
    raw_fields = typeof rawData === 'string' ? JSON.parse(rawData) : { ...rawData };
  } catch (_e) {
    raw_fields = { raw: rawData };
  }

  // Future Matchers placeholders
  const paybill_reference = cleanStr(getMapped('paybill_reference'));
  const bank_reference = cleanStr(getMapped('bank_reference'));
  const recipient_account = cleanStr(getMapped('recipient_account'));
  const invoice_reference = cleanStr(getMapped('invoice_reference'));
  const landlord_account_number = cleanStr(getMapped('landlord_account_number'));

  return {
    organization_id: Number(orgId),
    batch_id: context.batch_id ? Number(context.batch_id) : (rawData.batch_id ? Number(rawData.batch_id) : null),
    source_provider,
    source_type,
    source_perspective,
    document_source,
    collection_channel: cleanStr(getMapped('collection_channel')),
    transaction_date,
    transaction_time,
    amount,
    direction: getMapped('direction') || DIRECTIONS.UNKNOWN,
    transaction_code: transaction_code ? transaction_code.toUpperCase() : null,
    payer_name,
    payer_phone,
    recipient_name,
    recipient_phone,
    paybill_number,
    till_number,
    agent_number,
    reference_account,
    description,
    raw_text,
    raw_fields,
    row_hash,
    confidence: null,
    evidence_strength: EVIDENCE_STRENGTHS.UNKNOWN,
    status: STATUSES.IMPORTED,
    ignored_reason: null,

    // Future placeholders
    paybill_reference,
    bank_reference,
    recipient_account,
    invoice_reference,
    landlord_account_number
  };
}
