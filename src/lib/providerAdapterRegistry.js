/**
 * providerAdapterRegistry.js
 *
 * Static read-only registry of all statement provider adapters for the
 * Payment Evidence import wizard.
 *
 * REGISTRY RULES:
 * - This file is purely declarative. It has no side effects.
 * - It does not create transactions, allocations, receipts, or ledger entries.
 * - It does not mutate invoices, tenants, or balances.
 * - It does not add dependencies or migrations.
 * - Adding a new adapter here does NOT enable it. The `status` field controls gating.
 * - To promote an adapter to `supported`, a real parser must first be implemented
 *   and reviewed end-to-end through the review queue.
 */

// ─── Adapter Status Constants ─────────────────────────────────────────────────

export const ADAPTER_STATUS = Object.freeze({
  SUPPORTED:    'supported',
  PREVIEW_ONLY: 'preview_only',
  COMING_LATER: 'coming_later',
  DISABLED:     'disabled'
});

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * STATEMENT_PROVIDER_ADAPTERS
 *
 * Each key is the adapter key used internally (maps to importSource values
 * in the wizard or to a provider+source_type combination).
 *
 * Fields:
 *   wizard_source_id  — the `importSource` state value used by the wizard
 *   source_type       — canonical document source type
 *   provider          — canonical provider identifier
 *   label             — human-readable display label
 *   status            — one of ADAPTER_STATUS values
 *   capabilities      — what the adapter can do (all false unless implemented)
 */
export const STATEMENT_PROVIDER_ADAPTERS = Object.freeze({

  LOOP_PDF: Object.freeze({
    wizard_source_id: 'pdf_bank',
    source_type: 'PDF_BANK_STATEMENT',
    provider: 'LOOP',
    label: 'Loop PDF Statement',
    status: ADAPTER_STATUS.SUPPORTED,
    capabilities: Object.freeze({
      preview:                true,
      row_validation:         true,
      import_to_review_queue: true,
      matching_suggestions:   true,
      match_selection:        true,
      allocation_preview:     true,
      confirmed_allocation:   true,
      receipt_preview:        true,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  MPESA_STATEMENT: Object.freeze({
    wizard_source_id: 'mpesa_statement',
    source_type: 'MPESA_STATEMENT',
    provider: 'MPESA',
    label: 'M-Pesa Statement',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  COOP_BANK: Object.freeze({
    wizard_source_id: 'pdf_bank',
    source_type: 'PDF_BANK_STATEMENT',
    provider: 'COOP',
    label: 'Co-op Bank Statement',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  KCB_BANK: Object.freeze({
    wizard_source_id: 'pdf_bank',
    source_type: 'PDF_BANK_STATEMENT',
    provider: 'KCB',
    label: 'KCB Statement',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  EQUITY_BANK: Object.freeze({
    wizard_source_id: 'pdf_bank',
    source_type: 'PDF_BANK_STATEMENT',
    provider: 'EQUITY',
    label: 'Equity Statement',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  ABSA_BANK: Object.freeze({
    wizard_source_id: 'pdf_bank',
    source_type: 'PDF_BANK_STATEMENT',
    provider: 'ABSA',
    label: 'Absa Statement',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  PDF_RECEIPT_ADVICE: Object.freeze({
    wizard_source_id: 'pdf_receipt',
    source_type: 'PDF_RECEIPT_ADVICE',
    provider: 'GENERIC',
    label: 'PDF Receipt/Advice',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  EXCEL_FILE: Object.freeze({
    wizard_source_id: 'excel',
    source_type: 'EXCEL_FILE',
    provider: 'GENERIC',
    label: 'Excel file',
    status: ADAPTER_STATUS.COMING_LATER,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  }),

  OTHER_UNKNOWN: Object.freeze({
    wizard_source_id: 'unknown',
    source_type: 'OTHER_UNKNOWN',
    provider: 'UNKNOWN',
    label: 'Other/Unknown',
    status: ADAPTER_STATUS.DISABLED,
    capabilities: Object.freeze({
      preview:                false,
      row_validation:         false,
      import_to_review_queue: false,
      matching_suggestions:   false,
      match_selection:        false,
      allocation_preview:     false,
      confirmed_allocation:   false,
      receipt_preview:        false,
      receipt_issuance:       false,
      ledger_posting:         false
    })
  })

});

// ─── Helper Functions (read-only, no side effects) ────────────────────────────

/**
 * Returns all adapters with status === 'supported'.
 */
export function getSupportedAdapters() {
  return Object.values(STATEMENT_PROVIDER_ADAPTERS).filter(
    (a) => a.status === ADAPTER_STATUS.SUPPORTED
  );
}

/**
 * Returns all adapters with status === 'coming_later'.
 */
export function getComingLaterAdapters() {
  return Object.values(STATEMENT_PROVIDER_ADAPTERS).filter(
    (a) => a.status === ADAPTER_STATUS.COMING_LATER
  );
}

/**
 * Returns all adapters with status === 'disabled'.
 */
export function getDisabledAdapters() {
  return Object.values(STATEMENT_PROVIDER_ADAPTERS).filter(
    (a) => a.status === ADAPTER_STATUS.DISABLED
  );
}

/**
 * Returns all adapters with status === 'preview_only'.
 */
export function getPreviewOnlyAdapters() {
  return Object.values(STATEMENT_PROVIDER_ADAPTERS).filter(
    (a) => a.status === ADAPTER_STATUS.PREVIEW_ONLY
  );
}

/**
 * Returns whether a given wizard_source_id maps to a supported adapter.
 * Used to gate the final import step.
 *
 * For 'pdf_bank' source_id, also checks the provider key to distinguish
 * LOOP_PDF (supported) from COOP/KCB/EQUITY/ABSA (coming_later).
 *
 * @param {string} wizardSourceId  - importSource state value from wizard
 * @param {string} [providerKey]   - optional importProvider state value
 * @returns {boolean}
 */
export function isSourceImportSupported(wizardSourceId, providerKey) {
  // Loop PDF is the only fully supported source for import to review queue
  if (wizardSourceId === 'pdf_bank' && providerKey && providerKey === 'loop') {
    return true;
  }
  // CSV is also supported for import-to-review-queue via the CSV path
  if (wizardSourceId === 'csv') {
    return true;
  }
  return false;
}

/**
 * Returns the display label for a given adapter status.
 * @param {string} status
 * @returns {string}
 */
export function getAdapterStatusLabel(status) {
  switch (status) {
    case ADAPTER_STATUS.SUPPORTED:    return 'Supported';
    case ADAPTER_STATUS.PREVIEW_ONLY: return 'Preview Only';
    case ADAPTER_STATUS.COMING_LATER: return 'Coming Later';
    case ADAPTER_STATUS.DISABLED:     return 'Disabled';
    default:                          return 'Unknown';
  }
}
