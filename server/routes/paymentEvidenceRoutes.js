import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { db as localDb } from '../db.js';
import { normalizePaymentEvidence } from '../services/payment-evidence/normalizePaymentEvidence.js';
import { classifyPaymentEvidenceRow } from '../services/payment-evidence/classifyPaymentEvidenceRow.js';
import { StatementIngestionService } from '../services/payment-evidence/StatementIngestionService.js';

// Memory-only multer instance for PDF readiness preview (no files written to disk)
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB hard cap
});

// Memory-only multer instance for universal statement reconciliation preview
const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB hard cap
});

function asyncHandler(handler) {
  return (req, res, next) => {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const normalizePhone = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-9);
};

const getDaysDifference = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return Infinity;
  const diffTime = Math.abs(d1.getTime() - d2.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const RECEIPT_ISSUANCE_CONTRACT_SAFETY_MESSAGE = 'This receipt issuance contract is read-only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.';
const MATCH_SELECTION_CONFIRMATION_TEXT = 'CONFIRM MATCH SELECTION';
const PDF_TEXT_SAMPLE_LIMIT = 2000;
const PDF_PREVIEW_ROW_LIMIT = 100;
const PDF_PREVIEW_ROW_RAW_TEXT_LIMIT = 500;
const LOOP_PDF_IMPORT_CONFIRMATION_TEXT = 'CONFIRM LOOP PDF IMPORT';
const CONFIRM_SELECTED_ALLOCATION_TEXT = 'CONFIRM SELECTED ALLOCATION';
const PDF_DETECTION_KEYWORDS = [
  'ACCOUNT STATEMENT',
  'CUSTOMER ADVICE',
  'Date',
  'Debit',
  'Credit',
  'Balance',
  'Transaction',
  'Ref',
  'M-PESA',
  'Pay Bill',
  'Received'
];

const PDF_PROVIDER_UNKNOWN = {
  detected_provider: 'UNKNOWN_STATEMENT',
  detected_statement_type: 'unknown_statement',
  confidence: 'unknown',
  score: 0,
  matched_indicators: [],
  warnings: []
};

const PDF_PROVIDER_DETECTION_RULES = [
  {
    provider: 'LOOP_STATEMENT',
    statementType: 'account_statement',
    indicators: [
      { value: 'ACCOUNT STATEMENT', weight: 30 },
      { value: 'LOOP Ref', weight: 15 },
      { value: 'Customer Number', weight: 15 },
      { value: 'Account Number', weight: 15 },
      { value: 'WLTBNK', weight: 15 },
      { value: 'Received', weight: 5 },
      { value: 'Via NCBA', weight: 15 },
      { value: 'Payment In', weight: 5 },
      { value: 'Payment Out', weight: 5 },
      { value: 'Debit', weight: 5 },
      { value: 'Credit', weight: 5 },
      { value: 'Balance', weight: 5 },
      { value: 'Pay Bill Bill Payment', weight: 15 }
    ]
  },
  {
    provider: 'COOP_BANK_STATEMENT',
    statementType: 'account_statement',
    indicators: [
      { value: 'STATEMENT OF ACCOUNT', weight: 30 },
      { value: 'COOP HOUSE BRANCH', weight: 15 },
      { value: 'Swift code KCOOKENA', weight: 15 },
      { value: 'Account Currency', weight: 15 },
      { value: 'Branch', weight: 15 },
      { value: 'Transaction Details', weight: 15 },
      { value: 'Money In', weight: 5 },
      { value: 'Money Out', weight: 5 },
      { value: 'Balance', weight: 5 }
    ]
  },
  {
    provider: 'CUSTOMER_ADVICE',
    statementType: 'customer_advice',
    indicators: [
      { value: 'CUSTOMER ADVICE', weight: 30 },
      { value: 'Sender Details', weight: 15 },
      { value: 'Beneficiary details', weight: 15 },
      { value: 'Transaction Type', weight: 15 },
      { value: 'Transaction Reference', weight: 15 },
      { value: 'Bill Payment', weight: 15 },
      { value: 'Pay Bill Number', weight: 15 },
      { value: 'Beneficiary Account Number', weight: 15 }
    ]
  },
  {
    provider: 'MPESA_STATEMENT',
    statementType: 'mpesa_statement',
    indicators: [
      { value: 'M-PESA Statement', weight: 35 },
      { value: 'M-PESA', weight: 30 },
      { value: 'MPESA', weight: 30 },
      { value: 'Safaricom', weight: 20 },
      { value: 'Receipt No', weight: 15 },
      { value: 'Completion Time', weight: 15 },
      { value: 'Paid In', weight: 5 },
      { value: 'Withdrawn', weight: 5 },
      { value: 'Balance', weight: 5 },
      { value: 'Transaction Status', weight: 15 },
      { value: 'Transaction Type', weight: 10 },
      { value: 'Pay Bill', weight: 8 },
      { value: 'Buy Goods', weight: 8 },
      { value: 'Customer Transfer', weight: 8 },
      { value: 'Business Payment', weight: 8 },
      { value: 'Funds received from', weight: 8 },
      { value: 'Deposit of Funds', weight: 8 }
    ]
  }
];

function resolveProviderDetectionConfidence(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

export function detectPdfStatementProvider(text) {
  const normalized = String(text || '').toUpperCase();
  const strongLoopIndicators = ['LOOP REF', 'VIA NCBA', 'CUSTOMER NUMBER', 'WLTBNK', 'PAY BILL BILL PAYMENT'];
  const strongLoopMatchCount = strongLoopIndicators.filter(indicator => normalized.includes(indicator)).length;
  const results = PDF_PROVIDER_DETECTION_RULES.map((rule) => {
    const matched = [];
    let score = 0;

    for (const indicator of rule.indicators) {
      if (normalized.includes(indicator.value.toUpperCase())) {
        matched.push(indicator.value);
        score += indicator.weight;
      }
    }

    let adjustedScore = Math.min(100, score);
    if (rule.provider === 'LOOP_STATEMENT' && strongLoopMatchCount > 0) {
      // Bias toward LOOP when Loop-specific markers are present to avoid false
      // positives from generic "statement/account" wording.
      adjustedScore = Math.min(100, adjustedScore + (strongLoopMatchCount * 12));
    }

    return {
      provider: rule.provider,
      statementType: rule.statementType,
      matched,
      score: adjustedScore
    };
  });

  const best = results.reduce((acc, current) => {
    if (!acc) return current;
    if (current.score > acc.score) return current;
    if (current.score === acc.score && current.matched.length > acc.matched.length) return current;
    return acc;
  }, null);

  if (!best || best.score === 0) {
    return { ...PDF_PROVIDER_UNKNOWN };
  }

  const confidence = resolveProviderDetectionConfidence(best.score);
  const confidenceTooLow = best.score < 25;
  const warnings = [];

  if (confidenceTooLow || confidence === 'low') {
    warnings.push('Low-confidence provider detection. Confirm statement source manually before enabling parser import.');
  }

  if (confidenceTooLow) {
    return {
      detected_provider: 'UNKNOWN_STATEMENT',
      detected_statement_type: 'unknown_statement',
      confidence,
      score: best.score,
      matched_indicators: best.matched,
      warnings
    };
  }

  return {
    detected_provider: best.provider,
    detected_statement_type: best.statementType,
    confidence,
    score: best.score,
    matched_indicators: best.matched,
    warnings
  };
}

function buildDraftReceiptNumberPreview(orgId, row) {
  const parsedDate = row && row.transaction_date ? new Date(row.transaction_date) : new Date();
  const year = isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear();
  return `DRAFT-RCP-${orgId}-${year}-PREVIEW`;
}

function safeReceiptOrgIdentifier(orgId, organization) {
  const raw = organization && organization.account_number ? organization.account_number : orgId;
  const cleaned = String(raw || orgId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return cleaned || String(orgId);
}

function receiptYearFromEvidence(row) {
  const parsedDate = row && row.transaction_date ? new Date(row.transaction_date) : new Date();
  return isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear();
}

function buildFinalReceiptNumber(orgIdentifier, year, sequence) {
  return `RCP-${orgIdentifier}-${year}-${String(sequence).padStart(6, '0')}`;
}

function normalizePdfExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function detectPdfKeywords(text) {
  const normalized = String(text || '').toLowerCase();
  return PDF_DETECTION_KEYWORDS.filter(keyword => normalized.includes(keyword.toLowerCase()));
}

function decodeSimplePdfTextLiteral(value) {
  return String(value || '')
    .replace(/\\\)/g, ')')
    .replace(/\\\(/g, '(')
    .replace(/\\\\/g, '\\');
}

function extractSimplePdfTextOperators(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  const raw = buffer.toString('latin1');
  const lines = [];
  const textObjectPattern = /BT[\s\S]*?\(([^()]*(?:\\.[^()]*)*)\)\s*Tj[\s\S]*?ET/g;
  let match = textObjectPattern.exec(raw);
  while (match) {
    const line = decodeSimplePdfTextLiteral(match[1]).trim();
    if (line) lines.push(line);
    match = textObjectPattern.exec(raw);
  }
  return lines.join('\n');
}

function normalizeLoopNumeric(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatLoopDateToIso(day, monthText, year) {
  const monthLookup = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12'
  };
  const month = monthLookup[String(monthText || '').slice(0, 3).toLowerCase()];
  if (!month) return null;
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  if (!Number.isFinite(dayNumber) || !Number.isFinite(yearNumber)) return null;
  return `${String(yearNumber).padStart(4, '0')}-${month}-${String(dayNumber).padStart(2, '0')}`;
}

function extractLoopTransactionDate(text) {
  const raw = String(text || '');
  const isoMatch = raw.match(/(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?/);
  if (isoMatch && isoMatch[1]) return isoMatch[1];

  const humanDateMatch = raw.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
  if (humanDateMatch) {
    return formatLoopDateToIso(humanDateMatch[1], humanDateMatch[2], humanDateMatch[3]);
  }

  return null;
}

function extractLoopMonetaryColumns(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const numberPattern = '(-?\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)';
  const match = raw.match(new RegExp(`${numberPattern}\\s+${numberPattern}\\s+${numberPattern}\\s*$`));
  if (!match) return null;
  return {
    debit: normalizeLoopNumeric(match[1]),
    credit: normalizeLoopNumeric(match[2]),
    balance: normalizeLoopNumeric(match[3]),
    numericTail: match[0]
  };
}

function deriveLoopCollectionChannel(text) {
  const lowered = String(text || '').toLowerCase();
  if (lowered.includes('received') && lowered.includes('via ncba')) return 'bank_transfer';
  if (lowered.includes('deposit from mobile money')) return 'mobile_money';
  if (lowered.includes('pay bill')) return 'paybill';
  if (lowered.includes('send money to mobile')) return 'mobile_transfer';
  if (/(loop charge|access fee|access fees|excise duty|debit interest|interest settlement|charge)/i.test(lowered)) return 'fee';
  return 'unknown';
}

function extractLoopTransactionCode(text) {
  const raw = String(text || '');
  const loopRef = raw.match(/LOOP\s*Ref\s*:\s*([A-Z0-9]{6,})/i);
  if (loopRef && loopRef[1]) return loopRef[1].toUpperCase();

  const dashRef = raw.match(/-\s*([A-Z0-9]{8,})\b/i);
  if (dashRef && dashRef[1]) return dashRef[1].toUpperCase();

  return null;
}

function extractLoopPartnerReference(text) {
  const raw = String(text || '');
  const partner = raw.match(/Partner\s*Ref\s*:\s*([A-Z0-9]{6,})/i);
  if (partner && partner[1]) return partner[1].toUpperCase();

  const genericRef = raw.match(/\bref\s*:?[\s-]*([A-Z0-9]{6,})\b/i);
  if (genericRef && genericRef[1]) return genericRef[1].toUpperCase();

  return null;
}

function isLoopFeeOrChargeRow(text, channel) {
  if (channel === 'fee') return true;
  return /(loop charge|access fee|access fees|excise duty|debit interest|interest settlement|charge)/i.test(String(text || ''));
}

function reconstructLoopLogicalRows(text) {
  const lines = String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const rows = [];
  let current = '';
  for (const line of lines) {
    current = current ? `${current} ${line}` : line;
    const hasMonetaryTail = Boolean(extractLoopMonetaryColumns(current));
    if (hasMonetaryTail) {
      rows.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    rows.push(current.trim());
  }

  return rows;
}

export function parseLoopStatementPreviewRows(text) {
  const logicalRows = reconstructLoopLogicalRows(text);
  const warnings = [];
  let rowsDetected = 0;
  let rowsSkipped = 0;
  const parsedRows = [];

  for (const rowText of logicalRows) {
    const monetary = extractLoopMonetaryColumns(rowText);
    if (!monetary) continue;
    rowsDetected += 1;

    const transactionDate = extractLoopTransactionDate(rowText);
    const code = extractLoopTransactionCode(rowText);
    const partnerReference = extractLoopPartnerReference(rowText);
    const channel = deriveLoopCollectionChannel(rowText);
    const isSkippedFee = isLoopFeeOrChargeRow(rowText, channel);

    if (isSkippedFee) {
      rowsSkipped += 1;
      continue;
    }

    const direction = monetary.credit > 0 && monetary.debit === 0
      ? 'money_in'
      : (monetary.debit > 0 && monetary.credit === 0 ? 'money_out' : 'unknown');
    const amount = direction === 'money_in'
      ? monetary.credit
      : (direction === 'money_out' ? monetary.debit : Math.max(monetary.credit, monetary.debit));
    const rowWarnings = [];

    const description = rowText
      .replace(monetary.numericTail, '')
      .replace(/\s+/g, ' ')
      .trim();

    parsedRows.push({
      source_row_index: rowsDetected,
      transaction_date: transactionDate,
      value_date: transactionDate,
      description,
      transaction_code: code,
      partner_reference: partnerReference,
      debit: monetary.debit,
      credit: monetary.credit,
      amount,
      direction,
      balance: monetary.balance,
      collection_channel: channel,
      document_source: 'PDF_STATEMENT',
      source_provider: 'LOOP_STATEMENT',
      source_perspective: 'landlord',
      raw_text: rowText.slice(0, PDF_PREVIEW_ROW_RAW_TEXT_LIMIT),
      warnings: rowWarnings
    });

    if (parsedRows.length >= PDF_PREVIEW_ROW_LIMIT) {
      warnings.push(`Preview row limit reached (${PDF_PREVIEW_ROW_LIMIT}). Additional parsed rows were not returned.`);
      break;
    }
  }

  const duplicateLikeCodes = new Set();
  const codeCounts = parsedRows.reduce((acc, row) => {
    if (!row.transaction_code) return acc;
    const key = String(row.transaction_code).toUpperCase();
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  for (const [code, count] of codeCounts.entries()) {
    if (count > 1) duplicateLikeCodes.add(code);
  }

  const previewRows = parsedRows.map((row) => {
    const validation = validateLoopPreviewRow(row, { duplicateLikeCodes });
    const confidence = scoreLoopPreviewRow(row, validation);
    const validationErrors = [];
    const rowWarnings = [...(Array.isArray(row.warnings) ? row.warnings : [])];

    if (!validation.has_valid_date) validationErrors.push('Missing or invalid transaction_date.');
    if (!validation.has_valid_amount) validationErrors.push('Missing or invalid amount.');
    if (!validation.has_transaction_code) validationErrors.push('Missing transaction_code.');
    if (!validation.has_direction) validationErrors.push('Missing or ambiguous transaction direction.');
    if (!validation.has_balance) validationErrors.push('Missing or invalid balance value.');
    if (!validation.has_supported_channel) validationErrors.push('Unsupported or unknown collection channel.');
    if (validation.is_duplicate_like) {
      validationErrors.push('Duplicate-like transaction code detected in preview rows.');
      rowWarnings.push('Duplicate-like transaction code detected in preview rows.');
    }

    let rowStatus = 'needs_attention';
    if (validation.is_fee_or_charge) {
      rowStatus = 'skipped';
    } else if (validation.is_valid && (confidence.parser_confidence === 'high' || confidence.parser_confidence === 'medium')) {
      rowStatus = 'ready_for_review';
    }

    return {
      ...row,
      row_status: rowStatus,
      parser_confidence: confidence.parser_confidence,
      confidence_score: confidence.confidence_score,
      validation,
      validation_errors: validationErrors,
      warnings: Array.from(new Set(rowWarnings))
    };
  });

  if (rowsDetected === 0) {
    warnings.push('No Loop-style transaction rows with debit/credit/balance columns were detected.');
  }

  return {
    rowsDetected,
    rowsSkipped,
    previewRows,
    warnings
  };
}

export function validateLoopPreviewRow(row, context = {}) {
  const duplicateLikeCodes = context.duplicateLikeCodes || new Set();
  const transactionCode = row && row.transaction_code ? String(row.transaction_code).toUpperCase() : '';
  const hasValidDate = typeof row.transaction_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.transaction_date);
  const amount = Number(row.amount);
  const balance = Number(row.balance);
  const channel = String(row.collection_channel || 'unknown');

  const validation = {
    is_valid: false,
    has_valid_date: hasValidDate,
    has_valid_amount: Number.isFinite(amount) && amount > 0,
    has_transaction_code: Boolean(transactionCode),
    has_direction: row.direction === 'money_in' || row.direction === 'money_out',
    has_balance: Number.isFinite(balance),
    has_supported_channel: channel !== 'unknown',
    is_fee_or_charge: isLoopFeeOrChargeRow(row.raw_text || row.description || '', channel),
    is_duplicate_like: transactionCode ? duplicateLikeCodes.has(transactionCode) : false
  };

  validation.is_valid = validation.has_valid_date &&
    validation.has_valid_amount &&
    validation.has_transaction_code &&
    validation.has_direction &&
    validation.has_balance &&
    validation.has_supported_channel &&
    !validation.is_fee_or_charge &&
    !validation.is_duplicate_like;

  return validation;
}

export function scoreLoopPreviewRow(row, validation) {
  let score = 0;

  if (validation.has_valid_date) score += 15;
  if (validation.has_valid_amount) score += 15;
  if (validation.has_transaction_code) score += 20;
  if (validation.has_direction) score += 15;
  if (validation.has_supported_channel) score += 10;
  if (validation.has_balance) score += 10;
  if (row && row.partner_reference) score += 5;
  if (!validation.is_fee_or_charge) score += 10;

  let parserConfidence = 'unknown';
  if (score >= 80) parserConfidence = 'high';
  else if (score >= 55) parserConfidence = 'medium';
  else if (score >= 25) parserConfidence = 'low';

  return {
    confidence_score: score,
    parser_confidence: parserConfidence
  };
}

export function summarizeLoopParserValidation(rows, skippedCount) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const summary = {
    ready_for_review_count: safeRows.filter(row => row.row_status === 'ready_for_review').length,
    needs_attention_count: safeRows.filter(row => row.row_status === 'needs_attention').length,
    skipped_count: Number(skippedCount) || 0,
    high_confidence_count: safeRows.filter(row => row.parser_confidence === 'high').length,
    medium_confidence_count: safeRows.filter(row => row.parser_confidence === 'medium').length,
    low_confidence_count: safeRows.filter(row => row.parser_confidence === 'low').length,
    unknown_confidence_count: safeRows.filter(row => row.parser_confidence === 'unknown').length,
    warnings: ['Import remains disabled. Row validation is for parser review only.']
  };

  return summary;
}

function normalizeMpesaNumeric(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMpesaPhone(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1, 10)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function formatMpesaDateToIso(rawDate) {
  const text = String(rawDate || '').trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return text;

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${String(slashMatch[2]).padStart(2, '0')}-${String(slashMatch[1]).padStart(2, '0')}`;
  }

  return null;
}

function extractMpesaMonetaryColumns(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const numberPattern = '(-?\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)';
  const match = raw.match(new RegExp(`${numberPattern}\\s+${numberPattern}\\s+${numberPattern}\\s*$`));
  if (!match) return null;
  return {
    paidIn: normalizeMpesaNumeric(match[1]),
    withdrawn: normalizeMpesaNumeric(match[2]),
    balance: normalizeMpesaNumeric(match[3]),
    numericTail: match[0]
  };
}

function reconstructMpesaLogicalRows(text) {
  const lines = String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const rows = [];
  let current = '';

  for (const line of lines) {
    const startsTransaction = /\b[A-Z0-9]{8,12}\b\s+(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s+\d{2}:\d{2}:\d{2}/i.test(line);
    if (startsTransaction) {
      if (current && extractMpesaMonetaryColumns(current)) {
        rows.push(current.trim());
      }
      current = line;
    } else {
      current = current ? `${current} ${line}` : line;
    }

    if (extractMpesaMonetaryColumns(current)) {
      rows.push(current.trim());
      current = '';
    }
  }

  if (current.trim() && extractMpesaMonetaryColumns(current)) {
    rows.push(current.trim());
  }

  return rows;
}

function isMpesaFeeOrChargeRow(text) {
  return /(charge|transaction cost|withdrawal charge|pay bill charge|m-pesa charges|mpesa charges|excise duty|fee)/i.test(String(text || ''));
}

function deriveMpesaTransactionType(text) {
  const raw = String(text || '').toLowerCase();
  if (isMpesaFeeOrChargeRow(raw)) return 'fee';
  if (/(pay\s*bill|paybill)/i.test(raw)) return 'paybill_payment';
  if (/(buy goods|till)/i.test(raw)) return 'buy_goods';
  if (/(customer transfer|funds received from|deposit of funds)/i.test(raw)) return 'customer_transfer';
  if (/business payment/i.test(raw)) return 'business_payment';
  return 'unknown';
}

function extractMpesaPayer(description) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  const phoneMatch = text.match(/\b(254\d{9}|0\d{9})\b/);
  const payerPhone = phoneMatch ? normalizeMpesaPhone(phoneMatch[1]) : null;
  let payerName = null;

  if (phoneMatch) {
    const beforePhone = text.slice(0, phoneMatch.index || 0);
    const nameMatch = beforePhone.match(/\b(?:from|received from|funds received from|customer transfer from|payment from)\s+([A-Z][A-Z\s'.-]{2,})\s*$/i);
    if (nameMatch && nameMatch[1]) {
      payerName = String(nameMatch[1]).replace(/\s+/g, ' ').trim();
    }
  }

  return {
    payer_name: payerName || null,
    payer_phone: payerPhone || null
  };
}

function extractMpesaReferenceAccount(description) {
  const text = String(description || '');
  const accountMatch = text.match(/\bAccount\s+([A-Z0-9][A-Z0-9._/-]{1,40})\b/i);
  if (accountMatch && accountMatch[1]) return accountMatch[1].toUpperCase();

  const referenceMatch = text.match(/\b(?:Reference|Ref|Bill Ref|Account No)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{1,40})\b/i);
  if (referenceMatch && referenceMatch[1]) return referenceMatch[1].toUpperCase();

  return null;
}

function parseMpesaLogicalRow(rowText, sourceRowIndex) {
  const raw = String(rowText || '').replace(/\s+/g, ' ').trim();
  const monetary = extractMpesaMonetaryColumns(raw);
  if (!monetary) return null;

  const withoutTail = raw.replace(monetary.numericTail, '').trim();
  const match = withoutTail.match(/^([A-Z0-9]{8,12})\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)(?:\s+(Completed|Complete|Successful|Success|Failed|Cancelled|Reversed))?$/i);
  if (!match) {
    return {
      source_row_index: sourceRowIndex,
      transaction_date: null,
      transaction_time: null,
      transaction_code: null,
      description: withoutTail,
      payer_name: null,
      payer_phone: null,
      paybill_reference: null,
      reference_account: null,
      debit: monetary.withdrawn,
      credit: monetary.paidIn,
      amount: Math.max(monetary.paidIn, monetary.withdrawn),
      direction: 'unknown',
      balance: monetary.balance,
      collection_channel: 'mpesa',
      transaction_type: deriveMpesaTransactionType(withoutTail),
      document_source: 'MPESA_STATEMENT',
      source_provider: 'MPESA',
      source_perspective: 'landlord',
      raw_text: raw.slice(0, PDF_PREVIEW_ROW_RAW_TEXT_LIMIT),
      warnings: ['Could not parse M-Pesa receipt/date/time fields.']
    };
  }

  const transactionCode = String(match[1] || '').toUpperCase();
  const transactionDate = formatMpesaDateToIso(match[2]);
  const transactionTime = match[3] || null;
  const description = String(match[4] || '').replace(/\s+/g, ' ').trim();
  const payer = extractMpesaPayer(description);
  const referenceAccount = extractMpesaReferenceAccount(description);
  const direction = monetary.paidIn > 0 && monetary.withdrawn === 0
    ? 'money_in'
    : (monetary.withdrawn > 0 && monetary.paidIn === 0 ? 'money_out' : 'unknown');
  const amount = direction === 'money_in'
    ? monetary.paidIn
    : (direction === 'money_out' ? monetary.withdrawn : Math.max(monetary.paidIn, monetary.withdrawn));

  return {
    source_row_index: sourceRowIndex,
    transaction_date: transactionDate,
    transaction_time: transactionTime,
    transaction_code: transactionCode,
    description,
    payer_name: payer.payer_name,
    payer_phone: payer.payer_phone,
    paybill_reference: referenceAccount,
    reference_account: referenceAccount,
    debit: monetary.withdrawn,
    credit: monetary.paidIn,
    amount,
    direction,
    balance: monetary.balance,
    collection_channel: 'mpesa',
    transaction_type: deriveMpesaTransactionType(description),
    document_source: 'MPESA_STATEMENT',
    source_provider: 'MPESA',
    source_perspective: 'landlord',
    raw_text: raw.slice(0, PDF_PREVIEW_ROW_RAW_TEXT_LIMIT),
    warnings: []
  };
}

export function validateMpesaPreviewRow(row, context = {}) {
  const duplicateLikeCodes = context.duplicateLikeCodes || new Set();
  const transactionCode = row && row.transaction_code ? String(row.transaction_code).toUpperCase() : '';
  const amount = Number(row && row.amount);
  const balance = Number(row && row.balance);
  const channel = String(row && row.collection_channel || 'unknown');
  const validation = {
    is_valid: false,
    has_valid_date: Boolean(row && typeof row.transaction_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.transaction_date)),
    has_valid_amount: Number.isFinite(amount) && amount > 0,
    has_transaction_code: Boolean(transactionCode),
    has_direction: row && (row.direction === 'money_in' || row.direction === 'money_out'),
    has_balance: Number.isFinite(balance),
    has_supported_channel: channel === 'mpesa',
    is_fee_or_charge: Boolean(row && (row.transaction_type === 'fee' || isMpesaFeeOrChargeRow(row.raw_text || row.description || ''))),
    is_duplicate_like: transactionCode ? duplicateLikeCodes.has(transactionCode) : false
  };

  validation.is_valid = validation.has_valid_date &&
    validation.has_valid_amount &&
    validation.has_transaction_code &&
    validation.has_direction &&
    validation.has_balance &&
    validation.has_supported_channel &&
    !validation.is_fee_or_charge &&
    !validation.is_duplicate_like;

  return validation;
}

export function scoreMpesaPreviewRow(row, validation) {
  let score = 0;

  if (validation.has_valid_date) score += 15;
  if (validation.has_valid_amount) score += 15;
  if (validation.has_transaction_code) score += 20;
  if (validation.has_direction) score += 15;
  if (validation.has_supported_channel) score += 10;
  if (validation.has_balance) score += 10;
  if (row && (row.payer_name || row.payer_phone || row.reference_account || row.paybill_reference)) score += 10;
  if (!validation.is_fee_or_charge) score += 5;

  let parserConfidence = 'unknown';
  if (score >= 80) parserConfidence = 'high';
  else if (score >= 55) parserConfidence = 'medium';
  else if (score >= 25) parserConfidence = 'low';

  return {
    confidence_score: score,
    parser_confidence: parserConfidence
  };
}

export function parseMpesaStatementPreviewRows(text) {
  const logicalRows = reconstructMpesaLogicalRows(text);
  const warnings = [];
  let rowsDetected = 0;
  let rowsSkipped = 0;
  const parsedRows = [];

  for (const rowText of logicalRows) {
    const monetary = extractMpesaMonetaryColumns(rowText);
    if (!monetary) continue;
    rowsDetected += 1;

    if (isMpesaFeeOrChargeRow(rowText)) {
      rowsSkipped += 1;
      continue;
    }

    const row = parseMpesaLogicalRow(rowText, rowsDetected);
    if (!row) continue;
    parsedRows.push(row);

    if (parsedRows.length >= PDF_PREVIEW_ROW_LIMIT) {
      warnings.push(`Preview row limit reached (${PDF_PREVIEW_ROW_LIMIT}). Additional parsed rows were not returned.`);
      break;
    }
  }

  const duplicateLikeCodes = new Set();
  const codeCounts = parsedRows.reduce((acc, row) => {
    if (!row.transaction_code) return acc;
    const key = String(row.transaction_code).toUpperCase();
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  for (const [code, count] of codeCounts.entries()) {
    if (count > 1) duplicateLikeCodes.add(code);
  }

  const previewRows = parsedRows.map((row) => {
    const validation = validateMpesaPreviewRow(row, { duplicateLikeCodes });
    const confidence = scoreMpesaPreviewRow(row, validation);
    const validationErrors = [];
    const rowWarnings = [...(Array.isArray(row.warnings) ? row.warnings : [])];

    if (!validation.has_valid_date) validationErrors.push('Missing or invalid transaction_date.');
    if (!validation.has_valid_amount) validationErrors.push('Missing or invalid amount.');
    if (!validation.has_transaction_code) validationErrors.push('Missing transaction_code.');
    if (!validation.has_direction) validationErrors.push('Missing or ambiguous transaction direction.');
    if (!validation.has_balance) validationErrors.push('Missing or invalid balance value.');
    if (!validation.has_supported_channel) validationErrors.push('Unsupported or unknown collection channel.');
    if (validation.is_duplicate_like) {
      validationErrors.push('Duplicate-like transaction code detected in preview rows.');
      rowWarnings.push('Duplicate-like transaction code detected in preview rows.');
    }

    let rowStatus = 'needs_attention';
    if (validation.is_fee_or_charge) {
      rowStatus = 'skipped';
    } else if (validation.is_valid && (confidence.parser_confidence === 'high' || confidence.parser_confidence === 'medium')) {
      rowStatus = 'ready_for_review';
    }

    return {
      ...row,
      row_status: rowStatus,
      parser_confidence: confidence.parser_confidence,
      confidence_score: confidence.confidence_score,
      validation,
      validation_errors: validationErrors,
      warnings: Array.from(new Set(rowWarnings))
    };
  });

  if (rowsDetected === 0) {
    warnings.push('No M-Pesa-style transaction rows with paid-in/withdrawn/balance columns were detected.');
  }

  return {
    rowsDetected,
    rowsSkipped,
    previewRows,
    warnings
  };
}

export function summarizeMpesaParserValidation(rows, skippedCount) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    ready_for_review_count: safeRows.filter(row => row.row_status === 'ready_for_review').length,
    needs_attention_count: safeRows.filter(row => row.row_status === 'needs_attention').length,
    skipped_count: Number(skippedCount) || 0,
    high_confidence_count: safeRows.filter(row => row.parser_confidence === 'high').length,
    medium_confidence_count: safeRows.filter(row => row.parser_confidence === 'medium').length,
    low_confidence_count: safeRows.filter(row => row.parser_confidence === 'low').length,
    unknown_confidence_count: safeRows.filter(row => row.parser_confidence === 'unknown').length,
    warnings: ['M-Pesa parser preview is enabled for review only. Import remains disabled.']
  };
}

function normalizeLoopImportPhone(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1, 10)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function extractLoopPayerFromRawText(rawText) {
  const text = String(rawText || '');
  const phoneMatch = text.match(/\b(254\d{9}|0\d{9})\b/);
  const phone = phoneMatch ? normalizeLoopImportPhone(phoneMatch[1]) : null;

  let payerName = null;
  if (phoneMatch) {
    const left = text.slice(0, phoneMatch.index || 0);
    const nameMatch = left.match(/([A-Z][A-Z\s'.-]{2,})\s*,?\s*$/i);
    if (nameMatch && nameMatch[1]) {
      payerName = String(nameMatch[1]).replace(/\s+/g, ' ').trim();
    }
  }

  return {
    payer_name: payerName || null,
    payer_phone: phone || null
  };
}

export function buildLoopPdfPaymentEvidenceImportRows(previewRows) {
  const rows = Array.isArray(previewRows) ? previewRows : [];
  const eligibleRows = [];
  const skippedSummary = {
    duplicate_like: 0,
    needs_attention: 0,
    fee_or_charge: 0,
    missing_required_fields: 0
  };

  for (const row of rows) {
    const validation = row && row.validation ? row.validation : {};
    const amount = Number(row && row.amount);
    const hasValidDate = typeof (row && row.transaction_date) === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.transaction_date);
    const hasCode = Boolean(row && row.transaction_code);

    if (validation.is_fee_or_charge) {
      skippedSummary.fee_or_charge += 1;
      continue;
    }

    if (validation.is_duplicate_like) {
      skippedSummary.duplicate_like += 1;
      continue;
    }

    if (
      row.row_status !== 'ready_for_review' ||
      !['high', 'medium'].includes(row.parser_confidence) ||
      validation.is_valid !== true ||
      validation.is_fee_or_charge === true ||
      validation.is_duplicate_like === true
    ) {
      skippedSummary.needs_attention += 1;
      continue;
    }

    if (!hasCode || !hasValidDate || !Number.isFinite(amount) || amount <= 0) {
      skippedSummary.missing_required_fields += 1;
      continue;
    }

    eligibleRows.push(row);
  }

  return {
    eligibleRows,
    skippedSummary
  };
}

async function buildPdfTextExtractionPreview(file) {
  let parsed = null;
  let fallbackText = '';
  try {
    parsed = await pdfParse(file.buffer);
  } catch (_err) {
    parsed = null;
    fallbackText = extractSimplePdfTextOperators(file && file.buffer);
  }

  const extractedText = normalizePdfExtractedText((parsed && parsed.text) || fallbackText);
  const lines = extractedText
    ? extractedText.split('\n').map(line => line.trim()).filter(Boolean)
    : [];
  const pageCount = parsed && Number.isFinite(Number(parsed.numpages)) ? Number(parsed.numpages) : 0;
  const textAvailable = extractedText.length > 0;

  return {
    parserStatus: textAvailable ? 'text_extraction_enabled' : 'no_text_found',
    extractedText,
    extraction: {
      text_available: textAvailable,
      text_length: extractedText.length,
      page_count: textAvailable ? pageCount : 0,
      sample_text: extractedText.slice(0, PDF_TEXT_SAMPLE_LIMIT),
      line_count: lines.length,
      detected_keywords: textAvailable ? detectPdfKeywords(extractedText) : []
    }
  };
}

async function hasReceiptSchema(activeDb) {
  if (activeDb && activeDb.tables && Object.prototype.hasOwnProperty.call(activeDb.tables, 'receipts')) {
    return true;
  }

  if (activeDb && typeof activeDb.query === 'function') {
    const result = await activeDb.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'receipts') AS exists"
    );
    return Boolean(result.rows && result.rows[0] && result.rows[0].exists);
  }

  if (activeDb && typeof activeDb.get === 'function') {
    const receipts = await activeDb.get('receipts');
    return Array.isArray(receipts);
  }

  return false;
}

async function getReceiptDuplicateCheckState(activeDb, orgId, rowId, transaction, allocation) {
  const receiptSchemaEnabled = await hasReceiptSchema(activeDb);
  if (!receiptSchemaEnabled) {
    return 'receipt_schema_not_enabled';
  }

  if (activeDb && typeof activeDb.query === 'function') {
    const columnsResult = await activeDb.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'receipts'"
    );
    const columns = new Set((columnsResult.rows || []).map(row => row.column_name));
    const clauses = [];
    const values = [];

    const addCandidate = (column, value) => {
      if (!columns.has(column) || value === null || value === undefined) return;
      values.push(value);
      clauses.push(`${column} = $${values.length}`);
    };

    addCandidate('transaction_id', transaction ? transaction.id : null);
    addCandidate('payment_allocation_id', allocation ? allocation.id : null);
    addCandidate('payment_evidence_id', rowId);
    addCandidate('source_payment_evidence_id', rowId);

    if (clauses.length === 0) {
      return 'receipt_schema_not_enabled';
    }

    let sql = `SELECT id FROM receipts WHERE (${clauses.join(' OR ')})`;
    if (columns.has('organization_id')) {
      values.push(orgId);
      sql += ` AND organization_id = $${values.length}`;
    }
    sql += ' LIMIT 1';

    const duplicateResult = await activeDb.query(sql, values);
    return duplicateResult.rows && duplicateResult.rows.length > 0 ? 'existing_receipt_found' : 'no_existing_receipt';
  }

  const receipts = typeof activeDb.get === 'function'
    ? await activeDb.get('receipts')
    : [];
  const duplicate = receipts.find(receipt => {
    if (receipt.organization_id !== undefined && Number(receipt.organization_id) !== Number(orgId)) return false;
    return (
      (transaction && Number(receipt.transaction_id) === Number(transaction.id)) ||
      (allocation && Number(receipt.payment_allocation_id) === Number(allocation.id)) ||
      Number(receipt.payment_evidence_id) === Number(rowId) ||
      Number(receipt.source_payment_evidence_id) === Number(rowId)
    );
  });

  return duplicate ? 'existing_receipt_found' : 'no_existing_receipt';
}

function buildReceiptIssuanceContract({
  orgId,
  row,
  isAllocated,
  transaction,
  allocation,
  invoice,
  tenant,
  duplicateCheckState
}) {
  const blockingReasons = [];

  if (!isAllocated) {
    blockingReasons.push('Payment evidence must be allocated before receipt issuance.');
  }
  if (!transaction) {
    blockingReasons.push('An existing reconciled transaction is required before receipt issuance.');
  }
  if (!allocation) {
    blockingReasons.push('An existing payment allocation is required before receipt issuance.');
  }
  if (!invoice) {
    blockingReasons.push('An existing invoice is required before receipt issuance.');
  }
  if (!tenant) {
    blockingReasons.push('An existing tenant is required before receipt issuance.');
  }
  if (duplicateCheckState === 'existing_receipt_found') {
    blockingReasons.push('An existing receipt already references this payment evidence, transaction, or allocation.');
  }
  if (duplicateCheckState === 'receipt_schema_not_enabled') {
    blockingReasons.push('Receipt storage schema is not enabled yet.');
  }

  const canIssueReceipt = blockingReasons.length === 0;

  return {
    can_issue_receipt: canIssueReceipt,
    state: canIssueReceipt ? 'ready_for_confirmed_receipt_issuance' : 'issuance_blocked',
    required_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
    requires_allocated_payment_evidence: true,
    requires_existing_transaction: true,
    requires_existing_payment_allocation: true,
    requires_existing_invoice: true,
    requires_existing_tenant: true,
    requires_no_existing_receipt: true,
    duplicate_check_state: duplicateCheckState,
    receipt_number_strategy: 'preview_only_not_reserved',
    receipt_number_format_preview: 'RCP-{ORG}-{YYYY}-{SEQUENCE}',
    receipt_number_preview: buildDraftReceiptNumberPreview(orgId, row),
    blocking_reasons: blockingReasons,
    safety_message: RECEIPT_ISSUANCE_CONTRACT_SAFETY_MESSAGE
  };
}

async function getAllocatedReceiptContext(activeDb, orgId, rowId) {
  const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
  if (!row) {
    return { row: null };
  }

  const isAllocated = row.status === 'manually_reconciled' || row.status === 'auto_reconciled';
  const txs = await activeDb.find('transactions', { organization_id: orgId });
  const transaction = txs.find(t => {
    try {
      const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
      return payload && Number(payload.evidence_id) === Number(rowId);
    } catch (e) {
      return false;
    }
  });

  const allocation = transaction
    ? await activeDb.findOne('payment_allocations', { transaction_id: transaction.id, organization_id: orgId })
    : null;

  const tenant = row.accepted_tenant_id
    ? await activeDb.findOne('tenants', { id: Number(row.accepted_tenant_id), organization_id: orgId })
    : null;

  const invoice = row.accepted_invoice_id
    ? await activeDb.findOne('invoices', { id: Number(row.accepted_invoice_id), organization_id: orgId })
    : null;

  const organization = await activeDb.findOne('organizations', { id: Number(orgId) });
  const duplicateCheckState = await getReceiptDuplicateCheckState(activeDb, orgId, rowId, transaction, allocation);
  const receiptIssuanceContract = buildReceiptIssuanceContract({
    orgId,
    row,
    isAllocated,
    transaction,
    allocation,
    invoice,
    tenant,
    duplicateCheckState
  });

  return {
    row,
    isAllocated,
    transaction,
    allocation,
    tenant,
    invoice,
    organization,
    duplicateCheckState,
    receiptIssuanceContract
  };
}

function buildReceiptPayload({ orgId, userId, row, transaction, allocation, tenant, invoice, receiptNumber, issuedAt }) {
  const amountPaid = Number(allocation.amount_allocated);
  const receiptLines = [
    {
      label: 'Rent payment allocation',
      amount: amountPaid
    }
  ];

  return {
    organization_id: Number(orgId),
    tenant_id: tenant.id,
    tenant_name: tenant.full_name,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    transaction_id: transaction.id,
    payment_allocation_id: allocation.id,
    payment_evidence_id: row.id,
    payment_date: row.transaction_date,
    payment_method: row.collection_channel || transaction.payment_method || 'other',
    amount_paid: amountPaid,
    invoice_status_at_issue: invoice.status,
    invoice_balance_after_allocation: Number(invoice.balance),
    receipt_number: receiptNumber,
    issued_at: issuedAt,
    issued_by_user_id: userId,
    receipt_lines: receiptLines
  };
}

function mapReceiptResponse(receipt, tenant, invoice, transaction, allocation) {
  const payload = typeof receipt.receipt_payload === 'string'
    ? JSON.parse(receipt.receipt_payload)
    : (receipt.receipt_payload || {});

  return {
    id: receipt.id,
    receipt_number: receipt.receipt_number,
    status: receipt.status,
    issued_at: receipt.issued_at,
    amount: Number(receipt.amount),
    tenant_id: receipt.tenant_id,
    tenant_name: payload.tenant_name || (tenant ? tenant.full_name : null),
    invoice_id: receipt.invoice_id,
    invoice_number: payload.invoice_number || (invoice ? invoice.invoice_number : null),
    transaction_id: receipt.transaction_id || (transaction ? transaction.id : null),
    payment_allocation_id: receipt.payment_allocation_id || (allocation ? allocation.id : null)
  };
}

async function insertIssuedReceipt(activeDb, context, orgId, userId) {
  const { row, transaction, allocation, tenant, invoice, organization } = context;
  const issuedAt = new Date().toISOString();
  const year = receiptYearFromEvidence(row);
  const orgIdentifier = safeReceiptOrgIdentifier(orgId, organization);
  const prefix = `RCP-${orgIdentifier}-${year}-`;
  const amount = Number(allocation.amount_allocated);
  const paymentMethod = row.collection_channel || transaction.payment_method || 'other';

  if (activeDb.pool && typeof activeDb.pool.connect === 'function') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await activeDb.pool.connect();
      try {
        await client.query('BEGIN');
        const duplicate = await client.query(
          `
            SELECT id FROM receipts
            WHERE organization_id = $1
              AND (
                payment_allocation_id = $2
                OR payment_evidence_id = $3
                OR transaction_id = $4
              )
            LIMIT 1
          `,
          [orgId, allocation.id, row.id, transaction.id]
        );
        if (duplicate.rows.length > 0) {
          await client.query('ROLLBACK');
          return { duplicate: true };
        }

        const countResult = await client.query(
          'SELECT COUNT(*)::int AS count FROM receipts WHERE organization_id = $1 AND receipt_number LIKE $2',
          [orgId, `${prefix}%`]
        );
        const receiptNumber = buildFinalReceiptNumber(orgIdentifier, year, Number(countResult.rows[0].count) + 1 + attempt);
        const payload = buildReceiptPayload({ orgId, userId, row, transaction, allocation, tenant, invoice, receiptNumber, issuedAt });

        const insertResult = await client.query(
          `
            INSERT INTO receipts (
              organization_id,
              tenant_id,
              invoice_id,
              transaction_id,
              payment_allocation_id,
              payment_evidence_id,
              receipt_number,
              status,
              issued_at,
              issued_by_user_id,
              amount,
              currency,
              payment_method,
              receipt_payload,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued', $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
            RETURNING *
          `,
          [
            orgId,
            tenant.id,
            invoice.id,
            transaction.id,
            allocation.id,
            row.id,
            receiptNumber,
            issuedAt,
            userId,
            amount,
            tenant.currency || invoice.currency || transaction.currency || 'KES',
            paymentMethod,
            JSON.stringify(payload),
            JSON.stringify({
              source: 'payment_evidence_issue_receipt',
              payment_evidence_id: row.id,
              immutable_snapshot: true
            })
          ]
        );

        await client.query('COMMIT');
        return { receipt: insertResult.rows[0] };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error && error.code === '23505') {
          const constraint = String(error.constraint || '');
          if (constraint.includes('receipt_number') && attempt < 2) {
            continue;
          }
          return { duplicate: true };
        }
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error('Unable to generate a unique receipt number after retries.');
  }

  const existingReceipts = await activeDb.get('receipts');
  const duplicate = existingReceipts.find(receipt => (
    Number(receipt.organization_id) === Number(orgId) &&
    (
      Number(receipt.payment_allocation_id) === Number(allocation.id) ||
      Number(receipt.payment_evidence_id) === Number(row.id) ||
      Number(receipt.transaction_id) === Number(transaction.id)
    )
  ));
  if (duplicate) {
    return { duplicate: true };
  }

  const sequence = existingReceipts.filter(receipt => (
    Number(receipt.organization_id) === Number(orgId) &&
    String(receipt.receipt_number || '').startsWith(prefix)
  )).length + 1;
  const receiptNumber = buildFinalReceiptNumber(orgIdentifier, year, sequence);
  const payload = buildReceiptPayload({ orgId, userId, row, transaction, allocation, tenant, invoice, receiptNumber, issuedAt });
  const receipt = await activeDb.insert('receipts', {
    organization_id: orgId,
    tenant_id: tenant.id,
    invoice_id: invoice.id,
    transaction_id: transaction.id,
    payment_allocation_id: allocation.id,
    payment_evidence_id: row.id,
    receipt_number: receiptNumber,
    status: 'issued',
    issued_at: issuedAt,
    issued_by_user_id: userId,
    amount,
    currency: tenant.currency || invoice.currency || transaction.currency || 'KES',
    payment_method: paymentMethod,
    receipt_payload: payload,
    metadata: {
      source: 'payment_evidence_issue_receipt',
      payment_evidence_id: row.id,
      immutable_snapshot: true
    }
  });

  return { receipt };
}

function calculateCandidateScore(row, tenant, invoice, unit, property) {
  const reasons = [];
  const warnings = [];
  let score = 0;
  let confidence = 'low';

  const amount = Number(row.amount);
  const invBalance = Number(invoice.balance);
  const invTotal = Number(invoice.total);
  const isAmountMatch = (amount === invBalance || amount === invTotal);

  // 1. Reference Account / Tenant Account Number Match
  let refAccMatch = false;
  if (row.reference_account && tenant.tenant_account_number) {
    if (row.reference_account.trim().toLowerCase() === tenant.tenant_account_number.trim().toLowerCase()) {
      refAccMatch = true;
    }
  }

  // 2. Invoice Number Match
  let invNumMatch = false;
  const invNum = String(invoice.invoice_number || '').trim().toLowerCase();
  if (invNum) {
    if (row.transaction_code && String(row.transaction_code).trim().toLowerCase() === invNum) {
      invNumMatch = true;
    }
    if (row.paybill_reference && String(row.paybill_reference).trim().toLowerCase() === invNum) {
      invNumMatch = true;
    }
    if (row.invoice_reference && String(row.invoice_reference).trim().toLowerCase() === invNum) {
      invNumMatch = true;
    }
    if (row.description && String(row.description).trim().toLowerCase().includes(invNum)) {
      invNumMatch = true;
    }
  }

  // 3. Phone Match
  let phoneMatch = false;
  if (row.payer_phone && tenant.phone_number) {
    const p1 = normalizePhone(row.payer_phone);
    const p2 = normalizePhone(tenant.phone_number);
    if (p1 && p2 && p1 === p2) {
      phoneMatch = true;
    }
  }

  // 4. Name Match
  let nameMatch = false;
  if (row.payer_name && tenant.full_name) {
    const n1 = row.payer_name.trim().toLowerCase();
    const n2 = tenant.full_name.trim().toLowerCase();
    if (n1.includes(n2) || n2.includes(n1)) {
      nameMatch = true;
    }
  }

  // 5. Unit Match
  let unitMatch = false;
  if (unit && unit.unit_code) {
    const uc = unit.unit_code.trim().toLowerCase();
    if (row.description && row.description.toLowerCase().includes(uc)) {
      unitMatch = true;
    }
    if (row.reference_account && row.reference_account.toLowerCase().includes(uc)) {
      unitMatch = true;
    }
    if (row.payer_name && row.payer_name.toLowerCase().includes(uc)) {
      unitMatch = true;
    }
  }

  // Determine score and confidence
  if (refAccMatch) {
    if (isAmountMatch) {
      score = 95;
      confidence = 'high';
      reasons.push('Reference account matches tenant account number and amount matches invoice balance.');
    } else {
      score = 75;
      confidence = 'medium';
      reasons.push('Reference account matches tenant account number but amount does not match invoice balance.');
      warnings.push('Amount mismatch with matching tenant account reference.');
    }
  } else if (invNumMatch) {
    if (isAmountMatch) {
      score = 95;
      confidence = 'high';
      reasons.push('Invoice number matches payment evidence reference and amount matches invoice balance.');
    } else {
      score = 75;
      confidence = 'medium';
      reasons.push('Invoice number matches payment evidence reference but amount does not match invoice balance.');
      warnings.push('Amount mismatch with matching invoice number reference.');
    }
  } else if (phoneMatch && isAmountMatch) {
    const diffDays = getDaysDifference(row.transaction_date, invoice.due_date);
    if (diffDays <= 30) {
      score = 90;
      confidence = 'high';
      reasons.push('Tenant phone matches payer phone and amount matches invoice balance within date window.');
    } else {
      score = 70;
      confidence = 'medium';
      reasons.push('Tenant phone matches payer phone and amount matches invoice balance outside date window.');
      warnings.push('Date difference between payment and invoice exceeds 30 days.');
    }
  } else if (phoneMatch) {
    score = 65;
    confidence = 'medium';
    reasons.push('Tenant phone matches payer phone but amount does not match invoice balance.');
    warnings.push('Amount mismatch with matching phone number.');
  } else if (nameMatch && isAmountMatch) {
    score = 70;
    confidence = 'medium';
    reasons.push('Payer name is similar to tenant full name and amount matches invoice balance.');
  } else if (unitMatch && isAmountMatch) {
    score = 70;
    confidence = 'medium';
    reasons.push('Unit code matches payment narration / reference and amount matches invoice balance.');
  } else if (nameMatch) {
    score = 40;
    confidence = 'low';
    reasons.push('Payer name is similar to tenant full name but amount does not match invoice balance.');
    warnings.push('Name similarity match only (amount mismatch).');
  } else if (unitMatch) {
    score = 35;
    confidence = 'low';
    reasons.push('Unit code is mentioned in payment narration / reference but amount does not match invoice balance.');
    warnings.push('Unit code match only (amount mismatch).');
  } else if (isAmountMatch) {
    score = 50;
    confidence = 'low';
    reasons.push('Amount matches invoice balance exactly (no other matching signals).');
    warnings.push('Amount-only match; high risk of false positive.');
  }

  if (score === 0) {
    return null;
  }

  const propertyPrefix = property ? `${property.name} - ` : '';
  const unitLabel = unit ? `${propertyPrefix}${unit.unit_code}` : 'N/A';

  return {
    tenant_id: tenant.id,
    tenant_name: tenant.full_name,
    tenant_phone: tenant.phone_number || 'N/A',
    unit_label: unitLabel,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    invoice_status: invoice.status,
    invoice_balance: Number(invoice.balance),
    invoice_due_date: invoice.due_date,
    match_score: score,
    match_confidence: confidence,
    match_reasons: reasons,
    match_warnings: warnings
  };
}

async function buildPaymentEvidenceMatchingSuggestions(activeDb, orgId, evidenceRows, maxSuggestionsPerRow = 3) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  if (rows.length === 0) return [];

  const allTenants = await activeDb.find('tenants', { organization_id: orgId });
  const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
  const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
  const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];

  const unitsMap = new Map(allUnits.map(u => [u.id, u]));
  const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
  const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
  const activeTenantMap = new Map(activeTenants.map(t => [t.id, t]));
  const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

  return rows.map((row) => {
    let suggestions = [];
    if (row.status !== 'ignored') {
      for (const inv of eligibleInvoices) {
        const activeTenant = activeTenantMap.get(inv.tenant_id);
        if (!activeTenant) continue;
        const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
        const property = unit ? propertiesMap.get(unit.property_id) : null;

        const match = calculateCandidateScore(row, activeTenant, inv, unit, property);
        if (match) {
          suggestions.push(match);
        }
      }

      suggestions.sort((a, b) => {
        if (b.match_score !== a.match_score) {
          return b.match_score - a.match_score;
        }
        const confWeight = { high: 3, medium: 2, low: 1 };
        const weightA = confWeight[a.match_confidence] || 0;
        const weightB = confWeight[b.match_confidence] || 0;
        if (weightB !== weightA) {
          return weightB - weightA;
        }
        if (a.invoice_due_date !== b.invoice_due_date) {
          return String(b.invoice_due_date || '').localeCompare(String(a.invoice_due_date || ''));
        }
        return Number(b.invoice_id || 0) - Number(a.invoice_id || 0);
      });

      suggestions = suggestions.slice(0, maxSuggestionsPerRow);
    }

    return {
      payment_evidence_id: row.id,
      transaction_code: row.transaction_code || null,
      match_count: suggestions.length,
      top_match_confidence: suggestions[0] ? suggestions[0].match_confidence : 'none',
      top_match_score: suggestions[0] ? suggestions[0].match_score : 0,
      suggestions
    };
  });
}

function getConfidenceLabelFromScore(score) {
  const numericScore = Number(score || 0);
  if (numericScore >= 85) return 'high';
  if (numericScore >= 60) return 'medium';
  if (numericScore > 0) return 'low';
  return 'none';
}

function buildEvidenceCandidateSignals(row, tenant, invoice, unit) {
  const rowAmount = Number(row.amount);
  const invBalance = Number(invoice.balance);
  const invTotal = Number(invoice.total);
  const isAmountMatch = rowAmount === invBalance || rowAmount === invTotal;

  let referenceAccountMatch = false;
  if (row.reference_account && tenant.tenant_account_number) {
    referenceAccountMatch = String(row.reference_account).trim().toLowerCase() === String(tenant.tenant_account_number).trim().toLowerCase();
  }

  const invoiceNumber = String(invoice.invoice_number || '').trim().toLowerCase();
  let invoiceReferenceMatch = false;
  if (invoiceNumber) {
    invoiceReferenceMatch = (
      (row.transaction_code && String(row.transaction_code).trim().toLowerCase() === invoiceNumber) ||
      (row.paybill_reference && String(row.paybill_reference).trim().toLowerCase() === invoiceNumber) ||
      (row.invoice_reference && String(row.invoice_reference).trim().toLowerCase() === invoiceNumber) ||
      (row.description && String(row.description).trim().toLowerCase().includes(invoiceNumber))
    );
  }

  let phoneMatch = false;
  if (row.payer_phone && tenant.phone_number) {
    const p1 = normalizePhone(row.payer_phone);
    const p2 = normalizePhone(tenant.phone_number);
    phoneMatch = Boolean(p1 && p2 && p1 === p2);
  }

  let nameMatch = false;
  if (row.payer_name && tenant.full_name) {
    const n1 = String(row.payer_name).trim().toLowerCase();
    const n2 = String(tenant.full_name).trim().toLowerCase();
    nameMatch = n1.includes(n2) || n2.includes(n1);
  }

  let unitMatch = false;
  if (unit && unit.unit_code) {
    const uc = String(unit.unit_code).trim().toLowerCase();
    unitMatch = (
      (row.description && String(row.description).toLowerCase().includes(uc)) ||
      (row.reference_account && String(row.reference_account).toLowerCase().includes(uc)) ||
      (row.payer_name && String(row.payer_name).toLowerCase().includes(uc))
    );
  }

  const matchedSignals = [];
  if (invoiceReferenceMatch) matchedSignals.push('invoice_reference_exact');
  if (referenceAccountMatch) matchedSignals.push('tenant_account_reference_exact');
  if (phoneMatch) matchedSignals.push('tenant_phone_exact');
  if (nameMatch) matchedSignals.push('tenant_name_similar');
  if (unitMatch) matchedSignals.push('unit_reference_match');
  if (isAmountMatch) matchedSignals.push('amount_exact');

  return {
    isAmountMatch,
    invoiceReferenceMatch,
    referenceAccountMatch,
    phoneMatch,
    nameMatch,
    unitMatch,
    matchedSignals
  };
}

function deriveSuggestionTypeFromSignals(signals) {
  if (signals.invoiceReferenceMatch && signals.isAmountMatch) return 'invoice_reference_exact';
  if (signals.referenceAccountMatch && signals.isAmountMatch) return 'tenant_account_reference_exact';
  if (signals.phoneMatch && signals.isAmountMatch) return 'amount_plus_tenant_phone';
  if (signals.nameMatch && signals.isAmountMatch) return 'amount_plus_tenant_name';
  if (signals.unitMatch && signals.isAmountMatch) return 'amount_plus_unit_reference';
  if (signals.isAmountMatch) return 'amount_only';
  if (signals.phoneMatch) return 'tenant_phone_only';
  if (signals.nameMatch) return 'tenant_name_only';
  if (signals.referenceAccountMatch) return 'tenant_account_reference_only';
  return 'heuristic_candidate';
}

export function buildPaymentEvidenceAllocationPreview({ evidence, tenant, invoice }) {
  const warnings = [];
  const paymentAmount = Number(evidence?.amount || 0);

  const totalAmount = Number(invoice?.total ?? invoice?.total_amount ?? 0);
  const amountPaid = Number(invoice?.amount_paid ?? 0);
  let balanceDue = Number(invoice?.balance ?? (totalAmount - amountPaid));
  if (!Number.isFinite(balanceDue)) balanceDue = 0;
  balanceDue = Math.max(0, balanceDue);

  const invoiceStatus = String(invoice?.status || 'unknown').toLowerCase();
  if (invoiceStatus === 'paid') {
    warnings.push('Selected invoice appears already paid. Preview is shown for review only.');
  }

  let allocationType = 'blocked';
  let allocationAmount = 0;
  let balanceAfter = balanceDue;
  let invoiceStatusAfter = invoice?.status || 'unknown';
  let overpaymentAmount = 0;
  let underpaymentAmount = 0;
  let canPreview = true;

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    allocationType = 'blocked';
    canPreview = false;
    warnings.push('Payment evidence amount is invalid for allocation preview.');
  } else if (balanceDue <= 0) {
    allocationType = 'blocked';
    canPreview = false;
    balanceAfter = 0;
    warnings.push('Invoice has no outstanding balance.');
  } else if (paymentAmount === balanceDue) {
    allocationType = 'full_payment';
    allocationAmount = balanceDue;
    balanceAfter = 0;
    invoiceStatusAfter = 'paid';
  } else if (paymentAmount < balanceDue) {
    allocationType = 'partial_payment';
    allocationAmount = paymentAmount;
    balanceAfter = balanceDue - paymentAmount;
    underpaymentAmount = balanceDue - paymentAmount;
    invoiceStatusAfter = 'partially_paid';
  } else {
    allocationType = 'overpayment';
    allocationAmount = balanceDue;
    balanceAfter = 0;
    overpaymentAmount = paymentAmount - balanceDue;
    invoiceStatusAfter = 'paid';
    warnings.push('Payment amount exceeds invoice balance. Excess should remain unallocated or become wallet credit in a later controlled slice.');
  }

  return {
    canPreview,
    selectedMatch: {
      tenant_id: tenant?.id || null,
      tenant_name: tenant?.full_name || null,
      invoice_id: invoice?.id || null,
      invoice_number: invoice?.invoice_number || null
    },
    payment: {
      amount: paymentAmount,
      transaction_code: evidence?.transaction_code || null,
      transaction_date: evidence?.transaction_date || null,
      source_provider: evidence?.source_provider || null,
      document_source: evidence?.document_source || null
    },
    invoiceBefore: {
      invoice_id: invoice?.id || null,
      invoice_number: invoice?.invoice_number || null,
      status: invoice?.status || null,
      total_amount: totalAmount,
      amount_paid: amountPaid,
      balance_due: balanceDue
    },
    allocationPreview: {
      allocation_amount: allocationAmount,
      balance_before: balanceDue,
      balance_after: balanceAfter,
      invoice_status_after: invoiceStatusAfter,
      allocation_type: allocationType,
      overpayment_amount: overpaymentAmount,
      underpayment_amount: underpaymentAmount
    },
    warnings
  };
}

async function buildReviewOnlyMatchingSuggestionsForEvidence(activeDb, orgId, evidenceRow, maxSuggestions = 5) {
  if (!evidenceRow || evidenceRow.status === 'ignored') {
    return [];
  }

  const allTenants = await activeDb.find('tenants', { organization_id: orgId });
  const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
  const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
  const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];

  const unitsMap = new Map(allUnits.map(u => [u.id, u]));
  const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
  const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
  const activeTenantMap = new Map(activeTenants.map(t => [t.id, t]));

  const rawSuggestions = [];

  for (const inv of allInvoices) {
    if (String(inv.status || '').toLowerCase() === 'void') continue;

    const activeTenant = activeTenantMap.get(inv.tenant_id);
    if (!activeTenant) continue;

    const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
    const property = unit ? propertiesMap.get(unit.property_id) : null;
    const base = calculateCandidateScore(evidenceRow, activeTenant, inv, unit, property);
    if (!base) continue;

    const signals = buildEvidenceCandidateSignals(evidenceRow, activeTenant, inv, unit);
    let confidenceScore = Number(base.match_score || 0);
    const warnings = Array.isArray(base.match_warnings) ? [...base.match_warnings] : [];

    if (String(inv.status || '').toLowerCase() === 'paid') {
      warnings.push('Invoice is already paid. Confidence reduced for review-only safety.');
      confidenceScore = Math.max(15, confidenceScore - 35);
    }

    rawSuggestions.push({
      payment_evidence_id: evidenceRow.id,
      tenant_id: base.tenant_id,
      tenant_name: base.tenant_name,
      tenant_phone: base.tenant_phone,
      unit_label: base.unit_label,
      invoice_id: base.invoice_id,
      invoice_number: base.invoice_number,
      invoice_status: base.invoice_status,
      invoice_balance: base.invoice_balance,
      invoice_due_date: base.invoice_due_date,
      confidence: getConfidenceLabelFromScore(confidenceScore),
      confidence_score: confidenceScore,
      suggestion_type: deriveSuggestionTypeFromSignals(signals),
      matched_signals: signals.matchedSignals,
      reasons: Array.isArray(base.match_reasons) ? base.match_reasons : [],
      warnings
    });
  }

  const amountExactSuggestions = rawSuggestions.filter(s => Array.isArray(s.matched_signals) && s.matched_signals.includes('amount_exact'));
  if (amountExactSuggestions.length > 1) {
    for (const suggestion of amountExactSuggestions) {
      suggestion.warnings = Array.isArray(suggestion.warnings) ? suggestion.warnings : [];
      suggestion.warnings.push('Multiple invoices share the matched amount. Manual review required.');
    }
  }

  rawSuggestions.sort((a, b) => {
    if (b.confidence_score !== a.confidence_score) {
      return b.confidence_score - a.confidence_score;
    }
    if (a.invoice_due_date !== b.invoice_due_date) {
      return String(b.invoice_due_date || '').localeCompare(String(a.invoice_due_date || ''));
    }
    return Number(b.invoice_id || 0) - Number(a.invoice_id || 0);
  });

  return rawSuggestions.slice(0, maxSuggestions);
}

function getContext(req) {
  return {
    orgId: req.auth?.organizationId,
    userId: req.auth?.userId,
    role: req.auth?.role
  };
}

function requireAuthenticatedContext(req, res, next) {
  const { orgId, userId, role } = getContext(req);
  if (!orgId || !userId || !role) {
    return res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'A valid Smart Landlord session is required.'
    });
  }
  next();
}

function requireLandlordOrSuperAdmin(req, res, next) {
  const { role } = getContext(req);
  if (role !== 'landlord' && role !== 'super_admin') {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Only landlords and admins are permitted to access payment evidence.'
    });
  }
  next();
}

export function createPaymentEvidenceRoutes(pgDb) {
  const router = express.Router();
  const activeDb = pgDb || localDb;

  // POST /api/statement-reconciliation/preview
  // Universal statement reconciliation preview endpoint.
  // Parses CSV, PDF, XLSX, XLS, DOCX, DOC, TXT buffers and returns normalized preview rows.
  // Strictly read-only preview — does not write to the database or mutate any financial state.
  router.post(
    '/statement-reconciliation/preview',
    requireAuthenticatedContext,
    requireLandlordOrSuperAdmin,
    statementUpload.single('statement'),
    asyncHandler(async (req, res) => {
      const { orgId } = getContext(req);

      if (!req.file) {
        return res.status(400).json({
          error: 'NO_FILE',
          message: 'No statement file was attached. Please upload a file using the "statement" field.'
        });
      }

      const filename = req.file.originalname || 'statement.txt';
      const buffer = req.file.buffer;

      try {
        const previewResult = await StatementIngestionService.preview(buffer, filename, orgId, activeDb);
        return res.json(previewResult);
      } catch (err) {
        console.error('Statement preview failed:', err);
        return res.status(500).json({
          error: 'PREVIEW_FAILED',
          message: err.message || 'An error occurred while parsing the statement.'
        });
      }
    })
  );

  // GET /api/payment-evidence/batches
  router.get('/payment-evidence/batches', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const batches = await activeDb.find('payment_evidence_batches', { organization_id: orgId });
    batches.sort((a, b) => b.id - a.id);
    res.json(batches);
  }));

  // GET /api/payment-evidence/rows
  router.get('/payment-evidence/rows', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const {
      status,
      evidence_strength,
      collection_channel,
      start_date,
      end_date,
      min_amount,
      max_amount,
      search,
      batch_id,
      review_status,
      review_decision,
      has_suggestions,
      match_confidence,
      has_audit_history,
      min_match_score,
      max_match_score,
      reviewed_from,
      reviewed_to,
      imported_from,
      imported_to
    } = req.query;

    /*
     * TODO: Replace in-memory filtering with PostgreSQL WHERE clauses.
     * TODO: Support LIMIT/OFFSET pagination.
     * TODO: Move sorting into SQL ORDER BY.
     * TODO: Add server-side pagination for large datasets.
     * TODO: Support indexed search.
     */
    let rows = await activeDb.find('payment_evidence', { organization_id: orgId });

    // Preload active tenants, invoices, properties, units, and users for metadata injection
    const allTenants = await activeDb.find('tenants', { organization_id: orgId });
    const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
    const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
    const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];
    const allUsers = await activeDb.find('users', {}) || [];
    const allAuditRows = await activeDb.find('payment_evidence_review_audit', { organization_id: orgId }) || [];

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));
    const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
    const unitsMap = new Map(allUnits.map(u => [u.id, u]));
    const userMap = new Map(allUsers.map(u => [u.id, u.name]));
    const auditCountMap = new Map();
    allAuditRows.forEach(a => {
      const key = Number(a.payment_evidence_id);
      auditCountMap.set(key, (auditCountMap.get(key) || 0) + 1);
    });

    const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
    const activeTenantMap = new Map(activeTenants.map(t => [t.id, t]));
    const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

    // Filter by batch_id
    if (batch_id) {
      const bId = Number(batch_id);
      rows = rows.filter(r => r.batch_id && Number(r.batch_id) === bId);
    }

    // Filter by status
    if (status) {
      rows = rows.filter(r => r.status === status);
    }

    // Filter by evidence_strength
    if (evidence_strength) {
      rows = rows.filter(r => r.evidence_strength === evidence_strength);
    }

    // Filter by collection_channel
    if (collection_channel) {
      rows = rows.filter(r => r.collection_channel === collection_channel);
    }

    // Filter by manual review metadata. Null/empty review status means "unreviewed".
    if (review_status) {
      rows = rows.filter(r => {
        const normalizedReviewStatus = r.review_status || 'unreviewed';
        return normalizedReviewStatus === review_status;
      });
    }

    if (review_decision) {
      rows = rows.filter(r => r.review_decision === review_decision);
    }

    // Filter by date range (transaction_date format: YYYY-MM-DD)
    if (start_date) {
      rows = rows.filter(r => r.transaction_date >= start_date);
    }
    if (end_date) {
      rows = rows.filter(r => r.transaction_date <= end_date);
    }

    // Filter by imported date range. TODO: move this to SQL WHERE clauses for production scale.
    if (imported_from) {
      rows = rows.filter(r => (r.created_at || r.imported_at || r.transaction_date) >= imported_from);
    }
    if (imported_to) {
      rows = rows.filter(r => (r.created_at || r.imported_at || r.transaction_date) <= imported_to);
    }

    // Filter by reviewed date range. TODO: move this to SQL WHERE clauses for production scale.
    if (reviewed_from) {
      rows = rows.filter(r => r.reviewed_at && r.reviewed_at >= reviewed_from);
    }
    if (reviewed_to) {
      rows = rows.filter(r => r.reviewed_at && r.reviewed_at <= reviewed_to);
    }

    // Filter by amount
    if (min_amount) {
      const min = Number(min_amount);
      rows = rows.filter(r => r.amount >= min);
    }
    if (max_amount) {
      const max = Number(max_amount);
      rows = rows.filter(r => r.amount <= max);
    }

    // Search query substring check (case insensitive)
    if (search) {
      const query = search.toLowerCase();
      rows = rows.filter(r =>
        (r.transaction_code && r.transaction_code.toLowerCase().includes(query)) ||
        (r.reference_account && r.reference_account.toLowerCase().includes(query)) ||
        (r.payer_phone && r.payer_phone.toLowerCase().includes(query)) ||
        (r.payer_name && r.payer_name.toLowerCase().includes(query)) ||
        (r.description && r.description.toLowerCase().includes(query))
      );
    }

    // Sort descending by transaction_date, then descending by ID
    rows.sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) {
        return b.transaction_date.localeCompare(a.transaction_date);
      }
      return b.id - a.id;
    });

    // Map rows to include preloaded tenant/invoice metadata and matching suggestions
    const enrichedRows = rows.map(r => {
      const tenant = r.suggested_tenant_id ? tenantMap.get(r.suggested_tenant_id) : null;
      const invoice = r.suggested_invoice_id ? invoiceMap.get(r.suggested_invoice_id) : null;

      let suggestions = [];
      if (r.status !== 'ignored') {
        for (const inv of eligibleInvoices) {
          const activeTenant = activeTenantMap.get(inv.tenant_id);
          if (!activeTenant) continue;
          const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
          const property = unit ? propertiesMap.get(unit.property_id) : null;

          const match = calculateCandidateScore(r, activeTenant, inv, unit, property);
          if (match) {
            suggestions.push(match);
          }
        }

        // Sort suggestions:
        // 1. match_score descending
        // 2. confidence high -> medium -> low
        // 3. newest/open invoice priority (newest due date, then newest invoice id)
        suggestions.sort((a, b) => {
          if (b.match_score !== a.match_score) {
            return b.match_score - a.match_score;
          }
          const confWeight = { high: 3, medium: 2, low: 1 };
          const weightA = confWeight[a.match_confidence] || 0;
          const weightB = confWeight[b.match_confidence] || 0;
          if (weightB !== weightA) {
            return weightB - weightA;
          }
          if (a.invoice_due_date !== b.invoice_due_date) {
            return b.invoice_due_date.localeCompare(a.invoice_due_date);
          }
          return b.invoice_id - a.invoice_id;
        });

        // Limit to maximum 5 suggestions
        suggestions = suggestions.slice(0, 5);
      }

      const acceptedTenant = r.accepted_tenant_id ? tenantMap.get(r.accepted_tenant_id) : null;
      const acceptedInvoice = r.accepted_invoice_id ? invoiceMap.get(r.accepted_invoice_id) : null;

      return {
        ...r,
        suggested_tenant: tenant ? {
          id: tenant.id,
          full_name: tenant.full_name,
          tenant_account_number: tenant.tenant_account_number
        } : null,
        suggested_invoice: invoice ? {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          total: invoice.total,
          balance: invoice.balance
        } : null,
        accepted_tenant: acceptedTenant ? {
          id: acceptedTenant.id,
          full_name: acceptedTenant.full_name,
          tenant_account_number: acceptedTenant.tenant_account_number
        } : null,
        accepted_invoice: acceptedInvoice ? {
          id: acceptedInvoice.id,
          invoice_number: acceptedInvoice.invoice_number,
          total: acceptedInvoice.total,
          balance: acceptedInvoice.balance
        } : null,
        reviewer_name: r.reviewed_by ? (userMap.get(r.reviewed_by) || 'Unknown') : null,
        audit_count: auditCountMap.get(Number(r.id)) || 0,
        has_audit_history: (auditCountMap.get(Number(r.id)) || 0) > 0,
        suggestions
      };
    });

    let filteredEnrichedRows = enrichedRows;

    // Enriched filters that depend on suggestions/audit metadata.
    // TODO: move suggestion/audit filters to SQL/materialized summaries for production-scale datasets.
    if (has_suggestions === 'true') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => r.suggestions && r.suggestions.length > 0);
    } else if (has_suggestions === 'false') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => !r.suggestions || r.suggestions.length === 0);
    }

    if (has_audit_history === 'true') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => r.has_audit_history === true);
    } else if (has_audit_history === 'false') {
      filteredEnrichedRows = filteredEnrichedRows.filter(r => r.has_audit_history !== true);
    }

    if (match_confidence) {
      filteredEnrichedRows = filteredEnrichedRows.filter(r =>
        r.suggestions && r.suggestions.some(s => s.match_confidence === match_confidence)
      );
    }

    if (min_match_score) {
      const minScore = Number(min_match_score);
      filteredEnrichedRows = filteredEnrichedRows.filter(r =>
        r.suggestions && r.suggestions.some(s => Number(s.match_score) >= minScore)
      );
    }

    if (max_match_score) {
      const maxScore = Number(max_match_score);
      filteredEnrichedRows = filteredEnrichedRows.filter(r =>
        r.suggestions && r.suggestions.some(s => Number(s.match_score) <= maxScore)
      );
    }

    res.json(filteredEnrichedRows);
  }));

  // GET /api/payment-evidence/:id/matching-suggestions
  // Review-only endpoint. Returns deterministic tenant/invoice matching suggestions
  // without mutating any payment evidence, invoice, tenant, transaction,
  // allocation, receipt, ledger, or balance data.
  router.get('/payment-evidence/:id/matching-suggestions', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const evidenceId = Number(req.params.id);

    if (!Number.isFinite(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({
        error: 'INVALID_PAYMENT_EVIDENCE_ID',
        message: 'A valid payment evidence ID is required.'
      });
    }

    const evidenceRow = await activeDb.findOne('payment_evidence', {
      id: evidenceId,
      organization_id: orgId
    });

    if (!evidenceRow) {
      return res.status(404).json({
        error: 'PAYMENT_EVIDENCE_NOT_FOUND',
        message: 'Payment evidence was not found.'
      });
    }

    const suggestions = await buildReviewOnlyMatchingSuggestionsForEvidence(activeDb, orgId, evidenceRow, 5);
    const summary = {
      total_suggestions: suggestions.length,
      high_confidence_count: suggestions.filter(s => s.confidence === 'high').length,
      medium_confidence_count: suggestions.filter(s => s.confidence === 'medium').length,
      low_confidence_count: suggestions.filter(s => s.confidence === 'low').length,
      suggestions_with_warnings: suggestions.filter(s => Array.isArray(s.warnings) && s.warnings.length > 0).length
    };

    return res.json({
      success: true,
      payment_evidence_id: evidenceId,
      mode: 'matching_suggestions_review_only',
      matching_enabled: false,
      suggestions,
      summary,
      safety_message: 'Matching suggestions are review-only. No transaction, allocation, receipt, ledger, invoice, tenant, or balance record was changed.'
    });
  }));

  // POST /api/payment-evidence/:id/select-match
  // Review-only selection endpoint: persists selected suggestion metadata on
  // payment_evidence only. No transaction, allocation, receipt, ledger,
  // invoice, tenant, or balance mutations are allowed.
  router.post('/payment-evidence/:id/select-match', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const evidenceId = Number(req.params.id);

    if (!Number.isFinite(evidenceId) || evidenceId <= 0) {
      return res.status(400).json({
        error: 'INVALID_PAYMENT_EVIDENCE_ID',
        message: 'A valid payment evidence ID is required.'
      });
    }

    const row = await activeDb.findOne('payment_evidence', { id: evidenceId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'PAYMENT_EVIDENCE_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    if (String(row.status || '').toLowerCase() === 'ignored') {
      return res.status(400).json({
        error: 'IGNORED_ROW_BLOCKED',
        message: 'Ignored payment evidence rows cannot select a match suggestion.'
      });
    }

    const {
      confirmation_text,
      tenant_id,
      invoice_id,
      suggestion_rank,
      confidence_score,
      selection_notes
    } = req.body || {};

    if (String(confirmation_text || '') !== MATCH_SELECTION_CONFIRMATION_TEXT) {
      return res.status(400).json({
        error: 'INVALID_CONFIRMATION_TEXT',
        message: `Confirmation text is invalid. Please type "${MATCH_SELECTION_CONFIRMATION_TEXT}".`
      });
    }

    const selectedTenantId = Number(tenant_id);
    const selectedInvoiceId = Number(invoice_id);
    if (!Number.isFinite(selectedTenantId) || selectedTenantId <= 0 || !Number.isFinite(selectedInvoiceId) || selectedInvoiceId <= 0) {
      return res.status(400).json({
        error: 'INVALID_SELECTION',
        message: 'Both tenant_id and invoice_id must be positive integers.'
      });
    }

    if (selection_notes && String(selection_notes).length > 1000) {
      return res.status(400).json({
        error: 'NOTES_TOO_LONG',
        message: 'selection_notes must not exceed 1000 characters.'
      });
    }

    const tenant = await activeDb.findOne('tenants', { id: selectedTenantId, organization_id: orgId });
    if (!tenant) {
      return res.status(400).json({
        error: 'TENANT_NOT_ALLOWED',
        message: 'The selected tenant is invalid for this organization.'
      });
    }

    const invoice = await activeDb.findOne('invoices', { id: selectedInvoiceId, organization_id: orgId });
    if (!invoice) {
      return res.status(400).json({
        error: 'INVOICE_NOT_ALLOWED',
        message: 'The selected invoice is invalid for this organization.'
      });
    }

    const normalizedInvoiceStatus = String(invoice.status || '').toLowerCase();
    const allowedInvoiceStatuses = new Set(['unpaid', 'partially_paid', 'overdue', 'open', 'issued']);
    if (!allowedInvoiceStatuses.has(normalizedInvoiceStatus)) {
      return res.status(400).json({
        error: 'INVOICE_STATUS_BLOCKED',
        message: 'The selected invoice status is not eligible for review-only match selection.'
      });
    }

    const suggestions = await buildReviewOnlyMatchingSuggestionsForEvidence(activeDb, orgId, row, 5);
    const selectedSuggestion = suggestions.find(s => Number(s.tenant_id) === selectedTenantId && Number(s.invoice_id) === selectedInvoiceId);
    if (!selectedSuggestion) {
      return res.status(400).json({
        error: 'SUGGESTION_NOT_FOUND',
        message: 'The selected tenant/invoice pair is not in current matching suggestions.'
      });
    }

    const selectedAt = new Date().toISOString();
    const resolvedRank = Number.isFinite(Number(suggestion_rank)) && Number(suggestion_rank) > 0
      ? Number(suggestion_rank)
      : (suggestions.findIndex(s => Number(s.tenant_id) === selectedTenantId && Number(s.invoice_id) === selectedInvoiceId) + 1);
    const resolvedScore = Number.isFinite(Number(confidence_score))
      ? Number(confidence_score)
      : Number(selectedSuggestion.confidence_score || 0);

    const selectedMatchMetadata = {
      tenant_id: selectedTenantId,
      tenant_name: tenant.full_name || null,
      invoice_id: selectedInvoiceId,
      invoice_number: invoice.invoice_number || null,
      suggestion_rank: resolvedRank,
      confidence_score: resolvedScore,
      selection_notes: selection_notes ? String(selection_notes) : null,
      selected_by: userId,
      selected_at: selectedAt,
      mode: 'match_selection_review_only',
      safety_message: 'Match selection is review-only. No transaction, allocation, receipt, ledger, invoice, tenant, or balance record was changed.'
    };

    const priorRawFields = row.raw_fields && typeof row.raw_fields === 'object' ? row.raw_fields : {};
    const updatedRawFields = {
      ...priorRawFields,
      selected_match: selectedMatchMetadata
    };

    const updates = {
      suggested_tenant_id: selectedTenantId,
      suggested_invoice_id: selectedInvoiceId,
      review_notes: selection_notes ? String(selection_notes) : (row.review_notes || null),
      reviewed_by: userId,
      reviewed_at: selectedAt,
      raw_fields: updatedRawFields
    };

    const updatedRows = await activeDb.update('payment_evidence', evidenceId, updates);
    const updatedRow = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updatedRow) {
      return res.status(500).json({
        error: 'UPDATE_FAILED',
        message: 'Match selection could not be saved.'
      });
    }

    return res.json({
      success: true,
      mode: 'match_selection_review_only',
      payment_evidence_id: evidenceId,
      selected_match: selectedMatchMetadata,
      next_step_readiness: {
        allocation_preview_enabled: false,
        allocation_confirmation_enabled: false,
        receipt_enabled: false,
        ledger_enabled: false,
        message: 'Match selection was saved for review only. Allocation, receipt, ledger, invoice, tenant, and balance records were not changed.'
      },
      safety_message: 'Match selection is review-only. No transaction, allocation, receipt, ledger, invoice, tenant, or balance record was changed.'
    });
  }));

  // POST /api/payment-evidence/import-csv-preview
  router.post('/payment-evidence/import-csv-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const {
      source_provider,
      source_perspective,
      document_source,
      collection_channel,
      original_filename,
      preview_rows
    } = req.body;

    if (!Array.isArray(preview_rows)) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'preview_rows must be an array.'
      });
    }

    if (preview_rows.length > 2000) {
      return res.status(400).json({
        error: 'LIMIT_EXCEEDED',
        message: 'Import limited to maximum of 2,000 rows.'
      });
    }

    let imported_count = 0;
    let ignored_count = 0;
    let duplicate_count = 0;
    let needs_review_count = 0;
    let failed_validation_count = 0;

    // Create the batch record first
    const batchRow = await activeDb.insert('payment_evidence_batches', {
      organization_id: orgId,
      upload_filename: original_filename || 'unknown.csv',
      import_timestamp: new Date().toISOString(),
      uploaded_by: userId,
      detected_provider: source_provider || 'unknown',
      detected_format: 'CSV',
      parser_version: '1.0',
      total_rows: preview_rows.length,
      rows_imported: 0,
      rows_ignored: 0,
      rows_duplicated: 0,
      rows_reconciled: 0,
      rows_needing_review: 0,
      rows_failed_validation: 0
    });

    const batch_id = batchRow.id;
    const insertedRows = [];

    const normalizePhone = (phone) => {
      if (!phone) return null;
      let p = String(phone).replace(/\D/g, '');
      if (p.startsWith('0')) {
        p = '254' + p.slice(1);
      } else if (p.length === 9 && (p.startsWith('7') || p.startsWith('1'))) {
        p = '254' + p;
      }
      return p;
    };

    const processedHashes = new Set();
    const processedCodes = new Set();

    // TODO: If using PostgreSQL in production, wrap the batch creation and row inserts in a transaction block to ensure atomicity.
    for (let i = 0; i < preview_rows.length; i++) {
      const row = preview_rows[i];
      const rawPayload = row.raw_fields || row;

      let normalizedRow;
      try {
        normalizedRow = normalizePaymentEvidence(rawPayload, {
          organization_id: orgId,
          batch_id,
          source_provider: source_provider || 'unknown',
          source_type: 'CSV_STATEMENT',
          source_perspective: source_perspective || 'landlord',
          document_source: document_source || 'CSV'
        });
      } catch (err) {
        console.error('Normalization validation failed:', err);
        failed_validation_count++;
        continue;
      }

      // Overwrite / ensure values
      const amount = normalizedRow.amount;
      const transaction_date = normalizedRow.transaction_date;
      const direction = row.direction || normalizedRow.direction || 'credit';

      const isEmptyRow = row.warnings && row.warnings.includes('empty rows');
      if (!transaction_date || isNaN(amount) || amount <= 0 || isEmptyRow) {
        failed_validation_count++;
        continue;
      }

      // Normalize phone number
      normalizedRow.payer_phone = normalizePhone(normalizedRow.payer_phone);

      const transaction_code = normalizedRow.transaction_code;
      const reference_account = normalizedRow.reference_account;

      // Re-evaluate warnings
      const warnings = [];
      if (!transaction_code && !reference_account) {
        warnings.push('missing transaction code and missing reference account');
      }

      if (transaction_code) {
        const isDuplicateInBatch = preview_rows.some((r, idx) => {
          if (idx === i) return false;
          const rPayload = r.raw_fields || r;
          const rCode = rPayload.transaction_code || rPayload.transactionCode || rPayload.reference || rPayload.mpesa_code || null;
          return rCode && String(rCode).toUpperCase() === transaction_code;
        });
        if (isDuplicateInBatch) {
          warnings.push('duplicate transaction codes');
        }
      }

      // Check duplicate rows in this batch
      const rowStr = JSON.stringify(rawPayload);
      const isDuplicateRow = preview_rows.some((r, idx) => idx !== i && JSON.stringify(r.raw_fields || r) === rowStr);
      if (isDuplicateRow) {
        warnings.push('duplicate rows');
      }

      if (direction === 'debit') {
        warnings.push('debit rows on landlord statements');
      }

      if (Array.isArray(row.warnings)) {
        row.warnings.forEach(w => {
          if (!warnings.includes(w)) {
            warnings.push(w);
          }
        });
      }

      const row_hash = normalizedRow.row_hash;

      // Duplicate checking in database and processed batch items
      const existingHash = await activeDb.findOne('payment_evidence', { organization_id: orgId, row_hash });
      if (existingHash || processedHashes.has(row_hash)) {
        duplicate_count++;
        continue;
      }

      if (transaction_code) {
        const existingCode = await activeDb.findOne('payment_evidence', { organization_id: orgId, transaction_code });
        if (existingCode || processedCodes.has(transaction_code)) {
          duplicate_count++;
          continue;
        }
      }

      // Track processed keys to prevent duplicate insertions inside the batch
      processedHashes.add(row_hash);
      if (transaction_code) {
        processedCodes.add(transaction_code);
      }

      // Determine status
      let status = 'imported';
      if (direction === 'debit') {
        status = 'ignored';
        ignored_count++;
      } else if (warnings.length > 0) {
        status = 'needs_review';
        needs_review_count++;
      } else {
        imported_count++;
      }

      try {
        const inserted = await activeDb.insert('payment_evidence', {
          organization_id: orgId,
          batch_id,
          source_provider: normalizedRow.source_provider,
          source_type: normalizedRow.source_type,
          source_perspective: normalizedRow.source_perspective,
          collection_channel: collection_channel || normalizedRow.collection_channel || 'unknown',
          document_source: normalizedRow.document_source,
          transaction_date,
          transaction_time: normalizedRow.transaction_time || null,
          amount,
          direction,
          transaction_code,
          payer_name: normalizedRow.payer_name,
          payer_phone: normalizedRow.payer_phone,
          recipient_name: normalizedRow.recipient_name,
          recipient_phone: normalizedRow.recipient_phone,
          paybill_number: normalizedRow.paybill_number,
          till_number: normalizedRow.till_number,
          agent_number: normalizedRow.agent_number,
          reference_account,
          description: normalizedRow.description || '',
          raw_text: normalizedRow.raw_text,
          raw_fields: normalizedRow.raw_fields,
          row_hash,
          confidence: 0,
          evidence_strength: transaction_code ? 'high' : 'unknown',
          status,
          ignored_reason: status === 'ignored' ? 'debit_row_on_landlord_statement' : null,
          paybill_reference: normalizedRow.paybill_reference,
          bank_reference: normalizedRow.bank_reference,
          recipient_account: normalizedRow.recipient_account,
          invoice_reference: normalizedRow.invoice_reference,
          landlord_account_number: normalizedRow.landlord_account_number
        });

        insertedRows.push(inserted);
      } catch (err) {
        console.error('Failed to insert record:', err);
        failed_validation_count++;
      }
    }

    // Update batch record with final counts
    await activeDb.update('payment_evidence_batches', batch_id, {
      rows_imported: imported_count,
      rows_ignored: ignored_count,
      rows_duplicated: duplicate_count,
      rows_needing_review: needs_review_count,
      rows_failed_validation: failed_validation_count
    });

    res.json({
      success: true,
      batch_id,
      imported_count,
      ignored_count,
      duplicate_count,
      needs_review_count,
      failed_validation_count,
      rows: insertedRows
    });
  }));

  // POST /api/payment-evidence/:id/review-decision
  // HARDENING REVIEW & SECURITY BOUNDARY:
  // - This endpoint is strictly for logging manual review decisions (metadata-only audit trail).
  // - It does NOT reconcile payments, allocate funds, mark invoices as paid, create receipts,
  //   or perform any write operations on financial ledgers/transactions.
  // - Access is restricted to authenticated Landlord or Super Admin roles only.
  router.post('/payment-evidence/:id/review-decision', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { decision, review_notes, rejected_reason, accepted_tenant_id, accepted_invoice_id } = req.body;

    const allowedDecisions = ['accepted_suggestion', 'rejected_suggestion', 'needs_more_evidence', 'marked_irrelevant'];
    if (!decision || !allowedDecisions.includes(decision)) {
      return res.status(400).json({
        error: 'INVALID_DECISION',
        message: `The decision must be one of: ${allowedDecisions.join(', ')}`
      });
    }

    if (row.status === 'ignored' && decision === 'accepted_suggestion') {
      return res.status(400).json({
        error: 'IGNORED_ROW_BLOCKED',
        message: 'Ignored payment evidence rows cannot accept match suggestions.'
      });
    }

    let acceptedScore = null;
    let acceptedConf = null;
    if (decision === 'accepted_suggestion') {
      if (!accepted_tenant_id || !accepted_invoice_id) {
        return res.status(400).json({
          error: 'MISSING_ACCEPTED_REFS',
          message: 'Both accepted_tenant_id and accepted_invoice_id are required for accepting a suggestion.'
        });
      }

      const allTenants = await activeDb.find('tenants', { organization_id: orgId });
      const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
      const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
      const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];

      const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
      const unitsMap = new Map(allUnits.map(u => [u.id, u]));

      const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
      const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

      let suggestions = [];
      for (const inv of eligibleInvoices) {
        const activeTenant = activeTenants.find(t => t.id === inv.tenant_id);
        if (!activeTenant) continue;
        const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
        const property = unit ? propertiesMap.get(unit.property_id) : null;

        const match = calculateCandidateScore(row, activeTenant, inv, unit, property);
        if (match) {
          suggestions.push(match);
        }
      }

      const matchingSugg = suggestions.find(s => s.tenant_id === Number(accepted_tenant_id) && s.invoice_id === Number(accepted_invoice_id));
      if (!matchingSugg) {
        return res.status(400).json({
          error: 'SUGGESTION_NOT_FOUND',
          message: 'The selected tenant and invoice combination is not among the suggested match candidates for this row.'
        });
      }

      acceptedScore = matchingSugg.match_score;
      acceptedConf = matchingSugg.match_confidence;
    }

    if (review_notes && String(review_notes).length > 1000) {
      return res.status(400).json({
        error: 'NOTES_TOO_LONG',
        message: 'Review notes must not exceed 1000 characters.'
      });
    }
    if (rejected_reason && String(rejected_reason).length > 500) {
      return res.status(400).json({
        error: 'REASON_TOO_LONG',
        message: 'Rejected reason must not exceed 500 characters.'
      });
    }

    const updates = {
      review_status: decision,
      review_decision: decision,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: review_notes || null,
      accepted_tenant_id: decision === 'accepted_suggestion' ? Number(accepted_tenant_id) : null,
      accepted_invoice_id: decision === 'accepted_suggestion' ? Number(accepted_invoice_id) : null,
      accepted_match_score: acceptedScore,
      accepted_match_confidence: acceptedConf,
      rejected_reason: (decision === 'rejected_suggestion' || decision === 'marked_irrelevant') ? (rejected_reason || null) : null
    };

    const previousReviewMetadata = {
      review_status: row.review_status ?? null,
      review_decision: row.review_decision ?? null,
      reviewed_by: row.reviewed_by ?? null,
      reviewed_at: row.reviewed_at ?? null,
      review_notes: row.review_notes ?? null,
      accepted_tenant_id: row.accepted_tenant_id ?? null,
      accepted_invoice_id: row.accepted_invoice_id ?? null,
      accepted_match_score: row.accepted_match_score ?? null,
      accepted_match_confidence: row.accepted_match_confidence ?? null,
      rejected_reason: row.rejected_reason ?? null
    };

    const auditRow = {
      organization_id: orgId,
      payment_evidence_id: rowId,
      action: row.review_status ? 'update_decision' : 'create_decision',
      previous_review_status: row.review_status || null,
      new_review_status: updates.review_status,
      previous_review_decision: row.review_decision || null,
      new_review_decision: updates.review_decision,
      previous_accepted_tenant_id: row.accepted_tenant_id == null ? null : Number(row.accepted_tenant_id),
      new_accepted_tenant_id: updates.accepted_tenant_id,
      previous_accepted_invoice_id: row.accepted_invoice_id == null ? null : Number(row.accepted_invoice_id),
      new_accepted_invoice_id: updates.accepted_invoice_id,
      previous_accepted_match_score: row.accepted_match_score == null ? null : Number(row.accepted_match_score),
      new_accepted_match_score: updates.accepted_match_score,
      previous_accepted_match_confidence: row.accepted_match_confidence || null,
      new_accepted_match_confidence: updates.accepted_match_confidence,
      previous_rejected_reason: row.rejected_reason || null,
      new_rejected_reason: updates.rejected_reason,
      previous_review_notes: row.review_notes || null,
      new_review_notes: updates.review_notes,
      actor_user_id: userId,
      actor_role: role,
      actor_ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      user_agent: (req.headers && req.headers['user-agent']) || 'Unknown',
      safety_message: 'Manual review audit only. No payment has been reconciled, allocated, or applied.'
    };

    // TODO: PostgreSQL production should wrap the review metadata update and audit insert in a single real transaction.
    // The current generic DB wrapper exposes CRUD helpers but no same-client transaction helper.
    let updatedRow;
    let reviewMetadataUpdated = false;

    try {
      const rows = await activeDb.update('payment_evidence', rowId, updates);
      updatedRow = rows[0];
      if (!updatedRow) {
        throw new Error('Target payment evidence row was not updated.');
      }
      reviewMetadataUpdated = true;

      await activeDb.insert('payment_evidence_review_audit', auditRow);
    } catch (err) {
      if (reviewMetadataUpdated) {
        try {
          await activeDb.update('payment_evidence', rowId, previousReviewMetadata);
        } catch (rollbackErr) {
          console.error('Failed to restore review metadata after audit write failure:', rollbackErr);
        }
      }

      console.error('Failed to save payment evidence review audit:', err);
      return res.status(500).json({
        error: 'AUDIT_WRITE_FAILED',
        message: 'Review decision was not saved because the audit history could not be written. No payment has been reconciled, allocated, or applied.'
      });
    }

    const tenant = updatedRow.suggested_tenant_id ? (await activeDb.findOne('tenants', { id: updatedRow.suggested_tenant_id })) : null;
    const invoice = updatedRow.suggested_invoice_id ? (await activeDb.findOne('invoices', { id: updatedRow.suggested_invoice_id })) : null;

    const allTenants = await activeDb.find('tenants', { organization_id: orgId });
    const allInvoices = await activeDb.find('invoices', { organization_id: orgId });
    const allProperties = await activeDb.find('properties', { organization_id: orgId }) || [];
    const allUnits = await activeDb.find('units', { organization_id: orgId }) || [];

    const propertiesMap = new Map(allProperties.map(p => [p.id, p]));
    const unitsMap = new Map(allUnits.map(u => [u.id, u]));

    const activeTenants = allTenants.filter(t => t.status !== 'deleted' && t.status !== 'inactive');
    const eligibleInvoices = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');

    let suggestions = [];
    if (updatedRow.status !== 'ignored') {
      for (const inv of eligibleInvoices) {
        const activeTenant = activeTenants.find(t => t.id === inv.tenant_id);
        if (!activeTenant) continue;
        const unit = activeTenant.unit_id ? unitsMap.get(activeTenant.unit_id) : null;
        const property = unit ? propertiesMap.get(unit.property_id) : null;

        const match = calculateCandidateScore(updatedRow, activeTenant, inv, unit, property);
        if (match) {
          suggestions.push(match);
        }
      }
      suggestions.sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        const confWeight = { high: 3, medium: 2, low: 1 };
        const weightA = confWeight[a.match_confidence] || 0;
        const weightB = confWeight[b.match_confidence] || 0;
        if (weightB !== weightA) return weightB - weightA;
        if (a.invoice_due_date !== b.invoice_due_date) return b.invoice_due_date.localeCompare(a.invoice_due_date);
        return b.invoice_id - a.invoice_id;
      });
      suggestions = suggestions.slice(0, 5);
    }

    const tenantMap = new Map(allTenants.map(t => [t.id, t]));
    const invoiceMap = new Map(allInvoices.map(i => [i.id, i]));

    const acceptedTenant = updatedRow.accepted_tenant_id ? tenantMap.get(updatedRow.accepted_tenant_id) : null;
    const acceptedInvoice = updatedRow.accepted_invoice_id ? invoiceMap.get(updatedRow.accepted_invoice_id) : null;

    const reviewUser = await activeDb.findOne('users', { id: userId });

    const finalRow = {
      ...updatedRow,
      suggested_tenant: tenant ? {
        id: tenant.id,
        full_name: tenant.full_name,
        tenant_account_number: tenant.tenant_account_number
      } : null,
      suggested_invoice: invoice ? {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        total: invoice.total,
        balance: invoice.balance
      } : null,
      accepted_tenant: acceptedTenant ? {
        id: acceptedTenant.id,
        full_name: acceptedTenant.full_name,
        tenant_account_number: acceptedTenant.tenant_account_number
      } : null,
      accepted_invoice: acceptedInvoice ? {
        id: acceptedInvoice.id,
        invoice_number: acceptedInvoice.invoice_number,
        total: acceptedInvoice.total,
        balance: acceptedInvoice.balance
      } : null,
      suggestions,
      reviewer_name: reviewUser ? reviewUser.name : 'Unknown Reviewer'
    };

    res.json({
      success: true,
      message: 'Review decision saved. No payment has been reconciled or applied.',
      row: finalRow
    });
  }));

  // GET /api/payment-evidence/:id/review-audit
  router.get('/payment-evidence/:id/review-audit', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const auditRows = await activeDb.find('payment_evidence_review_audit', {
      organization_id: orgId,
      payment_evidence_id: rowId
    });

    // Resolve user names using users table mapping for actor_name
    const allUsers = await activeDb.find('users', {}) || [];
    const userMap = new Map(allUsers.map(u => [u.id, u.name]));

    const enrichedAudit = auditRows.map(item => ({
      action: item.action,
      previous_review_status: item.previous_review_status,
      new_review_status: item.new_review_status,
      previous_review_decision: item.previous_review_decision,
      new_review_decision: item.new_review_decision,
      previous_accepted_tenant_id: item.previous_accepted_tenant_id,
      new_accepted_tenant_id: item.new_accepted_tenant_id,
      previous_accepted_invoice_id: item.previous_accepted_invoice_id,
      new_accepted_invoice_id: item.new_accepted_invoice_id,
      previous_accepted_match_score: item.previous_accepted_match_score,
      new_accepted_match_score: item.new_accepted_match_score,
      previous_accepted_match_confidence: item.previous_accepted_match_confidence,
      new_accepted_match_confidence: item.new_accepted_match_confidence,
      previous_rejected_reason: item.previous_rejected_reason,
      new_rejected_reason: item.new_rejected_reason,
      previous_review_notes: item.previous_review_notes,
      new_review_notes: item.new_review_notes,
      actor_user_id: item.actor_user_id,
      actor_name: item.actor_user_id ? (userMap.get(item.actor_user_id) || 'Unknown') : 'Unknown',
      actor_role: item.actor_role,
      created_at: item.created_at,
      safety_message: item.safety_message
    }));

    // Sort newest first
    enrichedAudit.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      success: true,
      audit: enrichedAudit
    });
  }));

  // GET /api/payment-evidence/:id/allocation-preview
  router.get('/payment-evidence/:id/allocation-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const selectedMatchFromRaw = row.raw_fields && typeof row.raw_fields === 'object'
      ? row.raw_fields.selected_match
      : null;
    const selectedTenantId = Number(selectedMatchFromRaw?.tenant_id || row.suggested_tenant_id || 0);
    const selectedInvoiceId = Number(selectedMatchFromRaw?.invoice_id || row.suggested_invoice_id || 0);

    if (Number.isFinite(selectedTenantId) && selectedTenantId > 0 && Number.isFinite(selectedInvoiceId) && selectedInvoiceId > 0) {
      const tenant = await activeDb.findOne('tenants', { id: selectedTenantId, organization_id: orgId });
      if (!tenant) {
        return res.status(400).json({
          error: 'SELECTED_TENANT_NOT_FOUND',
          message: 'Selected match tenant is missing or outside your organization.'
        });
      }

      const invoice = await activeDb.findOne('invoices', { id: selectedInvoiceId, organization_id: orgId });
      if (!invoice) {
        return res.status(400).json({
          error: 'SELECTED_INVOICE_NOT_FOUND',
          message: 'Selected match invoice is missing or outside your organization.'
        });
      }

      const invoiceStatus = String(invoice.status || '').toLowerCase();
      if (['void', 'cancelled', 'deleted'].includes(invoiceStatus)) {
        return res.status(400).json({
          error: 'INVOICE_STATUS_BLOCKED',
          message: 'Selected invoice is not eligible for allocation preview.'
        });
      }

      const preview = buildPaymentEvidenceAllocationPreview({ evidence: row, tenant, invoice });
      const blockingReasons = [
        'Allocation confirmation is intentionally disabled until the next controlled slice.'
      ];
      if (!preview.canPreview) {
        blockingReasons.push('Allocation preview cannot be confirmed because preview preconditions are not met.');
      }

      return res.json({
        success: true,
        mode: 'allocation_preview_review_only',
        payment_evidence_id: row.id,
        selected_match: preview.selectedMatch,
        payment: preview.payment,
        invoice_before: preview.invoiceBefore,
        allocation_preview: preview.allocationPreview,
        readiness: {
          can_preview: preview.canPreview,
          can_confirm_allocation: false,
          receipt_preview_enabled: false,
          receipt_issuance_enabled: false,
          ledger_posting_enabled: false,
          blocking_reasons: blockingReasons
        },
        warnings: preview.warnings,
        safety_message: 'Allocation preview is review-only. No transaction, allocation, receipt, ledger, invoice, tenant, or balance record was changed.'
      });
    }

    let ready = false;
    let state = 'not_reviewed';
    let message = 'This evidence row has not been reviewed yet.';
    let tenant = null;
    let invoice = null;

    const reviewDecision = row.review_status || row.review_decision || '';

    if (!reviewDecision) {
      ready = false;
      state = 'not_reviewed';
      message = 'This evidence row has not been reviewed yet.';
    } else if (row.status === 'ignored' || reviewDecision === 'marked_irrelevant') {
      ready = false;
      state = 'ignored';
      message = 'This evidence row has been marked as ignored/irrelevant.';
    } else if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      ready = false;
      state = 'already_reconciled';
      message = 'This payment evidence row has already been allocated or reconciled.';
    } else if (reviewDecision === 'rejected_suggestion' || reviewDecision === 'needs_more_evidence') {
      ready = false;
      state = 'no_accepted_match';
      message = 'This evidence row does not have an accepted match suggestion.';
    } else if (reviewDecision === 'accepted_suggestion') {
      const tenantId = row.accepted_tenant_id;
      const invoiceId = row.accepted_invoice_id;

      if (!tenantId) {
        ready = false;
        state = 'missing_tenant';
        message = 'The accepted tenant is missing or does not exist.';
      } else {
        tenant = await activeDb.findOne('tenants', { id: Number(tenantId), organization_id: orgId });
        if (!tenant) {
          ready = false;
          state = 'missing_tenant';
          message = 'The accepted tenant is missing or does not exist.';
        } else if (!invoiceId) {
          ready = false;
          state = 'missing_invoice';
          message = 'The accepted invoice is missing or does not exist.';
        } else {
          invoice = await activeDb.findOne('invoices', { id: Number(invoiceId), organization_id: orgId });
          if (!invoice) {
            ready = false;
            state = 'missing_invoice';
            message = 'The accepted invoice is missing or does not exist.';
          } else if (invoice.status === 'paid' || invoice.status === 'void') {
            ready = false;
            state = 'invoice_not_payable';
            message = 'The accepted invoice is already paid or void.';
          } else if (Number(row.amount) <= 0 || isNaN(Number(row.amount))) {
            ready = false;
            state = 'amount_invalid';
            message = 'The payment evidence amount is invalid.';
          } else {
            ready = true;
            state = 'ready_for_draft_allocation';
            message = 'This evidence row is ready for draft allocation.';
          }
        }
      }
    }

    const amount = Number(row.amount);
    const invoice_balance = invoice ? Number(invoice.balance) : 0;

    let allocation_amount_preview = 0;
    let remaining_balance_preview = 0;
    let overpayment_preview = 0;

    if (ready && invoice) {
      allocation_amount_preview = Math.min(amount, invoice_balance);
      remaining_balance_preview = Math.max(0, invoice_balance - amount);
      overpayment_preview = Math.max(0, amount - invoice_balance);
    }

    const blocking_reasons = [];
    if (!reviewDecision) {
      blocking_reasons.push('Evidence row has not been reviewed yet.');
    }
    if (row.status === 'ignored' || reviewDecision === 'marked_irrelevant') {
      blocking_reasons.push('Evidence row is ignored or irrelevant.');
    }
    if (reviewDecision === 'rejected_suggestion' || reviewDecision === 'needs_more_evidence') {
      blocking_reasons.push('No accepted match suggestion for this evidence row.');
    }
    if (reviewDecision === 'accepted_suggestion') {
      if (!row.accepted_tenant_id || !tenant) {
        blocking_reasons.push('Accepted tenant is missing or does not exist.');
      }
      if (!row.accepted_invoice_id || !invoice) {
        blocking_reasons.push('Accepted invoice is missing or does not exist.');
      } else if (invoice.status === 'paid' || invoice.status === 'void') {
        blocking_reasons.push('Accepted invoice is already paid or void.');
      }
    }
    if (amount <= 0 || isNaN(amount)) {
      blocking_reasons.push('Payment evidence amount must be positive.');
    }
    if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      blocking_reasons.push('An allocation or reconciliation already exists for this evidence row.');
    }

    const can_confirm_allocation = ready && blocking_reasons.length === 0;

    const confirmation_contract = {
      can_confirm_allocation,
      required_confirmation_text: 'CONFIRM ALLOCATION PREVIEW',
      blocking_reasons,
      requires_landlord_confirmation: true,
      requires_current_preview_state: true,
      requires_accepted_review_decision: true,
      requires_invoice_payable: true,
      requires_positive_amount: true,
      requires_no_existing_allocation: true,
      safety_message: 'This confirmation contract is read-only. No allocation, invoice, tenant balance, ledger, receipt, or payment record has been changed.'
    };

    res.json({
      ready,
      state,
      message,
      evidence_id: row.id,
      amount,
      accepted_tenant_id: tenant ? tenant.id : null,
      accepted_tenant_name: tenant ? tenant.full_name : null,
      accepted_invoice_id: invoice ? invoice.id : null,
      accepted_invoice_number: invoice ? invoice.invoice_number : null,
      invoice_status: invoice ? invoice.status : null,
      invoice_balance: invoice ? invoice_balance : null,
      allocation_amount_preview,
      remaining_balance_preview,
      overpayment_preview,
      confirmation_contract,
      required_confirmation_text: 'CONFIRM ALLOCATION PREVIEW',
      can_confirm_allocation,
      blocking_reasons,
      safety_message: 'This is a draft allocation preview only. No invoice, tenant balance, ledger, receipt, or payment record has been changed.'
    });
  }));

  // POST /api/payment-evidence/:id/confirm-allocation
  router.post('/payment-evidence/:id/confirm-allocation', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { confirmation_text } = req.body;
    if (!confirmation_text) {
      return res.status(400).json({
        error: 'CONFIRMATION_TEXT_REQUIRED',
        message: 'Confirmation text is required.'
      });
    }
    if (confirmation_text !== 'CONFIRM ALLOCATION PREVIEW') {
      return res.status(400).json({
        error: 'INVALID_CONFIRMATION_TEXT',
        message: 'Confirmation text is invalid. Please type "CONFIRM ALLOCATION PREVIEW".'
      });
    }

    if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      return res.status(400).json({
        error: 'ALREADY_ALLOCATED',
        message: 'This payment evidence row has already been allocated or reconciled.'
      });
    }

    const reviewDecision = row.review_status || row.review_decision || '';
    if (reviewDecision !== 'accepted_suggestion') {
      return res.status(400).json({
        error: 'INVALID_REVIEW_STATE',
        message: 'Only reviewed rows with accepted suggestions can be confirmed for allocation.'
      });
    }

    const tenantId = row.accepted_tenant_id;
    const invoiceId = row.accepted_invoice_id;

    if (!tenantId) {
      return res.status(400).json({ error: 'MISSING_TENANT', message: 'The accepted tenant is missing.' });
    }
    const tenant = await activeDb.findOne('tenants', { id: Number(tenantId), organization_id: orgId });
    if (!tenant) {
      return res.status(400).json({ error: 'MISSING_TENANT', message: 'The accepted tenant does not exist or is outside organization.' });
    }

    if (!invoiceId) {
      return res.status(400).json({ error: 'MISSING_INVOICE', message: 'The accepted invoice is missing.' });
    }
    const invoice = await activeDb.findOne('invoices', { id: Number(invoiceId), organization_id: orgId });
    if (!invoice) {
      return res.status(400).json({ error: 'MISSING_INVOICE', message: 'The accepted invoice does not exist or is outside organization.' });
    }

    if (invoice.status === 'paid' || invoice.status === 'void') {
      return res.status(400).json({ error: 'INVOICE_NOT_PAYABLE', message: 'The accepted invoice is already paid or void.' });
    }

    const amount = Number(row.amount);
    if (amount <= 0 || isNaN(amount)) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'The payment evidence amount is invalid.' });
    }

    const invoice_balance = Number(invoice.balance);
    if (amount > invoice_balance) {
      return res.status(400).json({
        error: 'OVERPAYMENT_NOT_SUPPORTED',
        message: 'Overpayment allocation requires wallet credit support and is not enabled yet.'
      });
    }

    const allocation_amount = amount;
    const remaining_balance = invoice_balance - allocation_amount;
    const overpayment_amount = 0;
    const invoice_status_before = invoice.status;
    const invoice_status_after = remaining_balance <= 0 ? 'paid' : 'partially_paid';

    // Perform database operations
    const txData = {
      organization_id: orgId,
      tenant_id: tenant.id,
      property_id: tenant.property_id || null,
      unit_id: tenant.unit_id || null,
      amount: allocation_amount,
      currency: tenant.currency || 'KES',
      transaction_type: 'payment',
      payment_method: row.collection_channel || 'other',
      source: 'manual',
      reference_number: row.transaction_code || null,
      account_number: tenant.tenant_account_number || null,
      payer_name: tenant.full_name || null,
      payer_phone: tenant.phone_number || null,
      transaction_date: row.transaction_date,
      status: 'reconciled',
      raw_payload: JSON.stringify({
        evidence_id: row.id,
        source: 'payment_evidence_allocation'
      }),
      created_by: userId
    };

    const createdTx = await activeDb.insert('transactions', txData);

    const allocationData = {
      organization_id: orgId,
      transaction_id: createdTx.id,
      invoice_id: invoice.id,
      amount_allocated: allocation_amount,
      allocated_by: userId,
      allocated_at: new Date().toISOString()
    };

    await activeDb.insert('payment_allocations', allocationData);

    const updatedAmountPaid = Number(invoice.amount_paid) + allocation_amount;
    await activeDb.update('invoices', invoice.id, {
      amount_paid: updatedAmountPaid,
      balance: remaining_balance,
      status: invoice_status_after,
      updated_at: new Date().toISOString()
    });

    await activeDb.update('payment_evidence', row.id, {
      status: 'manually_reconciled',
      updated_at: new Date().toISOString()
    });

    const auditRow = {
      organization_id: orgId,
      payment_evidence_id: row.id,
      action: 'confirm_allocation',
      previous_review_status: row.review_status || null,
      new_review_status: row.review_status || null,
      previous_review_decision: row.review_decision || null,
      new_review_decision: row.review_decision || null,
      previous_accepted_tenant_id: row.accepted_tenant_id ? Number(row.accepted_tenant_id) : null,
      new_accepted_tenant_id: row.accepted_tenant_id ? Number(row.accepted_tenant_id) : null,
      previous_accepted_invoice_id: row.accepted_invoice_id ? Number(row.accepted_invoice_id) : null,
      new_accepted_invoice_id: row.accepted_invoice_id ? Number(row.accepted_invoice_id) : null,
      previous_accepted_match_score: row.accepted_match_score ? Number(row.accepted_match_score) : null,
      new_accepted_match_score: row.accepted_match_score ? Number(row.accepted_match_score) : null,
      previous_accepted_match_confidence: row.accepted_match_confidence || null,
      new_accepted_match_confidence: row.accepted_match_confidence || null,
      actor_user_id: userId,
      actor_role: role,
      actor_ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      user_agent: (req.headers && req.headers['user-agent']) || 'Unknown',
      safety_message: 'Confirmed allocation applied exactly once. Invoice/payment records were updated according to the confirmed preview. No unrelated tenant, ledger, or receipt records were changed.'
    };

    const createdAudit = await activeDb.insert('payment_evidence_review_audit', auditRow);

    res.json({
      success: true,
      message: 'Payment evidence allocation executed and invoice balance updated.',
      payment_evidence_id: row.id,
      invoice_id: invoice.id,
      tenant_id: tenant.id,
      allocation_amount,
      remaining_balance,
      overpayment_amount,
      invoice_status_before,
      invoice_status_after,
      safety_message: 'Confirmed allocation applied exactly once. Invoice/payment records were updated according to the confirmed preview. No unrelated tenant, ledger, or receipt records were changed.',
      audit_reference: createdAudit ? String(createdAudit.id) : null
    });
  }));

  // POST /api/payment-evidence/:id/confirm-selected-allocation
  // Controlled financial posting from selected evidence match. This endpoint may
  // create transaction/payment_allocation and update invoice/payment_evidence.
  // Receipt issuance and ledger posting are intentionally disabled.
  router.post('/payment-evidence/:id/confirm-selected-allocation', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { confirmation_text, allocation_notes } = req.body || {};
    if (String(confirmation_text || '') !== CONFIRM_SELECTED_ALLOCATION_TEXT) {
      return res.status(400).json({
        error: 'INVALID_CONFIRMATION_TEXT',
        message: `Confirmation text is invalid. Please type "${CONFIRM_SELECTED_ALLOCATION_TEXT}".`
      });
    }

    if (row.status === 'auto_reconciled' || row.status === 'manually_reconciled') {
      return res.status(409).json({
        success: false,
        error: 'ALREADY_ALLOCATED',
        duplicate: true,
        message: 'This payment evidence row has already been allocated or reconciled.'
      });
    }

    const selectedMatchFromRaw = row.raw_fields && typeof row.raw_fields === 'object'
      ? row.raw_fields.selected_match
      : null;
    const selectedTenantId = Number(selectedMatchFromRaw?.tenant_id || row.suggested_tenant_id || 0);
    const selectedInvoiceId = Number(selectedMatchFromRaw?.invoice_id || row.suggested_invoice_id || 0);

    if (!Number.isFinite(selectedTenantId) || selectedTenantId <= 0 || !Number.isFinite(selectedInvoiceId) || selectedInvoiceId <= 0) {
      return res.status(400).json({
        error: 'SELECTED_MATCH_REQUIRED',
        message: 'A selected tenant/invoice match is required before confirming allocation.'
      });
    }

    const tenant = await activeDb.findOne('tenants', { id: selectedTenantId, organization_id: orgId });
    if (!tenant) {
      return res.status(400).json({
        error: 'TENANT_NOT_ALLOWED',
        message: 'Selected tenant is missing or outside your organization.'
      });
    }

    const invoice = await activeDb.findOne('invoices', { id: selectedInvoiceId, organization_id: orgId });
    if (!invoice) {
      return res.status(400).json({
        error: 'INVOICE_NOT_ALLOWED',
        message: 'Selected invoice is missing or outside your organization.'
      });
    }

    const invoiceStatus = String(invoice.status || '').toLowerCase();
    if (['void', 'cancelled', 'deleted'].includes(invoiceStatus)) {
      return res.status(400).json({
        error: 'INVOICE_STATUS_BLOCKED',
        message: 'Selected invoice is not eligible for allocation.'
      });
    }

    const preview = buildPaymentEvidenceAllocationPreview({ evidence: row, tenant, invoice });
    if (!preview.canPreview) {
      return res.status(400).json({
        error: 'PREVIEW_NOT_CONFIRMABLE',
        message: 'Allocation preview failed safety checks and cannot be confirmed.',
        warnings: preview.warnings,
        mode: 'allocation_preview_review_only'
      });
    }

    const allocationAmount = Number(preview.allocationPreview.allocation_amount || 0);
    if (!Number.isFinite(allocationAmount) || allocationAmount <= 0) {
      return res.status(400).json({
        error: 'INVALID_ALLOCATION_AMOUNT',
        message: 'Computed allocation amount is invalid.'
      });
    }

    const overpaymentAmount = Number(preview.allocationPreview.overpayment_amount || 0);
    if (overpaymentAmount > 0) {
      return res.status(400).json({
        error: 'OVERPAYMENT_NOT_SUPPORTED',
        message: 'Overpayment allocation requires wallet credit support and is not enabled yet.',
        warnings: preview.warnings,
        mode: 'allocation_preview_review_only'
      });
    }

    const txs = await activeDb.find('transactions', { organization_id: orgId });
    const existingTxForEvidence = txs.find(t => {
      try {
        const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
        return payload && Number(payload.evidence_id) === Number(row.id);
      } catch (_err) {
        return false;
      }
    });

    if (existingTxForEvidence) {
      const existingAllocation = await activeDb.findOne('payment_allocations', {
        organization_id: orgId,
        transaction_id: existingTxForEvidence.id,
        invoice_id: invoice.id
      });
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_ALLOCATION',
        duplicate: true,
        message: 'Selected evidence allocation was already confirmed previously.',
        existing_transaction_id: existingTxForEvidence.id,
        existing_allocation_id: existingAllocation ? existingAllocation.id : null
      });
    }

    const txDuplicateByCode = txs.find(t => (
      String(t.reference_number || '') === String(row.transaction_code || '') &&
      Number(t.amount || 0) === allocationAmount &&
      String(t.transaction_date || '').slice(0, 10) === String(row.transaction_date || '').slice(0, 10)
    ));
    if (txDuplicateByCode) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_TRANSACTION_GUARD',
        duplicate: true,
        message: 'A transaction with this code/amount/date already exists. Allocation was not posted.'
      });
    }

    const invoiceBalanceBefore = Number(preview.invoiceBefore.balance_due || 0);
    const invoiceStatusBefore = preview.invoiceBefore.status || invoice.status;
    const invoiceBalanceAfter = Number(preview.allocationPreview.balance_after || 0);
    const invoiceStatusAfter = preview.allocationPreview.invoice_status_after || invoice.status;

    const txData = {
      organization_id: orgId,
      tenant_id: tenant.id,
      property_id: tenant.property_id || null,
      unit_id: tenant.unit_id || null,
      amount: allocationAmount,
      currency: tenant.currency || 'KES',
      transaction_type: 'payment',
      payment_method: row.collection_channel || 'other',
      source: 'manual',
      reference_number: row.transaction_code || null,
      account_number: tenant.tenant_account_number || null,
      payer_name: tenant.full_name || null,
      payer_phone: tenant.phone_number || null,
      transaction_date: row.transaction_date,
      status: 'reconciled',
      raw_payload: JSON.stringify({
        evidence_id: row.id,
        source: 'confirm_selected_allocation',
        selected_invoice_id: invoice.id
      }),
      created_by: userId
    };

    const createdTx = await activeDb.insert('transactions', txData);

    const allocationData = {
      organization_id: orgId,
      transaction_id: createdTx.id,
      invoice_id: invoice.id,
      amount_allocated: allocationAmount,
      allocated_by: userId,
      allocated_at: new Date().toISOString()
    };
    const createdAllocation = await activeDb.insert('payment_allocations', allocationData);

    const updatedAmountPaid = Number(invoice.amount_paid || 0) + allocationAmount;
    await activeDb.update('invoices', invoice.id, {
      amount_paid: updatedAmountPaid,
      balance: invoiceBalanceAfter,
      status: invoiceStatusAfter,
      updated_at: new Date().toISOString()
    });

    const rowRawFields = row.raw_fields && typeof row.raw_fields === 'object' ? row.raw_fields : {};
    await activeDb.update('payment_evidence', row.id, {
      status: 'manually_reconciled',
      review_notes: allocation_notes ? String(allocation_notes) : (row.review_notes || null),
      raw_fields: {
        ...rowRawFields,
        confirmed_selected_allocation: {
          transaction_id: createdTx.id,
          payment_allocation_id: createdAllocation.id,
          invoice_id: invoice.id,
          allocated_amount: allocationAmount,
          allocation_type: preview.allocationPreview.allocation_type,
          overpayment_amount: Number(preview.allocationPreview.overpayment_amount || 0),
          confirmed_by: userId,
          confirmed_at: new Date().toISOString()
        }
      },
      updated_at: new Date().toISOString()
    });

    const auditRow = {
      organization_id: orgId,
      payment_evidence_id: row.id,
      action: 'confirm_selected_allocation',
      previous_review_status: row.review_status || null,
      new_review_status: row.review_status || null,
      previous_review_decision: row.review_decision || null,
      new_review_decision: row.review_decision || null,
      previous_accepted_tenant_id: row.accepted_tenant_id ? Number(row.accepted_tenant_id) : null,
      new_accepted_tenant_id: row.accepted_tenant_id ? Number(row.accepted_tenant_id) : null,
      previous_accepted_invoice_id: row.accepted_invoice_id ? Number(row.accepted_invoice_id) : null,
      new_accepted_invoice_id: row.accepted_invoice_id ? Number(row.accepted_invoice_id) : null,
      actor_user_id: userId,
      actor_role: role,
      actor_ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      user_agent: (req.headers && req.headers['user-agent']) || 'Unknown',
      safety_message: 'Selected evidence allocation was confirmed. Receipt issuance and ledger posting were not performed.'
    };
    await activeDb.insert('payment_evidence_review_audit', auditRow);

    return res.json({
      success: true,
      mode: 'confirmed_selected_allocation',
      message: 'Selected evidence allocation confirmed successfully.',
      payment_evidence_id: row.id,
      transaction: {
        id: createdTx.id,
        transaction_code: row.transaction_code || null,
        amount: allocationAmount
      },
      allocation: {
        id: createdAllocation.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        tenant_id: tenant.id,
        allocated_amount: allocationAmount,
        allocation_type: preview.allocationPreview.allocation_type
      },
      invoice_result: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        balance_before: invoiceBalanceBefore,
        balance_after: invoiceBalanceAfter,
        status_before: invoiceStatusBefore,
        status_after: invoiceStatusAfter
      },
      overpayment_amount: overpaymentAmount,
      warnings: preview.warnings,
      post_allocation_readiness: {
        receipt_preview_enabled: false,
        receipt_issuance_enabled: false,
        ledger_posting_enabled: false,
        message: 'Allocation was confirmed. Receipt and ledger posting remain disabled until the next controlled slices.'
      },
      safety_message: 'Selected evidence allocation was confirmed. Receipt issuance and ledger posting were not performed.'
    });
  }));

  // GET /api/payment-evidence/:id/confirmed-allocation-receipt-preview
  // Review-only preview generated only from the confirmed selected allocation.
  // No receipt issuance, no ledger posting, and no write operations occur here.
  router.get('/payment-evidence/:id/confirmed-allocation-receipt-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const confirmedAllocation = row.raw_fields && typeof row.raw_fields === 'object'
      ? row.raw_fields.confirmed_selected_allocation
      : null;

    const isConfirmed = row.status === 'manually_reconciled' && confirmedAllocation;
    if (!isConfirmed) {
      return res.status(400).json({
        success: true,
        mode: 'receipt_preview_from_confirmed_allocation_review_only',
        payment_evidence_id: row.id,
        receipt_preview: {
          eligible: false,
          state: 'allocation_not_confirmed',
          message: 'Receipt preview from confirmed allocation is available only after selected allocation confirmation.'
        },
        issuance_readiness: {
          can_issue_receipt: false,
          state: 'receipt_issuance_disabled_in_slice',
          blocking_reasons: [
            'Receipt issuance is not enabled in this slice.'
          ],
          required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
          safety_message: 'This is a receipt preview only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
        },
        safety_message: 'Receipt preview from confirmed allocation is review-only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
      });
    }

    const transactionId = Number(confirmedAllocation.transaction_id || 0);
    const paymentAllocationId = Number(confirmedAllocation.payment_allocation_id || 0);
    const invoiceId = Number(confirmedAllocation.invoice_id || 0);

    const transaction = transactionId
      ? await activeDb.findOne('transactions', { id: transactionId, organization_id: orgId })
      : null;
    const allocation = paymentAllocationId
      ? await activeDb.findOne('payment_allocations', { id: paymentAllocationId, organization_id: orgId })
      : null;
    const invoice = invoiceId
      ? await activeDb.findOne('invoices', { id: invoiceId, organization_id: orgId })
      : null;

    const selectedMatchFromRaw = row.raw_fields && typeof row.raw_fields === 'object'
      ? row.raw_fields.selected_match
      : null;
    const selectedTenantId = Number(selectedMatchFromRaw?.tenant_id || row.suggested_tenant_id || 0);
    const tenant = selectedTenantId > 0
      ? await activeDb.findOne('tenants', { id: selectedTenantId, organization_id: orgId })
      : null;

    if (!transaction || !allocation || !invoice || !tenant) {
      return res.status(409).json({
        error: 'ALLOCATION_RECORDS_INCOMPLETE',
        message: 'Confirmed allocation metadata is incomplete for receipt preview. Please refresh allocation result.'
      });
    }

    const allocatedAmount = Number(allocation.amount_allocated || confirmedAllocation.allocated_amount || 0);
    const draftNumberSeed = String(transaction.reference_number || row.transaction_code || row.id).replace(/\s+/g, '').toUpperCase();

    return res.json({
      success: true,
      mode: 'receipt_preview_from_confirmed_allocation_review_only',
      payment_evidence_id: row.id,
      receipt_preview: {
        eligible: true,
        state: 'ready_for_review_only_receipt_preview',
        receipt_title: 'Draft Receipt Preview (Selected Allocation)',
        receipt_number_preview: `DRAFT-${draftNumberSeed}`,
        tenant_id: tenant.id,
        tenant_name: tenant.full_name,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        transaction_id: transaction.id,
        payment_allocation_id: allocation.id,
        payment_date: transaction.transaction_date || row.transaction_date,
        payment_method: transaction.payment_method || row.collection_channel || 'other',
        amount_paid: allocatedAmount,
        invoice_balance_after: Number(invoice.balance || 0),
        invoice_status: invoice.status,
        receipt_lines: [
          {
            label: `Allocation to invoice ${invoice.invoice_number}`,
            amount: allocatedAmount
          }
        ]
      },
      issuance_readiness: {
        can_issue_receipt: false,
        state: 'receipt_issuance_disabled_in_slice',
        blocking_reasons: [
          'Receipt issuance is not enabled in this slice.'
        ],
        required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
        safety_message: 'This is a receipt preview only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
      },
      post_preview_readiness: {
        download_receipt_enabled: false,
        print_receipt_enabled: false,
        send_receipt_enabled: false,
        ledger_posting_enabled: false,
        message: 'Receipt preview is review-only in this slice. Issuance, sending, printing, download, and ledger posting are disabled.'
      },
      safety_message: 'Receipt preview from confirmed allocation is review-only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
    });
  }));

  // GET /api/payment-evidence/:id/allocation-result
  router.get('/payment-evidence/:id/allocation-result', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const isAllocated = row.status === 'manually_reconciled' || row.status === 'auto_reconciled';
    if (!isAllocated) {
      return res.json({
        success: true,
        payment_evidence_id: row.id,
        allocation_result: {
          allocated: false,
          state: 'not_allocated',
          message: 'This payment evidence row has not been allocated or reconciled yet.'
        },
        reversal_readiness: {
          can_request_reversal: false,
          state: 'reversal_not_enabled',
          blocking_reasons: [
            'Reversal execution is not enabled in this release.'
          ],
          required_future_confirmation_text: 'CONFIRM ALLOCATION REVERSAL',
          safety_message: 'This is reversal readiness only. No allocation, invoice, transaction, ledger, receipt, or tenant record has been changed.'
        },
        safety_message: 'Allocation result is read-only. No financial records were changed by this lookup.'
      });
    }

    const txs = await activeDb.find('transactions', { organization_id: orgId });
    const transaction = txs.find(t => {
      try {
        const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
        return payload && Number(payload.evidence_id) === Number(rowId);
      } catch (e) {
        return false;
      }
    });

    let allocation = null;
    if (transaction) {
      allocation = await activeDb.findOne('payment_allocations', { transaction_id: transaction.id, organization_id: orgId });
    }

    const tenant = row.accepted_tenant_id
      ? await activeDb.findOne('tenants', { id: Number(row.accepted_tenant_id), organization_id: orgId })
      : null;

    const invoice = row.accepted_invoice_id
      ? await activeDb.findOne('invoices', { id: Number(row.accepted_invoice_id), organization_id: orgId })
      : null;

    const audits = await activeDb.find('payment_evidence_review_audit', { payment_evidence_id: rowId, action: 'confirm_allocation', organization_id: orgId });
    audits.sort((a, b) => b.id - a.id);
    const auditRow = audits[0];

    res.json({
      success: true,
      payment_evidence_id: row.id,
      allocation_result: {
        allocated: true,
        state: 'allocated',
        transaction_id: transaction ? transaction.id : null,
        payment_allocation_id: allocation ? allocation.id : null,
        tenant_id: tenant ? tenant.id : null,
        tenant_name: tenant ? tenant.full_name : null,
        invoice_id: invoice ? invoice.id : null,
        invoice_number: invoice ? invoice.invoice_number : null,
        invoice_status: invoice ? invoice.status : null,
        allocation_amount: allocation ? Number(allocation.amount_allocated) : (transaction ? Number(transaction.amount) : 0),
        invoice_balance_after: invoice ? Number(invoice.balance) : 0,
        payment_evidence_status: row.status,
        allocated_at: allocation ? allocation.allocated_at : (transaction ? transaction.created_at : null),
        audit_reference: auditRow ? String(auditRow.id) : null
      },
      reversal_readiness: {
        can_request_reversal: false,
        state: 'reversal_not_enabled',
        blocking_reasons: [
          'Reversal execution is not enabled in this release.'
        ],
        required_future_confirmation_text: 'CONFIRM ALLOCATION REVERSAL',
        safety_message: 'This is reversal readiness only. No allocation, invoice, transaction, ledger, receipt, or tenant record has been changed.'
      },
      safety_message: 'Allocation result is read-only. No financial records were changed by this lookup.'
    });
  }));

  // GET /api/payment-evidence/:id/receipt-preview
  router.get('/payment-evidence/:id/receipt-preview', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const confirmedAllocation = row.raw_fields && typeof row.raw_fields === 'object'
      ? row.raw_fields.confirmed_selected_allocation
      : null;

    // Selected-allocation receipt preview slice:
    // read-only review contract only, no issuance and no mutation side effects.
    if (confirmedAllocation) {
      const isConfirmed = row.status === 'manually_reconciled';
      if (!isConfirmed) {
        return res.status(400).json({
          success: true,
          mode: 'receipt_preview_review_only',
          payment_evidence_id: row.id,
          receipt_preview: {
            eligible: false,
            state: 'allocation_not_confirmed',
            message: 'Receipt preview from confirmed allocation is available only after selected allocation confirmation.'
          },
          issuance_readiness: {
            can_issue_receipt: false,
            state: 'receipt_issuance_disabled_in_slice',
            blocking_reasons: [
              'Receipt issuance is not enabled in this slice.'
            ],
            required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
            safety_message: 'This is a receipt preview only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
          },
          safety_message: 'Receipt preview is review-only. No receipt has been issued yet.'
        });
      }

      const transactionId = Number(confirmedAllocation.transaction_id || 0);
      const paymentAllocationId = Number(confirmedAllocation.payment_allocation_id || 0);
      const invoiceId = Number(confirmedAllocation.invoice_id || 0);

      const transaction = transactionId
        ? await activeDb.findOne('transactions', { id: transactionId, organization_id: orgId })
        : null;
      const allocation = paymentAllocationId
        ? await activeDb.findOne('payment_allocations', { id: paymentAllocationId, organization_id: orgId })
        : null;
      const invoice = invoiceId
        ? await activeDb.findOne('invoices', { id: invoiceId, organization_id: orgId })
        : null;

      const selectedMatchFromRaw = row.raw_fields && typeof row.raw_fields === 'object'
        ? row.raw_fields.selected_match
        : null;
      const selectedTenantId = Number(selectedMatchFromRaw?.tenant_id || row.suggested_tenant_id || 0);
      const tenant = selectedTenantId > 0
        ? await activeDb.findOne('tenants', { id: selectedTenantId, organization_id: orgId })
        : null;

      if (!transaction || !allocation || !invoice || !tenant) {
        return res.status(409).json({
          error: 'ALLOCATION_RECORDS_INCOMPLETE',
          message: 'Confirmed allocation metadata is incomplete for receipt preview. Please refresh allocation result.'
        });
      }

      const allocatedAmount = Number(allocation.amount_allocated || confirmedAllocation.allocated_amount || 0);
      const draftNumberSeed = String(transaction.reference_number || row.transaction_code || row.id).replace(/\s+/g, '').toUpperCase();

      return res.json({
        success: true,
        mode: 'receipt_preview_review_only',
        payment_evidence_id: row.id,
        receipt_preview: {
          eligible: true,
          state: 'ready_for_review_only_receipt_preview',
          receipt_title: 'Draft Receipt Preview (Selected Allocation)',
          receipt_number_preview: `DRAFT-${draftNumberSeed}`,
          tenant_id: tenant.id,
          tenant_name: tenant.full_name,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          transaction_id: transaction.id,
          payment_allocation_id: allocation.id,
          payment_date: transaction.transaction_date || row.transaction_date,
          payment_method: transaction.payment_method || row.collection_channel || 'other',
          amount_paid: allocatedAmount,
          invoice_balance_after: Number(invoice.balance || 0),
          invoice_status: invoice.status,
          receipt_lines: [
            {
              label: `Allocation to invoice ${invoice.invoice_number}`,
              amount: allocatedAmount
            }
          ]
        },
        issuance_readiness: {
          can_issue_receipt: false,
          state: 'receipt_issuance_disabled_in_slice',
          blocking_reasons: [
            'Receipt issuance is not enabled in this slice.'
          ],
          required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
          safety_message: 'This is a receipt preview only. No receipt number has been reserved and no receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
        },
        post_preview_readiness: {
          download_receipt_enabled: false,
          print_receipt_enabled: false,
          send_receipt_enabled: false,
          ledger_posting_enabled: false,
          message: 'Receipt preview is review-only in this slice. Issuance, sending, printing, download, and ledger posting are disabled.'
        },
        safety_message: 'Receipt preview is review-only. No receipt has been issued yet.'
      });
    }

    const isAllocated = row.status === 'manually_reconciled' || row.status === 'auto_reconciled';
    if (!isAllocated) {
      const duplicateCheckState = await getReceiptDuplicateCheckState(activeDb, orgId, rowId, null, null);
      const receiptIssuanceContract = buildReceiptIssuanceContract({
        orgId,
        row,
        isAllocated,
        transaction: null,
        allocation: null,
        invoice: null,
        tenant: null,
        duplicateCheckState
      });

      return res.json({
        success: true,
        payment_evidence_id: row.id,
        receipt_preview: {
          eligible: false,
          state: 'not_allocated',
          message: 'This payment evidence row has not been allocated or reconciled yet.'
        },
        issuance_readiness: {
          can_issue_receipt: false,
          state: 'receipt_issuance_not_enabled',
          blocking_reasons: [
            'Receipt issuance is not enabled in this release.'
          ],
          required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
          safety_message: 'This is a receipt preview only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
        },
        receipt_issuance_contract: receiptIssuanceContract,
        safety_message: 'Receipt preview is read-only. No financial or receipt records were changed by this lookup.'
      });
    }

    const txs = await activeDb.find('transactions', { organization_id: orgId });
    const transaction = txs.find(t => {
      try {
        const payload = typeof t.raw_payload === 'string' ? JSON.parse(t.raw_payload) : t.raw_payload;
        return payload && Number(payload.evidence_id) === Number(rowId);
      } catch (e) {
        return false;
      }
    });

    let allocation = null;
    if (transaction) {
      allocation = await activeDb.findOne('payment_allocations', { transaction_id: transaction.id, organization_id: orgId });
    }

    const tenant = row.accepted_tenant_id
      ? await activeDb.findOne('tenants', { id: Number(row.accepted_tenant_id), organization_id: orgId })
      : null;

    const invoice = row.accepted_invoice_id
      ? await activeDb.findOne('invoices', { id: Number(row.accepted_invoice_id), organization_id: orgId })
      : null;

    const property = tenant && tenant.property_id
      ? await activeDb.findOne('properties', { id: Number(tenant.property_id), organization_id: orgId })
      : null;

    const unit = tenant && tenant.unit_id
      ? await activeDb.findOne('units', { id: Number(tenant.unit_id), organization_id: orgId })
      : null;

    const amountPaid = allocation ? Number(allocation.amount_allocated) : (transaction ? Number(transaction.amount) : 0);
    const duplicateCheckState = await getReceiptDuplicateCheckState(activeDb, orgId, rowId, transaction, allocation);
    const receiptIssuanceContract = buildReceiptIssuanceContract({
      orgId,
      row,
      isAllocated,
      transaction,
      allocation,
      invoice,
      tenant,
      duplicateCheckState
    });

    res.json({
      success: true,
      payment_evidence_id: row.id,
      receipt_preview: {
        eligible: true,
        state: 'ready_for_receipt_preview',
        tenant_id: tenant ? tenant.id : null,
        tenant_name: tenant ? tenant.full_name : null,
        invoice_id: invoice ? invoice.id : null,
        invoice_number: invoice ? invoice.invoice_number : null,
        transaction_id: transaction ? transaction.id : null,
        payment_allocation_id: allocation ? allocation.id : null,
        payment_date: row.transaction_date,
        payment_method: row.collection_channel || 'other',
        amount_paid: amountPaid,
        invoice_balance_after: invoice ? Number(invoice.balance) : 0,
        invoice_status: invoice ? invoice.status : null,
        property_name: property ? property.name : 'N/A',
        unit_label: unit ? unit.unit_code : 'N/A',
        receipt_number_preview: 'DRAFT-' + (row.transaction_code || `TX-${rowId}`),
        receipt_title: 'Payment Receipt Preview',
        receipt_lines: [
          {
            label: 'Rent payment allocation',
            amount: amountPaid
          }
        ]
      },
      issuance_readiness: {
        can_issue_receipt: false,
        state: 'receipt_issuance_not_enabled',
        blocking_reasons: [
          'Receipt issuance is not enabled in this release.'
        ],
        required_future_confirmation_text: 'CONFIRM RECEIPT ISSUANCE',
        safety_message: 'This is a receipt preview only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
      },
      receipt_issuance_contract: receiptIssuanceContract,
      safety_message: 'Receipt preview is read-only. No financial or receipt records were changed by this lookup.'
    });
  }));

  // POST /api/payment-evidence/:id/issue-receipt
  router.post('/payment-evidence/:id/issue-receipt', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const rowId = Number(req.params.id);

    const context = await getAllocatedReceiptContext(activeDb, orgId, rowId);
    if (!context.row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    const { confirmation_text } = req.body || {};
    if (!confirmation_text) {
      return res.status(400).json({
        error: 'CONFIRMATION_TEXT_REQUIRED',
        message: 'Confirmation text is required.'
      });
    }
    if (confirmation_text !== 'CONFIRM RECEIPT ISSUANCE') {
      return res.status(400).json({
        error: 'INVALID_CONFIRMATION_TEXT',
        message: 'Confirmation text is invalid. Please type "CONFIRM RECEIPT ISSUANCE".'
      });
    }

    if (!context.isAllocated) {
      return res.status(400).json({
        error: 'PAYMENT_EVIDENCE_NOT_ALLOCATED',
        message: 'Payment evidence must be allocated before receipt issuance.'
      });
    }
    if (!context.transaction) {
      return res.status(400).json({
        error: 'MISSING_TRANSACTION',
        message: 'An existing reconciled transaction is required before receipt issuance.'
      });
    }
    if (!context.allocation) {
      return res.status(400).json({
        error: 'MISSING_PAYMENT_ALLOCATION',
        message: 'An existing payment allocation is required before receipt issuance.'
      });
    }
    if (!context.invoice) {
      return res.status(400).json({
        error: 'MISSING_INVOICE',
        message: 'An existing invoice is required before receipt issuance.'
      });
    }
    if (!context.tenant) {
      return res.status(400).json({
        error: 'MISSING_TENANT',
        message: 'An existing tenant is required before receipt issuance.'
      });
    }
    if (context.duplicateCheckState === 'receipt_schema_not_enabled') {
      return res.status(400).json({
        error: 'RECEIPT_SCHEMA_NOT_ENABLED',
        message: 'Receipt storage schema is not enabled yet.'
      });
    }
    if (context.duplicateCheckState === 'existing_receipt_found') {
      return res.status(409).json({
        error: 'RECEIPT_ALREADY_ISSUED',
        message: 'A receipt already exists for this payment evidence, transaction, or allocation.'
      });
    }

    const issued = await insertIssuedReceipt(activeDb, context, orgId, userId);
    if (issued.duplicate) {
      return res.status(409).json({
        error: 'RECEIPT_ALREADY_ISSUED',
        message: 'A receipt already exists for this payment evidence, transaction, or allocation.'
      });
    }

    const receipt = mapReceiptResponse(issued.receipt, context.tenant, context.invoice, context.transaction, context.allocation);
    res.json({
      success: true,
      message: 'Receipt issued successfully.',
      payment_evidence_id: context.row.id,
      receipt,
      safety_message: 'Receipt issued exactly once. No ledger, invoice, tenant, transaction, allocation, or payment evidence financial record was changed.'
    });
  }));

  // GET /api/payment-evidence/:id/receipt-result
  router.get('/payment-evidence/:id/receipt-result', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    // Org-scoped row lookup
    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    // Find issued receipt for this evidence row
    let issuedReceipt = null;
    if (activeDb.pool && typeof activeDb.pool.connect === 'function') {
      const result = await activeDb.pool.connect().then(async (client) => {
        try {
          return await client.query(
            `SELECT * FROM receipts WHERE organization_id = $1 AND payment_evidence_id = $2 ORDER BY issued_at DESC LIMIT 1`,
            [orgId, rowId]
          );
        } finally {
          client.release();
        }
      });
      issuedReceipt = result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } else {
      const receipts = typeof activeDb.get === 'function' ? await activeDb.get('receipts') : [];
      const matches = receipts.filter(r =>
        Number(r.organization_id) === Number(orgId) &&
        Number(r.payment_evidence_id) === Number(rowId)
      );
      issuedReceipt = matches.length > 0 ? matches[matches.length - 1] : null;
    }

    if (!issuedReceipt) {
      return res.json({
        success: true,
        payment_evidence_id: rowId,
        receipt_issued: false,
        receipt: null,
        post_issuance_readiness: null,
        safety_message: 'Receipt result is read-only. No financial or receipt records were changed by this lookup.'
      });
    }

    // Parse the stored receipt payload snapshot
    const payload = typeof issuedReceipt.receipt_payload === 'string'
      ? JSON.parse(issuedReceipt.receipt_payload)
      : (issuedReceipt.receipt_payload || {});

    const receiptResult = {
      id: issuedReceipt.id,
      receipt_number: issuedReceipt.receipt_number,
      status: issuedReceipt.status,
      issued_at: issuedReceipt.issued_at,
      amount: Number(issuedReceipt.amount),
      currency: issuedReceipt.currency || 'KES',
      payment_method: issuedReceipt.payment_method || null,
      tenant_id: issuedReceipt.tenant_id,
      tenant_name: payload.tenant_name || null,
      invoice_id: issuedReceipt.invoice_id,
      invoice_number: payload.invoice_number || null,
      transaction_id: issuedReceipt.transaction_id,
      payment_allocation_id: issuedReceipt.payment_allocation_id,
      payment_evidence_id: issuedReceipt.payment_evidence_id,
      payment_date: payload.payment_date || null,
      invoice_status_at_issue: payload.invoice_status_at_issue || null,
      invoice_balance_after_allocation: payload.invoice_balance_after_allocation !== undefined ? Number(payload.invoice_balance_after_allocation) : null,
      receipt_lines: Array.isArray(payload.receipt_lines) ? payload.receipt_lines : []
    };

    // Post-issuance readiness block: all output actions are explicitly disabled
    const postIssuanceReadiness = {
      state: 'receipt_issued',
      download_pdf: { enabled: false, reason: 'PDF download is not supported in this release.' },
      print_receipt: { enabled: false, reason: 'Receipt printing is not supported in this release.' },
      send_receipt: { enabled: false, reason: 'Receipt sending is not supported in this release.' },
      void_receipt: { enabled: false, reason: 'Receipt voiding is not supported in this release.' },
      post_ledger: { enabled: false, reason: 'Ledger posting is not supported in this release.' },
      safety_message: 'Receipt has been issued. No further mutations are allowed via this endpoint. Download, print, send, void, and ledger posting are disabled.'
    };

    res.json({
      success: true,
      payment_evidence_id: rowId,
      receipt_issued: true,
      receipt: receiptResult,
      post_issuance_readiness: postIssuanceReadiness,
      safety_message: 'Receipt result is read-only. No financial or receipt records were changed by this lookup.'
    });
  }));

  // GET /api/payment-evidence/:id/receipt-print-view
  router.get('/payment-evidence/:id/receipt-print-view', requireAuthenticatedContext, requireLandlordOrSuperAdmin, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const rowId = Number(req.params.id);

    // Org-scoped row lookup
    const row = await activeDb.findOne('payment_evidence', { id: rowId, organization_id: orgId });
    if (!row) {
      return res.status(404).json({
        error: 'ROW_NOT_FOUND',
        message: 'The requested payment evidence record was not found or is outside your organization.'
      });
    }

    // Lookup organization for display name
    const organization = await activeDb.findOne('organizations', { id: Number(orgId) });

    // Find issued receipt for this evidence row
    let issuedReceipt = null;
    if (activeDb.pool && typeof activeDb.pool.connect === 'function') {
      const result = await activeDb.pool.connect().then(async (client) => {
        try {
          return await client.query(
            `SELECT * FROM receipts WHERE organization_id = $1 AND payment_evidence_id = $2 ORDER BY issued_at DESC LIMIT 1`,
            [orgId, rowId]
          );
        } finally {
          client.release();
        }
      });
      issuedReceipt = result.rows && result.rows.length > 0 ? result.rows[0] : null;
    } else {
      const receipts = typeof activeDb.get === 'function' ? await activeDb.get('receipts') : [];
      const matches = receipts.filter(r =>
        Number(r.organization_id) === Number(orgId) &&
        Number(r.payment_evidence_id) === Number(rowId)
      );
      issuedReceipt = matches.length > 0 ? matches[matches.length - 1] : null;
    }

    // Print readiness block — all output actions disabled in this release
    const printReadiness = {
      browser_print_enabled: false,
      pdf_download_enabled: false,
      send_enabled: false,
      ledger_posting_enabled: false,
      void_enabled: false,
      blocking_reasons: [
        'Browser print, PDF download, sending, ledger posting, and void workflows are not enabled in this release.'
      ],
      safety_message: 'Receipt print view is read-only. No receipt, ledger, invoice, tenant, transaction, allocation, or payment evidence record has been changed.'
    };

    if (!issuedReceipt) {
      return res.json({
        success: true,
        payment_evidence_id: rowId,
        print_view: {
          available: false,
          state: 'receipt_not_issued',
          message: 'No issued receipt found for this payment evidence record. Issue a receipt first.'
        },
        print_readiness: printReadiness,
        safety_message: 'Receipt print view lookup is read-only. No records were changed by this lookup.'
      });
    }

    // Parse the stored receipt payload snapshot
    const payload = typeof issuedReceipt.receipt_payload === 'string'
      ? JSON.parse(issuedReceipt.receipt_payload)
      : (issuedReceipt.receipt_payload || {});

    const printView = {
      available: true,
      state: 'ready_for_print_view',
      receipt_id: issuedReceipt.id,
      receipt_number: issuedReceipt.receipt_number,
      status: issuedReceipt.status,
      issued_at: issuedReceipt.issued_at,
      organization_name: organization ? organization.name : null,
      organization_account_number: organization ? organization.account_number : null,
      tenant_name: payload.tenant_name || null,
      invoice_number: payload.invoice_number || null,
      payment_date: payload.payment_date || null,
      payment_method: issuedReceipt.payment_method || payload.payment_method || null,
      amount: Number(issuedReceipt.amount),
      currency: issuedReceipt.currency || 'KES',
      invoice_status_at_issue: payload.invoice_status_at_issue || null,
      invoice_balance_after_allocation: payload.invoice_balance_after_allocation !== undefined
        ? Number(payload.invoice_balance_after_allocation)
        : null,
      receipt_lines: Array.isArray(payload.receipt_lines) ? payload.receipt_lines : [],
      footer_note: 'This is a system-generated receipt view.',
      watermark: 'ISSUED'
    };

    res.json({
      success: true,
      payment_evidence_id: rowId,
      print_view: printView,
      print_readiness: printReadiness,
      safety_message: 'Receipt print view lookup is read-only. No records were changed by this lookup.'
    });
  }));

  // POST /api/payment-evidence/pdf-statement-preview
  // Read-only endpoint: accepts PDF, extracts selectable text, detects provider,
  // and returns preview metadata plus Loop preview rows when supported.
  // Does NOT import rows, create batches, or mutate any records.
  router.post(
    '/payment-evidence/pdf-statement-preview',
    requireAuthenticatedContext,
    requireLandlordOrSuperAdmin,
    (req, res, next) => {
      pdfUpload.single('statement')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'FILE_TOO_LARGE',
            message: 'PDF file must not exceed 5 MB for the readiness preview.'
          });
        }
        if (err) {
          return res.status(400).json({
            error: 'UPLOAD_ERROR',
            message: err.message || 'File upload failed.'
          });
        }
        next();
      });
    },
    asyncHandler(async (req, res) => {
      // File presence check
      if (!req.file) {
        return res.status(400).json({
          error: 'NO_FILE',
          message: 'No PDF file was attached. Please upload a file using the "statement" field.'
        });
      }

      // MIME type check — must be application/pdf
      const mime = req.file.mimetype || '';
      if (mime !== 'application/pdf') {
        return res.status(400).json({
          error: 'INVALID_FILE_TYPE',
          message: `Only PDF files are accepted (received: ${mime || 'unknown'}). Please upload a file with MIME type application/pdf.`
        });
      }

      if (Number(req.file.size || 0) > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: 'FILE_TOO_LARGE',
          message: 'PDF file must not exceed 5 MB for the readiness preview.'
        });
      }

      // File is in memory buffer only. Do not save or parse transaction rows.
      const fileName = req.file.originalname || 'unknown.pdf';
      const fileSize = req.file.size || 0;
      const fileMime = req.file.mimetype;
      const extractionPreview = await buildPdfTextExtractionPreview(req.file);
      const providerDetection = detectPdfStatementProvider(extractionPreview.extractedText);
      const loopProviderDetected = providerDetection.detected_provider === 'LOOP_STATEMENT';
      const mpesaProviderDetected = providerDetection.detected_provider === 'MPESA_STATEMENT';

      const parserResult = {
        enabled: loopProviderDetected || mpesaProviderDetected,
        parser: loopProviderDetected ? 'LOOP_STATEMENT_V1' : (mpesaProviderDetected ? 'MPESA_STATEMENT_V1' : null),
        status: (loopProviderDetected || mpesaProviderDetected) ? 'preview_only' : 'not_enabled_for_provider',
        rows_detected: 0,
        rows_returned: 0,
        rows_skipped: 0,
        ready_for_review_count: 0,
        needs_attention_count: 0,
        skipped_count: 0,
        high_confidence_count: 0,
        medium_confidence_count: 0,
        low_confidence_count: 0,
        unknown_confidence_count: 0,
        warnings: (loopProviderDetected || mpesaProviderDetected)
          ? []
          : ['Parser not enabled for detected provider in this release.']
      };
      const importReadiness = {
        enabled: false,
        reason: 'Loop PDF import is not enabled in this release. Preview rows require parser validation review first.',
        validation_required: false,
        ready_for_future_import_count: 0,
        blocked_count: 0,
        blocking_reasons: [
          'Import is intentionally disabled until landlord-confirmed PDF import is implemented.'
        ]
      };

      if (!extractionPreview.extraction.text_available) {
        return res.json({
          success: true,
          mode: 'text_extraction_preview',
          document_source: 'PDF_STATEMENT',
          parser_status: 'no_text_found',
          file: {
            original_name: fileName,
            mime_type: fileMime,
            size_bytes: fileSize
          },
          extraction: extractionPreview.extraction,
          provider_detection: {
            enabled: true,
            ...providerDetection,
            message: 'Statement provider detection is enabled. Transaction row parsing is not enabled in this release.'
          },
          parser_result: {
            ...parserResult,
            enabled: false,
            parser: null,
            status: 'no_text_available',
            warnings: ['Parser not executed because no selectable text was found in the PDF.']
          },
          preview_rows: [],
          import_readiness: importReadiness,
          warnings: [
            'No selectable text was found in this PDF.',
            'This may be a scanned/image-only PDF.',
            'OCR is not enabled in this release.',
            'Provider detection is heuristic and should be confirmed by the landlord before parser import is enabled.',
            'Transaction row parsing is not enabled in this release.',
            'No payment evidence rows were imported.'
          ],
          next_parser_steps: [
            'Add Loop statement row parser.',
            'Add M-Pesa statement row parser.',
            'Add Co-op Bank statement row parser.',
            'Allow landlord-confirmed import into review queue.'
          ],
          safety_message: 'PDF text extraction preview is read-only. No records were changed.'
        });
      }

      if (loopProviderDetected) {
        const loopParsed = parseLoopStatementPreviewRows(extractionPreview.extractedText);
        const previewRows = loopParsed.previewRows;
        const validationSummary = summarizeLoopParserValidation(previewRows, loopParsed.rowsSkipped);
        const loopParserResult = {
          enabled: true,
          parser: 'LOOP_STATEMENT_V1',
          status: 'preview_only',
          rows_detected: loopParsed.rowsDetected,
          rows_returned: previewRows.length,
          rows_skipped: loopParsed.rowsSkipped,
          ready_for_review_count: validationSummary.ready_for_review_count,
          needs_attention_count: validationSummary.needs_attention_count,
          skipped_count: validationSummary.skipped_count,
          high_confidence_count: validationSummary.high_confidence_count,
          medium_confidence_count: validationSummary.medium_confidence_count,
          low_confidence_count: validationSummary.low_confidence_count,
          unknown_confidence_count: validationSummary.unknown_confidence_count,
          warnings: [...loopParsed.warnings, ...validationSummary.warnings]
        };

        const loopImportReadiness = {
          ...importReadiness,
          validation_required: true,
          ready_for_future_import_count: validationSummary.ready_for_review_count,
          blocked_count: validationSummary.needs_attention_count + validationSummary.skipped_count
        };

        return res.json({
          success: true,
          mode: 'loop_statement_preview_rows',
          document_source: 'PDF_STATEMENT',
          parser_status: previewRows.length > 0 ? 'loop_preview_rows_available' : 'loop_preview_rows_unavailable',
          file: {
            original_name: fileName,
            mime_type: fileMime,
            size_bytes: fileSize
          },
          extraction: extractionPreview.extraction,
          provider_detection: {
            enabled: true,
            ...providerDetection,
            message: 'Statement provider detection is enabled. Loop preview row parsing is enabled for review only.'
          },
          parser_result: loopParserResult,
          preview_rows: previewRows,
          import_readiness: loopImportReadiness,
          warnings: [
            'Loop statement preview row parsing is enabled for review only.',
            'Rows were not imported.',
            'No payment evidence rows were created.',
            'No invoice, tenant, receipt, ledger, transaction, allocation, or balance record was changed.'
          ],
          next_parser_steps: [
            'Add parser confidence and row-level error review.',
            'Add landlord-confirmed import into payment evidence review queue.',
            'Add duplicate protection for imported statement rows.'
          ],
          safety_message: 'Loop statement row parsing preview is read-only. No payment evidence, invoice, tenant, receipt, ledger, transaction, allocation, or balance record has been changed.'
        });
      }

      if (mpesaProviderDetected) {
        const mpesaParsed = parseMpesaStatementPreviewRows(extractionPreview.extractedText);
        const previewRows = mpesaParsed.previewRows;
        const validationSummary = summarizeMpesaParserValidation(previewRows, mpesaParsed.rowsSkipped);
        const mpesaParserResult = {
          enabled: true,
          parser: 'MPESA_STATEMENT_V1',
          status: 'preview_only',
          rows_detected: mpesaParsed.rowsDetected,
          rows_returned: previewRows.length,
          rows_skipped: mpesaParsed.rowsSkipped,
          ready_for_review_count: validationSummary.ready_for_review_count,
          needs_attention_count: validationSummary.needs_attention_count,
          skipped_count: validationSummary.skipped_count,
          high_confidence_count: validationSummary.high_confidence_count,
          medium_confidence_count: validationSummary.medium_confidence_count,
          low_confidence_count: validationSummary.low_confidence_count,
          unknown_confidence_count: validationSummary.unknown_confidence_count,
          warnings: [...mpesaParsed.warnings, ...validationSummary.warnings]
        };

        const mpesaImportReadiness = {
          enabled: false,
          reason: 'M-Pesa statement import is not enabled in this release. Preview rows are shown for parser validation only.',
          validation_required: true,
          ready_for_future_import_count: validationSummary.ready_for_review_count,
          blocked_count: validationSummary.needs_attention_count + validationSummary.skipped_count,
          blocking_reasons: [
            'Import is intentionally disabled until landlord-confirmed M-Pesa import is implemented.'
          ]
        };

        return res.json({
          success: true,
          mode: 'mpesa_statement_preview_rows',
          document_source: 'MPESA_STATEMENT',
          parser_status: previewRows.length > 0 ? 'mpesa_preview_rows_available' : 'mpesa_preview_rows_unavailable',
          file: {
            original_name: fileName,
            mime_type: fileMime,
            size_bytes: fileSize
          },
          extraction: extractionPreview.extraction,
          provider_detection: {
            enabled: true,
            ...providerDetection,
            message: 'Statement provider detection is enabled. M-Pesa preview row parsing is enabled for review only.'
          },
          parser_result: mpesaParserResult,
          preview_rows: previewRows,
          import_readiness: mpesaImportReadiness,
          warnings: [
            'M-Pesa statement preview is available. Import to review queue is coming later.',
            'Rows were not imported.',
            'No payment evidence rows were created.',
            'No invoice, tenant, receipt, ledger, transaction, allocation, or balance record was changed.'
          ],
          next_parser_steps: [
            'Review M-Pesa parser confidence and row-level validation.',
            'Add landlord-confirmed M-Pesa import into payment evidence review queue.',
            'Add duplicate protection for imported M-Pesa statement rows.'
          ],
          safety_message: 'M-Pesa statement row parsing preview is read-only. No payment evidence, invoice, tenant, receipt, ledger, transaction, allocation, or balance record has been changed.'
        });
      }

      // Return text extraction preview only.
      // Zero database mutations — no payment_evidence, batches, transactions,
      // allocations, receipts, invoices, tenants, or ledger records are touched.
      return res.json({
        success: true,
        mode: 'text_extraction_preview',
        document_source: 'PDF_STATEMENT',
        parser_status: extractionPreview.parserStatus,
        file: {
          original_name: fileName,
          mime_type: fileMime,
          size_bytes: fileSize
        },
        extraction: extractionPreview.extraction,
        provider_detection: {
          enabled: true,
          ...providerDetection,
          message: 'Statement provider detection is enabled. Transaction row parsing is not enabled in this release.'
        },
        parser_result: parserResult,
        preview_rows: [],
        import_readiness: importReadiness,
        warnings: [
          'PDF text extraction is enabled for selectable-text PDFs only.',
          'Provider detection is heuristic and should be confirmed by the landlord before parser import is enabled.',
          'Transaction row parsing is not enabled in this release.',
          'No payment evidence rows were imported.',
          'No invoice, tenant, receipt, ledger, transaction, allocation, or balance record was changed.'
        ],
        next_parser_steps: [
          'Add Loop statement row parser.',
          'Add M-Pesa statement row parser.',
          'Add Co-op Bank statement row parser.',
          'Allow landlord-confirmed import into review queue.'
        ],
        safety_message: 'PDF text extraction preview is read-only. No payment evidence, invoice, tenant, receipt, ledger, transaction, allocation, or balance record has been changed.'
      });
    })
  );

  // POST /api/payment-evidence/pdf-statement-import
  // Controlled mutation endpoint: imports only validated Loop preview rows into
  // payment_evidence review queue. No allocations, receipts, ledger, transaction,
  // invoice, tenant, or balance mutations occur here.
  router.post(
    '/payment-evidence/pdf-statement-import',
    requireAuthenticatedContext,
    requireLandlordOrSuperAdmin,
    (req, res, next) => {
      pdfUpload.single('statement')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'FILE_TOO_LARGE',
            message: 'PDF file must not exceed 5 MB for Loop import.'
          });
        }
        if (err) {
          return res.status(400).json({
            error: 'UPLOAD_ERROR',
            message: err.message || 'File upload failed.'
          });
        }
        next();
      });
    },
    asyncHandler(async (req, res) => {
      const { orgId, userId } = getContext(req);
      const body = req.body || {};
      const confirmationText = String(body.confirmation_text || '');
      const sourceLabel = String(body.source_label || 'Loop PDF Statement').trim() || 'Loop PDF Statement';
      let providedPreviewRows = [];
      if (typeof body.preview_rows_json === 'string' && body.preview_rows_json.trim()) {
        try {
          const parsed = JSON.parse(body.preview_rows_json);
          if (Array.isArray(parsed)) {
            providedPreviewRows = parsed;
          }
        } catch (_err) {
          providedPreviewRows = [];
        }
      } else if (Array.isArray(body.preview_rows)) {
        providedPreviewRows = body.preview_rows;
      }
      const providedRowsSkipped = Number(body.preview_rows_skipped || 0);

      if (!req.file) {
        return res.status(400).json({
          error: 'NO_FILE',
          message: 'No PDF file was attached. Please upload a file using the "statement" field.'
        });
      }

      const mime = req.file.mimetype || '';
      if (mime !== 'application/pdf') {
        return res.status(400).json({
          error: 'INVALID_FILE_TYPE',
          message: `Only PDF files are accepted (received: ${mime || 'unknown'}). Please upload a file with MIME type application/pdf.`
        });
      }

      if (Number(req.file.size || 0) > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: 'FILE_TOO_LARGE',
          message: 'PDF file must not exceed 5 MB for Loop import.'
        });
      }

      if (confirmationText !== LOOP_PDF_IMPORT_CONFIRMATION_TEXT) {
        return res.status(400).json({
          error: 'INVALID_CONFIRMATION_TEXT',
          message: `Confirmation text is invalid. Please type "${LOOP_PDF_IMPORT_CONFIRMATION_TEXT}".`
        });
      }

      const extractionPreview = await buildPdfTextExtractionPreview(req.file);
      if (!extractionPreview.extraction.text_available) {
        return res.status(400).json({
          error: 'NO_TEXT_FOUND',
          message: 'No selectable text was found in this PDF. OCR is not enabled in this release.'
        });
      }

      const providerDetection = detectPdfStatementProvider(extractionPreview.extractedText);
      const loopParsed = parseLoopStatementPreviewRows(extractionPreview.extractedText);
      const candidatePreviewRows = providedPreviewRows.length > 0 ? providedPreviewRows : loopParsed.previewRows;
      const selection = buildLoopPdfPaymentEvidenceImportRows(candidatePreviewRows);
      const detectedRowsCount = Math.max(loopParsed.rowsDetected, candidatePreviewRows.length);

      if (providerDetection.detected_provider !== 'LOOP_STATEMENT' && selection.eligibleRows.length === 0) {
        return res.status(400).json({
          error: 'UNSUPPORTED_PROVIDER',
          message: 'Only Loop statements are supported for PDF import in this release.',
          provider_detection: {
            detected_provider: providerDetection.detected_provider,
            detected_statement_type: providerDetection.detected_statement_type,
            confidence: providerDetection.confidence,
            score: providerDetection.score
          }
        });
      }

      const eligibleRows = selection.eligibleRows;

      if (eligibleRows.length === 0) {
        const feeRowsSkipped = Math.max(loopParsed.rowsSkipped, selection.skippedSummary.fee_or_charge, Number.isFinite(providedRowsSkipped) ? providedRowsSkipped : 0);
        const totalSkipped = detectedRowsCount;
        return res.json({
          success: true,
          mode: 'loop_pdf_import_to_review_queue',
          document_source: 'PDF_STATEMENT',
          source_provider: 'LOOP_STATEMENT',
          import_status: 'nothing_imported',
          batch: null,
          import_result: {
            rows_detected: detectedRowsCount,
            rows_eligible: 0,
            rows_imported: 0,
            rows_skipped: totalSkipped,
            duplicate_rows_skipped: selection.skippedSummary.duplicate_like,
            needs_attention_rows_skipped: selection.skippedSummary.needs_attention + selection.skippedSummary.missing_required_fields,
            fee_rows_skipped: feeRowsSkipped,
            created_payment_evidence_ids: []
          },
          skipped_summary: {
            duplicate_like: selection.skippedSummary.duplicate_like,
            needs_attention: selection.skippedSummary.needs_attention,
            fee_or_charge: feeRowsSkipped,
            missing_required_fields: selection.skippedSummary.missing_required_fields
          },
          post_import_readiness: {
            matching_enabled: false,
            allocation_enabled: false,
            receipt_enabled: false,
            ledger_enabled: false,
            message: 'Rows were imported into payment evidence review only. Matching, allocation, receipt, and ledger workflows were not executed.'
          },
          safety_message: 'Loop PDF import created payment evidence review rows only. No transactions, allocations, receipts, ledger entries, invoices, tenants, or balances were changed.'
        });
      }

      const fileName = req.file.originalname || 'statement.pdf';
      const nowIso = new Date().toISOString();
      const batch = await activeDb.insert('payment_evidence_batches', {
        organization_id: orgId,
        upload_filename: fileName,
        import_timestamp: nowIso,
        uploaded_by: userId,
        detected_provider: 'LOOP_STATEMENT',
        detected_format: 'PDF_STATEMENT',
        parser_version: 'LOOP_STATEMENT_V1',
        total_rows: detectedRowsCount,
        rows_imported: 0,
        rows_ignored: 0,
        rows_duplicated: 0,
        rows_reconciled: 0,
        rows_needing_review: 0,
        rows_failed_validation: 0
      });

      const createdPaymentEvidenceIds = [];
      const insertedEvidenceRows = [];
      const seenComposite = new Set();
      let duplicateRowsSkipped = selection.skippedSummary.duplicate_like;
      let importedRows = 0;
      let failedValidationRows = selection.skippedSummary.missing_required_fields;

      for (const row of eligibleRows) {
        const transactionCode = String(row.transaction_code || '').toUpperCase().trim();
        const amount = Number(row.amount);
        const transactionDate = row.transaction_date;
        const compositeKey = `${transactionCode}|${transactionDate}|${amount.toFixed(2)}`;

        if (seenComposite.has(compositeKey)) {
          duplicateRowsSkipped += 1;
          continue;
        }

        const existingEvidenceWithCode = await activeDb.find('payment_evidence', {
          organization_id: orgId,
          transaction_code: transactionCode
        });
        const existingEvidenceDuplicate = existingEvidenceWithCode.some(existing =>
          String(existing.transaction_date || '').slice(0, 10) === transactionDate &&
          Number(existing.amount) === amount
        );
        if (existingEvidenceDuplicate) {
          duplicateRowsSkipped += 1;
          continue;
        }

        const txByReference = await activeDb.find('transactions', {
          organization_id: orgId,
          reference_number: transactionCode
        });
        const txByCode = await activeDb.find('transactions', {
          organization_id: orgId,
          transaction_code: transactionCode
        });
        const txDuplicate = [...txByReference, ...txByCode].some(tx => String(tx.status || '').toLowerCase() !== 'failed');
        if (txDuplicate) {
          duplicateRowsSkipped += 1;
          continue;
        }

        seenComposite.add(compositeKey);

        let normalizedRow;
        try {
          const payer = extractLoopPayerFromRawText(row.raw_text || row.description || '');
          normalizedRow = normalizePaymentEvidence({
            amount,
            transaction_date: transactionDate,
            transaction_code: transactionCode,
            payer_name: payer.payer_name,
            payer_phone: payer.payer_phone,
            reference_account: row.partner_reference || null,
            paybill_reference: null,
            invoice_reference: null,
            description: row.description || '',
            collection_channel: row.collection_channel || 'unknown',
            direction: row.direction === 'money_out' ? 'debit' : 'credit',
            raw_text: row.raw_text || row.description || '',
            raw_fields: {
              loop_preview_row: row,
              parser_confidence: row.parser_confidence,
              confidence_score: row.confidence_score,
              parser_validation: row.validation || null,
              parser_validation_errors: row.validation_errors || []
            }
          }, {
            organization_id: orgId,
            batch_id: batch.id,
            source_provider: 'LOOP_STATEMENT',
            source_type: 'PDF_STATEMENT',
            source_perspective: 'landlord',
            document_source: 'PDF_STATEMENT'
          });
        } catch (_err) {
          failedValidationRows += 1;
          continue;
        }

        const evidenceStrength = row.parser_confidence === 'high'
          ? 'high'
          : (row.parser_confidence === 'medium' ? 'medium' : 'unknown');

        const inserted = await activeDb.insert('payment_evidence', {
          organization_id: orgId,
          batch_id: batch.id,
          source_provider: 'LOOP_STATEMENT',
          source_type: 'PDF_STATEMENT',
          source_perspective: 'landlord',
          collection_channel: normalizedRow.collection_channel || 'unknown',
          document_source: 'PDF_STATEMENT',
          transaction_date: normalizedRow.transaction_date,
          transaction_time: normalizedRow.transaction_time || null,
          amount: normalizedRow.amount,
          direction: normalizedRow.direction,
          transaction_code: normalizedRow.transaction_code,
          payer_name: normalizedRow.payer_name,
          payer_phone: normalizedRow.payer_phone,
          recipient_name: normalizedRow.recipient_name,
          recipient_phone: normalizedRow.recipient_phone,
          paybill_number: normalizedRow.paybill_number,
          till_number: normalizedRow.till_number,
          agent_number: normalizedRow.agent_number,
          reference_account: normalizedRow.reference_account,
          description: normalizedRow.description || '',
          raw_text: normalizedRow.raw_text,
          raw_fields: normalizedRow.raw_fields,
          row_hash: normalizedRow.row_hash,
          confidence: Number(row.confidence_score || 0),
          evidence_strength: evidenceStrength,
          status: 'needs_review',
          ignored_reason: null,
          paybill_reference: normalizedRow.paybill_reference,
          bank_reference: normalizedRow.bank_reference,
          recipient_account: normalizedRow.recipient_account,
          invoice_reference: normalizedRow.invoice_reference,
          landlord_account_number: normalizedRow.landlord_account_number
        });

        importedRows += 1;
        createdPaymentEvidenceIds.push(inserted.id);
        insertedEvidenceRows.push(inserted);
      }

      const feeRowsSkipped = Math.max(loopParsed.rowsSkipped, selection.skippedSummary.fee_or_charge, Number.isFinite(providedRowsSkipped) ? providedRowsSkipped : 0);
      const needsAttentionRowsSkipped = selection.skippedSummary.needs_attention + selection.skippedSummary.missing_required_fields;
      const totalRowsSkipped = Math.max(0, detectedRowsCount - importedRows);

      await activeDb.update('payment_evidence_batches', batch.id, {
        rows_imported: importedRows,
        rows_ignored: feeRowsSkipped,
        rows_duplicated: duplicateRowsSkipped,
        rows_needing_review: importedRows,
        rows_failed_validation: failedValidationRows
      });

      const matchingSuggestions = await buildPaymentEvidenceMatchingSuggestions(activeDb, orgId, insertedEvidenceRows, 3);
      const rowsWithSuggestions = matchingSuggestions.filter(item => item.match_count > 0).length;

      return res.json({
        success: true,
        mode: 'loop_pdf_import_to_review_queue',
        document_source: 'PDF_STATEMENT',
        source_provider: 'LOOP_STATEMENT',
        import_status: importedRows > 0 ? 'completed_with_review_rows' : 'nothing_imported',
        batch: {
          id: batch.id,
          upload_filename: fileName,
          source_label: sourceLabel,
          rows_imported: importedRows,
          rows_skipped: totalRowsSkipped
        },
        import_result: {
          rows_detected: detectedRowsCount,
          rows_eligible: eligibleRows.length,
          rows_imported: importedRows,
          rows_skipped: totalRowsSkipped,
          duplicate_rows_skipped: duplicateRowsSkipped,
          needs_attention_rows_skipped: needsAttentionRowsSkipped,
          fee_rows_skipped: feeRowsSkipped,
          created_payment_evidence_ids: createdPaymentEvidenceIds
        },
        matching_suggestions: matchingSuggestions,
        matching_summary: {
          rows_with_suggestions: rowsWithSuggestions,
          rows_without_suggestions: Math.max(0, insertedEvidenceRows.length - rowsWithSuggestions)
        },
        skipped_summary: {
          duplicate_like: selection.skippedSummary.duplicate_like,
          needs_attention: selection.skippedSummary.needs_attention,
          fee_or_charge: feeRowsSkipped,
          missing_required_fields: selection.skippedSummary.missing_required_fields
        },
        post_import_readiness: {
          matching_enabled: false,
          allocation_enabled: false,
          receipt_enabled: false,
          ledger_enabled: false,
          message: 'Rows were imported into payment evidence review only. Matching suggestions are review-only. Allocation, receipt, and ledger workflows were not executed.'
        },
        safety_message: 'Loop PDF import created payment evidence review rows only. No transactions, allocations, receipts, ledger entries, invoices, tenants, or balances were changed.'
      });
    })
  );

  return router;
}
