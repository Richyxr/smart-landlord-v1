import React, { useState, useEffect } from 'react';
import { 
  CircleDollarSign, 
  Search, 
  CheckCircle2, 
  AlertTriangle, 
  HelpCircle, 
  X, 
  ChevronRight, 
  Check, 
  Loader2, 
  RefreshCw, 
  MinusCircle, 
  Copy, 
  FileSearch,
  Filter
} from 'lucide-react';

export default function BankTransactions({ organization }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // Filters & Pagination
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState('Unmatched');
  const [searchVal, setSearchVal] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({
    total_money_in: 0,
    total_money_out: 0,
    unmatched_count: 0,
    matched_count: 0,
    duplicate_count: 0,
    needs_review_count: 0,
    ignored_count: 0
  });

  // Selected Transaction & Suggestions
  const [selectedTx, setSelectedTx] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);

  // Manual Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [manualCandidates, setManualCandidates] = useState([]);
  const [searchingManual, setSearchingManual] = useState(false);
  const [showManualSearch, setShowManualSearch] = useState(false);

  // Allocation Preview & Control Layer States
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [allocating, setAllocating] = useState(false);
  const [allocationSuccessData, setAllocationSuccessData] = useState(null);

  const handleOpenPreviewModal = async () => {
    if (!selectedTx) return;
    setShowPreviewModal(true);
    setLoadingPreview(true);
    setPreviewError('');
    setPreviewData(null);
    setAllocationSuccessData(null);

    const invoiceId = selectedTx.matched_invoice_id;
    if (!invoiceId) {
      setPreviewError('No invoice is currently matched to this transaction.');
      setLoadingPreview(false);
      return;
    }

    try {
      const paymentRes = await fetch(`/api/billing/bank-transactions/${selectedTx.id}/payment`);
      const payment = await paymentRes.json();
      if (!paymentRes.ok) {
        throw new Error(payment.error || 'Failed to fetch associated payment.');
      }

      const previewRes = await fetch(`/api/billing/payments/${payment.id}/allocation-preview?invoice_id=${invoiceId}&bank_transaction_id=${selectedTx.id}`);
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        throw new Error(preview.error || 'Failed to fetch allocation preview.');
      }

      setPreviewData(preview);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleAllocatePayment = async () => {
    if (!previewData || !selectedTx) return;
    setAllocating(true);
    setPreviewError('');
    try {
      const res = await fetch(`/api/billing/payments/${previewData.payment.id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: previewData.invoice.id,
          amount: previewData.suggested_allocation_amount,
          bank_transaction_id: selectedTx.id,
          allocation_source: 'bank_reconciliation',
          notes: 'Approved bank match allocation'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Allocation failed.');

      setAllocationSuccessData(data.allocation);
      setSuccessMsg('Payment allocated successfully!');
      setSelectedTx(null);
      setShowPreviewModal(false);
      fetchTransactions();
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setAllocating(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [statusFilter, providerFilter, page]);

  // Debounced search trigger
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchTransactions();
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchVal]);

  const fetchTransactions = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page,
        limit: 15,
        status: statusFilter,
        search: searchVal,
        provider: providerFilter
      });
      const res = await fetch(`/api/billing/bank-transactions?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch bank transactions.');
      
      setTransactions(data.transactions || []);
      setTotalPages(data.pagination?.pages || 1);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTx = async (tx) => {
    setSelectedTx(tx);
    setSuggestions([]);
    setShowManualSearch(false);
    setSearchQuery('');
    setManualCandidates([]);
    setError('');
    setSuccessMsg('');

    if (tx.direction === 'money_out') {
      return; // only money_in can be matched to invoices
    }

    setLoadingSuggestions(true);
    try {
      const res = await fetch(`/api/billing/bank-transactions/${tx.id}/suggestions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch suggestions.');
      setSuggestions(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleApproveMatch = async (invoiceId) => {
    if (!selectedTx) return;
    setSubmittingAction(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/billing/bank-transactions/${selectedTx.id}/approve-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve match.');

      setSuccessMsg('Transaction match approved successfully!');
      setSelectedTx(null);
      fetchTransactions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleIgnore = async () => {
    if (!selectedTx) return;
    setSubmittingAction(true);
    setError('');
    try {
      const res = await fetch(`/api/billing/bank-transactions/${selectedTx.id}/ignore`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to ignore transaction.');
      
      setSuccessMsg('Transaction marked as Ignored.');
      setSelectedTx(null);
      fetchTransactions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleMarkDuplicate = async () => {
    if (!selectedTx) return;
    setSubmittingAction(true);
    setError('');
    try {
      const res = await fetch(`/api/billing/bank-transactions/${selectedTx.id}/mark-duplicate`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mark as duplicate.');
      
      setSuccessMsg('Transaction marked as Duplicate.');
      setSelectedTx(null);
      fetchTransactions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleReturnToQueue = async () => {
    if (!selectedTx) return;
    setSubmittingAction(true);
    setError('');
    try {
      const res = await fetch(`/api/billing/bank-transactions/${selectedTx.id}/return-to-queue`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to return to queue.');
      
      setSuccessMsg('Transaction returned to unmatched queue.');
      setSelectedTx(null);
      fetchTransactions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleManualSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchingManual(true);
    setError('');
    try {
      const res = await fetch(`/api/billing/reconciliation/search-candidates?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Manual search failed.');
      setManualCandidates(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearchingManual(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { 
      style: 'currency', 
      currency: organization.billing_currency || 'KES', 
      maximumFractionDigits: 0 
    }).format(Number(val));
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Match Approved':
      case 'Ready for Allocation':
      case 'Matched':
      case 'Confirmed':
        return 'sl-status-success';
      case 'Possible Match':
        return 'sl-status-warning';
      case 'Needs Review':
        return 'sl-status-danger';
      case 'Duplicate':
        return 'sl-status-secondary';
      case 'Ignored':
        return 'sl-status-secondary';
      default:
        return 'sl-status-info';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* Metric summary boxes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        {[
          { label: 'Unmatched', value: summary.unmatched_count, filter: 'Unmatched', color: 'var(--info)' },
          { label: 'Possible Match', value: summary.unmatched_count, filter: 'Possible Match', color: 'var(--warning)' }, // Wait, possible matches are also in queue
          { label: 'Approved Matches', value: summary.matched_count, filter: 'Match Approved', color: 'var(--success)' },
          { label: 'Needs Review', value: summary.needs_review_count, filter: 'Needs Review', color: 'var(--danger)' },
          { label: 'Duplicate', value: summary.duplicate_count, filter: 'Duplicate', color: 'var(--text-muted)' },
          { label: 'Ignored', value: summary.ignored_count, filter: 'Ignored', color: 'var(--text-secondary)' }
        ].map((item, idx) => (
          <div 
            key={idx}
            className={`sl-metric-card ${statusFilter === item.filter ? 'active-metric' : ''}`}
            style={{ 
              padding: '10px', 
              borderRadius: '8px', 
              background: 'var(--bg-surface)', 
              border: statusFilter === item.filter ? '1.5px solid var(--primary)' : '1px solid var(--border)',
              cursor: 'pointer',
              textAlign: 'center',
              boxShadow: 'var(--shadow-sm)',
              transition: 'all 0.2s'
            }}
            onClick={() => { setStatusFilter(item.filter); setPage(1); setSelectedTx(null); }}
          >
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>
              {item.label}
            </div>
            <div style={{ fontSize: '20px', fontWeight: '800', marginTop: '4px', color: item.color }}>
              {statusFilter === item.filter && item.label === 'Possible Match' ? 
                transactions.filter(t => t.status === 'Possible Match').length : 
                item.value
              }
            </div>
          </div>
        ))}
      </div>

      {successMsg && (
        <div style={{ 
          background: 'var(--bg-surface-elevated)', 
          borderLeft: '4px solid var(--success)', 
          color: 'var(--success)', 
          padding: '12px', 
          borderRadius: '4px', 
          fontWeight: 'bold',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <CheckCircle2 size={16} /> {successMsg}
        </div>
      )}

      {error && (
        <div style={{ 
          background: 'var(--bg-surface-elevated)', 
          borderLeft: '4px solid var(--danger)', 
          color: 'var(--danger)', 
          padding: '12px', 
          borderRadius: '4px', 
          fontWeight: 'bold',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Split Queue Layout */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        
        {/* Left Side: Transactions Table */}
        <div style={{ flex: selectedTx ? '1 1 55%' : '1 1 100%', minWidth: '320px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          
          {/* Search and Filters Bar */}
          <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter size={14} /> Filters {showFilters ? '▲' : '▼'}
            </button>

            {showFilters && (
              <>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search by description or reference..."
                    className="form-control"
                    style={{ paddingLeft: '28px', height: '34px', fontSize: '12px', margin: 0 }}
                    value={searchVal}
                    onChange={e => setSearchVal(e.target.value)}
                  />
                </div>

                <select
                  className="form-control"
                  style={{ width: '130px', height: '34px', fontSize: '12px', margin: 0 }}
                  value={providerFilter}
                  onChange={e => setProviderFilter(e.target.value)}
                >
                  <option value="">All Banks</option>
                  <option value="MPesa">M-Pesa</option>
                  <option value="NCBA">Loop (NCBA)</option>
                  <option value="KCB">KCB</option>
                  <option value="Equity">Equity</option>
                  <option value="Absa">Absa</option>
                  <option value="Coop">Co-op Bank</option>
                  <option value="Family">Family Bank</option>
                  <option value="DTB">DTB</option>
                  <option value="I&M">I&M Bank</option>
                  <option value="Generic">Generic</option>
                </select>
              </>
            )}
          </div>

          {/* Transactions List */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px' }}>
                <Loader2 className="animate-spin" size={20} /> Loading queue...
              </div>
            ) : transactions.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No bank transactions found in "{statusFilter}" status.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', margin: 0 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Reference</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Narration</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr 
                        key={tx.id} 
                        style={{ 
                          borderBottom: '1px solid var(--border)',
                          background: selectedTx?.id === tx.id ? 'var(--bg-surface-elevated)' : 'none',
                          cursor: 'pointer'
                        }}
                        onClick={() => handleSelectTx(tx)}
                      >
                        <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                          {tx.transaction_date.split('T')[0]}
                        </td>
                        <td style={{ padding: '10px', fontWeight: 'bold' }}>
                          {tx.reference || '--'}
                        </td>
                        <td style={{ padding: '10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tx.description}
                        </td>
                        <td style={{ 
                          padding: '10px', 
                          textAlign: 'right', 
                          fontWeight: '700',
                          color: tx.direction === 'money_in' ? 'var(--success)' : 'var(--text-primary)'
                        }}>
                          {tx.direction === 'money_in' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Page {page} of {totalPages}
                </span>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Split Detail & suggestions Drawer */}
        {selectedTx && (
          <div style={{ flex: '1 1 40%', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            
            {/* Header / Dismiss */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface-elevated)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                  Reviewing Transaction
                </span>
                <div style={{ fontSize: '14px', fontWeight: 'bold', fontFamily: 'var(--font-title)' }}>
                  {selectedTx.reference || 'No Ref'}
                </div>
              </div>
              <button 
                type="button" 
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                onClick={() => setSelectedTx(null)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Original transaction details */}
            <div className="card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Statement Record</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Date:</span>
                  <span style={{ fontWeight: '600' }}>{selectedTx.transaction_date.split('T')[0]}</span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Provider:</span>
                  <span className="sl-status-badge sl-status-info" style={{ textTransform: 'uppercase' }}>
                    {selectedTx.source_provider || 'Generic'}
                  </span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Amount:</span>
                  <span style={{ fontWeight: '700', color: selectedTx.direction === 'money_in' ? 'var(--success)' : 'var(--text-primary)' }}>
                    {formatCurrency(selectedTx.amount)}
                  </span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                  <span className={`sl-status-badge ${getStatusBadgeClass(selectedTx.status)}`}>
                    {selectedTx.status}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Description:</span>
                  <p style={{ margin: 0, fontWeight: '500', lineHeight: '1.4', background: 'var(--bg-surface-elevated)', padding: '6px', borderRadius: '4px' }}>
                    {selectedTx.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Suggestions Engine */}
            {selectedTx.direction === 'money_out' ? (
              <div className="card" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', borderLeft: '4px solid var(--border)' }}>
                Money out transactions cannot be matched to invoice payments. You can only Mark Duplicate or Ignore.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 'bold' }}>
                    Intelligent Match Suggestions
                  </h4>
                  <button 
                    type="button" 
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '10px', height: '24px', padding: '0 6px', display: 'flex', gap: '4px', alignItems: 'center' }}
                    onClick={() => { setShowManualSearch(!showManualSearch); setManualCandidates([]); }}
                  >
                    <FileSearch size={12} /> {showManualSearch ? 'Suggestions' : 'Search Invoices'}
                  </button>
                </div>

                {showManualSearch ? (
                  /* Manual Search Panel */
                  <div className="card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <form onSubmit={handleManualSearch} style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder="Search name, invoice #, property..."
                        className="form-control"
                        style={{ height: '30px', fontSize: '11px', margin: 0 }}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                      />
                      <button 
                        type="submit" 
                        className="btn btn-primary btn-sm"
                        style={{ height: '30px', padding: '0 10px' }}
                        disabled={searchingManual}
                      >
                        {searchingManual ? <Loader2 className="animate-spin" size={12} /> : 'Search'}
                      </button>
                    </form>

                    {manualCandidates.length === 0 ? (
                      <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', margin: '10px 0' }}>
                        Enter query to find candidate invoices manually.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                        {manualCandidates.map((candidate, idx) => (
                          <div 
                            key={idx} 
                            style={{ 
                              padding: '8px', 
                              border: '1px solid var(--border)', 
                              borderRadius: '6px',
                              background: 'var(--bg-surface)',
                              fontSize: '11px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                              <span>{candidate.tenant_name}</span>
                              <span style={{ color: 'var(--primary)' }}>{candidate.invoice_number}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                              <span>Unit: {candidate.unit_label}</span>
                              <span>Bal: {formatCurrency(candidate.invoice_balance)}</span>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ width: '100%', height: '24px', fontSize: '10px', marginTop: '4px' }}
                              disabled={submittingAction}
                              onClick={() => handleApproveMatch(candidate.invoiceId)}
                            >
                              Approve Manual Match
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Auto Suggestions List */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {loadingSuggestions ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', gap: '8px', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <Loader2 className="animate-spin" size={14} /> Finding matches...
                      </div>
                    ) : suggestions.length === 0 ? (
                      <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No matching invoices found. Use "Search Invoices" to look up manually.
                      </div>
                    ) : (
                      suggestions.map((sug, idx) => (
                        <div 
                          key={idx}
                          className="card"
                          style={{ 
                            padding: '12px',
                            borderLeft: sug.score >= 80 ? '4px solid var(--success)' : '4px solid var(--warning)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{sug.tenant_name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                Invoice No: <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{sug.invoice_number}</span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span 
                                className={`sl-status-badge ${sug.score >= 80 ? 'sl-status-success' : 'sl-status-warning'}`}
                                style={{ fontSize: '10px', fontWeight: 'bold' }}
                              >
                                {sug.score}% Score
                              </span>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                Bal: {formatCurrency(sug.invoice_balance)}
                              </div>
                            </div>
                          </div>

                          {/* Explanatory reasoning checklist */}
                          <div style={{ background: 'var(--bg-surface-elevated)', padding: '6px', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {sug.reasons.map((reason, rIdx) => (
                              <div key={rIdx} style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Check size={10} style={{ color: 'var(--success)' }} /> {reason}
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            style={{ height: '28px', fontSize: '11px' }}
                            disabled={submittingAction}
                            onClick={() => handleApproveMatch(sug.invoiceId)}
                          >
                            {submittingAction ? <Loader2 className="animate-spin" size={12} /> : 'Approve Match'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* General Actions panel */}
            <div className="card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Operations</h4>
              
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {selectedTx.status === 'Unmatched' || selectedTx.status === 'Possible Match' || selectedTx.status === 'Needs Review' ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, height: '28px', fontSize: '11px', border: '1px solid var(--border)' }}
                      disabled={submittingAction}
                      onClick={handleIgnore}
                    >
                      Ignore Transaction
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, height: '28px', fontSize: '11px', border: '1px solid var(--border)' }}
                      disabled={submittingAction}
                      onClick={handleMarkDuplicate}
                    >
                      Mark Duplicate
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    {(selectedTx.status === 'Match Approved' || selectedTx.status === 'Ready for Allocation') && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ width: '100%', height: '32px', fontSize: '12px', fontWeight: 'bold' }}
                        onClick={handleOpenPreviewModal}
                      >
                        Preview Allocation
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ width: '100%', height: '28px', fontSize: '11px', border: '1px solid var(--border)' }}
                      disabled={submittingAction}
                      onClick={handleReturnToQueue}
                    >
                      Return to Unmatched Queue
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </div>

      {/* Allocation Preview Modal */}
      {showPreviewModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '540px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            maxHeight: '90vh'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)'
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', fontFamily: 'var(--font-title)' }}>
                Preview Allocation Details
              </h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                onClick={() => setShowPreviewModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {loadingPreview ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '12px' }}>
                  <Loader2 className="animate-spin" size={24} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading allocation preview...</span>
                </div>
              ) : previewError ? (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--error)',
                  color: 'var(--error)',
                  padding: '12px',
                  borderRadius: '6px',
                  fontSize: '13px'
                }}>
                  {previewError}
                </div>
              ) : previewData ? (
                <>
                  {/* Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Payment Source</span>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '2px' }}>
                        {previewData.payment?.payer_name || 'Unknown Tenant'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Status: <span style={{ textTransform: 'uppercase', fontWeight: 'bold', color: 'var(--success)' }}>{previewData.payment?.status}</span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '700', marginTop: '4px', color: 'var(--success)' }}>
                        {formatCurrency(previewData.payment_available_amount)} Available
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Target Invoice</span>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '2px', color: 'var(--primary)' }}>
                        {previewData.invoice?.invoice_number}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Status: <span style={{ textTransform: 'uppercase', fontWeight: 'bold' }}>{previewData.invoice?.status}</span>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '700', marginTop: '4px' }}>
                        {formatCurrency(previewData.invoice_outstanding_balance)} Balance
                      </div>
                    </div>
                  </div>

                  {/* Allocation Math */}
                  <div style={{
                    background: 'var(--bg-surface)',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '12px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Bank Transaction Amount:</span>
                      <span style={{ fontWeight: '600' }}>{formatCurrency(selectedTx.amount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Amount to Allocate:</span>
                      <span style={{ fontWeight: '700', color: 'var(--primary)' }}>{formatCurrency(previewData.suggested_allocation_amount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <span style={{ color: 'var(--text-primary)' }}>New Invoice Balance:</span>
                      <span style={{ color: previewData.new_invoice_balance === 0 ? 'var(--success)' : 'var(--text-primary)' }}>
                        {formatCurrency(previewData.new_invoice_balance)}
                      </span>
                    </div>
                  </div>

                  {/* Warnings & Errors */}
                  {previewData.warnings && previewData.warnings.length > 0 && (
                    <div style={{
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid var(--warning)',
                      color: 'var(--warning)',
                      padding: '10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      {previewData.warnings.map((warn, wIdx) => (
                        <div key={wIdx}>⚠️ {warn}</div>
                      ))}
                    </div>
                  )}

                  {/* Eligibility Checks Checklist */}
                  <div>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Eligibility Validation Checks
                    </h4>
                    <div style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontSize: '11px'
                    }}>
                      {Object.entries(previewData.eligibility?.checks || {}).map(([key, passed]) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {key === 'paymentExists' && 'Payment record exists'}
                            {key === 'paymentVerifiedOrCaptured' && 'Payment is captured or verified'}
                            {key === 'paymentHasAvailableBalance' && 'Payment has available balance'}
                            {key === 'invoiceExists' && 'Invoice record exists'}
                            {key === 'sameOrganization' && 'Belongs to same organization'}
                            {key === 'invoiceAllocatable' && 'Invoice is allocatable (not void/paid)'}
                            {key === 'decisionValid' && 'Matching decision is valid and pending'}
                            {key === 'notAlreadyAllocated' && 'Not already allocated to this invoice'}
                            {key === 'sourceHashUnused' && 'Source transaction hash is unused'}
                          </span>
                          <span style={{
                            fontWeight: 'bold',
                            color: passed ? 'var(--success)' : 'var(--error)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px'
                          }}>
                            {passed ? 'Passed' : 'Failed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rejection / Reasons */}
                  {!previewData.eligibility?.eligible && previewData.eligibility?.reasons?.length > 0 && (
                    <div style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid var(--error)',
                      color: 'var(--error)',
                      padding: '10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      <div style={{ fontWeight: 'bold' }}>Reconciliation Blocked:</div>
                      {previewData.eligibility.reasons.map((reason, rIdx) => (
                        <div key={rIdx}>• {reason}</div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '32px', fontSize: '12px', border: '1px solid var(--border)' }}
                onClick={() => setShowPreviewModal(false)}
              >
                Cancel
              </button>
              {previewData && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ height: '32px', fontSize: '12px', fontWeight: 'bold' }}
                  disabled={!previewData.eligibility?.eligible || allocating}
                  onClick={handleAllocatePayment}
                >
                  {allocating ? <Loader2 className="animate-spin" size={14} /> : 'Allocate Payment'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
