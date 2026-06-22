import React, { useState, useEffect } from 'react';
import SecurityPinModal from '../components/SecurityPinModal.jsx';
import { Download, Loader2, Smartphone } from 'lucide-react';

export default function Reconciliation({ organization, refreshTrigger, onRefresh }) {
  const [stagingRows, setStagingRows] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadSummary, setUploadSummary] = useState(null);
  
  // Workbench Active View
  const [filterStatus, setFilterStatus] = useState('needs_review'); // needs_review, unmatched, reconciled, ignored

  // Upload & Mapping state
  const [file, setFile] = useState(null);
  const [uploadData, setUploadData] = useState(null); // { headers, rows, tempPath, fileName }
  const [mappings, setMappings] = useState({
    date: '',
    amount: '',
    reference: '',
    account_number: '',
    description: '',
    payer_name: ''
  });

  // Manual Matching State
  const [matchingRow, setMatchingRow] = useState(null); // Row currently being manually matched
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pinTargetRow, setPinTargetRow] = useState(null);

  const headers = {};

  useEffect(() => {
    fetchStaging();
    fetchSelectionData();
  }, [refreshTrigger, filterStatus]);

  const fetchStaging = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reconciliation/staging', { headers });
      const data = await res.json();
      setStagingRows(data);
    } catch (e) {
      console.error(e);
      setError('Failed to load staging rows.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSelectionData = async () => {
    try {
      const [resTenants, resInvs] = await Promise.all([
        fetch('/api/tenants', { headers }),
        fetch('/api/invoices', { headers })
      ]);
      setTenants(await resTenants.json());
      setInvoices(await resInvs.json());
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError('');
    } else {
      setFile(null);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please choose a statement file before uploading.');
      return;
    }

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/reconciliation/upload', {
        method: 'POST',
        headers: {},
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload CSV.');

      setUploadData(data);
      
      // Guess default mapping matches
      const guessMapping = { date: '', amount: '', reference: '', account_number: '', description: '', payer_name: '' };
      data.headers.forEach(h => {
        const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lower.includes('date')) guessMapping.date = h;
        else if (lower.includes('amount') || lower.includes('cr')) guessMapping.amount = h;
        else if (lower.includes('ref') || lower.includes('transid')) guessMapping.reference = h;
        else if (lower.includes('acc') || lower.includes('billref')) guessMapping.account_number = h;
        else if (lower.includes('desc') || lower.includes('particulars')) guessMapping.description = h;
        else if (lower.includes('name') || lower.includes('payer') || lower.includes('client')) guessMapping.payer_name = h;
      });
      setMappings(guessMapping);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleImportFinalize = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/reconciliation/import-finalize', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempPath: uploadData.tempPath,
          fileName: uploadData.fileName,
          mappings
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reconciliation import failed.');

      setUploadData(null);
      setFile(null);
      
      // Save summary data
      setUploadSummary(data.summary);

      // Switch active tab depending on whether there are reviewable candidate rows
      if (data.summary && (data.summary.probable + data.summary.possible > 0)) {
        setFilterStatus('needs_review');
      } else {
        setFilterStatus('unmatched');
      }

      fetchStaging();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadDemoCSV = (e) => {
    e.preventDefault();
    const csvContent = [
      ["Date", "Description", "Reference", "Debit", "Credit", "Balance"],
      ["2026-06-01", "Rent Payment Unit A1 - Maina Kamau", "MPESA-KCB-98217", "", "45000", "45000"],
      ["2026-06-02", "Rent Payment Unit B3 - Sarah Wanjiku", "MPESA-EQUITY-1029", "", "35000", "80000"],
      ["2026-06-05", "Utility Bill Unit C2 - John Doe", "MPESA-COOP-8821", "", "2500", "82500"]
    ].map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "smart-landlord-bank-statement-template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleConfirmAutoMatch = async (row) => {
    // Requires PIN, trigger matching panel or direct modal
    // In our workbench, we can direct confirm matching row
    setSelectedTenantId(row.suggested_tenant_id);
    setSelectedInvoiceId(row.suggested_invoice_id || '');
    setPinTargetRow(row);
  };

  const handlePinSuccess = async (enteredPin) => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/reconciliation/match', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row_id: pinTargetRow.id,
          tenant_id: selectedTenantId,
          invoice_id: selectedInvoiceId || null,
          pin: enteredPin
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to match payment.');

      setPinTargetRow(null);
      setMatchingRow(null);
      setSelectedTenantId('');
      setSelectedInvoiceId('');
      fetchStaging();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleIgnoreRow = async (id) => {
    setLoading(true);
    try {
      const res = await fetch('/api/reconciliation/ignore', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ row_id: id })
      });
      if (!res.ok) throw new Error('Ignore failed.');
      fetchStaging();
      onRefresh();
    } catch (e) {
      setError('Failed to ignore row.');
    } finally {
      setLoading(false);
    }
  };

  const getFilteredRows = () => {
    return stagingRows.filter(r => {
      if (filterStatus === 'ignored') {
        return r.status === 'ignored' || r.status === 'duplicate';
      }
      return r.status === filterStatus;
    });
  };

  const getUnpaidInvoicesForTenant = (tenantId) => {
    return invoices.filter(inv => inv.tenant_id === parseInt(tenantId) && inv.status !== 'paid' && inv.status !== 'void');
  };

  const getTenantName = (id) => {
    const t = tenants.find(te => te.id === id);
    return t ? t.full_name : 'Unknown';
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: organization.billing_currency || 'KES', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      
      {/* PIN VALIDATION MODAL */}
      {pinTargetRow && (
        <SecurityPinModal
          isOpen={!!pinTargetRow}
          onClose={() => setPinTargetRow(null)}
          organizationId={organization.id}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* SAMPLE STATEMENT DOWNLOAD / STATEMENT UPLOAD */}
      {!uploadData && !matchingRow && (
        <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg-surface), var(--primary-glow))' }}>
          <h3 className="card-title">Statement Reconciliation</h3>
          <p style={{ fontSize: '12px', marginBottom: '16px' }}>
            Upload statement CSV file from KCB, Equity, Absa, Co-op, etc. Map columns and reconcile payments.
          </p>

          <form onSubmit={handleUpload}>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
              <input 
                type="file" 
                id="statement-file-input"
                accept=".csv" 
                onChange={handleFileChange} 
                style={{ display: 'none' }} 
              />
              <label 
                htmlFor="statement-file-input" 
                className={`btn btn-sm ${!file ? 'btn-primary pulse-primary' : 'btn-secondary'}`}
                style={{ 
                  cursor: 'pointer', 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: '600',
                  fontSize: '13px',
                  transition: 'all 0.2s',
                  width: 'auto'
                }}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    document.getElementById('statement-file-input').click();
                  }
                }}
              >
                Choose Statement
              </label>
              {file && (
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', animation: 'slideInUp 0.15s ease' }}>
                  Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>
            
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                type="submit" 
                className={`btn btn-sm ${file && !uploading && !loading ? 'btn-primary' : 'btn-secondary'}`}
                style={{ 
                  width: '100%', 
                  opacity: (file && !uploading && !loading) ? 1 : 0.6,
                  cursor: (file && !uploading && !loading) ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }} 
                disabled={!file || uploading || loading}
              >
                {uploading ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'sl-spin 1s linear infinite' }} />
                    Uploading Statement...
                  </>
                ) : (
                  'Upload Statement'
                )}
              </button>
              
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
                <a 
                  href="#"
                  onClick={handleDownloadDemoCSV} 
                  style={{ 
                    fontSize: '11px', 
                    color: 'var(--text-muted)', 
                    textDecoration: 'underline', 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    cursor: 'pointer'
                  }}
                >
                  <Download size={12} /> Download Demo Bank CSV Template
                </a>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* COLUMN MAPPING SCREEN */}
      {uploadData && (
        <div className="card">
          <h3 className="card-title">Map Statement Columns</h3>
          <p style={{ fontSize: '12px', marginBottom: '14px' }}>
            Match the statement headers to Smart Landlord fields.
          </p>

          <form onSubmit={handleImportFinalize}>
            {Object.keys(mappings).map(field => (
              <div key={field} className="form-group">
                <label className="form-label" style={{ fontSize: '11px' }}>{field.replace('_', ' ')}</label>
                <select
                  required={['date', 'amount', 'reference'].includes(field)}
                  className="form-control"
                  value={mappings[field]}
                  onChange={e => setMappings({ ...mappings, [field]: e.target.value })}
                >
                  <option value="">-- Ignore Column --</option>
                  {uploadData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}

            <div className="flex-gap" style={{ marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setUploadData(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>Run Auto Match & Import</button>
            </div>
          </form>
        </div>
      )}

      {/* MANUAL MATCH WORKBENCH PANEL */}
      {matchingRow && (
        <div className="card">
          <h3 className="card-title">Manual Reconcile Row</h3>
          <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', fontSize: '12px', marginBottom: '16px' }}>
            <div>Ref: <strong>{matchingRow.reference_number}</strong> • Amount: <strong style={{ color: 'var(--success)' }}>{formatCurrency(matchingRow.amount)}</strong></div>
            <div>Payer: {matchingRow.payer_name || 'N/A'} • Memo: {matchingRow.description || 'N/A'}</div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); setPinTargetRow(matchingRow); }}>
            <div className="form-group">
              <label className="form-label">Search / Select Tenant</label>
              <select
                required
                className="form-control"
                value={selectedTenantId}
                onChange={e => { setSelectedTenantId(e.target.value); setSelectedInvoiceId(''); }}
              >
                <option value="">-- Select Matching Tenant --</option>
                {tenants.filter(t => t.status === 'active').map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} ({t.unit_code} - Acc: {t.tenant_account_number})</option>
                ))}
              </select>
            </div>

            {selectedTenantId && (
              <div className="form-group">
                <label className="form-label">Apply to Invoice (Optional)</label>
                <select
                  className="form-control"
                  value={selectedInvoiceId}
                  onChange={e => setSelectedInvoiceId(e.target.value)}
                >
                  <option value="">-- Oldest Unpaid Bill (Auto) --</option>
                  {getUnpaidInvoicesForTenant(selectedTenantId).map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.invoice_number} ({inv.invoice_type} - Oustanding: {formatCurrency(inv.balance)} Due: {inv.due_date})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-gap" style={{ marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMatchingRow(null)}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={!selectedTenantId}>Match with PIN</button>
            </div>
          </form>
        </div>
      )}

      {/* WORKBENCH LISTS */}
      {!uploadData && !matchingRow && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          
          {/* UPLOAD SUMMARY REPORT */}
          {uploadSummary && (
            <div className="card" style={{ borderLeft: '4px solid var(--success)', marginBottom: '16px', position: 'relative' }}>
              <button 
                type="button" 
                className="btn btn-secondary btn-sm" 
                onClick={() => setUploadSummary(null)} 
                style={{ position: 'absolute', right: '12px', top: '12px', padding: '2px 8px' }}
              >
                Dismiss
              </button>
              <h4 style={{ fontWeight: '700', color: 'var(--success)', marginBottom: '10px', fontSize: '14px' }}>Statement Import Summary</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                <div>Total rows processed: <strong>{uploadSummary.total}</strong></div>
                <div style={{ color: 'var(--success)' }}>Probable matches (confidence &gt;= 70%): <strong>{uploadSummary.probable}</strong></div>
                <div style={{ color: 'var(--warning)' }}>Possible matches (40% - 69%): <strong>{uploadSummary.possible}</strong></div>
                <div style={{ color: 'var(--text-secondary)' }}>Unmatched rows (no candidate): <strong>{uploadSummary.unmatched}</strong></div>
                {uploadSummary.duplicates > 0 && (
                  <div style={{ color: 'var(--danger)' }}>Duplicates ignored: <strong>{uploadSummary.duplicates}</strong></div>
                )}
                <div style={{ marginTop: '6px', fontWeight: '600', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                  Next action: {uploadSummary.probable + uploadSummary.possible > 0 
                    ? 'Please review probable/possible matches in the "Needs Review" queue.'
                    : 'All rows are unmatched. Please match them manually.'}
                </div>
              </div>
            </div>
          )}

          {/* TAB HEADERS */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
            <button
              style={{ flex: 1, padding: '10px 0', border: 'none', background: 'none', color: filterStatus === 'needs_review' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: filterStatus === 'needs_review' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
              onClick={() => setFilterStatus('needs_review')}
            >
              Needs Review
            </button>
            <button
              style={{ flex: 1, padding: '10px 0', border: 'none', background: 'none', color: filterStatus === 'unmatched' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: filterStatus === 'unmatched' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
              onClick={() => setFilterStatus('unmatched')}
            >
              Unmatched
            </button>
            <button
              style={{ flex: 1, padding: '10px 0', border: 'none', background: 'none', color: filterStatus === 'reconciled' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: filterStatus === 'reconciled' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
              onClick={() => setFilterStatus('reconciled')}
            >
              Reconciled
            </button>
            <button
              style={{ flex: 1, padding: '10px 0', border: 'none', background: 'none', color: filterStatus === 'ignored' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: filterStatus === 'ignored' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
              onClick={() => setFilterStatus('ignored')}
            >
              Ignored
            </button>
          </div>

          {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

          {/* LIST ITEMS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {getFilteredRows().length === 0 ? (
              <div className="sl-empty-state">
                <div className="sl-empty-state-title">Queue Empty</div>
                <div className="sl-empty-state-desc">No statement rows in this queue.</div>
              </div>
            ) : (
              getFilteredRows().map(row => (
                <div key={row.id} className="sl-list-card" style={{ borderLeft: filterStatus === 'needs_review' ? '4px solid var(--primary)' : '1px solid var(--border)' }}>
                  <div className="flex-row">
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>
                      Ref: {row.reference_number}
                      {((row.reference_number && row.reference_number.toLowerCase().includes('mpesa')) || 
                        (row.description && row.description.toLowerCase().includes('mpesa'))) && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', marginLeft: '6px', color: 'var(--success)' }}>
                          <Smartphone size={11} /> <span style={{ fontSize: '10px', fontWeight: 'bold' }}>Lipa na M-Pesa</span>
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--success)', fontWeight: '700' }}>{formatCurrency(row.amount)}</span>
                  </div>
                  
                  <div style={{ fontSize: '13px', margin: '6px 0' }}>
                    <div><strong>Payer Name:</strong> {row.payer_name || 'Unknown Payer'}</div>
                    {row.account_number && <div><strong>Acc No:</strong> {row.account_number}</div>}
                    <div><strong>Description:</strong> {row.description}</div>
                    <div><strong>Date:</strong> {new Date(row.transaction_date).toLocaleDateString()}</div>
                  </div>

                  {/* Auto match suggestions details */}
                  {row.status === 'needs_review' && (
                    <div style={{ marginTop: '8px', padding: '10px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                        <span className={`badge ${row.confidence_score >= 70 ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                          {row.confidence_score >= 70 ? 'Probable Match' : 'Possible Match'} ({row.confidence_score}%)
                        </span>
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        Tenant: <strong>{getTenantName(row.suggested_tenant_id)}</strong>
                        {row.suggested_invoice_id && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Suggested Invoice: <strong>{invoices.find(i => i.id === row.suggested_invoice_id)?.invoice_number || `#${row.suggested_invoice_id}`}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px', justifyContent: 'flex-end' }}>
                    {filterStatus === 'needs_review' && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleIgnoreRow(row.id)}>Ignore</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                          setMatchingRow(row);
                          setSelectedTenantId(row.suggested_tenant_id);
                          setSelectedInvoiceId(row.suggested_invoice_id || '');
                        }}>Match Manually</button>
                        <button className="btn btn-primary btn-sm" onClick={() => handleConfirmAutoMatch(row)}>Confirm Match</button>
                      </>
                    )}
                    
                    {filterStatus === 'unmatched' && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleIgnoreRow(row.id)}>Ignore</button>
                        <button className="btn btn-primary btn-sm" onClick={() => {
                          setMatchingRow(row);
                          setSelectedTenantId('');
                          setSelectedInvoiceId('');
                        }}>Match Manually</button>
                      </>
                    )}

                    {filterStatus === 'reconciled' && (
                      <span className="badge badge-success">Posted Ledger</span>
                    )}

                    {filterStatus === 'ignored' && (
                      <span className="badge badge-danger" style={{ cursor: 'pointer' }} onClick={() => handleIgnoreRow(row.id)}>Restore</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

        </div>
      )}

    </div>
  );
}
