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
  Check
} from 'lucide-react';

export default function PaymentEvidence({ organization, refreshTrigger }) {
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

  // Selected row for Detail Drawer
  const [selectedRow, setSelectedRow] = useState(null);

  // Import Wizard State
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [importSource, setImportSource] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importProvider, setImportProvider] = useState('');

  // Fetch batches & evidence rows
  useEffect(() => {
    fetchBatches();
    fetchEvidenceRows();
  }, [refreshTrigger, status, strength, channel, startDate, endDate, minAmount, maxAmount, selectedBatchId]);

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEvidenceRows();
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

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

          {/* Clear Filters Button */}
          {(status || strength || channel || startDate || endDate || minAmount || maxAmount || selectedBatchId || search) && (
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
                      {row.suggested_tenant ? (
                        <div>
                          <div className="badge badge-info" style={{ fontSize: '10px' }}>
                            {row.suggested_tenant.full_name}
                          </div>
                          {row.suggested_invoice && (
                            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              Invoice: {row.suggested_invoice.invoice_number}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>None</span>
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

            {/* Normalized Details Panel */}
            <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: '700' }}>Normalized Data</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', backgroundColor: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '8px', fontSize: '12px', marginBottom: '16px' }}>
              <div>
                <span className="text-muted">Transaction Date:</span> <strong>{new Date(selectedRow.transaction_date).toLocaleDateString()}</strong>
              </div>
              <div>
                <span className="text-muted">Normalized Amount:</span> <strong style={{ color: 'var(--success)' }}>{formatCurrency(selectedRow.amount)}</strong>
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
                <span className="text-muted">Source Perspective:</span> <span style={{ textTransform: 'capitalize' }}>{selectedRow.source_perspective}</span>
              </div>
              <div>
                <span className="text-muted">Evidence Strength:</span> <span className={`badge ${getStrengthBadgeClass(selectedRow.evidence_strength)}`} style={{ fontSize: '9px', textTransform: 'capitalize' }}>{selectedRow.evidence_strength}</span>
              </div>
              <div>
                <span className="text-muted">Engine Status:</span> <span className={`badge ${getStatusBadgeClass(selectedRow.status)}`} style={{ fontSize: '9px', textTransform: 'capitalize' }}>{selectedRow.status.replace('_', ' ')}</span>
              </div>
              <div>
                <span className="text-muted">Confidence Score:</span> <strong>{selectedRow.confidence}%</strong>
              </div>
              <div>
                <span className="text-muted">Document Source:</span> <strong>{selectedRow.document_source || 'N/A'}</strong>
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
                <div className="alert alert-info" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '11px', margin: 0, padding: '12px' }}>
                  <HelpCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>
                    <strong>Foundation Mode:</strong> File parsing will be enabled in the next phase. This wizard currently prepares the import workflow only. No files will be processed or uploaded.
                  </span>
                </div>
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
                    <strong>Validation Status:</strong> <span style={{ color: 'var(--warning)', fontWeight: '700' }}>PENDING PARSING</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled
                    style={{ width: '100%', cursor: 'not-allowed', opacity: 0.6 }}
                  >
                    Import Scored Rows to Review Queue
                  </button>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                    Import will be enabled after preview validation is implemented.
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
