import React, { useState, useEffect } from 'react';
import { Upload, Eye, Trash2, CheckCircle2, AlertTriangle, Info, Clock, Check, FileSpreadsheet, FileText, ChevronRight, X } from 'lucide-react';

export default function StatementImports({ organization }) {
  const [uploads, setUploads] = useState([]);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    fetchUploads();
  }, [organization]);

  const fetchUploads = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/billing/statement-uploads');
      if (!res.ok) throw new Error('Failed to fetch upload history.');
      const data = await res.json();
      setUploads(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUploadDetails = async (id) => {
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/billing/statement-uploads/${id}`);
      if (!res.ok) throw new Error('Failed to fetch statement details.');
      const data = await res.json();
      setSelectedUpload(data);
      setIncludeDuplicates(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    setSuccessMsg('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/billing/statement-uploads', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed.');
      }

      setSuccessMsg(data.message || 'File uploaded successfully.');
      fetchUploads();
      if (data.upload_id) {
        fetchUploadDetails(data.upload_id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedUpload) return;
    setConfirming(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`/api/billing/statement-uploads/${selectedUpload.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_duplicates: includeDuplicates })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Confirmation failed.');
      }

      setSuccessMsg(`Imported ${data.imported_count} rows successfully. Skipped ${data.skipped_duplicate_count} duplicates and ${data.skipped_invalid_count} invalid rows.`);
      setSelectedUpload(null);
      fetchUploads();
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  };

  const handleDeleteUpload = async (id) => {
    if (!window.confirm('Are you sure you want to reject and delete this statement upload? All extracted preview rows will be permanently deleted.')) {
      return;
    }
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`/api/billing/statement-uploads/${id}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete upload.');
      }

      setSuccessMsg('Statement upload rejected and deleted.');
      if (selectedUpload && selectedUpload.id === id) {
        setSelectedUpload(null);
      }
      fetchUploads();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusBadge = (status) => {
    const styles = {
      uploaded: { bg: '#eef2f6', color: '#4b5563', label: 'Uploaded' },
      parsing: { bg: '#eff6ff', color: '#2563eb', label: 'Parsing' },
      parsed: { bg: '#f0fdf4', color: '#16a34a', label: 'Parsed' },
      needs_review: { bg: '#fffbeb', color: '#d97706', label: 'Needs Review' },
      confirmed: { bg: '#ecfdf5', color: '#059669', label: 'Confirmed' },
      failed: { bg: '#fef2f2', color: '#dc2626', label: 'Failed' }
    };
    const s = styles[status] || { bg: '#f3f4f6', color: '#374151', label: status };
    return (
      <span style={{
        backgroundColor: s.bg,
        color: s.color,
        padding: '3px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: '600',
        textTransform: 'capitalize'
      }}>
        {s.label}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* File Upload Area */}
      <div 
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        style={{
          border: dragActive ? '2px dashed var(--primary)' : '2px dashed var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '32px 16px',
          textAlign: 'center',
          backgroundColor: dragActive ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
          transition: 'all 0.2s',
          position: 'relative'
        }}
      >
        <input 
          type="file" 
          accept=".csv,.pdf,.xlsx"
          onChange={(e) => handleFileUpload(e.target.files[0])}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'pointer'
          }}
          disabled={uploading}
        />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <Upload size={36} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: '600', fontSize: '14px' }}>
            {uploading ? 'Processing Statement...' : 'Upload Bank Statement'}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Drag and drop or click to upload CSV, PDF, or XLSX (Max 5MB)
          </span>
        </div>
      </div>

      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px',
          backgroundColor: '#fef2f2',
          borderLeft: '4px solid #dc2626',
          borderRadius: '4px',
          color: '#b91c1c',
          fontSize: '13px'
        }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px',
          backgroundColor: '#f0fdf4',
          borderLeft: '4px solid #16a34a',
          borderRadius: '4px',
          color: '#15803d',
          fontSize: '13px'
        }}>
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Selected Upload Detail/Preview Panel */}
      {selectedUpload && (
        <div style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {selectedUpload.file_type === 'CSV' ? <FileText size={20} /> : <FileSpreadsheet size={20} />}
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{selectedUpload.file_name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Detected Provider: <strong>{selectedUpload.provider_guess}</strong> &bull; Engine: {selectedUpload.parse_engine}
                </div>
              </div>
            </div>
            <button 
              type="button" 
              onClick={() => setSelectedUpload(null)} 
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              <X size={20} />
            </button>
          </div>

          {selectedUpload.status === 'failed' && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '16px',
              backgroundColor: '#fef2f2',
              borderLeft: '4px solid #dc2626',
              borderRadius: '4px',
              color: '#b91c1c',
              fontSize: '13px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                <AlertTriangle size={18} />
                <span>Statement Ingestion Failed</span>
              </div>
              <p style={{ margin: 0 }}>
                Error details: {selectedUpload.error_message || 'An unknown error occurred during statement processing.'}
              </p>
              {selectedUpload.file_type === 'PDF' && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  backgroundColor: '#fee2e2',
                  border: '1px solid #fca5a5',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#991b1b',
                  fontWeight: '500'
                }}>
                  <strong>Notice for PDF statements:</strong> If this file is scanned or does not contain a text layer, text extraction requires OCR (Optical Character Recognition) which is not enabled. Please upload a structured electronic PDF or a CSV file instead.
                </div>
              )}
            </div>
          )}

          {/* Metric Summary Counters */}
          {selectedUpload.parse_summary_json && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '10px'
            }}>
              {[
                { label: 'Rows Detected', val: selectedUpload.parse_summary_json.rows_detected, bg: '#f8fafc', color: '#475569' },
                { label: 'Ready', val: selectedUpload.parse_summary_json.rows_ready_for_review, bg: '#f0fdf4', color: '#16a34a' },
                { label: 'Attention', val: selectedUpload.parse_summary_json.rows_needing_attention, bg: '#fffbeb', color: '#d97706' },
                { label: 'Duplicates', val: selectedUpload.parse_summary_json.rows_duplicates, bg: '#fef2f2', color: '#dc2626' },
                { label: 'Unreadable', val: selectedUpload.parse_summary_json.rows_unreadable, bg: '#f1f5f9', color: '#64748b' }
              ].map((c, i) => (
                <div key={i} style={{ backgroundColor: c.bg, padding: '10px', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>{c.label}</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: c.color }}>{c.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Confirmation & Skip Duplicates Area */}
          {selectedUpload.status !== 'confirmed' && selectedUpload.status !== 'failed' && (
            <div style={{
              backgroundColor: '#eff6ff',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input 
                  type="checkbox" 
                  id="include_duplicates"
                  checked={includeDuplicates}
                  onChange={(e) => setIncludeDuplicates(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="include_duplicates" style={{ fontSize: '12px', color: '#1e40af', cursor: 'pointer', fontWeight: '500' }}>
                  Include duplicate candidate rows (default: skip)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleDeleteUpload(selectedUpload.id)}
                  style={{
                    backgroundColor: 'white',
                    color: '#dc2626',
                    border: '1px solid #fca5a5',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Trash2 size={14} /> Reject
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={confirming}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Check size={14} /> Confirm Import
                </button>
              </div>
            </div>
          )}

          {/* Extracted Rows Table */}
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '600px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-surface-hover)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>#</th>
                  <th style={{ padding: '8px 12px' }}>Date</th>
                  <th style={{ padding: '8px 12px' }}>Reference</th>
                  <th style={{ padding: '8px 12px' }}>Description</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Debit</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Credit</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedUpload.extracted_rows && selectedUpload.extracted_rows.length > 0 ? (
                  selectedUpload.extracted_rows.map((row, i) => {
                    const isDup = row.duplicate_candidate;
                    const flags = row.validation_flags_json || [];
                    const isInvalid = flags.includes('invalid_both_debit_credit') || 
                                      flags.includes('incomplete_no_amount') ||
                                      flags.includes('missing_date');
                    let rowBg = 'white';
                    if (isInvalid) rowBg = '#fef2f2';
                    else if (isDup) rowBg = '#fffbeb';

                    return (
                      <tr key={i} style={{ backgroundColor: rowBg, borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{row.row_index}</td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{row.transaction_date}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{row.reference || '-'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <div>{row.description}</div>
                          {flags.map((f, fi) => (
                            <span key={fi} style={{
                              display: 'inline-block',
                              backgroundColor: '#fee2e2',
                              color: '#991b1b',
                              fontSize: '9px',
                              padding: '1px 4px',
                              borderRadius: '2px',
                              marginRight: '4px',
                              marginTop: '2px',
                              fontWeight: '600'
                            }}>
                              {f.replace('_', ' ')}
                            </span>
                          ))}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#dc2626' }}>
                          {row.debit_amount ? parseFloat(row.debit_amount).toFixed(2) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#16a34a' }}>
                          {row.credit_amount ? parseFloat(row.credit_amount).toFixed(2) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {isInvalid ? (
                            <span style={{ color: '#dc2626', fontWeight: 'bold' }}>Invalid</span>
                          ) : isDup ? (
                            <span style={{ color: '#d97706', fontWeight: 'bold' }}>Duplicate</span>
                          ) : (
                            <span style={{ color: '#16a34a', fontWeight: 'bold' }}>Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="7" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No transactions extracted yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upload History Section */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontFamily: 'var(--font-title)' }}>Statement Processing History</h3>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>Loading history...</div>
        ) : uploads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            No statements uploaded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {uploads.map((upload) => (
              <div 
                key={upload.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: selectedUpload && selectedUpload.id === upload.id ? 'var(--bg-surface-hover)' : 'transparent',
                  transition: 'background-color 0.2s'
                }}
              >
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#eff6ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--primary)'
                  }}>
                    {upload.file_type === 'PDF' ? <FileText size={16} /> : <FileSpreadsheet size={16} />}
                  </div>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '13px' }}>{upload.file_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Size: {formatSize(upload.file_size)} &bull; Guess: {upload.provider_guess}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {getStatusBadge(upload.status)}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => fetchUploadDetails(upload.id)}
                      title="Preview Statement Details"
                      style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        padding: '6px',
                        color: 'var(--text-secondary)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Eye size={16} />
                    </button>
                    {upload.status !== 'confirmed' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUpload(upload.id)}
                        title="Delete Upload"
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '6px',
                          color: '#dc2626',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
