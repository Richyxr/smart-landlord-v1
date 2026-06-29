import React, { useState, useEffect } from 'react';
import {
  Eye,
  Search,
  X,
  Smartphone,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ShieldAlert,
  HelpCircle,
  FileSpreadsheet,
  Coins,
  Upload,
  ArrowLeft,
  ArrowRight,
  Check,
  Info
} from 'lucide-react';

export default function PaymentEvidence({ organization, refreshTrigger, user, role }) {
  const [evidenceRows, setEvidenceRows] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filter States
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [strength, setStrength] = useState('');
  const [channel, setChannel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState('');
  const [reviewDecisionFilter, setReviewDecisionFilter] = useState('');
  const [suggestionFilter, setSuggestionFilter] = useState('');
  const [matchConfidenceFilter, setMatchConfidenceFilter] = useState('');
  const [auditHistoryFilter, setAuditHistoryFilter] = useState('');
  const [reviewedFrom, setReviewedFrom] = useState('');
  const [reviewedTo, setReviewedTo] = useState('');
  const [importedFrom, setImportedFrom] = useState('');
  const [importedTo, setImportedTo] = useState('');

  // Selected row for Detail Drawer
  const [selectedRow, setSelectedRow] = useState(null);

  // Manual Review Decision States
  const [reviewDecisionType, setReviewDecisionType] = useState('');
  const [acceptedCandidateIndex, setAcceptedCandidateIndex] = useState(-1);
  const [rejectedReasonText, setRejectedReasonText] = useState('');
  const [reviewNotesText, setReviewNotesText] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Draft Allocation Preview States
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [typedConfirmationText, setTypedConfirmationText] = useState('');
  const [confirmingAllocation, setConfirmingAllocation] = useState(false);

  // Allocation Result States
  const [allocationResultData, setAllocationResultData] = useState(null);
  const [loadingResult, setLoadingResult] = useState(false);
  const [resultError, setResultError] = useState('');

  const fetchAllocationResult = async (id) => {
    setLoadingResult(true);
    setResultError('');
    try {
      const res = await fetch(`/api/payment-evidence/${id}/allocation-result`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to fetch allocation result');
      }
      setAllocationResultData(data);
    } catch (err) {
      console.error(err);
      setResultError(err.message || 'Failed to fetch allocation result');
      setAllocationResultData(null);
    } finally {
      setLoadingResult(false);
    }
  };

  const fetchAllocationPreview = async (id) => {
    setLoadingPreview(true);
    setPreviewError('');
    try {
      const res = await fetch(`/api/payment-evidence/${id}/allocation-preview`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to fetch allocation preview');
      }
      setPreviewData(data);
    } catch (err) {
      console.error(err);
      setPreviewError(err.message || 'Failed to fetch allocation preview');
      setPreviewData(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const fetchAuditLogs = async (id) => {
    setLoadingAudit(true);
    try {
      const res = await fetch(`/api/payment-evidence/${id}/review-audit`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to fetch audit log');
      }
      setAuditLogs(data.audit || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const getBrandedConfirmAndNotify = () => {
    const showConfirm = window.showConfirm;
    const notifySuccess = window.notifySuccess;
    const notifyError = window.notifyError;
    const notifyWarning = window.notifyWarning;

    if (!showConfirm || !notifySuccess || !notifyError || !notifyWarning) {
      console.warn("Branded notification/confirmation system is unavailable.");
      return null;
    }

    return { showConfirm, notifySuccess, notifyError, notifyWarning };
  };

  // Import Wizard State
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [importSource, setImportSource] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importProvider, setImportProvider] = useState('');
  const [parsedPreviewRows, setParsedPreviewRows] = useState([]);
  const [wizardError, setWizardError] = useState('');

  // Fetch batches & evidence rows
  useEffect(() => {
    fetchBatches();
    fetchEvidenceRows();
  }, [refreshTrigger, status, strength, channel, startDate, endDate, minAmount, maxAmount, selectedBatchId, reviewStatusFilter, reviewDecisionFilter, suggestionFilter, matchConfidenceFilter, auditHistoryFilter, reviewedFrom, reviewedTo, importedFrom, importedTo]);

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEvidenceRows();
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setReviewDecisionType(selectedRow?.status === 'ignored' ? 'marked_irrelevant' : '');
    setAcceptedCandidateIndex(-1);
    setRejectedReasonText('');
    setReviewNotesText('');
    setSavingReview(false);
    setTypedConfirmationText('');
    setConfirmingAllocation(false);

    if (selectedRow && (role === 'landlord' || role === 'super_admin')) {
      fetchAuditLogs(selectedRow.id);
      if (selectedRow.status === 'manually_reconciled' || selectedRow.status === 'auto_reconciled') {
        fetchAllocationResult(selectedRow.id);
        setPreviewData(null);
        setPreviewError('');
      } else {
        fetchAllocationPreview(selectedRow.id);
        setAllocationResultData(null);
        setResultError('');
      }
    } else {
      setAuditLogs([]);
      setPreviewData(null);
      setPreviewError('');
      setAllocationResultData(null);
      setResultError('');
    }
  }, [selectedRow, role]);

  const parseCSV = (text) => {
    /*
     * TODO: Move parsing to a Web Worker.
     * TODO: Support streaming CSV parser.
     * TODO: Support server-side chunked import.
     * TODO: Support million-row imports.
     * TODO: Add resumable imports.
     */
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line) => {
      const result = [];
      let start = 0;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
          inQuotes = !inQuotes;
        } else if (line[i] === ',' && !inQuotes) {
          result.push(line.slice(start, i).replace(/^"|"$/g, '').trim());
          start = i + 1;
        }
      }
      result.push(line.slice(start).replace(/^"|"$/g, '').trim());
      return result;
    };

    const headers = parseLine(lines[0]).map(h => h.toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        if (header) {
          row[header] = values[index] !== undefined ? values[index] : '';
        }
      });
      rows.push(row);
    }
    return { headers, rows };
  };

  const mapHeaders = (headers) => {
    const mappings = {
      date: ['date', 'transaction_date', 'trans_date', 'value_date'],
      time: ['time', 'transaction_time'],
      amount: ['amount', 'paid_amount', 'credit', 'money_in', 'money in'],
      debit: ['debit', 'money_out', 'money out'],
      description: ['description', 'details', 'narration', 'transaction_details', 'transaction details'],
      reference: ['reference', 'transaction_code', 'transaction code', 'mpesa_code', 'receipt_no', 'receipt number'],
      payer: ['payer', 'payer_name', 'customer_name', 'name'],
      phone: ['phone', 'payer_phone', 'customer_phone', 'mobile', 'msisdn'],
      account: ['account', 'account_number', 'reference_account', 'bill_reference', 'paybill_account', 'customer_reference']
    };

    const resolved = {};
    Object.keys(mappings).forEach(field => {
      const match = headers.find(h => mappings[field].includes(h));
      resolved[field] = match || null;
    });
    return resolved;
  };

  const normalizePreviewRow = (rawRow, mappings, allCsvRows, index) => {
    const warnings = [];

    // Empty row check
    const isEmptyRow = Object.values(rawRow).every(val => !val || val.trim() === '');
    if (isEmptyRow) {
      warnings.push('empty rows');
    }

    // Date check
    let transaction_date = null;
    if (mappings.date && rawRow[mappings.date]) {
      transaction_date = rawRow[mappings.date];
    } else if (!isEmptyRow) {
      warnings.push('missing date');
    }

    // Time check
    const transaction_time = (mappings.time && rawRow[mappings.time]) ? rawRow[mappings.time] : null;

    // Amount check
    let amountStr = mappings.amount ? rawRow[mappings.amount] : '';
    let debitStr = mappings.debit ? rawRow[mappings.debit] : '';

    let amount = NaN;
    let debit = 0;
    let direction = 'credit';

    if (amountStr) {
      amount = parseFloat(amountStr.replace(/,/g, ''));
    }
    if (debitStr) {
      debit = parseFloat(debitStr.replace(/,/g, '')) || 0;
    }

    if (isNaN(amount) && debit > 0) {
      amount = debit;
      direction = 'debit';
    } else if (!isNaN(amount) && debit > 0) {
      direction = 'credit';
      warnings.push('ambiguous direction');
    } else if (!isNaN(amount)) {
      direction = 'credit';
    }

    if (isNaN(amount) && !isEmptyRow) {
      warnings.push('missing amount');
    } else if (!isNaN(amount) && amount <= 0) {
      warnings.push('invalid amount');
    }

    // If amount exists without debit/credit column mappings explicitly, we treat as credit but add warning: "Direction inferred from amount column."
    if (!mappings.debit && !isNaN(amount) && !isEmptyRow) {
      warnings.push('Direction inferred from amount column.');
    }

    // Ref / Code check
    const transaction_code = (mappings.reference && rawRow[mappings.reference]) ? rawRow[mappings.reference] : null;
    const reference_account = (mappings.account && rawRow[mappings.account]) ? rawRow[mappings.account] : null;

    if (!transaction_code && !reference_account && !isEmptyRow) {
      warnings.push('missing transaction code AND missing reference account');
    }

    // Duplicate transaction code in CSV
    if (transaction_code) {
      const isDuplicateCode = allCsvRows.some((r, i) => i !== index && r[mappings.reference] === transaction_code);
      if (isDuplicateCode) {
        warnings.push('duplicate transaction codes');
      }
    }

    // Duplicate rows check
    if (!isEmptyRow) {
      const rowStr = JSON.stringify(rawRow);
      const isDuplicateRow = allCsvRows.some((r, i) => i !== index && JSON.stringify(r) === rowStr);
      if (isDuplicateRow) {
        warnings.push('duplicate rows');
      }
    }

    // Unsupported columns check
    const unsupportedKeys = Object.keys(rawRow).filter(k => !Object.values(mappings).includes(k) && rawRow[k] && rawRow[k].trim() !== '');
    if (unsupportedKeys.length > 0) {
      warnings.push('unsupported columns');
    }

    // Invalid UTF-8 check
    const hasInvalidUtf8 = Object.values(rawRow).some(val =>
      val && (val.includes('\uFFFD') || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(val))
    );
    if (hasInvalidUtf8) {
      warnings.push('invalid UTF-8 characters');
    }

    // Extremely long text check
    const hasExtremelyLongText = Object.values(rawRow).some(val => val && val.length > 1000);
    if (hasExtremelyLongText) {
      warnings.push('extremely long text');
    }

    // Debit/outgoing row warning on landlord statement
    if (direction === 'debit' && !isEmptyRow) {
      warnings.push('debit rows on landlord statements');
    }

    const payer_name = (mappings.payer && rawRow[mappings.payer]) ? rawRow[mappings.payer] : null;
    const payer_phone = (mappings.phone && rawRow[mappings.phone]) ? rawRow[mappings.phone] : null;
    const description = (mappings.description && rawRow[mappings.description]) ? rawRow[mappings.description] : '';

    return {
      transaction_date,
      transaction_time,
      amount: isNaN(amount) ? 0 : amount,
      direction,
      transaction_code,
      payer_name,
      payer_phone,
      reference_account,
      description,
      collection_channel: 'unknown',
      document_source: 'CSV',
      source_provider: 'unknown',
      source_perspective: 'landlord',
      evidence_strength: transaction_code ? 'high' : 'unknown',
      confidence: 0,
      status: 'preview_only',
      warnings,
      raw_fields: rawRow
    };
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setWizardError('');
    setImportFile(null);
    setParsedPreviewRows([]);

    if (!file.name.endsWith('.csv')) {
      setWizardError('Only .csv files are supported in this phase.');
      return;
    }

    if (file.size > 1024 * 1024) {
      setWizardError(`This CSV is too large for browser preview.
Maximum supported preview:
• 1 MB
• 2,000 rows
Please split the file into smaller batches or wait for the upcoming server-side import engine.`);
      return;
    }

    setImportFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;

      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length > 2001) {
        setWizardError(`This CSV is too large for browser preview.
Maximum supported preview:
• 1 MB
• 2,000 rows
Please split the file into smaller batches or wait for the upcoming server-side import engine.`);
        setImportFile(null);
        return;
      }

      try {
        const parsed = parseCSV(text);
        const headers = parsed.headers;
        const rawRows = parsed.rows;

        const mappings = mapHeaders(headers);
        const previewRows = rawRows.map((row, index) =>
          normalizePreviewRow(row, mappings, rawRows, index)
        );

        setParsedPreviewRows(previewRows);
      } catch (err) {
        console.error(err);
        setWizardError('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  };

  const getPreviewSummary = () => {
    const summary = {
      total: parsedPreviewRows.length,
      valid: 0,
      warnings: 0,
      duplicates: 0,
      duplicateRows: 0,
      missingDates: 0,
      missingAmounts: 0,
      debits: 0,
      unsupported: 0,
      skipped: 0
    };

    parsedPreviewRows.forEach(r => {
      if (r.warnings.length > 0) {
        summary.warnings++;
      } else {
        summary.valid++;
      }

      if (r.warnings.some(w => w.includes('duplicate transaction codes'))) {
        summary.duplicates++;
      }
      if (r.warnings.some(w => w.includes('duplicate rows'))) {
        summary.duplicateRows++;
      }
      if (r.warnings.some(w => w.includes('missing date'))) {
        summary.missingDates++;
      }
      if (r.warnings.some(w => w.includes('missing amount'))) {
        summary.missingAmounts++;
      }
      if (r.direction === 'debit' || r.warnings.some(w => w.includes('debit rows'))) {
        summary.debits++;
      }
      if (r.warnings.some(w => w.includes('unsupported columns'))) {
        summary.unsupported++;
      }
      if (r.warnings.some(w => w.includes('empty rows'))) {
        summary.skipped++;
      }
    });

    return summary;
  };

  const [importing, setImporting] = useState(false);

  const isImportEnabled =
    importSource === 'csv' &&
    parsedPreviewRows.length > 0 &&
    parsedPreviewRows.some(row => row.amount > 0 && row.transaction_date && (!row.warnings || !row.warnings.includes('empty rows'))) &&
    !wizardError;

  const handleImportCSV = () => {
    const system = getBrandedConfirmAndNotify();
    if (!system) {
      setError("Notification system is unavailable. Please refresh and try again.");
      return;
    }
    const { showConfirm, notifySuccess, notifyError } = system;

    showConfirm(
      "Import CSV Records",
      "Import preview rows into Review Queue? No reconciliation or payment allocation will happen.",
      async () => {
        setImporting(true);
        try {
          const response = await fetch('/api/payment-evidence/import-csv-preview', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              source_provider: importProvider || 'unknown',
              source_perspective: 'landlord',
              document_source: 'CSV',
              collection_channel: 'unknown',
              original_filename: importFile ? importFile.name : 'uploaded_statement.csv',
              preview_rows: parsedPreviewRows
            })
          });

          const data = await response.json();
          if (response.ok && data.success) {
            if (data.imported_count === 0 && data.needs_review_count === 0) {
              notifyWarning(
                'Import Results',
                `No new rows were imported. (Skipped ${data.duplicate_count} duplicate rows, ${data.failed_validation_count} failed validation).`
              );
            } else {
              notifySuccess(
                'Import Successful',
                `Successfully imported CSV batch!\n- Imported: ${data.imported_count} rows\n- Needs Review: ${data.needs_review_count} rows\n- Ignored: ${data.ignored_count} rows\n- Duplicates Skipped: ${data.duplicate_count} rows\n- Failed Validation: ${data.failed_validation_count} rows`
              );
            }
            setShowImportWizard(false);
            setImportFile(null);
            setParsedPreviewRows([]);
            setWizardError('');
            await fetchBatches();
            await fetchEvidenceRows();
          } else {
            notifyError('Import Failed', data.message || 'Unknown error');
          }
        } catch (err) {
          console.error(err);
          notifyError('Error', 'An error occurred during import.');
        } finally {
          setImporting(false);
        }
      }
    );
  };

  const fetchBatches = async () => {
    try {
      const res = await fetch('/api/payment-evidence/batches');
      if (res.ok) {
        setBatches(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch batches', e);
    }
  };

  const fetchEvidenceRows = async () => {
    setLoading(true);
    setError('');
    try {
      const queryParams = new URLSearchParams();
      if (status) queryParams.append('status', status);
      if (strength) queryParams.append('evidence_strength', strength);
      if (channel) queryParams.append('collection_channel', channel);
      if (startDate) queryParams.append('start_date', startDate);
      if (endDate) queryParams.append('end_date', endDate);
      if (minAmount) queryParams.append('min_amount', minAmount);
      if (maxAmount) queryParams.append('max_amount', maxAmount);
      if (selectedBatchId) queryParams.append('batch_id', selectedBatchId);
      if (reviewStatusFilter) queryParams.append('review_status', reviewStatusFilter);
      if (reviewDecisionFilter) queryParams.append('review_decision', reviewDecisionFilter);
      if (suggestionFilter) queryParams.append('has_suggestions', suggestionFilter);
      if (matchConfidenceFilter) queryParams.append('match_confidence', matchConfidenceFilter);
      if (auditHistoryFilter) queryParams.append('has_audit_history', auditHistoryFilter);
      if (reviewedFrom) queryParams.append('reviewed_from', reviewedFrom);
      if (reviewedTo) queryParams.append('reviewed_to', reviewedTo);
      if (importedFrom) queryParams.append('imported_from', importedFrom);
      if (importedTo) queryParams.append('imported_to', importedTo);
      if (search) queryParams.append('search', search);

      const res = await fetch(`/api/payment-evidence/rows?${queryParams.toString()}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || errData.error || 'Failed to fetch rows');
      }
      setEvidenceRows(await res.json());
    } catch (e) {
      console.error(e);
      setError('Could not load payment evidence list.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveReviewDecision = async (decision, acceptedTenantId = null, acceptedInvoiceId = null) => {
    if (!selectedRow) return;

    const system = getBrandedConfirmAndNotify();
    if (!system) {
      setError("Notification system is unavailable. Please refresh and try again.");
      return;
    }
    const { showConfirm, notifySuccess, notifyError } = system;

    const notes = reviewNotesText.trim();
    const reason = rejectedReasonText.trim();

    if (notes.length > 1000) {
      notifyError('Validation Error', 'Review notes must not exceed 1000 characters.');
      return;
    }
    if (reason.length > 500) {
      notifyError('Validation Error', 'Rejected/irrelevant reason must not exceed 500 characters.');
      return;
    }

    const payload = {
      decision,
      review_notes: notes || null,
      rejected_reason: (decision === 'rejected_suggestion' || decision === 'marked_irrelevant') ? (reason || null) : null,
      accepted_tenant_id: acceptedTenantId,
      accepted_invoice_id: acceptedInvoiceId
    };

    let confirmMsg = 'Save this review decision? This will not reconcile, allocate, or apply the payment.';
    if (decision === 'accepted_suggestion') {
      confirmMsg = 'Save this accepted suggestion? This will not reconcile, allocate, or apply the payment.';
    } else if (decision === 'rejected_suggestion') {
      confirmMsg = 'Save this rejection decision? This will not reconcile, allocate, or apply the payment.';
    } else if (decision === 'needs_more_evidence') {
      confirmMsg = 'Save this needs more evidence decision? This will not reconcile, allocate, or apply the payment.';
    } else if (decision === 'marked_irrelevant') {
      confirmMsg = 'Mark this evidence row irrelevant? This will not reconcile, allocate, or apply the payment.';
    }

    showConfirm(
      "Save Review Decision",
      confirmMsg,
      async () => {
        setSavingReview(true);
        try {
          const res = await fetch(`/api/payment-evidence/${selectedRow.id}/review-decision`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || data.error || 'Failed to save review decision');
          }

          notifySuccess('Decision Saved', data.message || 'Review decision updated.');
          setSelectedRow(data.row);
          fetchAuditLogs(data.row.id);
          fetchAllocationPreview(data.row.id);
          await fetchEvidenceRows();
        } catch (err) {
          console.error(err);
          notifyError('Error', err.message || 'Failed to save review decision.');
        } finally {
          setSavingReview(false);
        }
      }
    );
  };

  const handleConfirmAllocation = async () => {
    if (!selectedRow || !previewData?.confirmation_contract?.can_confirm_allocation) return;

    if (typedConfirmationText !== 'CONFIRM ALLOCATION PREVIEW') {
      const { notifyError } = getBrandedConfirmAndNotify();
      notifyError('Validation Error', 'Please type the confirmation text exactly.');
      return;
    }

    const { showConfirm, notifySuccess, notifyError } = getBrandedConfirmAndNotify();

    showConfirm(
      "Confirm Allocation Execution",
      "Are you sure you want to execute this payment allocation? This will decrease the invoice balance and cannot be undone.",
      async () => {
        setConfirmingAllocation(true);
        try {
          const res = await fetch(`/api/payment-evidence/${selectedRow.id}/confirm-allocation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              confirmation_text: typedConfirmationText
            })
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || data.error || 'Failed to execute allocation');
          }

          notifySuccess('Allocation Executed', data.message || 'Payment evidence allocated successfully.');
          setTypedConfirmationText('');

          setSelectedRow(prev => prev ? { ...prev, status: 'manually_reconciled' } : null);
          fetchAuditLogs(selectedRow.id);
          fetchAllocationPreview(selectedRow.id);
          await fetchEvidenceRows();
        } catch (err) {
          console.error(err);
          notifyError('Error', err.message || 'Failed to execute allocation.');
        } finally {
          setConfirmingAllocation(false);
        }
      }
    );
  };

  // Helper to format currency
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: organization?.billing_currency || 'KES',
      maximumFractionDigits: 0
    }).format(val || 0);
  };

  // Helper to resolve Badge Styles for Status
  const getStatusBadgeClass = (statusStr) => {
    switch (statusStr) {
      case 'auto_reconciled':
        return 'badge-success';
      case 'needs_review':
        return 'badge-warning';
      case 'candidate_found':
        return 'badge-info';
      case 'duplicate':
        return 'badge-danger';
      case 'ignored':
        return 'badge-secondary';
      case 'failed_validation':
        return 'badge-danger';
      default:
        return 'badge-secondary';
    }
  };

  // Helper to resolve Badge Styles for Strength
  const getStrengthBadgeClass = (strengthStr) => {
    switch (strengthStr) {
      case 'verified':
        return 'badge-success';
      case 'high':
        return 'badge-info';
      case 'medium':
        return 'badge-warning';
      case 'low':
        return 'badge-secondary';
      default:
        return 'badge-secondary';
    }
  };

  // Helper to resolve Badge Styles for Review Status
  const getReviewStatusBadgeClass = (status) => {
    switch (status) {
      case 'accepted_suggestion':
        return 'badge-success';
      case 'rejected_suggestion':
        return 'badge-danger';
      case 'needs_more_evidence':
        return 'badge-warning';
      case 'marked_irrelevant':
        return 'badge-secondary';
      default:
        return 'badge-secondary';
    }
  };

  const getReviewStatusLabel = (status) => {
    switch (status) {
      case 'accepted_suggestion':
        return 'Accepted Suggestion';
      case 'rejected_suggestion':
        return 'Rejected Suggestion';
      case 'needs_more_evidence':
        return 'Needs More Evidence';
      case 'marked_irrelevant':
        return 'Marked Irrelevant';
      default:
        return 'Not Reviewed';
    }
  };

  // Stats Counters (Calculated from all pre-filtered rows if loaded, or filter metrics)
  const getStats = () => {
    const stats = {
      needsReview: 0,
      candidateFound: 0,
      duplicates: 0,
      ignored: 0,
      autoReconciled: 0,
      total: evidenceRows.length
    };

    evidenceRows.forEach(r => {
      if (r.status === 'needs_review') stats.needsReview++;
      else if (r.status === 'candidate_found') stats.candidateFound++;
      else if (r.status === 'duplicate') stats.duplicates++;
      else if (r.status === 'ignored') stats.ignored++;
      else if (r.status === 'auto_reconciled') stats.autoReconciled++;
    });

    return stats;
  };

  const stats = getStats();

  return (
    <div className="payment-evidence-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '20px' }}>

      {/* HEADER SECTION */}
      <div className="flex-row justify-between align-center">
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>Review Queue</h2>
          <p className="text-muted" style={{ fontSize: '12px', margin: '4px 0 0 0' }}>
            Inspect, classify, and match imported payment evidence records.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setShowImportWizard(true);
            setWizardStep(1);
            setImportSource('');
            setImportFile(null);
            setImportProvider('');
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Layers size={14} />
          Import Payment Evidence
        </button>
      </div>

      {/* SUMMARY METRICS CARDS */}
      <div className="grid-cards" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '16px'
      }}>
        {/* Needs Review */}
        <div className="card metric-card" style={{ borderLeft: '4px solid var(--warning)', padding: '16px' }}>
          <div className="text-muted" style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Needs Review</div>
          <div className="metric-val" style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: 'var(--warning)' }}>{stats.needsReview}</div>
        </div>

        {/* Candidate Found */}
        <div className="card metric-card" style={{ borderLeft: '4px solid var(--info)', padding: '16px' }}>
          <div className="text-muted" style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Candidate Found</div>
          <div className="metric-val" style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: 'var(--info)' }}>{stats.candidateFound}</div>
        </div>

        {/* Duplicates */}
        <div className="card metric-card" style={{ borderLeft: '4px solid var(--danger)', padding: '16px' }}>
          <div className="text-muted" style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Duplicates</div>
          <div className="metric-val" style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: 'var(--danger)' }}>{stats.duplicates}</div>
        </div>

        {/* Ignored */}
        <div className="card metric-card" style={{ borderLeft: '4px solid var(--text-secondary)', padding: '16px' }}>
          <div className="text-muted" style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Ignored</div>
          <div className="metric-val" style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px' }}>{stats.ignored}</div>
        </div>

        {/* Auto Reconciled */}
        <div className="card metric-card" style={{ borderLeft: '4px solid var(--success)', padding: '16px' }}>
          <div className="text-muted" style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Auto Reconciled</div>
          <div className="metric-val" style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: 'var(--success)' }}>{stats.autoReconciled}</div>
        </div>

        {/* Total Rows */}
        <div className="card metric-card" style={{ borderLeft: '4px solid var(--primary)', padding: '16px' }}>
          <div className="text-muted" style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Total Scored</div>
          <div className="metric-val" style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: 'var(--primary)' }}>{stats.total}</div>
        </div>
      </div>

      {/* FUTURE IMPORT BATCHES UX PLACEHOLDER CARD */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, var(--bg-surface), var(--primary-glow))',
        padding: '16px',
        borderLeft: '4px solid var(--primary)',
        animation: 'fadeIn 0.2s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Layers size={18} style={{ color: 'var(--primary)' }} />
          <h4 style={{ margin: 0, fontWeight: '700', fontSize: '14px' }}>Future Import Batches</h4>
        </div>
        <p style={{ fontSize: '12px', margin: 0, color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          Imported payment files will be grouped into batches. Each batch will show the upload date, provider, imported rows, duplicates, ignored rows, needs review, and reconciled rows. Clicking a batch will open its imported payment evidence.
        </p>
      </div>

      {/* FILTER PANEL */}
      <div className="card filter-panel" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {/* Search bar */}
          <div style={{ flex: '1 1 240px', position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by code, account, phone, payer name..."
              className="form-control"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: '32px' }}
            />
          </div>

          {/* Status filter */}
          <div style={{ flex: '1 1 140px' }}>
            <select className="form-control" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="imported">Imported</option>
              <option value="needs_review">Needs Review</option>
              <option value="candidate_found">Candidate Found</option>
              <option value="duplicate">Duplicate</option>
              <option value="ignored">Ignored</option>
              <option value="auto_reconciled">Auto Reconciled</option>
              <option value="failed_validation">Failed Validation</option>
            </select>
          </div>

          {/* Strength filter */}
          <div style={{ flex: '1 1 140px' }}>
            <select className="form-control" value={strength} onChange={e => setStrength(e.target.value)}>
              <option value="">All Strengths</option>
              <option value="verified">Verified</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>

          {/* Channel filter */}
          <div style={{ flex: '1 1 140px' }}>
            <select className="form-control" value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="">All Channels</option>
              <option value="MPESA_PAYBILL">M-Pesa PayBill</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="MPESA_TILL">M-Pesa Till</option>
              <option value="BANK_DEPOSIT">Bank Deposit</option>
              <option value="CASH">Cash</option>
            </select>
          </div>

          {/* Batch filter */}
          <div style={{ flex: '1 1 180px' }}>
            <select className="form-control" value={selectedBatchId} onChange={e => setSelectedBatchId(e.target.value)}>
              <option value="">All Import Batches</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>
                  Batch #{b.id} ({b.upload_filename || 'unknown'})
                </option>
              ))}
            </select>
          </div>

          {/* Review status filter */}
          <div style={{ flex: '1 1 180px' }}>
            <select className="form-control" value={reviewStatusFilter} onChange={e => setReviewStatusFilter(e.target.value)}>
              <option value="">All Review States</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="accepted_suggestion">Accepted Suggestion</option>
              <option value="rejected_suggestion">Rejected Suggestion</option>
              <option value="needs_more_evidence">Needs More Evidence</option>
              <option value="marked_irrelevant">Marked Irrelevant</option>
            </select>
          </div>

          {/* Suggestions filter */}
          <div style={{ flex: '1 1 170px' }}>
            <select className="form-control" value={suggestionFilter} onChange={e => setSuggestionFilter(e.target.value)}>
              <option value="">All Suggestion States</option>
              <option value="true">Has Suggestions</option>
              <option value="false">No Suggestions</option>
            </select>
          </div>

          {/* Match confidence filter */}
          <div style={{ flex: '1 1 170px' }}>
            <select className="form-control" value={matchConfidenceFilter} onChange={e => setMatchConfidenceFilter(e.target.value)}>
              <option value="">All Match Confidence</option>
              <option value="high">High Confidence</option>
              <option value="medium">Medium Confidence</option>
              <option value="low">Low Confidence</option>
            </select>
          </div>

          {/* Audit history filter */}
          <div style={{ flex: '1 1 160px' }}>
            <select className="form-control" value={auditHistoryFilter} onChange={e => setAuditHistoryFilter(e.target.value)}>
              <option value="">All Audit States</option>
              <option value="true">Has Audit Trail</option>
              <option value="false">No Audit Trail</option>
            </select>
          </div>
        </div>

        {/* Extended filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          {/* Start Date */}
          <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>From:</span>
            <input type="date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          {/* End Date */}
          <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>To:</span>
            <input type="date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>

          {/* Min Amount */}
          <div style={{ flex: '1 1 120px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Min KES:</span>
            <input type="number" className="form-control" placeholder="0" value={minAmount} onChange={e => setMinAmount(e.target.value)} />
          </div>

          {/* Max Amount */}
          <div style={{ flex: '1 1 120px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Max KES:</span>
            <input type="number" className="form-control" placeholder="100k" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} />
          </div>

          {/* Imported From */}
          <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Imported From:</span>
            <input type="date" className="form-control" value={importedFrom} onChange={e => setImportedFrom(e.target.value)} />
          </div>

          {/* Imported To */}
          <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Imported To:</span>
            <input type="date" className="form-control" value={importedTo} onChange={e => setImportedTo(e.target.value)} />
          </div>

          {/* Reviewed From */}
          <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Reviewed From:</span>
            <input type="date" className="form-control" value={reviewedFrom} onChange={e => setReviewedFrom(e.target.value)} />
          </div>

          {/* Reviewed To */}
          <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>Reviewed To:</span>
            <input type="date" className="form-control" value={reviewedTo} onChange={e => setReviewedTo(e.target.value)} />
          </div>

          {/* Clear Filters Button */}
          {(status || strength || channel || startDate || endDate || minAmount || maxAmount || selectedBatchId || reviewStatusFilter || reviewDecisionFilter || suggestionFilter || matchConfidenceFilter || auditHistoryFilter || reviewedFrom || reviewedTo || importedFrom || importedTo || search) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStatus('');
                setStrength('');
                setChannel('');
                setStartDate('');
                setEndDate('');
                setMinAmount('');
                setMaxAmount('');
                setSelectedBatchId('');
                setReviewStatusFilter('');
                setReviewDecisionFilter('');
                setSuggestionFilter('');
                setMatchConfidenceFilter('');
                setAuditHistoryFilter('');
                setReviewedFrom('');
                setReviewedTo('');
                setImportedFrom('');
                setImportedTo('');
                setSearch('');
              }}
              style={{ padding: '6px 12px', fontSize: '11px', marginLeft: 'auto' }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* ERROR DISPLAY */}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* SAFETY WARNING NOTICE */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: 'var(--info-glow)',
        border: '1px solid var(--info)',
        borderRadius: '8px',
        fontSize: '11.5px',
        color: 'var(--text-primary)',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <Info size={14} style={{ color: 'var(--info)', flexShrink: 0 }} />
        <span><strong>Notice:</strong> These are matching suggestions only. No payment has been reconciled, allocated, or applied to an invoice.</span>
      </div>

      {/* TABLE OR EMPTY STATE */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div className="sl-spinner" style={{ margin: '0 auto 12px auto' }} />
            Loading scored evidence list...
          </div>
        ) : evidenceRows.length === 0 ? (
          <div className="sl-empty-state" style={{ padding: '48px 24px' }}>
            <div className="sl-empty-state-orb" style={{ marginBottom: '16px', background: 'var(--primary-glow)' }}>
              <Coins size={32} style={{ color: 'var(--primary)' }} />
            </div>
            <h3 className="sl-empty-state-title" style={{ fontSize: '16px', fontWeight: '800' }}>Queue Empty</h3>
            <p className="sl-empty-state-desc" style={{ maxWidth: '500px', margin: '8px auto 0 auto', fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
              No payment evidence has been imported yet. The system will support importing payment evidence from **CSV**, **PDF bank statements**, **PDF receipts**, **M-Pesa statements**, **Excel files**, **bank exports**, and **OCR (future)**. Once imported, your payments will appear here in the Review Queue for validation before final reconciliation.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', backgroundColor: 'var(--bg-surface-elevated)' }}>
                  <th style={{ padding: '12px' }}>Date</th>
                  <th style={{ padding: '12px' }}>Code</th>
                  <th style={{ padding: '12px' }}>Payer</th>
                  <th style={{ padding: '12px' }}>Account</th>
                  <th style={{ padding: '12px' }}>Channel</th>
                  <th style={{ padding: '12px' }}>Suggested Match</th>
                  <th style={{ padding: '12px' }}>Strength</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Review</th>
                  <th style={{ padding: '12px' }}>Audit</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {evidenceRows.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background-color 0.15s' }} className="table-row-hover">
                    <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                      {new Date(row.transaction_date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {row.transaction_code || 'N/A'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: '600' }}>{row.payer_name || 'N/A'}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{row.payer_phone || ''}</div>
                    </td>
                    <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                      {row.reference_account || 'N/A'}
                    </td>
                    <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                        {row.collection_channel.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {row.status === 'ignored' ? (
                        <span style={{ color: 'var(--text-muted)' }}>N/A (Ignored)</span>
                      ) : row.suggestions && row.suggestions.length > 0 ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            <span style={{
                              fontSize: '9px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: '700',
                              textTransform: 'uppercase',
                              backgroundColor: row.suggestions[0].match_confidence === 'high' ? 'rgba(76, 175, 80, 0.15)' : row.suggestions[0].match_confidence === 'medium' ? 'rgba(255, 152, 0, 0.15)' : 'rgba(33, 150, 243, 0.15)',
                              color: row.suggestions[0].match_confidence === 'high' ? 'var(--success)' : row.suggestions[0].match_confidence === 'medium' ? 'var(--warning)' : 'var(--info)',
                              border: row.suggestions[0].match_confidence === 'high' ? '1px solid var(--success)' : row.suggestions[0].match_confidence === 'medium' ? '1px solid var(--warning)' : '1px solid var(--info)'
                            }}>
                              {row.suggestions[0].match_confidence} Confidence
                            </span>
                            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                              Score: {row.suggestions[0].match_score}
                            </span>
                          </div>
                          <div style={{ fontWeight: '600' }}>{row.suggestions[0].tenant_name}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            Unit: {row.suggestions[0].unit_label}
                          </div>
                          {row.suggestions[0].invoice_number && (
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              Invoice: {row.suggestions[0].invoice_number} ({formatCurrency(row.suggestions[0].invoice_balance)})
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: '700',
                            textTransform: 'uppercase',
                            backgroundColor: 'rgba(158, 158, 158, 0.15)',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border)',
                            display: 'inline-block',
                            marginBottom: '4px'
                          }}>
                            No suggestion
                          </span>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>No safe match suggestion found.</div>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span className={`badge ${getStrengthBadgeClass(row.evidence_strength)}`} style={{ textTransform: 'capitalize', fontSize: '9px' }}>
                        {row.evidence_strength}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span className={`badge ${getStatusBadgeClass(row.status)}`} style={{ textTransform: 'capitalize', fontSize: '9px' }}>
                        {row.status.replace('_', ' ')}
                      </span>
                      {row.status === 'ignored' && row.ignored_reason && (
                        <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }} title={row.ignored_reason}>
                          {row.ignored_reason.length > 20 ? row.ignored_reason.slice(0, 20) + '...' : row.ignored_reason}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span className={`badge ${getReviewStatusBadgeClass(row.review_status)}`} style={{ textTransform: 'capitalize', fontSize: '9px' }}>
                        {getReviewStatusLabel(row.review_status)}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span className={'badge ' + (row.has_audit_history ? 'badge-info' : 'badge-secondary')} style={{ fontSize: '9px' }}>
                        {row.audit_count || 0} audit
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800', color: 'var(--success)' }}>
                      {formatCurrency(row.amount)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedRow(row)}
                        style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Eye size={12} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DETAIL MODAL / DRAWER */}
      {selectedRow && (
        <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 }}>
          <div className="modal-content" style={{ maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', position: 'relative' }}>

            {/* Close button */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedRow(null)}
              style={{ position: 'absolute', right: '16px', top: '16px', borderRadius: '50%', width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={14} />
            </button>

            <h3 className="card-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', fontSize: '16px', fontWeight: '800' }}>
              Payment Evidence Details
            </h3>

            {/* Safety & Reconciliation Disclaimer Banner */}
            <div style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(255, 152, 0, 0.05)',
              border: '1px solid var(--warning)',
              borderRadius: '8px',
              fontSize: '11.5px',
              color: 'var(--text-primary)',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ fontWeight: '700', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldAlert size={14} />
                Safety Disclaimer
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Review decisions are audit notes only. No invoice is marked paid from this screen, and no payment is allocated from this screen.
              </p>
            </div>

            {/* Evidence Facts Panel */}
            {(() => {
              const assocBatch = batches.find(b => Number(b.id) === Number(selectedRow.batch_id));
              const batchFileName = assocBatch ? assocBatch.upload_filename : 'N/A';
              return (
                <>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '700' }}>Evidence Facts</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', backgroundColor: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '8px', fontSize: '12px', marginBottom: '16px' }}>
                    <div>
                      <span className="text-muted">Transaction Date:</span> <strong>{new Date(selectedRow.transaction_date).toLocaleDateString()}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Amount:</span> <strong style={{ color: 'var(--success)' }}>{formatCurrency(selectedRow.amount)}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Transaction Code:</span> <strong>{selectedRow.transaction_code || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Reference Account:</span> <strong>{selectedRow.reference_account || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Payer Name:</span> <strong>{selectedRow.payer_name || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Payer Phone:</span> <strong>{selectedRow.payer_phone || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Collection Channel:</span> <span style={{ textTransform: 'capitalize' }}>{selectedRow.collection_channel.replace('_', ' ').toLowerCase()}</span>
                    </div>
                    <div>
                      <span className="text-muted">Evidence Status:</span> <span className={`badge ${getStatusBadgeClass(selectedRow.status)}`} style={{ fontSize: '9px', textTransform: 'capitalize' }}>{selectedRow.status.replace('_', ' ')}</span>
                    </div>
                    <div>
                      <span className="text-muted">Evidence Strength:</span> <span className={`badge ${getStrengthBadgeClass(selectedRow.evidence_strength)}`} style={{ fontSize: '9px', textTransform: 'capitalize' }}>{selectedRow.evidence_strength}</span>
                    </div>
                    <div>
                      <span className="text-muted">Import Batch Filename:</span> <strong>{batchFileName}</strong>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Review Decision Audit Trail */}
            <div style={{ marginBottom: '16px', border: '1px dashed var(--border)', padding: '12px', borderRadius: '8px' }}>
              <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '700' }}>Review Status & Decision Trail</h4>
              <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div>
                  <span className="text-muted">Review Decision State:</span>{' '}
                  <span className={`badge ${getReviewStatusBadgeClass(selectedRow.review_status)}`} style={{ textTransform: 'capitalize', fontSize: '10px' }}>
                    {getReviewStatusLabel(selectedRow.review_status)}
                  </span>
                </div>
                {selectedRow.reviewed_by && (
                  <>
                    <div>
                      <span className="text-muted">Reviewed By:</span> <strong>{selectedRow.reviewer_name || `User ID: ${selectedRow.reviewed_by}`}</strong>
                    </div>
                    <div>
                      <span className="text-muted">Reviewed At:</span> <strong>{new Date(selectedRow.reviewed_at).toLocaleString()}</strong>
                    </div>
                  </>
                )}
                {selectedRow.accepted_tenant && (
                  <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '3px solid var(--success)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div>Accepted Tenant: <strong>{selectedRow.accepted_tenant.full_name}</strong> (Acc: {selectedRow.accepted_tenant.tenant_account_number})</div>
                    {selectedRow.accepted_invoice && (
                      <div>Accepted Invoice: <strong>{selectedRow.accepted_invoice.invoice_number}</strong> (Outstanding: {formatCurrency(selectedRow.accepted_invoice.balance)})</div>
                    )}
                  </div>
                )}
                {selectedRow.rejected_reason && (
                  <div>
                    <span className="text-muted">Rejection/Irrelevant Reason:</span> <strong style={{ color: 'var(--danger)' }}>{selectedRow.rejected_reason}</strong>
                  </div>
                )}
                {selectedRow.review_notes && (
                  <div style={{ marginTop: '4px', backgroundColor: 'var(--bg-surface-elevated)', padding: '8px', borderRadius: '4px', fontStyle: 'italic' }}>
                    <span className="text-muted" style={{ display: 'block', fontSize: '10px', fontStyle: 'normal', marginBottom: '2px' }}>Review Notes:</span>
                    "{selectedRow.review_notes}"
                  </div>
                )}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                Manual review decisions are audit notes only. They do not reconcile, allocate, or apply payments.
              </div>
            </div>

            {/* Draft Allocation Preview Section */}
            {(role === 'landlord' || role === 'super_admin') && (selectedRow?.status !== 'manually_reconciled' && selectedRow?.status !== 'auto_reconciled' && !allocationResultData?.allocation_result?.allocated) && (
              <div style={{ marginBottom: '16px', border: '1px solid var(--border)', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-primary)', margin: 0, fontWeight: '700' }}>Draft Allocation Preview</h4>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => selectedRow && fetchAllocationPreview(selectedRow.id)}
                    disabled={loadingPreview}
                    style={{ padding: '2px 8px', fontSize: '10px', height: 'auto', marginLeft: 'auto' }}
                  >
                    Refresh Preview
                  </button>
                </div>

                {loadingPreview ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading readiness preview...</div>
                ) : previewError ? (
                  <div style={{ fontSize: '11px', color: 'var(--danger)' }}>{previewError}</div>
                ) : previewData ? (
                  <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="text-muted">Readiness State:</span>
                      <span className={`badge ${previewData.ready ? 'badge-success' : 'badge-secondary'}`} style={{ textTransform: 'capitalize', fontSize: '9px' }}>
                        {previewData.state.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div>
                      <span className="text-muted">Message:</span> <strong>{previewData.message}</strong>
                    </div>

                    {previewData.ready ? (
                      <div style={{ marginTop: '6px', borderTop: '1px solid var(--border)', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                          <div>
                            <span className="text-muted">Tenant:</span> <strong>{previewData.accepted_tenant_name}</strong>
                          </div>
                          <div>
                            <span className="text-muted">Invoice:</span> <strong>{previewData.accepted_invoice_number}</strong> ({previewData.invoice_status})
                          </div>
                          <div>
                            <span className="text-muted">Invoice Balance:</span> <strong>{formatCurrency(previewData.invoice_balance)}</strong>
                          </div>
                          <div>
                            <span className="text-muted">Evidence Amount:</span> <strong>{formatCurrency(previewData.amount)}</strong>
                          </div>
                        </div>
                        <div style={{ marginTop: '4px', padding: '6px 8px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                          <div>
                            <span className="text-muted" style={{ display: 'block', fontSize: '9px' }}>Allocation Preview:</span>
                            <strong style={{ color: 'var(--success)' }}>{formatCurrency(previewData.allocation_amount_preview)}</strong>
                          </div>
                          <div>
                            <span className="text-muted" style={{ display: 'block', fontSize: '9px' }}>Remaining Balance:</span>
                            <strong>{formatCurrency(previewData.remaining_balance_preview)}</strong>
                          </div>
                          <div>
                            <span className="text-muted" style={{ display: 'block', fontSize: '9px' }}>Overpayment Preview:</span>
                            <strong style={{ color: previewData.overpayment_preview > 0 ? 'var(--warning)' : 'inherit' }}>{formatCurrency(previewData.overpayment_preview)}</strong>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '4px' }}>
                        Not ready for allocation. Please review the evidence row and accept a match suggestion to generate draft allocation numbers.
                      </div>
                    )}

                    {/* Confirmation Contract Sub-Section */}
                    {previewData.confirmation_contract && (
                      <div style={{ marginTop: '10px', borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
                        <strong style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Confirmation Requirements</strong>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <span className="text-muted">Can Confirm Allocation:</span>
                          <strong style={{ color: previewData.confirmation_contract.can_confirm_allocation ? 'var(--success)' : 'var(--danger)' }}>
                            {previewData.confirmation_contract.can_confirm_allocation ? 'YES' : 'NO'}
                          </strong>
                        </div>

                        <div style={{ marginBottom: '4px' }}>
                          <span className="text-muted">Required Confirmation Text:</span>{' '}
                          <code style={{ padding: '2px 4px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '3px', color: 'var(--primary)' }}>
                            {previewData.confirmation_contract.required_confirmation_text}
                          </code>
                        </div>

                        {previewData.confirmation_contract.blocking_reasons && previewData.confirmation_contract.blocking_reasons.length > 0 && (
                          <div style={{ marginTop: '4px', padding: '6px 8px', backgroundColor: 'rgba(244, 67, 54, 0.05)', border: '1px solid var(--danger)', borderRadius: '4px' }}>
                            <span style={{ fontWeight: '700', color: 'var(--danger)', display: 'block', marginBottom: '2px', fontSize: '9.5px' }}>Blocking Reasons:</span>
                            <ul style={{ margin: 0, paddingLeft: '14px', fontSize: '9.5px', color: 'var(--text-primary)' }}>
                              {previewData.confirmation_contract.blocking_reasons.map((reason, rIdx) => (
                                <li key={rIdx}>{reason}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div style={{
                          marginTop: '6px',
                          padding: '6px 8px',
                          backgroundColor: 'var(--bg-surface-elevated)',
                          borderRadius: '4px',
                          fontSize: '9px',
                          color: 'var(--text-muted)'
                        }}>
                          <strong>Contract Security Notice:</strong> {previewData.confirmation_contract.safety_message}
                        </div>

                        {previewData.confirmation_contract.can_confirm_allocation && (role === 'landlord' || role === 'super_admin') && (
                          <div style={{ marginTop: '10px', borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
                            <label style={{ display: 'block', fontSize: '10px', fontWeight: '700', marginBottom: '4px', color: 'var(--text-primary)' }}>
                              Type <strong>CONFIRM ALLOCATION PREVIEW</strong> to enable execution:
                            </label>
                            <input
                              type="text"
                              className="form-control"
                              value={typedConfirmationText}
                              onChange={(e) => setTypedConfirmationText(e.target.value)}
                              placeholder="CONFIRM ALLOCATION PREVIEW"
                              disabled={confirmingAllocation}
                              style={{ fontSize: '11px', padding: '6px', height: 'auto', marginBottom: '8px' }}
                            />
                            {typedConfirmationText === 'CONFIRM ALLOCATION PREVIEW' && (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm w-100"
                                onClick={handleConfirmAllocation}
                                disabled={confirmingAllocation}
                                style={{ fontSize: '11px', fontWeight: '700', padding: '8px' }}
                              >
                                {confirmingAllocation ? 'Confirming Allocation...' : 'Confirm Allocation'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{
                      marginTop: '6px',
                      padding: '8px',
                      backgroundColor: 'rgba(255, 152, 0, 0.05)',
                      border: '1px solid var(--warning)',
                      borderRadius: '4px',
                      fontSize: '9.5px',
                      color: 'var(--text-secondary)'
                    }}>
                      <strong>Preview Notice:</strong> {previewData.safety_message}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No readiness data loaded.</div>
                )}
              </div>
            )}

            {/* Allocation Result Section */}
            {(role === 'landlord' || role === 'super_admin') && (selectedRow?.status === 'manually_reconciled' || selectedRow?.status === 'auto_reconciled' || allocationResultData?.allocation_result?.allocated) && (
              <div style={{ marginBottom: '16px', border: '1px solid var(--border)', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-primary)', margin: 0, fontWeight: '700' }}>Allocation Result</h4>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => selectedRow && fetchAllocationResult(selectedRow.id)}
                    disabled={loadingResult}
                    style={{ padding: '2px 8px', fontSize: '10px', height: 'auto', marginLeft: 'auto' }}
                  >
                    Refresh Allocation Result
                  </button>
                </div>

                {loadingResult ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading allocation result...</div>
                ) : resultError ? (
                  <div style={{ fontSize: '11px', color: 'var(--danger)' }}>{resultError}</div>
                ) : allocationResultData?.allocation_result ? (
                  <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <div>
                        <span className="text-muted">Transaction ID:</span> <strong>{allocationResultData.allocation_result.transaction_id || 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-muted">Allocation ID:</span> <strong>{allocationResultData.allocation_result.payment_allocation_id || 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-muted">Tenant:</span> <strong>{allocationResultData.allocation_result.tenant_name || 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-muted">Invoice:</span> <strong>{allocationResultData.allocation_result.invoice_number || 'N/A'}</strong> ({allocationResultData.allocation_result.invoice_status})
                      </div>
                      <div>
                        <span className="text-muted">Allocation Amount:</span> <strong style={{ color: 'var(--success)' }}>{formatCurrency(allocationResultData.allocation_result.allocation_amount)}</strong>
                      </div>
                      <div>
                        <span className="text-muted">Invoice Balance After:</span> <strong>{formatCurrency(allocationResultData.allocation_result.invoice_balance_after)}</strong>
                      </div>
                      <div>
                        <span className="text-muted">Evidence Status:</span> <strong style={{ textTransform: 'capitalize' }}>{allocationResultData.allocation_result.payment_evidence_status.replace(/_/g, ' ')}</strong>
                      </div>
                      {allocationResultData.allocation_result.audit_reference && (
                        <div>
                          <span className="text-muted">Audit Reference:</span> <strong>{allocationResultData.allocation_result.audit_reference}</strong>
                        </div>
                      )}
                    </div>

                    {/* Reversal Readiness Subsection */}
                    {allocationResultData.reversal_readiness && (
                      <div style={{ marginTop: '6px', paddingTop: '6px' }}>
                        <strong style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Reversal Readiness</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <span className="text-muted">Can Request Reversal:</span>
                          <strong style={{ color: 'var(--danger)' }}>NO</strong>
                        </div>
                        <div style={{ marginBottom: '4px' }}>
                          <span className="text-muted">Future Confirmation Text:</span>{' '}
                          <code style={{ padding: '2px 4px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '3px', color: 'var(--primary)' }}>
                            {allocationResultData.reversal_readiness.required_future_confirmation_text || 'CONFIRM ALLOCATION REVERSAL'}
                          </code>
                        </div>
                        {allocationResultData.reversal_readiness.blocking_reasons && (
                          <div style={{ marginTop: '4px', padding: '6px 8px', backgroundColor: 'rgba(244, 67, 54, 0.05)', border: '1px solid var(--danger)', borderRadius: '4px' }}>
                            <span style={{ fontWeight: '700', color: 'var(--danger)', display: 'block', marginBottom: '2px', fontSize: '9.5px' }}>Blocking Reasons:</span>
                            <ul style={{ margin: 0, paddingLeft: '14px', fontSize: '9.5px', color: 'var(--text-primary)' }}>
                              {allocationResultData.reversal_readiness.blocking_reasons.map((reason, rIdx) => (
                                <li key={rIdx}>{reason}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div style={{ marginTop: '6px', padding: '6px 8px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', fontSize: '9px', color: 'var(--text-muted)' }}>
                          <strong>Safety Notice:</strong> {allocationResultData.reversal_readiness.safety_message}
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: '6px', padding: '6px 8px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', fontSize: '9px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {allocationResultData.safety_message}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No allocation result data available.</div>
                )}
              </div>
            )}

            {/* Review Decision History Section */}
            <div style={{ marginBottom: '16px', border: '1px solid var(--border)', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-surface)' }}>
              <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: '8px', fontWeight: '700' }}>Review Decision History</h4>

              {loadingAudit ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '4px 0' }}>Loading history...</div>
              ) : auditLogs.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>No audit history yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                  {auditLogs.map((log, index) => (
                    <div key={`${log.created_at}-${log.action}-${index}`} style={{ fontSize: '11px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontWeight: '700', textTransform: 'uppercase', color: log.action.includes('create') ? 'var(--primary)' : 'var(--warning)' }}>
                          {log.action.replace('_', ' ')}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        By <strong>{log.actor_name}</strong> ({log.actor_role})
                      </div>

                      {/* Status changes */}
                      {(log.previous_review_status !== log.new_review_status || log.previous_review_decision !== log.new_review_decision) && (
                        <div style={{ marginBottom: '2px' }}>
                          <span className="text-muted">Decision:</span>{' '}
                          <span style={{ textDecoration: 'line-through', color: 'var(--danger)' }}>{getReviewStatusLabel(log.previous_review_status) || 'None'}</span>
                          {' -> '}
                          <span style={{ color: 'var(--success)', fontWeight: '700' }}>{getReviewStatusLabel(log.new_review_status)}</span>
                        </div>
                      )}

                      {/* Tenant/Invoice references changes */}
                      {log.new_review_status === 'accepted_suggestion' && (log.previous_accepted_tenant_id !== log.new_accepted_tenant_id || log.previous_accepted_invoice_id !== log.new_accepted_invoice_id) && (
                        <div style={{ paddingLeft: '6px', borderLeft: '2px solid var(--success)', margin: '4px 0' }}>
                          <div>
                            Tenant ID: <span style={{ color: 'var(--text-muted)' }}>{log.previous_accepted_tenant_id || 'None'}</span>
                            {' -> '}
                            <strong>{log.new_accepted_tenant_id || 'None'}</strong>
                          </div>
                          <div>
                            Invoice ID: <span style={{ color: 'var(--text-muted)' }}>{log.previous_accepted_invoice_id || 'None'}</span>
                            {' -> '}
                            <strong>{log.new_accepted_invoice_id || 'None'}</strong>
                          </div>
                          {(log.previous_accepted_match_score !== log.new_accepted_match_score || log.previous_accepted_match_confidence !== log.new_accepted_match_confidence) && (
                            <div>
                              Match: <span style={{ color: 'var(--text-muted)' }}>{log.previous_accepted_match_score || 'None'} {log.previous_accepted_match_confidence || ''}</span>
                              {' -> '}
                              <strong>{log.new_accepted_match_score || 'None'} {log.new_accepted_match_confidence || ''}</strong>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Rejection reason changes */}
                      {log.previous_rejected_reason !== log.new_rejected_reason && (log.previous_rejected_reason || log.new_rejected_reason) && (
                        <div style={{ color: 'var(--danger)', fontStyle: 'italic', marginBottom: '2px' }}>
                          Reason: "{log.previous_rejected_reason || 'None'}" {' -> '} "{log.new_rejected_reason || 'None'}"
                        </div>
                      )}

                      {/* Notes changes */}
                      {log.previous_review_notes !== log.new_review_notes && (log.previous_review_notes || log.new_review_notes) && (
                        <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '6px', borderRadius: '4px', fontStyle: 'italic', marginTop: '4px' }}>
                          Notes: "{log.previous_review_notes || 'None'}" {' -> '} "{log.new_review_notes || 'None'}"
                        </div>
                      )}

                      {log.safety_message && (
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {log.safety_message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                Review history is an audit trail only. It does not reconcile, allocate, or apply payments.
              </div>
            </div>

            {/* Matches details */}
            {selectedRow.suggested_tenant && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '700' }}>Matched Candidate Info</h4>
                <div style={{ border: '1px solid var(--border)', padding: '10px', borderRadius: '6px', fontSize: '12px' }}>
                  <div>Tenant: <strong>{selectedRow.suggested_tenant.full_name}</strong> (Acc: {selectedRow.suggested_tenant.tenant_account_number})</div>
                  {selectedRow.suggested_invoice && (
                    <div style={{ marginTop: '4px' }}>
                      Invoice: <strong>{selectedRow.suggested_invoice.invoice_number}</strong> • Outstanding: <span style={{ color: 'var(--danger)' }}>{formatCurrency(selectedRow.suggested_invoice.balance)}</span> (Total: {formatCurrency(selectedRow.suggested_invoice.total)})
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Suggested Match Explanation Section */}
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '700' }}>Suggested Match Explanation</h4>
              <div style={{
                padding: '10px 12px',
                backgroundColor: 'var(--info-glow)',
                border: '1px solid var(--info)',
                borderRadius: '6px',
                fontSize: '11px',
                color: 'var(--text-primary)',
                marginBottom: '12px'
              }}>
                These are matching suggestions only. No payment has been reconciled, allocated, or applied to an invoice.
              </div>
              {selectedRow.status === 'ignored' ? (
                <div style={{ border: '1px solid var(--border)', padding: '12px', borderRadius: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Ignored evidence cannot accept match suggestions.
                </div>
              ) : selectedRow.suggestions && selectedRow.suggestions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {selectedRow.suggestions.map((s, idx) => (
                    <div key={idx} style={{
                      border: '1px solid var(--border)',
                      padding: '12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      fontSize: '12px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{
                          fontSize: '9px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          backgroundColor: s.match_confidence === 'high' ? 'rgba(76, 175, 80, 0.15)' : s.match_confidence === 'medium' ? 'rgba(255, 152, 0, 0.15)' : 'rgba(33, 150, 243, 0.15)',
                          color: s.match_confidence === 'high' ? 'var(--success)' : s.match_confidence === 'medium' ? 'var(--warning)' : 'var(--info)',
                          border: s.match_confidence === 'high' ? '1px solid var(--success)' : s.match_confidence === 'medium' ? '1px solid var(--warning)' : '1px solid var(--info)'
                        }}>
                          {s.match_confidence} Confidence (Score: {s.match_score})
                        </span>
                        {idx === 0 && <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--success)' }}>BEST MATCH</span>}
                      </div>
                      <div>Tenant: <strong>{s.tenant_name}</strong> (Phone: {s.tenant_phone})</div>
                      <div>Unit/Property: <strong>{s.unit_label}</strong></div>
                      {s.invoice_number && (
                        <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid var(--border)' }}>
                          <div>Invoice: <strong>{s.invoice_number}</strong> • Status: <span style={{ textTransform: 'capitalize' }}>{s.invoice_status}</span></div>
                          <div>Outstanding Balance: <strong style={{ color: 'var(--danger)' }}>{formatCurrency(s.invoice_balance)}</strong></div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Due Date: {new Date(s.invoice_due_date).toLocaleDateString()}</div>
                        </div>
                      )}
                      {s.match_reasons && s.match_reasons.length > 0 && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                          <strong>Reasons:</strong>
                          <ul style={{ margin: '2px 0 0 0', paddingLeft: '16px' }}>
                            {s.match_reasons.map((r, rIdx) => <li key={rIdx}>{r}</li>)}
                          </ul>
                        </div>
                      )}
                      {s.match_warnings && s.match_warnings.length > 0 && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--warning)' }}>
                          <strong>Warnings:</strong>
                          <ul style={{ margin: '2px 0 0 0', paddingLeft: '16px' }}>
                            {s.match_warnings.map((w, wIdx) => <li key={wIdx}>{w}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border)', padding: '12px', borderRadius: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  No suggestions available.
                </div>
              )}
            </div>

            {/* Raw Text line */}
            {selectedRow.raw_text && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '700' }}>Raw Line Input</h4>
                <pre style={{ margin: 0, padding: '8px 12px', fontSize: '11px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border)', borderRadius: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {selectedRow.raw_text}
                </pre>
              </div>
            )}

            {/* Prettified raw_fields JSON */}
            {selectedRow.raw_fields && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '700' }}>Prettified Raw Payload (JSON)</h4>
                <pre style={{ margin: 0, padding: '12px', fontSize: '11px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border)', borderRadius: '8px', overflowX: 'auto', maxBlockSize: '150px' }}>
                  {JSON.stringify(selectedRow.raw_fields, null, 2)}
                </pre>
              </div>
            )}

            {/* MANUAL REVIEW DECISION WORKSPACE */}
            {(role === 'landlord' || role === 'super_admin') && (
              <div style={{
                marginBottom: '20px',
                border: '2px solid var(--border)',
                padding: '16px',
                borderRadius: '12px',
                backgroundColor: 'var(--bg-surface-elevated)'
              }}>
                <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: '12px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldAlert size={14} style={{ color: 'var(--primary)' }} />
                  Manual Review Decision
                </h4>

                {/* Safety notice info banner */}
                <div style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(255, 152, 0, 0.05)',
                  border: '1px solid var(--warning)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  marginBottom: '12px'
                }}>
                  <strong>Review Disclaimer:</strong> Manual review decisions are audit notes only. They do not reconcile, allocate, or apply payments to invoices.
                </div>

                {/* Form Controls for Review Notes */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                    Review / Audit Notes (Max 1000 chars)
                  </label>
                  <textarea
                    className="form-control"
                    rows={2}
                    maxLength={1000}
                    placeholder="Enter manual review notes here..."
                    value={reviewNotesText}
                    onChange={(e) => setReviewNotesText(e.target.value)}
                    style={{ fontSize: '12px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  />
                </div>

                {/* Decision options grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                  {/* Option 1: Accept suggestion */}
                  {selectedRow.status !== 'ignored' && selectedRow.suggestions && selectedRow.suggestions.length > 0 && (
                    <div style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-surface)' }}>
                      <div style={{ fontSize: '11.5px', fontWeight: '700', marginBottom: '6px' }}>Option A: Accept Match Suggestion</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                        {selectedRow.suggestions.map((s, idx) => (
                          <label key={idx} style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            padding: '6px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            backgroundColor: acceptedCandidateIndex === idx ? 'rgba(76, 175, 80, 0.08)' : 'transparent',
                            borderColor: acceptedCandidateIndex === idx ? 'var(--success)' : 'var(--border)'
                          }}>
                            <input
                              type="radio"
                              name="accepted_suggestion_radio"
                              checked={acceptedCandidateIndex === idx}
                              onChange={() => {
                                setAcceptedCandidateIndex(idx);
                                setReviewDecisionType('accepted_suggestion');
                              }}
                              style={{ marginTop: '3px' }}
                            />
                            <div style={{ fontSize: '11px' }}>
                              <strong>{s.tenant_name}</strong> ({s.unit_label}) • Invoice <strong>{s.invoice_number}</strong> • Confidence: <span style={{ textTransform: 'uppercase', fontWeight: '700' }}>{s.match_confidence}</span> (Score: {s.match_score})
                            </div>
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        disabled={savingReview || reviewDecisionType !== 'accepted_suggestion' || acceptedCandidateIndex === -1}
                        onClick={() => {
                          const s = selectedRow.suggestions[acceptedCandidateIndex];
                          handleSaveReviewDecision('accepted_suggestion', s.tenant_id, s.invoice_id);
                        }}
                      >
                        Save Accepted Suggestion
                      </button>
                    </div>
                  )}

                  {/* Reject / Needs More Evidence / Irrelevant forms */}
                  {selectedRow.status !== 'ignored' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${reviewDecisionType === 'rejected_suggestion' ? 'btn-danger' : 'btn-secondary'}`}
                        onClick={() => setReviewDecisionType('rejected_suggestion')}
                        disabled={savingReview}
                      >
                        Reject Suggestion
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${reviewDecisionType === 'needs_more_evidence' ? 'btn-warning' : 'btn-secondary'}`}
                        onClick={() => setReviewDecisionType('needs_more_evidence')}
                        disabled={savingReview}
                      >
                        Needs More Evidence
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${reviewDecisionType === 'marked_irrelevant' ? 'btn-secondary' : 'btn-secondary'}`}
                        onClick={() => setReviewDecisionType('marked_irrelevant')}
                        style={{
                          backgroundColor: reviewDecisionType === 'marked_irrelevant' ? 'var(--border)' : 'transparent',
                          borderColor: 'var(--border)'
                        }}
                        disabled={savingReview}
                      >
                        Mark Irrelevant
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={savingReview}
                        style={{
                          backgroundColor: 'var(--border)',
                          borderColor: 'var(--border)',
                          width: '100%',
                          cursor: 'default',
                          fontWeight: '800'
                        }}
                      >
                        Mark Evidence Irrelevant
                      </button>
                    </div>
                  )}

                  {/* Rejected Reason Form */}
                  {(reviewDecisionType === 'rejected_suggestion' || reviewDecisionType === 'marked_irrelevant') && (
                    <div style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-surface)' }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                        Rejection / Irrelevant Reason (Max 500 chars) *
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        maxLength={500}
                        placeholder="Enter the reason why this suggestion/row is invalid..."
                        value={rejectedReasonText}
                        onChange={(e) => setRejectedReasonText(e.target.value)}
                        style={{ fontSize: '12px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', marginBottom: '8px' }}
                      />
                      <button
                        type="button"
                        className={`btn ${reviewDecisionType === 'rejected_suggestion' ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                        disabled={savingReview || !rejectedReasonText.trim()}
                        onClick={() => handleSaveReviewDecision(reviewDecisionType)}
                      >
                        {reviewDecisionType === 'rejected_suggestion' ? 'Save Rejection' : 'Mark Evidence Irrelevant'}
                      </button>
                    </div>
                  )}

                  {/* Needs More Evidence Form */}
                  {reviewDecisionType === 'needs_more_evidence' && (
                    <div style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--bg-surface)' }}>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        This will flag the evidence row as needing further documentation or review notes.
                      </p>
                      <button
                        type="button"
                        className="btn btn-warning btn-sm"
                        disabled={savingReview}
                        onClick={() => handleSaveReviewDecision('needs_more_evidence')}
                      >
                        Save Needs More Evidence
                      </button>
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* Action buttons footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedRow(null)}
                style={{ minWidth: '100px' }}
              >
                Close Details
              </button>
            </div>

          </div>
        </div>
      )}
        {/* IMPORT WIZARD MODAL */}
      {showImportWizard && (
        <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 }}>
          <div className="modal-content" style={{ maxWidth: '680px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', position: 'relative' }}>

            {/* Close button */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowImportWizard(false)}
              style={{ position: 'absolute', right: '16px', top: '16px', borderRadius: '50%', width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={14} />
            </button>

            <h3 className="card-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} style={{ color: 'var(--primary)' }} />
              Import Payment Evidence Wizard
            </h3>

            {/* STEP PROGRESS BAR */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', position: 'relative', padding: '0 10px' }}>
              <div style={{ position: 'absolute', top: '14px', left: '20px', right: '20px', height: '2px', backgroundColor: 'var(--border)', zIndex: 1 }} />
              <div style={{ position: 'absolute', top: '14px', left: '20px', right: '20px', height: '2px', backgroundColor: 'var(--primary)', width: `${((wizardStep - 1) / 4) * 100}%`, transition: 'width 0.3s ease', zIndex: 2 }} />

              {[1, 2, 3, 4, 5].map((step) => {
                const isCompleted = step < wizardStep;
                const isActive = step === wizardStep;
                return (
                  <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 3, position: 'relative' }}>
                    <div style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '50%',
                      backgroundColor: isCompleted ? 'var(--primary)' : isActive ? 'var(--bg-surface)' : 'var(--bg-surface-elevated)',
                      border: isActive ? '2.5px solid var(--primary)' : isCompleted ? 'none' : '2px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '700',
                      fontSize: '12px',
                      color: isCompleted ? '#ffffff' : isActive ? 'var(--primary)' : 'var(--text-muted)',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 0 10px var(--primary-glow)' : 'none'
                    }}>
                      {isCompleted ? <Check size={14} strokeWidth={3} /> : step}
                    </div>
                    <span style={{
                      fontSize: '9px',
                      marginTop: '6px',
                      fontWeight: isActive || isCompleted ? '700' : '500',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                      whiteSpace: 'nowrap'
                    }}>
                      {step === 1 && 'Source'}
                      {step === 2 && 'Upload'}
                      {step === 3 && 'Provider'}
                      {step === 4 && 'Preview'}
                      {step === 5 && 'Import'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* STEP 1: CHOOSE SOURCE */}
            {wizardStep === 1 && (
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px' }}>Step 1: Choose Source Template</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  {[
                    { id: 'csv', name: 'CSV statement', desc: 'Raw spreadsheet exports' },
                    { id: 'pdf_bank', name: 'PDF bank statement', desc: 'Standard monthly e-statements' },
                    { id: 'pdf_receipt', name: 'PDF receipt/advice', desc: 'Individual transaction receipts' },
                    { id: 'mpesa_statement', name: 'M-Pesa statement', desc: 'Official Safaricom ledger exports' },
                    { id: 'excel', name: 'Excel file', desc: 'XLSX formats or accounting tables' },
                    { id: 'unknown', name: 'Other/Unknown', desc: 'Unformatted text or other layouts' }
                  ].map((src) => (
                    <div
                      key={src.id}
                      onClick={() => setImportSource(src.id)}
                      style={{
                        padding: '14px',
                        border: importSource === src.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                        borderRadius: '8px',
                        backgroundColor: importSource === src.id ? 'var(--primary-glow)' : 'var(--bg-surface-elevated)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        boxShadow: importSource === src.id ? '0 4px 12px rgba(0,0,0,0.15)' : 'none'
                      }}
                      className="wizard-card-hover"
                    >
                      <div style={{ fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', border: '2px solid var(--border)', backgroundColor: importSource === src.id ? 'var(--primary)' : 'transparent', transition: 'all 0.1s' }} />
                        {src.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '18px' }}>{src.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 2: UPLOAD FILE */}
            {wizardStep === 2 && (
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px' }}>Step 2: Upload Source File</h4>
                {wizardError && (
                  <div className="alert alert-danger" style={{ fontSize: '11px', whiteSpace: 'pre-line', padding: '12px', marginBottom: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>{wizardError}</div>
                  </div>
                )}
                {importSource === 'csv' ? (
                  <div style={{
                    border: '2px dashed var(--border)',
                    borderRadius: '8px',
                    padding: '30px',
                    textAlign: 'center',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    marginBottom: '16px',
                    position: 'relative'
                  }}>
                    <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
                    <p style={{ fontSize: '13px', fontWeight: '600', margin: '0 0 6px 0' }}>Select CSV File</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>Supports .csv format only</p>

                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileChange}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        opacity: 0,
                        cursor: 'pointer'
                      }}
                    />

                    {importFile && (
                      <div style={{ fontSize: '12px', color: 'var(--success)', fontWeight: '700', marginTop: '10px' }}>
                        Selected: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    border: '2px dashed var(--border)',
                    borderRadius: '8px',
                    padding: '30px',
                    textAlign: 'center',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    marginBottom: '16px'
                  }}>
                    <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
                    <p style={{ fontSize: '13px', fontWeight: '600', margin: '0 0 6px 0' }}>Select or Drag file here</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>Supports .csv, .pdf, .xls, .xlsx formats</p>
                    <button type="button" className="btn btn-secondary btn-sm" disabled style={{ cursor: 'not-allowed' }}>
                      Choose File
                    </button>
                  </div>
                )}

                {importSource === 'csv' ? (
                  <div className="alert alert-info" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '11px', margin: 0, padding: '12px' }}>
                    <HelpCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>
                      <strong>Local Parse Mode:</strong> The CSV file will be parsed and validated entirely inside your browser. No data will be sent to the server.
                    </span>
                  </div>
                ) : (
                  <div className="alert alert-info" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '11px', margin: 0, padding: '12px' }}>
                    <HelpCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>
                      <strong>Future Mode:</strong> File parsing will be enabled in a future phase. This wizard currently prepares the import workflow only.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: DETECT PROVIDER */}
            {wizardStep === 3 && (
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px' }}>Step 3: Select or Confirm Provider</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  {[
                    { id: 'mpesa', name: 'M-Pesa', desc: 'Safaricom mobile network operator' },
                    { id: 'coop', name: 'Co-op Bank', desc: 'Co-operative Bank of Kenya' },
                    { id: 'loop', name: 'Loop', desc: 'Loop Digital Banking' },
                    { id: 'kcb', name: 'KCB', desc: 'Kenya Commercial Bank' },
                    { id: 'equity', name: 'Equity', desc: 'Equity Bank Group' },
                    { id: 'absa', name: 'Absa', desc: 'Absa Bank Kenya' },
                    { id: 'ncba', name: 'NCBA', desc: 'NCBA Bank Group' },
                    { id: 'unknown', name: 'Other/Unknown', desc: 'Other bank or processing channel' }
                  ].map((prov) => (
                    <div
                      key={prov.id}
                      onClick={() => setImportProvider(prov.id)}
                      style={{
                        padding: '12px',
                        border: importProvider === prov.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                        borderRadius: '8px',
                        backgroundColor: importProvider === prov.id ? 'var(--primary-glow)' : 'var(--bg-surface-elevated)',
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                      className="wizard-card-hover"
                    >
                      <div style={{ fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', border: '2px solid var(--border)', backgroundColor: importProvider === prov.id ? 'var(--primary)' : 'transparent', transition: 'all 0.1s' }} />
                        {prov.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '18px' }}>{prov.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 4: PREVIEW & VALIDATE */}
            {wizardStep === 4 && (
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px' }}>Step 4: Preview Scored Records</h4>
                {importSource === 'csv' && parsedPreviewRows.length > 0 ? (
                  <div>
                    {/* Summary counters grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--primary)' }}>
                        Total Rows: <strong>{getPreviewSummary().total}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--success)' }}>
                        Valid Rows: <strong>{getPreviewSummary().valid}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--warning)' }}>
                        With Warnings: <strong>{getPreviewSummary().warnings}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--danger)' }}>
                        Duplicate Codes: <strong>{getPreviewSummary().duplicates}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--danger)' }}>
                        Duplicate Rows: <strong>{getPreviewSummary().duplicateRows}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--warning)' }}>
                        Missing Dates: <strong>{getPreviewSummary().missingDates}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--warning)' }}>
                        Missing Amounts: <strong>{getPreviewSummary().missingAmounts}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--text-secondary)' }}>
                        Debit Rows: <strong>{getPreviewSummary().debits}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--warning)' }}>
                        Unsupported Rows: <strong>{getPreviewSummary().unsupported}</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '11px', borderLeft: '3px solid var(--text-muted)' }}>
                        Skipped Rows: <strong>{getPreviewSummary().skipped}</strong>
                      </div>
                    </div>

                    {/* Preview Table */}
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px', maxBlockSize: '240px', overflowY: 'auto', marginBottom: '16px' }}>
                      <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', backgroundColor: 'var(--bg-surface-elevated)' }}>
                            <th style={{ padding: '8px' }}>Status/Warnings</th>
                            <th style={{ padding: '8px' }}>Date</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
                            <th style={{ padding: '8px' }}>Direction</th>
                            <th style={{ padding: '8px' }}>Payer</th>
                            <th style={{ padding: '8px' }}>Phone</th>
                            <th style={{ padding: '8px' }}>Code</th>
                            <th style={{ padding: '8px' }}>Account</th>
                            <th style={{ padding: '8px' }}>Description</th>
                            <th style={{ padding: '8px' }}>Channel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedPreviewRows.map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border)', backgroundColor: row.warnings.length > 0 ? 'rgba(var(--warning-rgb), 0.05)' : 'transparent' }}>
                              <td style={{ padding: '8px', verticalAlign: 'top' }}>
                                {row.warnings.length === 0 ? (
                                  <span style={{ color: 'var(--success)', fontWeight: '700' }}>✓ Valid</span>
                                ) : (
                                  <div style={{ color: 'var(--warning)', fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {row.warnings.map((w, wIdx) => (
                                      <div key={wIdx} title={w}>• {w.length > 25 ? w.slice(0, 25) + '...' : w}</div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '8px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{row.transaction_date || 'N/A'}</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: '700', verticalAlign: 'top' }}>{formatCurrency(row.amount)}</td>
                              <td style={{ padding: '8px', textTransform: 'capitalize', verticalAlign: 'top' }}>{row.direction}</td>
                              <td style={{ padding: '8px', verticalAlign: 'top' }}>{row.payer_name || 'N/A'}</td>
                              <td style={{ padding: '8px', verticalAlign: 'top' }}>{row.payer_phone || 'N/A'}</td>
                              <td style={{ padding: '8px', fontWeight: '600', verticalAlign: 'top' }}>{row.transaction_code || 'N/A'}</td>
                              <td style={{ padding: '8px', verticalAlign: 'top' }}>{row.reference_account || 'N/A'}</td>
                              <td style={{ padding: '8px', verticalAlign: 'top', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxInlineSize: '120px' }} title={row.description}>{row.description || 'N/A'}</td>
                              <td style={{ padding: '8px', verticalAlign: 'top' }}>{row.collection_channel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Task 5: User Guidance Panel */}
                    <div style={{
                      backgroundColor: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      fontSize: '11px',
                      lineHeight: '1.5'
                    }}>
                      <div style={{ fontWeight: '700', marginBottom: '6px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ShieldAlert size={14} />
                        Current Phase: Preview Only
                      </div>
                      <p style={{ margin: '0 0 8px 0', color: 'var(--text-secondary)' }}>
                        This is a browser-only preview. <strong>No data has been saved to the database</strong>, no reconciliation has occurred, and no payment allocations have been created. The final Import button is intentionally disabled.
                      </p>
                      <div style={{ fontWeight: '700', marginBottom: '4px', color: 'var(--text-primary)' }}>Future phases will enable:</div>
                      <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)' }}>
                        <li>CSV, PDF, and Excel Import & validation adapters</li>
                        <li>Bank and M-Pesa statements file upload</li>
                        <li>OCR receipt scanning & digitizing pipeline</li>
                        <li>Automatic matching engine with manual review queue reconciliation</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '40px 20px',
                    textAlign: 'center',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    color: 'var(--text-muted)'
                  }}>
                    <FileSpreadsheet size={36} style={{ color: 'var(--text-muted)', marginBottom: '12px', opacity: 0.5 }} />
                    <p style={{ fontSize: '12px', margin: 0, fontWeight: '500' }}>
                      Preview will appear here after parser adapters are enabled.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 5: IMPORT TO REVIEW QUEUE */}
            {wizardStep === 5 && (
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '700', marginBottom: '12px' }}>Step 5: Finalize Import</h4>
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '24px',
                  backgroundColor: 'var(--bg-surface-elevated)',
                  marginBottom: '16px'
                }}>
                  <div style={{ fontSize: '12px', marginBottom: '12px' }}>
                    <strong>Selected Source:</strong> {importSource ? importSource.toUpperCase() : 'N/A'}
                  </div>
                  <div style={{ fontSize: '12px', marginBottom: '12px' }}>
                    <strong>Selected Provider:</strong> {importProvider ? importProvider.toUpperCase() : 'N/A'}
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    <strong>Validation Status:</strong> <span style={{ color: importSource === 'csv' && parsedPreviewRows.length > 0 ? 'var(--success)' : 'var(--warning)', fontWeight: '700' }}>{importSource === 'csv' && parsedPreviewRows.length > 0 ? 'PARSED PREVIEW READY' : 'PENDING PARSING'}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!isImportEnabled || importing}
                    onClick={handleImportCSV}
                    style={{
                      width: '100%',
                      cursor: (!isImportEnabled || importing) ? 'not-allowed' : 'pointer',
                      opacity: (!isImportEnabled || importing) ? 0.6 : 1
                    }}
                  >
                    {importing ? 'Importing...' : 'Import CSV to Review Queue'}
                  </button>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                    Importing only saves evidence rows for review. It does not reconcile payments or update invoices.
                  </p>
                </div>
              </div>
            )}

            {/* MODAL FOOTER BUTTONS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '24px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (wizardStep === 1) {
                    setShowImportWizard(false);
                  } else {
                    setWizardStep(wizardStep - 1);
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <ArrowLeft size={14} />
                {wizardStep === 1 ? 'Cancel' : 'Back'}
              </button>

              {wizardStep < 5 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setWizardStep(wizardStep + 1)}
                  disabled={(wizardStep === 1 && !importSource) || (wizardStep === 3 && !importProvider)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: ((wizardStep === 1 && !importSource) || (wizardStep === 3 && !importProvider)) ? 0.6 : 1,
                    cursor: ((wizardStep === 1 && !importSource) || (wizardStep === 3 && !importProvider)) ? 'not-allowed' : 'pointer'
                  }}
                >
                  Next
                  <ArrowRight size={14} />
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
