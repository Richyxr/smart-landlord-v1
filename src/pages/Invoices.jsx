import React, { useState, useEffect } from 'react';
import SecurityPinModal from '../components/SecurityPinModal.jsx';
import { CircleDollarSign, AlertTriangle, CheckCircle, Users, Zap, FileText, Printer, Bell, Check, CheckCircle2, Plus, DoorOpen, Droplets, Pencil, Clock, Mail, Phone, MessageSquare, Smartphone } from 'lucide-react';

export default function Invoices({ organization, refreshTrigger, onRefresh, initialSubTab, clearInitialSubTab, onNavigate }) {
  const [invoices, setInvoices] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Tab Navigation
  const [activeSubTab, setActiveSubTab] = useState('overview'); // overview, due_tenants, invoices, readings, utility_settings
  const [searchTerm, setSearchTerm] = useState('');

  // View States for Invoice Actions
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null); // Full detail for invoice
  const [printInvoice, setPrintInvoice] = useState(null); // Print-ready overlay
  const [reminderResult, setReminderResult] = useState(null); // Reminder sent confirmation
  const [reminderTarget, setReminderTarget] = useState(null); // { invoiceId, selectedChannel } for picker modal

  // PIN modal triggers
  const [pinTargetId, setPinTargetId] = useState(null);

  // Selected due tenant details modal state for mobile view
  const [selectedMobileTenant, setSelectedMobileTenant] = useState(null);

  // Form State for Invoice Creation
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [invoiceType, setInvoiceType] = useState('rent');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 5*24*60*60*1000).toISOString().split('T')[0]); // +5 days
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ description: 'Monthly Rent', item_type: 'rent', quantity: 1, unit_price: '' }]);

  // Local Readings State (in-memory draft only)
  const [readings, setReadings] = useState({});
  const [readingUnitId, setReadingUnitId] = useState(null);
  const [waterVal, setWaterVal] = useState('');
  const [elecVal, setElecVal] = useState('');

  // Utility Settings States (in-memory draft only)
  const [enableWater, setEnableWater] = useState(false);
  const [waterCost, setWaterCost] = useState('150');
  const [enableElec, setEnableElec] = useState(false);
  const [elecCost, setElecCost] = useState('25');
  const [deadlineDay, setDeadlineDay] = useState('25');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const headers = {};

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
      clearInitialSubTab?.();
    }
  }, [initialSubTab]);

  useEffect(() => {
    fetchBillingData();
  }, [refreshTrigger]);

  const fetchBillingData = async () => {
    setLoading(true);
    setError('');
    try {
      const [resInvs, resTenants, resUnits] = await Promise.all([
        fetch('/api/invoices', { headers }),
        fetch('/api/tenants', { headers }),
        fetch('/api/units', { headers })
      ]);
      setInvoices(await resInvs.json());
      setTenants(await resTenants.json());
      setUnits(await resUnits.json());
    } catch (e) {
      setError('Failed to fetch billing data.');
    } finally {
      setLoading(false);
    }
  };

  const handleTenantChange = (tenantId) => {
    setSelectedTenantId(tenantId);
    const tenant = tenants.find(t => t.id === parseInt(tenantId));
    if (tenant) {
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
      fetchBillingData();
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
      fetchBillingData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
      fetchBillingData();
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

  const safeNumber = (val) => {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: organization.billing_currency || 'KES', maximumFractionDigits: 0 }).format(safeNumber(val));
  };

  // Utility Settings Save
  const handleSaveSettings = (e) => {
    e.preventDefault();
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
  };

  // Local Readings Save
  const handleSaveReading = (e) => {
    e.preventDefault();
    const updated = {
      ...readings,
      [readingUnitId]: {
        water: waterVal,
        electricity: elecVal,
        date: new Date().toISOString().split('T')[0]
      }
    };
    setReadings(updated);
    setReadingUnitId(null);
    setWaterVal('');
    setElecVal('');
  };

  // Dashboard Data Calculations
  const activeTenants = tenants.filter(t => t.status === 'active');
  const totalArrears = activeTenants.reduce((sum, t) => sum + safeNumber(t.balance), 0);
  const totalMonthlyRent = activeTenants.reduce((sum, t) => sum + safeNumber(t.rent_amount), 0);
  const totalDueAmount = totalMonthlyRent + totalArrears;
  const paidThisMonth = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + safeNumber(inv.amount_paid), 0);
  const unpaidTenantsCount = activeTenants.filter(t => safeNumber(t.balance) > 0).length;
  const pendingReadingsCount = units.length - Object.keys(readings).filter(key => readings[key]?.water || readings[key]?.electricity).length;
  const invoicesCount = invoices.length;

  // Filter Due Tenants
  const filteredTenants = activeTenants.filter(t => {
    const search = searchTerm.toLowerCase();
    return (
      (t.full_name || '').toLowerCase().includes(search) ||
      (t.property_name || '').toLowerCase().includes(search) ||
      (t.unit_code || '').toLowerCase().includes(search)
    );
  });

  // Render Form / Details / Print views first (if active)
  if (showAddForm) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
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
      </div>
    );
  }

  if (viewInvoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
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
              <button className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setPrintInvoice(viewInvoice)}>
                <Printer size={14} /> Print
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '6px 14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => openReminderModal(viewInvoice.id)}
                disabled={loading}
              >
                <Bell size={14} /> Send Payment Reminder
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (printInvoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
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
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', border: '1px solid #333', color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={() => window.print()}>
                <Printer size={14} /> Print Invoice
              </button>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => setPrintInvoice(null)}>Close Preview</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="modal-content">

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                <Bell size={20} />
              </div>
              <div>
                <h3 style={{ fontWeight: '700', fontSize: '16px', margin: 0 }}>Send Payment Reminder</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>Choose how to reach the tenant</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: 'sms',       label: 'SMS',       icon: Smartphone, desc: 'Text message to tenant\'s phone number',    color: '#10b981' },
                { key: 'email',     label: 'Email',     icon: Mail,       desc: 'Send to tenant\'s registered email address', color: '#3b82f6' },
                { key: 'whatsapp',  label: 'WhatsApp',  icon: MessageSquare, desc: 'WhatsApp message via linked number',         color: '#25d366' }
              ].map(ch => {
                const IconComp = ch.icon;
                return (
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
                    <span style={{ display: 'inline-flex', flexShrink: 0, color: reminderTarget.selectedChannel === ch.key ? ch.color : 'var(--text-secondary)' }}>
                      <IconComp size={24} />
                    </span>
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
                      {reminderTarget.selectedChannel === ch.key && <span style={{ color: '#fff', fontSize: '10px', fontWeight: 'bold' }}><Check size={10} /></span>}
                    </div>
                  </button>
                );
              })}
            </div>

            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '12px' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setReminderTarget(null); setError(''); }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2, background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={confirmSendReminder}
                disabled={loading}
              >
                <Bell size={14} />
                {loading ? 'Sending...' : `Send via ${reminderTarget.selectedChannel === 'sms' ? 'SMS' : reminderTarget.selectedChannel === 'email' ? 'Email' : 'WhatsApp'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REMINDER SENT CONFIRMATION OVERLAY */}
      {reminderResult && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}><CheckCircle2 size={20} /></div>
              <div>
                <h3 style={{ fontWeight: '700', fontSize: '16px', margin: 0 }}>Reminder Sent!</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {reminderResult.channel === 'sms' && <><Smartphone size={12} /> <span>SMS</span></>}
                  {reminderResult.channel === 'email' && <><Mail size={12} /> <span>Email</span></>}
                  {reminderResult.channel === 'whatsapp' && <><MessageSquare size={12} /> <span>WhatsApp</span></>}
                  {' '}dispatched to <strong>{reminderResult.tenant_name}</strong>
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {reminderResult.channel === 'sms' && 'Message Preview'}
                {reminderResult.channel === 'email' && 'Email Body Preview'}
                {reminderResult.channel === 'whatsapp' && 'WhatsApp Message Preview'}
              </div>
              <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0, color: 'var(--text-primary)' }}>
                {reminderResult.message}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>
                {reminderResult.channel === 'sms' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Phone size={12} /> {reminderResult.phone}</span>}
                {reminderResult.channel === 'email' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Mail size={12} /> {reminderResult.email || reminderResult.phone}</span>}
                {reminderResult.channel === 'whatsapp' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MessageSquare size={12} /> {reminderResult.phone}</span>}
              </span>
              <span>•</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {new Date(reminderResult.sent_at).toLocaleTimeString()}</span>
            </div>

            <button className="btn btn-primary" style={{ marginTop: '4px' }} onClick={() => setReminderResult(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* MOBILE DUE TENANT DETAIL MODAL */}
      {selectedMobileTenant && (() => {
        const t = selectedMobileTenant;
        const arrearsVal = safeNumber(t.balance);
        const rentVal = safeNumber(t.rent_amount);
        const dueVal = rentVal + arrearsVal;
        return (
          <div className="modal-backdrop" onClick={() => setSelectedMobileTenant(null)}>
            <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontWeight: '700', fontSize: '18px', marginBottom: '14px', fontFamily: 'var(--font-title)' }}>Due Tenant Details</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Tenant Name:</span>
                  <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{t.full_name}</span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Property / Unit:</span>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                    {t.property_name} <span style={{ color: 'var(--text-muted)' }}>({t.unit_code})</span>
                  </span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Billing Day:</span>
                  <span style={{ color: 'var(--info)', fontWeight: '600' }}>{t.billing_day || '1'}</span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Monthly Rent:</span>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{formatCurrency(rentVal)}</span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Arrears:</span>
                  <span style={{ color: arrearsVal > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: '600' }}>
                    {arrearsVal > 0 ? formatCurrency(arrearsVal) : '--'}
                  </span>
                </div>
                <div className="flex-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                  <span className={`sl-status-badge ${arrearsVal > 0 ? 'sl-status-danger' : 'sl-status-success'}`}>
                    {arrearsVal > 0 ? 'Arrears' : 'No Arrears'}
                  </span>
                </div>
                <div className="flex-row" style={{ paddingTop: '4px', fontSize: '15px' }}>
                  <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>Total Amount Due:</span>
                  <span style={{ fontWeight: '800', color: 'var(--text-primary)' }}>{formatCurrency(dueVal)}</span>
                </div>
              </div>
              
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ marginTop: '20px' }} 
                onClick={() => setSelectedMobileTenant(null)}
              >
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* RENDER BILLING HEADER */}
      <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '22px', marginBottom: '4px' }}>Billing Operations</h2>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Manage invoices, due tenants, utilities, and payment dispatching.</p>

      {/* RENDER BILLING SUB-TABS */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'due_tenants', label: 'Due Tenants' },
          { id: 'invoices', label: 'Invoices' },
          { id: 'readings', label: 'Meter Readings' },
          { id: 'utility_settings', label: 'Utility Settings' }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            style={{
              flex: 1,
              padding: '12px 4px',
              border: 'none',
              background: 'none',
              color: activeSubTab === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
              borderBottom: activeSubTab === tab.id ? '2px solid var(--primary)' : 'none',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '11px',
              transition: 'all 0.2s'
            }}
            onClick={() => { setActiveSubTab(tab.id); setError(''); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px', fontWeight: 'bold' }}>{error}</div>}

      {/* OVERVIEW SUB-TAB */}
      {activeSubTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* KPI Dashboard Grid */}
          <div className="grid-2">
            
            <div 
              className="sl-metric-card sl-clickable"
              onClick={() => { setActiveSubTab('due_tenants'); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSubTab('due_tenants'); setError(''); } }}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <div className="sl-metric-top">
                <span className="sl-metric-label">Total Due</span>
                <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}><CircleDollarSign size={18} /></span>
              </div>
              <div className="sl-metric-value">{formatCurrency(totalDueAmount)}</div>
              <div className="sl-metric-helper">Rent + arrears this cycle</div>
            </div>

            <div 
              className="sl-metric-card sl-metric-danger sl-clickable"
              onClick={() => { setActiveSubTab('due_tenants'); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSubTab('due_tenants'); setError(''); } }}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <div className="sl-metric-top">
                <span className="sl-metric-label">Arrears</span>
                <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}><AlertTriangle size={18} /></span>
              </div>
              <div className="sl-metric-value">{formatCurrency(totalArrears)}</div>
              <div className="sl-metric-helper">Accumulated debt</div>
            </div>

            <div 
              className="sl-metric-card sl-metric-success sl-clickable"
              onClick={() => onNavigate?.('landlord_reconciliation')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('landlord_reconciliation'); } }}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <div className="sl-metric-top">
                <span className="sl-metric-label">Paid This Month</span>
                <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}><CheckCircle size={18} /></span>
              </div>
              <div className="sl-metric-value">{formatCurrency(paidThisMonth)}</div>
              <div className="sl-metric-helper">Rent collected in ledger</div>
            </div>

            <div 
              className="sl-metric-card sl-clickable"
              onClick={() => { setActiveSubTab('due_tenants'); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSubTab('due_tenants'); setError(''); } }}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <div className="sl-metric-top">
                <span className="sl-metric-label">Unpaid Tenants</span>
                <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}><Users size={18} /></span>
              </div>
              <div className="sl-metric-value">{unpaidTenantsCount}</div>
              <div className="sl-metric-helper">Tenants with balance &gt; 0</div>
            </div>

            <div 
              className="sl-metric-card sl-metric-warning sl-clickable"
              onClick={() => { setActiveSubTab('readings'); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSubTab('readings'); setError(''); } }}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <div className="sl-metric-top">
                <span className="sl-metric-label">Pending Readings</span>
                <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}><Zap size={18} /></span>
              </div>
              <div className="sl-metric-value">{pendingReadingsCount}</div>
              <div className="sl-metric-helper">Units requiring utility logs</div>
            </div>

            <div 
              className="sl-metric-card sl-clickable"
              onClick={() => { setActiveSubTab('invoices'); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSubTab('invoices'); setError(''); } }}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <div className="sl-metric-top">
                <span className="sl-metric-label">Invoices</span>
                <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}><FileText size={18} /></span>
              </div>
              <div className="sl-metric-value">{invoicesCount}</div>
              <div className="sl-metric-helper">Total issued invoices</div>
            </div>

          </div>

          {/* Quick Operations Guide */}
          <div className="sl-card sl-card-primary">
            <h4 style={{ fontWeight: '700', fontSize: '14px', marginBottom: '6px' }}>Billing Operations Center</h4>
            <p style={{ fontSize: '12px', lineHeight: '1.6', marginBottom: '12px' }}>
              Welcome to the Landlord Billing Dashboard. Review due tenants, allocate pending invoices, or update water/electricity meter records before generating rent receipts.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary btn-sm" onClick={() => { setShowAddForm(true); resetForm(); }}>
                Create New Invoice
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveSubTab('due_tenants')}>
                View Due List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DUE TENANTS SUB-TAB */}
      {activeSubTab === 'due_tenants' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          <input
            type="text"
            placeholder="Search due tenants by name, property, or unit..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="form-control"
            style={{ marginBottom: '4px' }}
          />

          {filteredTenants.length === 0 ? (
            <div className="sl-empty-state">
              <div className="sl-empty-state-title">No due tenants found</div>
              <div className="sl-empty-state-desc">No active due tenants match the current search filter.</div>
            </div>
          ) : (
            <>
              {/* Desktop View: Keep existing table layout */}
              <div className="due-tenants-desktop-view" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px' }}>Tenant</th>
                      <th style={{ padding: '10px' }}>Property / Unit</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>Day</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Rent</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Arrears</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Total Due</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTenants.map(t => {
                      const arrearsVal = safeNumber(t.balance);
                      const rentVal = safeNumber(t.rent_amount);
                      const dueVal = rentVal + arrearsVal;
                      return (
                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                          <td style={{ padding: '10px', fontWeight: '700' }}>{t.full_name}</td>
                          <td style={{ padding: '10px' }}>{t.property_name} <span style={{ color: 'var(--text-muted)' }}>({t.unit_code})</span></td>
                          <td style={{ padding: '10px', textAlign: 'center', color: 'var(--info)' }}>{t.billing_day || '1'}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>{formatCurrency(rentVal)}</td>
                          <td style={{ padding: '10px', textAlign: 'right', color: arrearsVal > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {arrearsVal > 0 ? formatCurrency(arrearsVal) : '--'}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(dueVal)}</td>
                          <td style={{ padding: '10px', textAlign: 'center' }}>
                            <span className={`sl-status-badge ${arrearsVal > 0 ? 'sl-status-danger' : 'sl-status-success'}`}>
                              {arrearsVal > 0 ? 'Arrears' : 'No Arrears'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View: Display as stacked cards */}
              <div className="due-tenants-mobile-view" style={{ display: 'none', flexDirection: 'column', gap: '10px' }}>
                {filteredTenants.map(t => {
                  const arrearsVal = safeNumber(t.balance);
                  const rentVal = safeNumber(t.rent_amount);
                  const dueVal = rentVal + arrearsVal;
                  return (
                    <div 
                      key={t.id} 
                      className="sl-card sl-card-interactive" 
                      style={{ marginBottom: 0, padding: '12px 14px' }}
                      onClick={() => setSelectedMobileTenant(t)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMobileTenant(t); } }}
                    >
                      <div className="flex-row">
                        <span style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-primary)' }}>{t.full_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span className={`sl-status-badge ${arrearsVal > 0 ? 'sl-status-danger' : 'sl-status-success'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                            {arrearsVal > 0 ? 'Arrears' : 'No Arrears'}
                          </span>
                          <span style={{ fontWeight: '800', fontSize: '14px', color: 'var(--text-primary)' }}>{formatCurrency(dueVal)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* INVOICES SUB-TAB */}
      {activeSubTab === 'invoices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Invoice Records: {invoices.length} total</span>
            <button className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => { setShowAddForm(true); resetForm(); }}>
              <Plus size={14} /> Create New Invoice
            </button>
          </div>

          {invoices.length === 0 ? (
            <div className="sl-empty-state">
              <div className="sl-empty-state-icon">
                <FileText size={32} />
              </div>
              <div className="sl-empty-state-title">No invoices registered yet</div>
              <div className="sl-empty-state-desc">
                Click "Create New Invoice" above to generate a bill for an active tenant, or navigate to Properties to add units and tenants first.
              </div>
            </div>
          ) : (
            invoices.map(inv => (
              <div key={inv.id} className="sl-list-card">
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
                      Remind
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

      {/* METER READINGS SUB-TAB */}
      {activeSubTab === 'readings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Utility Log Registry</span>
            <span className="badge badge-info">active cycle</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--warning-glow)',
              border: '1px solid var(--warning)',
              color: '#fbbf24',
              fontSize: '12px',
              lineHeight: '1.5'
            }}
          >
            <AlertTriangle size={16} />
            <span>Utility billing settings and meter readings require backend persistence before production billing automation.</span>
          </div>

          {!enableWater && !enableElec ? (
            <div className="card" style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-secondary)' }}>
              Utility readings are currently disabled. Please enable water or electricity logging inside the <strong>Utility Settings</strong> tab.
            </div>
          ) : (
            units.map(u => {
              const currentReading = readings[u.id];
              const activeTenant = activeTenants.find(t => String(t.unit_id) === String(u.id));
              
              return (
                <div key={u.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="flex-row">
                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <DoorOpen size={16} style={{ color: 'var(--primary)' }} />
                      <span>Unit {u.unit_code} ({u.property_name})</span>
                    </h4>
                    <span className={`sl-status-badge ${currentReading ? 'sl-status-success' : 'sl-status-warning'}`}>
                      {currentReading ? 'logged' : 'pending'}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', margin: 0 }}>Tenant: <strong>{activeTenant ? activeTenant.full_name : 'Vacant'}</strong></p>
                  
                  <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                    {enableWater && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Droplets size={14} style={{ color: 'var(--info)' }} />
                        <span>Water: <strong style={{ color: 'var(--info)' }}>{currentReading?.water ? `${currentReading.water} m³` : '--'}</strong></span>
                      </div>
                    )}
                    {enableElec && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Zap size={14} style={{ color: 'var(--warning)' }} />
                        <span>Electricity: <strong style={{ color: 'var(--warning)' }}>{currentReading?.electricity ? `${currentReading.electricity} kWh` : '--'}</strong></span>
                      </div>
                    )}
                  </div>
                  
                  {currentReading?.date && (
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      Last updated: {currentReading.date}
                    </div>
                  )}

                  {activeTenant && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '8px', width: 'fit-content', alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={() => {
                        setReadingUnitId(u.id);
                        setWaterVal(currentReading?.water || '');
                        setElecVal(currentReading?.electricity || '');
                      }}
                    >
                      <Pencil size={12} /> Update Reading
                    </button>
                  )}
                </div>
              );
            })
          )}

          {/* UPDATE READING MODAL */}
          {readingUnitId && (
            <div className="modal-backdrop">
              <form onSubmit={handleSaveReading} className="modal-content">
                <h3 style={{ fontWeight: '700', fontSize: '16px', margin: 0 }}>Update Unit Readings</h3>
                
                {enableWater && (
                  <div className="form-group">
                    <label className="form-label">Water Reading (m³)</label>
                    <input
                      type="number"
                      required
                      placeholder="e.g. 104.5"
                      className="form-control"
                      value={waterVal}
                      onChange={e => setWaterVal(e.target.value)}
                    />
                  </div>
                )}

                {enableElec && (
                  <div className="form-group">
                    <label className="form-label">Electricity Reading (kWh)</label>
                    <input
                      type="number"
                      required
                      placeholder="e.g. 340.2"
                      className="form-control"
                      value={elecVal}
                      onChange={e => setElecVal(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex-gap" style={{ marginTop: '8px' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setReadingUnitId(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                    Save Readings
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      )}

      {/* UTILITY SETTINGS SUB-TAB */}
      {activeSubTab === 'utility_settings' && (
        <form onSubmit={handleSaveSettings} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '16px', margin: 0 }}>Utility Cost Rules</h3>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--warning-glow)',
              border: '1px solid var(--warning)',
              color: '#fbbf24',
              fontSize: '12px',
              lineHeight: '1.5'
            }}
          >
            <AlertTriangle size={16} />
            <span>Utility billing settings and meter readings require backend persistence before production billing automation.</span>
          </div>
          
          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={enableWater}
                onChange={e => setEnableWater(e.target.checked)}
              />
              Enable Water Billing
            </label>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '24px' }}>
              Require monthly water meter readings for tenants and calculate cost.
            </p>
          </div>

          {enableWater && (
            <div className="form-group" style={{ marginLeft: '24px' }}>
              <label className="form-label">Water Cost per m³ ({organization.billing_currency || 'KES'})</label>
              <input
                type="number"
                required
                className="form-control"
                placeholder="150"
                value={waterCost}
                onChange={e => setWaterCost(e.target.value)}
              />
            </div>
          )}

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={enableElec}
                onChange={e => setEnableElec(e.target.checked)}
              />
              Enable Electricity Billing
            </label>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '24px' }}>
              Require monthly power meter readings and add to tenant utility bills.
            </p>
          </div>

          {enableElec && (
            <div className="form-group" style={{ marginLeft: '24px' }}>
              <label className="form-label">Electricity Cost per kWh ({organization.billing_currency || 'KES'})</label>
              <input
                type="number"
                required
                className="form-control"
                placeholder="25"
                value={elecCost}
                onChange={e => setElecCost(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Monthly Meter Reading Deadline Day</label>
            <input
              type="number"
              min="1"
              max="28"
              required
              className="form-control"
              value={deadlineDay}
              onChange={e => setDeadlineDay(e.target.value)}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
              Caretakers must submit all unit meter readings by this calendar day.
            </p>
          </div>

          {settingsSaved && (
            <div style={{ color: 'var(--success)', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={12} /> Settings saved locally successfully!
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }}>
            Save Billing Settings
          </button>
        </form>
      )}

    </div>
  );
}
