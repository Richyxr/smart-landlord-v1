import React, { useState, useEffect } from 'react';
import SecurityPinModal from '../components/SecurityPinModal.jsx';

export default function Invoices({ organization, refreshTrigger, onRefresh }) {
  const [invoices, setInvoices] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // View States
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null); // Full detail for invoice
  const [printInvoice, setPrintInvoice] = useState(null); // Print-ready overlay
  const [reminderResult, setReminderResult] = useState(null); // Reminder sent confirmation
  const [reminderTarget, setReminderTarget] = useState(null); // { invoiceId, selectedChannel } for picker modal

  // PIN modal triggers
  const [pinTargetId, setPinTargetId] = useState(null);

  // Form State
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [invoiceType, setInvoiceType] = useState('rent');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 5*24*60*60*1000).toISOString().split('T')[0]); // +5 days
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ description: 'Monthly Rent', item_type: 'rent', quantity: 1, unit_price: '' }]);

  const headers = {};

  useEffect(() => {
    fetchInvoices();
  }, [refreshTrigger]);

  const fetchInvoices = async () => {
    setLoading(true);
    setError('');
    try {
      const [resInvs, resTenants] = await Promise.all([
        fetch('/api/invoices', { headers }),
        fetch('/api/tenants', { headers })
      ]);
      setInvoices(await resInvs.json());
      setTenants(await resTenants.json());
    } catch (e) {
      setError('Failed to fetch invoices.');
    } finally {
      setLoading(false);
    }
  };

  const handleTenantChange = (tenantId) => {
    setSelectedTenantId(tenantId);
    const tenant = tenants.find(t => t.id === parseInt(tenantId));
    if (tenant) {
      // Auto fill first item with rent amount
      const updated = [...items];
      updated[0] = {
        description: `Rent - Unit ${tenant.unit_code}`,
        item_type: 'rent',
        quantity: 1,
        unit_price: tenant.rent_amount.toString()
      };
      setItems(updated);
    }
  };

  const handleAddItemRow = () => {
    setItems([...items, { description: '', item_type: 'other', quantity: 1, unit_price: '' }]);
  };

  const handleRemoveItemRow = (idx) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx, field, value) => {
    const updated = [...items];
    updated[idx][field] = value;
    setItems(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!selectedTenantId) {
      setError('Please select a tenant.');
      setLoading(false);
      return;
    }
    if (new Date(issueDate) > new Date(dueDate)) {
      setError('Issue date cannot be later than due date.');
      setLoading(false);
      return;
    }
    if (items.length === 0) {
      setError('At least one bill item is required.');
      setLoading(false);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.description.trim()) {
        setError(`Item #${i + 1} description is required.`);
        setLoading(false);
        return;
      }
      const price = parseFloat(it.unit_price);
      if (isNaN(price) || price <= 0) {
        setError(`Item "${it.description || '#' + (i + 1)}" must have a positive price.`);
        setLoading(false);
        return;
      }
    }

    // Format items
    const formattedItems = items.map(it => ({
      ...it,
      quantity: parseInt(it.quantity) || 1,
      unit_price: parseFloat(it.unit_price) || 0
    }));

    const body = {
      tenant_id: selectedTenantId,
      invoice_type: invoiceType,
      issue_date: issueDate,
      due_date: dueDate,
      notes,
      items: formattedItems
    };

    const url = editId ? `/api/invoices/${editId}` : '/api/invoices';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save invoice.');
      }

      setShowAddForm(false);
      setEditId(null);
      resetForm();
      fetchInvoices();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleIssueInvoice = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${id}/issue`, { method: 'POST', headers });
      if (!res.ok) throw new Error('Issue invoice failed.');
      fetchInvoices();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVoidInvoice = async () => {
    setLoading(true);
    try {
      // Trigger API voiding (PIN is validated inside modal, now we call match/void)
      const res = await fetch(`/api/invoices/${pinTargetId}/void`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '123456' }) // Simple mockup bypass or we can let model pass it. Wait, verify-pin takes it, then server checks it. Here we need the actual PIN entered.
        // Wait, how do we get the pin? In React we can prompt PIN inside modal, and upon success trigger this callback. Let's make sure the callback handles it!
      });
      
      // Since PIN is verified in modal first, we can request voiding directly without double-check, but server requires PIN again for ledger logging.
      // So we can capture the PIN in modal and pass it in! Let's adapt our function signature.
    } catch (e) {
      console.error(e);
    }
  };

  // Safe voiding with captured PIN from modal
  const handlePinSuccess = async (enteredPin) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${pinTargetId}/void`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to void invoice.');
      
      setPinTargetId(null);
      fetchInvoices();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedTenantId('');
    setInvoiceType('rent');
    setNotes('');
    setItems([{ description: 'Monthly Rent', item_type: 'rent', quantity: 1, unit_price: '' }]);
  };

  const handleViewDetails = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${id}`, { headers });
      const data = await res.json();
      setViewInvoice(data);
    } catch (e) {
      setError('Failed to fetch invoice details.');
    } finally {
      setLoading(false);
    }
  };

  const openReminderModal = (invoiceId) => {
    setReminderTarget({ invoiceId, selectedChannel: 'sms' });
    setError('');
  };

  const confirmSendReminder = async () => {
    if (!reminderTarget) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/invoices/${reminderTarget.invoiceId}/send-reminder`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: reminderTarget.selectedChannel })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reminder.');
      setReminderTarget(null);
      setReminderResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: organization.billing_currency || 'KES', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      
      {/* SECURITY PIN MODAL */}
      {pinTargetId && (
        <SecurityPinModal
          isOpen={!!pinTargetId}
          onClose={() => setPinTargetId(null)}
          organizationId={organization.id}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* REMINDER CHANNEL PICKER MODAL */}
      {reminderTarget && (
        <div className="modal-backdrop">
          <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '24px', width: '92%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>🔔</div>
              <div>
                <h3 style={{ fontWeight: '700', fontSize: '16px', margin: 0 }}>Send Payment Reminder</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Choose how to reach the tenant</p>
              </div>
            </div>

            {/* CHANNEL SELECTOR */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: 'sms',       label: 'SMS',       icon: '📱', desc: 'Text message to tenant\'s phone number',    color: '#10b981' },
                { key: 'email',     label: 'Email',     icon: '✉️',  desc: 'Send to tenant\'s registered email address', color: '#3b82f6' },
                { key: 'whatsapp',  label: 'WhatsApp',  icon: '💬',  desc: 'WhatsApp message via linked number',         color: '#25d366' }
              ].map(ch => (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => setReminderTarget(p => ({ ...p, selectedChannel: ch.key }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '14px', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${reminderTarget.selectedChannel === ch.key ? ch.color : 'var(--border)'}`,
                    background: reminderTarget.selectedChannel === ch.key ? `${ch.color}18` : 'var(--bg-surface-elevated)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '26px', lineHeight: 1, flexShrink: 0 }}>{ch.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: reminderTarget.selectedChannel === ch.key ? ch.color : 'var(--text-primary)' }}>{ch.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{ch.desc}</div>
                  </div>
                  <div style={{
                    width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${reminderTarget.selectedChannel === ch.key ? ch.color : 'var(--border)'}`,
                    background: reminderTarget.selectedChannel === ch.key ? ch.color : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {reminderTarget.selectedChannel === ch.key && <span style={{ color: '#fff', fontSize: '10px', fontWeight: 'bold' }}>✓</span>}
                  </div>
                </button>
              ))}
            </div>

            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '12px' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setReminderTarget(null); setError(''); }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2, background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none' }}
                onClick={confirmSendReminder}
                disabled={loading}
              >
                {loading ? 'Sending...' : `🔔 Send via ${reminderTarget.selectedChannel === 'sms' ? 'SMS' : reminderTarget.selectedChannel === 'email' ? 'Email' : 'WhatsApp'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REMINDER SENT CONFIRMATION OVERLAY */}
      {reminderResult && (
        <div className="modal-backdrop">
          <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '24px', width: '92%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>✅</div>
              <div>
                <h3 style={{ fontWeight: '700', fontSize: '16px', margin: 0 }}>Reminder Sent!</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                  {reminderResult.channel === 'sms' && '📱 SMS'}
                  {reminderResult.channel === 'email' && '✉️ Email'}
                  {reminderResult.channel === 'whatsapp' && '💬 WhatsApp'}
                  {' '}dispatched to <strong>{reminderResult.tenant_name}</strong>
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {reminderResult.channel === 'sms' && '📱 Message Preview'}
                {reminderResult.channel === 'email' && '✉️ Email Body Preview'}
                {reminderResult.channel === 'whatsapp' && '💬 WhatsApp Message Preview'}
              </div>
              <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0, color: 'var(--text-primary)' }}>
                {reminderResult.message}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>
                {reminderResult.channel === 'sms' && `📞 ${reminderResult.phone}`}
                {reminderResult.channel === 'email' && `📧 ${reminderResult.email || reminderResult.phone}`}
                {reminderResult.channel === 'whatsapp' && `💬 ${reminderResult.phone}`}
              </span>
              <span>•</span>
              <span>🕐 {new Date(reminderResult.sent_at).toLocaleTimeString()}</span>
            </div>

            <button className="btn btn-primary" style={{ marginTop: '4px' }} onClick={() => setReminderResult(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {/* RENDER DRAFT FORM */}
      {showAddForm && (
        <div className="card">
          <h3 className="card-title">{editId ? 'Edit' : 'Create'} Invoice</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Select Tenant</label>
              <select
                required
                className="form-control"
                value={selectedTenantId}
                onChange={e => handleTenantChange(e.target.value)}
                disabled={!!editId}
              >
                <option value="">-- Choose Occupied Tenant --</option>
                {tenants.filter(t => t.status === 'active').map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} ({t.unit_code} - Account: {t.tenant_account_number})</option>
                ))}
              </select>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Invoice Category</label>
                <select className="form-control" value={invoiceType} onChange={e => setInvoiceType(e.target.value)}>
                  <option value="rent">Rent Bill</option>
                  <option value="utility">Utility (Water/Power)</option>
                  <option value="deposit">Deposit Charge</option>
                  <option value="penalty">Penalty Fee</option>
                  <option value="other">Other Charge</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Issue Date</label>
                <input type="date" required className="form-control" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input type="date" required className="form-control" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
            <div className="flex-row" style={{ marginBottom: '8px' }}>
              <span className="form-label">Bill Line Items</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddItemRow}>＋ Add Item</button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="card" style={{ padding: '10px', backgroundColor: 'var(--bg-surface-elevated)', marginBottom: '8px' }}>
                <div className="form-group" style={{ marginBottom: '8px' }}>
                  <input
                    type="text"
                    required
                    placeholder="Description (e.g. June Rent)"
                    className="form-control"
                    value={item.description}
                    onChange={e => handleItemChange(idx, 'description', e.target.value)}
                  />
                </div>
                <div className="grid-2">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <select
                      className="form-control"
                      value={item.item_type}
                      onChange={e => handleItemChange(idx, 'item_type', e.target.value)}
                    >
                      <option value="rent">Rent</option>
                      <option value="water">Water</option>
                      <option value="electricity">Electricity</option>
                      <option value="deposit">Deposit</option>
                      <option value="penalty">Penalty</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <input
                      type="number"
                      required
                      placeholder="Amount"
                      className="form-control"
                      value={item.unit_price}
                      onChange={e => handleItemChange(idx, 'unit_price', e.target.value)}
                    />
                  </div>
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    style={{ marginTop: '8px', padding: '4px 8px', fontSize: '10px' }}
                    onClick={() => handleRemoveItemRow(idx)}
                  >
                    Remove Item
                  </button>
                )}
              </div>
            ))}

            <div className="form-group">
              <label className="form-label">Notes for Invoice</label>
              <input type="text" className="form-control" placeholder="Optional notes visible to tenant..." value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <div className="flex-gap" style={{ marginTop: '16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowAddForm(false); setEditId(null); resetForm(); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save Draft'}</button>
            </div>
          </form>
        </div>
      )}

      {/* QUICK ADD TRIGGER */}
      {!showAddForm && !viewInvoice && !printInvoice && (
        <button className="btn btn-primary" style={{ marginBottom: '16px' }} onClick={() => { setShowAddForm(true); setEditId(null); resetForm(); }}>
          ➕ Create New Invoice
        </button>
      )}

      {/* INVOICE LIST */}
      {!showAddForm && !viewInvoice && !printInvoice && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {invoices.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px' }}>No invoices found.</p>
          ) : (
            invoices.map(inv => (
              <div key={inv.id} className="card">
                <div className="flex-row">
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{inv.invoice_number}</span>
                  <span className={`badge ${
                    inv.status === 'paid' ? 'badge-success' :
                    inv.status === 'overdue' ? 'badge-danger' :
                    inv.status === 'draft' ? 'badge-info' : 'badge-warning'
                  }`}>{inv.status}</span>
                </div>
                <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>{inv.tenant_name} ({inv.unit_code})</h3>
                <p style={{ fontSize: '12px' }}>Category: <strong>{inv.invoice_type.toUpperCase()}</strong> • Due: {inv.due_date}</p>
                
                <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                <div className="flex-row" style={{ fontSize: '13px' }}>
                  <span>Total: <strong>{formatCurrency(inv.total)}</strong></span>
                  <span style={{ color: 'var(--danger)' }}>Balance: <strong>{formatCurrency(inv.balance)}</strong></span>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: '12px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleViewDetails(inv.id)}>View</button>
                  {inv.status === 'draft' && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => {
                        setEditId(inv.id);
                        setSelectedTenantId(inv.tenant_id);
                        setInvoiceType(inv.invoice_type);
                        setIssueDate(inv.issue_date);
                        setDueDate(inv.due_date);
                        setNotes(inv.notes || '');
                        // Load items via detail fetch
                        fetch(`/api/invoices/${inv.id}`, { headers })
                          .then(r => r.json())
                          .then(data => {
                            setItems(data.items.map(it => ({
                              description: it.description,
                              item_type: it.item_type,
                              quantity: it.quantity,
                              unit_price: it.unit_price.toString()
                            })));
                            setShowAddForm(true);
                          });
                      }}>Edit</button>
                      <button className="btn btn-primary btn-sm" onClick={() => handleIssueInvoice(inv.id)}>Issue</button>
                    </>
                  )}
                  {(inv.status === 'issued' || inv.status === 'overdue') && (
                    <button
                      className="btn btn-sm"
                      style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', padding: '5px 10px', fontWeight: '600' }}
                      onClick={() => openReminderModal(inv.id)}
                      disabled={loading}
                    >
                      🔔 Remind
                    </button>
                  )}
                  {inv.status === 'issued' && (
                    <button className="btn btn-danger btn-sm" onClick={() => setPinTargetId(inv.id)}>Void</button>
                  )}
                  {inv.status !== 'draft' && inv.status !== 'void' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setPrintInvoice(inv)}>Print</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEW SINGLE INVOICE DETAILS */}
      {viewInvoice && (
        <div className="card">
          <div className="flex-row" style={{ marginBottom: '14px' }}>
            <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '18px' }}>Invoice Info</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewInvoice(null)}>Back to List</button>
          </div>

          <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>Number: <strong>{viewInvoice.invoice_number}</strong></div>
            <div>Status: <span className="badge badge-success" style={{ fontSize: '10px' }}>{viewInvoice.status}</span></div>
            <div>Tenant: <strong>{viewInvoice.tenant?.full_name}</strong></div>
            <div>Property: {viewInvoice.property?.name} ({viewInvoice.unit?.unit_code})</div>
            <div>Issue Date: {viewInvoice.issue_date}</div>
            <div>Due Date: {viewInvoice.due_date}</div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
          <p className="form-label" style={{ marginBottom: '8px' }}>Line Items</p>
          {viewInvoice.items?.map((item, idx) => (
            <div key={idx} className="flex-row" style={{ fontSize: '13px', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{item.description}</span>
              <span><strong>{formatCurrency(item.total)}</strong></span>
            </div>
          ))}

          <div className="flex-row" style={{ fontSize: '14px', marginTop: '12px', fontWeight: 'bold' }}>
            <span>Subtotal:</span>
            <span>{formatCurrency(viewInvoice.subtotal)}</span>
          </div>
          <div className="flex-row" style={{ fontSize: '14px', color: 'var(--success)' }}>
            <span>Amount Paid:</span>
            <span>{formatCurrency(viewInvoice.amount_paid)}</span>
          </div>
          <div className="flex-row" style={{ fontSize: '16px', color: 'var(--danger)', fontWeight: '800' }}>
            <span>Outstanding Balance:</span>
            <span>{formatCurrency(viewInvoice.balance)}</span>
          </div>

          {viewInvoice.notes && (
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '16px' }}>Notes: {viewInvoice.notes}</p>
          )}

          {(viewInvoice.status === 'issued' || viewInvoice.status === 'overdue') && (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '14px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPrintInvoice(viewInvoice)}>🖨️ Print</button>
              <button
                className="btn btn-sm"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '6px 14px', fontWeight: '600' }}
                onClick={() => openReminderModal(viewInvoice.id)}
                disabled={loading}
              >
                🔔 Send Payment Reminder
              </button>
            </div>
          )}
        </div>
      )}

      {/* PRINT-READY INVOICE PREVIEW */}
      {printInvoice && (
        <div className="modal-backdrop" style={{ background: '#111' }}>
          <div className="print-invoice-container" style={{ background: '#fff', color: '#111', width: '100%', maxWidth: '400px', padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            <div className="flex-row" style={{ borderBottom: '2px solid #222', paddingBottom: '10px' }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '20px', fontWeight: 'bold' }}>INVOICE</h2>
                <div style={{ fontSize: '10px', color: '#555' }}>{printInvoice.invoice_number}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h4 style={{ fontSize: '12px', fontWeight: 'bold' }}>{organization.name}</h4>
                <div style={{ fontSize: '10px', color: '#555' }}>{organization.email}</div>
              </div>
            </div>

            <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>Billed To:</strong>
                <div>{printInvoice.tenant_name}</div>
                <div>Account: {printInvoice.tenant_account_number || printInvoice.unit_code}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div><strong>Issue Date:</strong> {printInvoice.issue_date}</div>
                <div><strong>Due Date:</strong> {printInvoice.due_date}</div>
              </div>
            </div>

            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>
                  <th style={{ textAlign: 'left', padding: '4px 0' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '4px 0' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 0' }}>{printInvoice.invoice_type.toUpperCase()} Invoice</td>
                  <td style={{ textAlign: 'right', padding: '6px 0' }}>{formatCurrency(printInvoice.total)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ borderTop: '2px solid #ddd', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', alignItems: 'flex-end' }}>
              <div>Subtotal: <strong>{formatCurrency(printInvoice.total)}</strong></div>
              <div>Paid Amount: <strong style={{ color: 'green' }}>{formatCurrency(printInvoice.amount_paid)}</strong></div>
              <div style={{ fontSize: '14px', borderTop: '1px solid #111', paddingTop: '4px' }}>Balance Due: <strong style={{ color: 'red' }}>{formatCurrency(printInvoice.balance)}</strong></div>
            </div>

            <div style={{ background: '#f5f5f5', padding: '10px', borderRadius: '6px', fontSize: '10px', borderLeft: '3px solid #333' }}>
              <strong>Payment Instructions:</strong>
              <div>Lipa Na M-Pesa Paybill: <strong>174379</strong></div>
              <div>Account Number: <strong>{printInvoice.tenant_account_number || printInvoice.unit_code}</strong></div>
            </div>

            <div className="flex-gap print-no-print" style={{ marginTop: '10px' }}>
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', border: '1px solid #333', color: '#333' }} onClick={() => window.print()}>🖨️ Print Invoice</button>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => setPrintInvoice(null)}>Close Preview</button>
            </div>
          </div>
        </div>
      )}



    </div>
  );
}
