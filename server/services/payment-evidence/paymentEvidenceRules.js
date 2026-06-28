export const PERSPECTIVES = {
  LANDLORD: 'landlord',
  TENANT: 'tenant',
  UNKNOWN: 'unknown'
};

export const DIRECTIONS = {
  CREDIT: 'credit',
  DEBIT: 'debit',
  UNKNOWN: 'unknown'
};

export const STATUSES = {
  IMPORTED: 'imported',
  IGNORED: 'ignored',
  DUPLICATE: 'duplicate',
  CANDIDATE_FOUND: 'candidate_found',
  NEEDS_REVIEW: 'needs_review',
  AUTO_RECONCILED: 'auto_reconciled',
  MANUALLY_RECONCILED: 'manually_reconciled',
  FAILED_VALIDATION: 'failed_validation'
};

export const COLLECTION_CHANNELS = {
  MPESA_PAYBILL: 'MPESA_PAYBILL',
  BANK_PAYBILL: 'BANK_PAYBILL',
  BANK_TRANSFER: 'BANK_TRANSFER',
  MPESA_SEND_MONEY: 'MPESA_SEND_MONEY',
  MPESA_TILL: 'MPESA_TILL',
  MPESA_AGENT: 'MPESA_AGENT',
  BANK_DEPOSIT: 'BANK_DEPOSIT',
  PESALINK: 'PESALINK',
  CHEQUE: 'CHEQUE',
  CASH: 'CASH',
  UNKNOWN: 'UNKNOWN'
};

export const DOCUMENT_SOURCES = {
  CSV: 'CSV',
  PDF_STATEMENT: 'PDF_STATEMENT',
  PDF_RECEIPT: 'PDF_RECEIPT',
  BANK_STATEMENT: 'BANK_STATEMENT',
  MPESA_STATEMENT: 'MPESA_STATEMENT',
  EXCEL: 'EXCEL',
  WEBHOOK: 'WEBHOOK',
  MANUAL: 'MANUAL',
  UNKNOWN: 'UNKNOWN'
};

export const EVIDENCE_STRENGTHS = {
  VERIFIED: 'verified',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'unknown'
};

export const IGNORE_KEYWORDS = [
  'charge',
  'fee',
  'excise',
  'loan',
  'interest',
  'airtime',
  'subscription'
];

// Per-matcher date windows in days
export const MATCHER_WINDOWS = {
  TRANSACTION_CODE_WINDOW: null, // No limit
  REFERENCE_ACCOUNT_WINDOW: 30,
  PAYBILL_REFERENCE_WINDOW: 30,
  PHONE_MATCH_WINDOW: 3,
  NAME_MATCH_WINDOW: 2,
  AMOUNT_ONLY_WINDOW: 3
};
