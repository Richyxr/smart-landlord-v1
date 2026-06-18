import React, { useState, useEffect } from 'react';

export default function LandlordDashboard({ organization, onNavigate, refreshTrigger }) {
  const [stats, setStats] = useState({
    propertiesCount: 0,
    unitsCount: 0,
    occupiedCount: 0,
    vacantCount: 0,
    expectedRent: 0,
    collectedRent: 0,
    arrears: 0,
    unmatchedCount: 0,
    pendingReadingsCount: 0,
    saasLocked: false,
    readinessStatus: false
  });
  const [recentPayments, setRecentPayments] = useState([]);
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger, organization.id]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const headers = {};
      
      // Get properties, units, tenants, invoices
      const [resProps, resUnits, resTenants, resInvoices, resStaging, resReadings, resSaaS, resReadiness, resPayments] = await Promise.all([
        fetch('/api/properties', { headers }),
        fetch('/api/units', { headers }),
        fetch('/api/tenants', { headers }),
        fetch('/api/invoices', { headers }),
        fetch('/api/reconciliation/staging', { headers }),
        fetch('/api/meter-readings', { headers }),
        fetch('/api/saas/status', { headers }),
        fetch('/api/settings/readiness', { headers }),
        fetch('/api/payments', { headers })
      ]);

      const props = await resProps.json();
      const units = await resUnits.json();
      const tenants = await resTenants.json();
      const invoices = await resInvoices.json();
      const staging = await resStaging.json();
      const readings = await resReadings.json();
      const saas = await resSaaS.json();
      const readiness = await resReadiness.json();
      const payments = await resPayments.json();

      // Calculation of monthly metrics (June 2026 expected)
      const expected = units.reduce((acc, curr) => acc + (curr.rent_amount || 0), 0);
      const collected = invoices.filter(i => i.status === 'paid').reduce((acc, curr) => acc + (curr.amount_paid || 0), 0);
      const outstanding = invoices.filter(i => i.status === 'overdue' || i.status === 'partially_paid').reduce((acc, curr) => acc + (curr.balance || 0), 0);

      setStats({
        propertiesCount: props.length,
        unitsCount: units.length,
        occupiedCount: units.filter(u => u.status === 'occupied').length,
        vacantCount: units.filter(u => u.status === 'vacant').length,
        expectedRent: expected,
        collectedRent: collected,
        arrears: outstanding,
        unmatchedCount: staging.filter(r => r.status === 'unmatched' || r.status === 'needs_review').length,
        pendingReadingsCount: readings.filter(r => r.status === 'submitted').length,
        saasLocked: saas.organization.is_locked,
        readinessStatus: readiness.is_ready
      });

      // Recent payment transactions (last 3)
      setRecentPayments(payments.slice(0, 3));

      // Recent invoices (last 3)
      setRecentInvoices(invoices.slice(0, 3));

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: organization.billing_currency || 'KES', maximumFractionDigits: 0 }).format(val);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div className="pulse-primary" style={{ padding: '20px', borderRadius: '50%', background: 'var(--bg-surface)' }}>⏳ Loading Dashboard...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* HEADER CARD WITH QUICK ACTION */}
      <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg-surface), var(--primary-glow))', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
        <p className="kpi-lbl" style={{ color: 'var(--primary)' }}>Organization</p>
        <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'var(--font-title)' }}>{organization.name}</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
          <span className="badge badge-success">Active Subscription</span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Currency: <strong>{organization.billing_currency}</strong></span>
        </div>
      </div>

      {/* SETUP CHECKLIST BANNER */}
      {!stats.readinessStatus && (
        <div className="card" style={{ backgroundColor: '#1e1b4b', borderColor: '#4338ca', cursor: 'pointer' }} onClick={() => onNavigate('landlord_settings')}>
          <div className="flex-row">
            <div>
              <h4 style={{ fontSize: '14px', color: '#c7d2fe', fontWeight: 'bold' }}>⚠️ Setup Not Completed</h4>
              <p style={{ fontSize: '12px', color: '#a5b4fc', marginTop: '2px' }}>Configure your SMS gateway, PIN, and properties to get ready.</p>
            </div>
            <span style={{ fontSize: '18px' }}>👉</span>
          </div>
        </div>
      )}

      {/* RECONCILIATION & READINGS ALERTS */}
      {(stats.unmatchedCount > 0 || stats.pendingReadingsCount > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {stats.unmatchedCount > 0 && (
            <div className="card pulse-primary" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--danger)', cursor: 'pointer', marginBottom: 0 }} onClick={() => onNavigate('landlord_reconciliation')}>
              <div className="flex-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>🤝</span>
                  <div>
                    <h4 style={{ fontSize: '14px', color: '#fca5a5', fontWeight: 'bold' }}>{stats.unmatchedCount} Unmatched Payments</h4>
                    <p style={{ fontSize: '12px', color: '#fca5a5' }}>Incoming statement entries require reconciliation.</p>
                  </div>
                </div>
                <span className="badge badge-danger">Review</span>
              </div>
            </div>
          )}
          {stats.pendingReadingsCount > 0 && (
            <div className="card" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'var(--warning)', cursor: 'pointer', marginBottom: 0 }} onClick={() => onNavigate('landlord_settings')}>
              <div className="flex-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>⚡</span>
                  <div>
                    <h4 style={{ fontSize: '14px', color: '#fde68a', fontWeight: 'bold' }}>{stats.pendingReadingsCount} Pending Readings</h4>
                    <p style={{ fontSize: '12px', color: '#fde68a' }}>Caretaker submitted meter readings require approval.</p>
                  </div>
                </div>
                <span className="badge badge-warning">Approve</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PORTFOLIO STATS GRID */}
      <div className="grid-2">
        <div className="card" style={{ marginBottom: 0 }}>
          <span className="kpi-lbl">Total Properties</span>
          <div className="kpi-num">{stats.propertiesCount}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <span className="kpi-lbl">Occupancy</span>
          <div className="kpi-num" style={{ fontSize: '20px' }}>
            {stats.occupiedCount} / {stats.unitsCount} <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Units</span>
          </div>
        </div>
      </div>

      {/* REVENUE STATS GRID */}
      <div className="card">
        <span className="kpi-lbl">Current Month Collections</span>
        <h3 style={{ fontSize: '28px', color: 'var(--success)', fontFamily: 'var(--font-title)', fontWeight: '800', margin: '4px 0' }}>
          {formatCurrency(stats.collectedRent)}
        </h3>
        <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
        <div className="grid-2">
          <div>
            <span className="kpi-lbl">Expected Revenue</span>
            <div style={{ fontSize: '15px', fontWeight: '600' }}>{formatCurrency(stats.expectedRent)}</div>
          </div>
          <div>
            <span className="kpi-lbl">Outstanding Arrears</span>
            <div style={{ fontSize: '15px', fontWeight: '600', color: stats.arrears > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
              {formatCurrency(stats.arrears)}
            </div>
          </div>
        </div>
      </div>

      {/* RECENT PAYMENTS */}
      <div className="card">
        <div className="flex-row" style={{ marginBottom: '12px' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Recent Payments</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('landlord_reconciliation')}>View All</button>
        </div>
        
        {recentPayments.length === 0 ? (
          <p style={{ fontSize: '13px', textAlign: 'center', padding: '10px' }}>No payments recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recentPayments.map(pay => (
              <div key={pay.id} className="flex-row" style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{pay.tenant_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Ref: {pay.reference_number} • {new Date(pay.transaction_date).toLocaleDateString()}</div>
                </div>
                <div style={{ color: 'var(--success)', fontWeight: '700' }}>+{formatCurrency(pay.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RECENT INVOICES */}
      <div className="card">
        <div className="flex-row" style={{ marginBottom: '12px' }}>
          <h3 className="card-title" style={{ margin: 0 }}>Recent Invoices</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('landlord_invoices')}>View All</button>
        </div>

        {recentInvoices.length === 0 ? (
          <p style={{ fontSize: '13px', textAlign: 'center', padding: '10px' }}>No invoices created yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recentInvoices.map(inv => (
              <div key={inv.id} className="flex-row" style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{inv.tenant_name} ({inv.unit_code})</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Due: {inv.due_date} • {inv.invoice_number}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <div style={{ fontWeight: '600' }}>{formatCurrency(inv.total)}</div>
                  <span className={`badge ${
                    inv.status === 'paid' ? 'badge-success' :
                    inv.status === 'overdue' ? 'badge-danger' : 'badge-warning'
                  }`} style={{ fontSize: '9px', padding: '2px 6px' }}>
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
