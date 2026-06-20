import React, { useState, useEffect } from 'react';
import { LockKeyhole, Smartphone, ReceiptText } from 'lucide-react';

export default function SaaSInvoices({ organization, refreshTrigger, onRefresh, forceShowLock }) {
  const [saasStatus, setSaasStatus] = useState(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isLocked, setIsLocked] = useState(organization.is_locked || forceShowLock);

  useEffect(() => {
    fetchSaaSStatus();
  }, [refreshTrigger, organization.is_locked, forceShowLock]);

  const fetchSaaSStatus = async () => {
    try {
      const headers = {};
      const res = await fetch('/api/saas/status', { headers });
      const data = await res.json();
      setSaasStatus(data);
      setIsLocked(data.organization.is_locked || forceShowLock);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePaySTK = async (invoiceId) => {
    setLoading(true);
    setMessage('');
    try {
      const headers = {};
      
      const res = await fetch('/api/saas/pay', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: invoiceId,
          phone_number: phone || organization.phone_number
        })
      });

      const data = await res.json();
      if (res.ok) {
        setMessage('STK Push simulated! Input your PIN on phone popup.');
        
        // Simulating webhook callback returning to unlock in 4 seconds
        setTimeout(() => {
          setMessage('Payment Confirmed! Account unlocked.');
          fetchSaaSStatus();
          onRefresh();
        }, 4500);

      } else {
        setMessage(data.error || 'STK Push failed.');
      }
    } catch (e) {
      setMessage('Failed to initiate M-Pesa STK push.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(val);
  };

  if (!saasStatus) {
    return <p style={{ padding: '20px', textAlign: 'center' }}>Loading billing info...</p>;
  }

  const activeInvoice = saasStatus.invoices.find(inv => inv.status === 'overdue' || inv.status === 'issued');

  // Render LOCKOUT OVERLAY SCREEN
  if (isLocked) {
    return (
      <div className="lockout-screen lockout-page">
        <div className="lockout-shell">
          <section className="lockout-hero">
            <span className="lockout-icon" aria-hidden="true">
  <LockKeyhole size={48} strokeWidth={2.2} />
</span>
            <h2 className="lockout-title">
              Account Locked
            </h2>
            <p className="lockout-copy">
              Your platform subscription is overdue. Complete payment below to reactivate your account.
            </p>
          </section>

          <section className="lockout-payment-grid">
            {activeInvoice ? (
              <article className="card lockout-card lockout-invoice-card">
                <h4 className="lockout-card-kicker lockout-card-kicker-with-icon">
  <ReceiptText size={15} strokeWidth={2.4} aria-hidden="true" />
  <span>Invoice Summary</span>
</h4>
                <div className="lockout-invoice-number">Invoice: {activeInvoice.invoice_number}</div>
                <div className="lockout-amount">
                  {formatCurrency(activeInvoice.total)}
                </div>
                <p>Billing Period: {new Date(activeInvoice.billing_period_start).toLocaleDateString()} to {new Date(activeInvoice.billing_period_end).toLocaleDateString()}</p>
                <p>Active Tenant Count: <strong>{activeInvoice.active_tenant_count}</strong></p>
              </article>
            ) : (
              <p className="lockout-loading">Checking invoice details...</p>
            )}

            {activeInvoice && (
              <article className="card lockout-card lockout-stk-card">
                <h4 className="lockout-card-title">
  <Smartphone size={18} strokeWidth={2.4} aria-hidden="true" />
  <span>Lipa na M-Pesa STK Push</span>
</h4>
                <p className="lockout-card-description">
                  Enter the M-Pesa phone number that should receive the payment prompt.
                </p>

                <div className="form-group">
                  <label className="form-label">M-Pesa Phone Number</label>
                  <input
                    type="tel"
                    className="form-control"
                    placeholder={organization.phone_number}
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-primary lockout-pay-button"
                  disabled={loading}
                  onClick={() => handlePaySTK(activeInvoice.id)}
                >
                  {loading ? 'Sending STK Push...' : 'Send M-Pesa STK Push'}
                </button>

                {message && (
                  <div className="lockout-message">
                    {message}
                  </div>
                )}
              </article>
            )}

            <article className="card lockout-card lockout-paybill-card">
              <h4 className="lockout-card-kicker">Offline Paybill Instructions</h4>
              <div className="lockout-paybill-list">
                <div>Business Number: <strong>174379</strong></div>
                <div>Account Name: <strong>{organization.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12)}</strong></div>
                <div className="lockout-note">Once paid, support admin will confirm within 1 hour.</div>
              </div>
            </article>
          </section>
        </div>
      </div>
    );
  }

  // Render STANDARD BILLING PAGE (if not locked)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      <div className="card">
        <h3 className="card-title">SaaS Subscription Status</h3>
        <div style={{ fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
          <div className="flex-row">
            <span>Billing Model:</span>
            <strong>Per Active Tenant</strong>
          </div>
          <div className="flex-row">
            <span>Price per Tenant:</span>
            <strong>{formatCurrency(saasStatus.price_per_active_tenant)} / month</strong>
          </div>
          <div className="flex-row">
            <span>Current Active Tenants:</span>
            <strong>{saasStatus.active_tenants}</strong>
          </div>
          <div className="flex-row">
            <span>Status:</span>
            <span className="badge badge-success">active</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Billing Invoice History</h3>
        
        {saasStatus.invoices.length === 0 ? (
          <p style={{ fontSize: '13px', textAlign: 'center', padding: '10px' }}>No platform invoices issued yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            {saasStatus.invoices.map(inv => (
              <div key={inv.id} className="flex-row" style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>Invoice: {inv.invoice_number}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Due: {new Date(inv.due_at).toLocaleDateString()}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <strong>{formatCurrency(inv.total)}</strong>
                  <span className={`badge ${inv.status === 'paid' ? 'badge-success' : 'badge-danger'}`}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}





