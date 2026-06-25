import React, { useState, useEffect } from 'react';
import { Settings, Building2, Mail, ShieldCheck, TestTube2 } from 'lucide-react';

export default function SuperAdmin({ activeRoute, onImpersonateStart, refreshTrigger, onRefresh }) {
  const routeTabMap = {
    admin_dashboard: 'dashboard',
    admin_orgs: 'landlords',
    admin_pricing: 'billing',
    admin_errors: 'errors',
    admin_email: 'email'
  };

  const [activeTab, setActiveTab] = useState(routeTabMap[activeRoute] || 'dashboard'); // dashboard, landlords, billing, email, errors, audits

  useEffect(() => {
    const nextTab = routeTabMap[activeRoute];
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeRoute]);
  const [stats, setStats] = useState({
    total_organizations: 0,
    active_organizations: 0,
    locked_organizations: 0,
    total_active_tenants: 0,
    monthly_saas_revenue: 0,
    pending_confirmations: 0,
    system_errors_count: 0
  });

  const [landlords, setLandlords] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [systemErrors, setSystemErrors] = useState([]);
  const [systemAudits, setSystemAudits] = useState([]);
  const [deletionRequests, setDeletionRequests] = useState([]);
  const [platformEmail, setPlatformEmail] = useState({
    status: 'not_configured',
    last_tested_at: null,
    config_masked: {},
    has_credentials: false
  });
  const [platformEmailForm, setPlatformEmailForm] = useState({
    host: '',
    port: '465',
    secure: true,
    username: '',
    password: '',
    from_email: '',
    from_name: 'Smart Landlord',
    reply_to: ''
  });
  const [platformEmailPasswordMasked, setPlatformEmailPasswordMasked] = useState(false);

  // Pricing Form
  const [pricePerTenant, setPricePerTenant] = useState('200');
  const [gracePeriod, setGracePeriod] = useState('7');

  // Impersonate Modal
  const [impersonateOrg, setImpersonateOrg] = useState(null);
  const [impersonateReason, setImpersonateReason] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = {};

  useEffect(() => {
    fetchStats();
    fetchData();
  }, [activeTab, refreshTrigger]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', { headers });
      setStats(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'landlords') {
        const res = await fetch('/api/admin/organizations', { headers });
        setLandlords(await res.json());
      } else if (activeTab === 'billing') {
        const res = await fetch('/api/admin/platform-payments', { headers });
        const data = await res.json();
        setPendingPayments(data.filter(p => p.status === 'pending'));
      } else if (activeTab === 'email') {
        const res = await fetch('/api/admin/platform-email', { headers });
        if (!res.ok) throw new Error('Failed to fetch platform email settings.');
        const data = await res.json();
        setPlatformEmail(data);
        setPlatformEmailForm({
          host: data.config_masked?.host || '',
          port: String(data.config_masked?.port || '465'),
          secure: data.config_masked?.secure !== false,
          username: data.config_masked?.username || '',
          password: '',
          from_email: data.config_masked?.from_email || '',
          from_name: data.config_masked?.from_name || 'Smart Landlord',
          reply_to: data.config_masked?.reply_to || ''
        });
        setPlatformEmailPasswordMasked(Boolean(data.has_credentials));
      } else if (activeTab === 'errors') {
        const res = await fetch('/api/admin/system-errors', { headers });
        setSystemErrors(await res.json());
      } else if (activeTab === 'audits') {
        const res = await fetch('/api/admin/system-audits', { headers });
        setSystemAudits(await res.json());
      } else if (activeTab === 'compliance') {
        const res = await fetch('/api/admin/compliance/delete-requests', { headers });
        setDeletionRequests(await res.json());
      }
    } catch (e) {
      setError('Failed to fetch platform records.');
    } finally {
      setLoading(false);
    }
  };

  const handlePricingSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_per_active_tenant: pricePerTenant, grace_period_days: gracePeriod })
      });
      if (res.ok) {
        alert('Pricing settings updated successfully.');
        fetchStats();
        onRefresh();
      }
    } catch (e) {
      setError('Failed to update pricing.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPayment = async (payId) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/confirm-payment', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: payId })
      });
      if (res.ok) {
        alert('SaaS payment manually confirmed! Organization unlocked.');
        fetchData();
        fetchStats();
        onRefresh();
      }
    } catch (e) {
      setError('Confirm failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformEmailSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        host: platformEmailForm.host.trim(),
        port: Number.parseInt(platformEmailForm.port, 10),
        secure: platformEmailForm.secure,
        username: platformEmailForm.username.trim(),
        from_email: platformEmailForm.from_email.trim() || platformEmailForm.username.trim(),
        from_name: platformEmailForm.from_name.trim() || 'Smart Landlord',
        reply_to: platformEmailForm.reply_to.trim()
      };

      if (!platformEmailPasswordMasked || platformEmailForm.password.trim()) {
        payload.password = platformEmailForm.password;
      }

      const res = await fetch('/api/admin/platform-email', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_json: payload })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save platform email settings.');

      setPlatformEmail(data);
      setPlatformEmailPasswordMasked(true);
      setPlatformEmailForm(prev => ({ ...prev, password: '' }));
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformEmailTest = async () => {
    const recipient = window.prompt('Enter a test recipient email address (leave blank to use your account email):');
    if (recipient === null) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/platform-email/test', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(recipient.trim() ? { to: recipient.trim() } : {})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to send platform email test.');
      setPlatformEmail(prev => ({ ...prev, status: data.status || 'active', last_tested_at: data.last_tested_at || new Date().toISOString() }));
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessDeletion = async (requestId, action) => {
    let reason = '';
    if (action === 'reject') {
      reason = window.prompt('Enter reason for rejection:');
      if (reason === null) return;
      if (!reason.trim()) {
        alert('Reason is required for rejection.');
        return;
      }
    } else {
      const confirmed = window.confirm('Are you sure you want to APPROVE this deletion request? This will permanently anonymize personal identity data (PII) and cannot be undone.');
      if (!confirmed) return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/compliance/delete-requests/${requestId}/process`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reject_reason: reason })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to process request.');
      }

      alert(`Request has been successfully ${action === 'approve' ? 'approved & data anonymized' : 'rejected'}.`);
      fetchData();
      fetchStats();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonateSubmit = async (e) => {
    e.preventDefault();
    if (!impersonateReason.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate/start', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: impersonateOrg.id, reason: impersonateReason })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start impersonation.');

      onImpersonateStart(data.session, data.targetOrg, data.ownerUser, data.auth_token);
      setImpersonateOrg(null);
      setImpersonateReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      
      {/* IMPERSONATION MODAL REASON INPUT */}
      {impersonateOrg && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="card-title">Impersonate {impersonateOrg.name}</h3>
            <p style={{ fontSize: '12px', marginBottom: '14px' }}>
              You are about to access this landlord's dashboard. Under policy guidelines, this support action must have an audit trail.
            </p>

            <form onSubmit={handleImpersonateSubmit}>
              <div className="form-group">
                <label className="form-label">Reason for Support Access</label>
                <textarea
                  required
                  rows="3"
                  className="form-control"
                  placeholder="e.g. Debugging CSV column mapping issue for customer ticket #9081"
                  value={impersonateReason}
                  onChange={e => setImpersonateReason(e.target.value)}
                />
              </div>

              <div className="flex-gap" style={{ marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setImpersonateOrg(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Start Impersonation</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPER ADMIN MENU TABS */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px', background: 'var(--bg-surface)' }}>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'dashboard' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'dashboard' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('dashboard')}
        >
          Overview
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'landlords' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'landlords' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('landlords')}
        >
          Landlords
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'billing' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'billing' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('billing')}
        >
          Confirm SaaS
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'email' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'email' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('email')}
        >
          Email
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'errors' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'errors' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('errors')}
        >
          Errors
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'audits' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'audits' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('audits')}
        >
          System Logs
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'compliance' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'compliance' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
          onClick={() => setActiveTab('compliance')}
        >
          Compliance
        </button>
      </div>

      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

      {/* OVERVIEW PLATFORM STATS */}
      {activeTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div className="grid-2">
            <div className="card" style={{ marginBottom: 0 }}>
              <span className="kpi-lbl">Total Landlords</span>
              <div className="kpi-num">{stats.total_organizations}</div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <span className="kpi-lbl">Active Tenants</span>
              <div className="kpi-num">{stats.total_active_tenants}</div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <span className="kpi-lbl">Locked accounts</span>
              <div className="kpi-num" style={{ color: stats.locked_organizations > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                {stats.locked_organizations}
              </div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <span className="kpi-lbl">SaaS Billing Confirmations</span>
              <div className="kpi-num" style={{ color: stats.pending_confirmations > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {stats.pending_confirmations}
              </div>
            </div>
          </div>

          <div className="card">
            <span className="kpi-lbl">Total Monthly SaaS Revenue</span>
            <div className="kpi-num" style={{ color: 'var(--success)', fontSize: '28px' }}>
              {formatCurrency(stats.monthly_saas_revenue)}
            </div>
          </div>

          {/* PRICING SETTINGS FORM */}
          <div className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={18} /> Global Platform Pricing
            </h3>
            <form onSubmit={handlePricingSubmit}>
              <div className="form-group">
                <label className="form-label">Price per Active Tenant (Monthly KES)</label>
                <input
                  type="number"
                  required
                  className="form-control"
                  value={pricePerTenant}
                  onChange={e => setPricePerTenant(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Unpaid Invoice Grace Period (Days)</label>
                <input
                  type="number"
                  required
                  className="form-control"
                  value={gracePeriod}
                  onChange={e => setGracePeriod(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
                Update Pricing Policy
              </button>
            </form>
          </div>

        </div>
      )}

      {/* LANDLORDS LIST */}
      {activeTab === 'landlords' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {landlords.map(org => (
            <div key={org.id} className="sl-list-card">
              <div className="flex-row">
                <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Building2 size={18} style={{ color: 'var(--primary)' }} />
                  <span>{org.name}</span>
                </h3>
                <span className={`badge ${org.is_locked ? 'badge-danger' : 'badge-success'}`}>
                  {org.is_locked ? 'locked' : 'active'}
                </span>
              </div>
              <p style={{ fontSize: '12px', marginTop: '2px' }}>Owner ID: {org.owner_user_id} • Country: {org.country}</p>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', background: 'var(--bg-surface-elevated)', padding: '6px', borderRadius: '4px', margin: '8px 0' }}>
                <span>Sub: <strong>{org.subscription_tier.toUpperCase()}</strong></span>
                <span>Active Tenants: <strong>{org.active_tenant_count}</strong></span>
              </div>

              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setImpersonateOrg(org)}
                >
                  Impersonate Dashboard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CONFIRM SAAS PAYMENTS */}
      {activeTab === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pendingPayments.map(pay => (
            <div key={pay.id} className="sl-list-card">
              <div className="flex-row">
                <span className="badge badge-warning">{pay.payment_method.toUpperCase()} Payment</span>
                <span className="badge badge-danger">pending confirmation</span>
              </div>
              <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>{pay.organization_name}</h3>
              <p style={{ fontSize: '12px' }}>Ref: <strong>{pay.reference_number}</strong> • Date: {new Date(pay.created_at).toLocaleString()}</p>
              
              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
              
              <div className="flex-row" style={{ fontSize: '13px', marginBottom: '12px' }}>
                <span>Amount:</span>
                <strong style={{ color: 'var(--success)', fontSize: '16px' }}>{formatCurrency(pay.amount)}</strong>
              </div>

              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleConfirmPayment(pay.id)}
              >
                Confirm Bank Deposit & Unlock Org
              </button>
            </div>
          ))}
        </div>
      )}

      {/* PLATFORM EMAIL */}
      {activeTab === 'email' && (
        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Mail size={18} /> Platform Email
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Used for registration OTP, password reset later, and platform/system emails.
          </p>

          <div className="flex-row" style={{ marginBottom: '12px' }}>
            <span className="badge badge-info">{platformEmail.status}</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Last tested: {platformEmail.last_tested_at ? new Date(platformEmail.last_tested_at).toLocaleString() : 'Never'}
            </span>
          </div>

          <form onSubmit={handlePlatformEmailSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">SMTP Host</label>
                <input className="form-control" value={platformEmailForm.host} onChange={e => setPlatformEmailForm(prev => ({ ...prev, host: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">SMTP Port</label>
                <input type="number" className="form-control" value={platformEmailForm.port} onChange={e => setPlatformEmailForm(prev => ({ ...prev, port: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Secure (TLS/SSL)</label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={platformEmailForm.secure} onChange={e => setPlatformEmailForm(prev => ({ ...prev, secure: e.target.checked }))} />
                <span>{platformEmailForm.secure ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="form-control" value={platformEmailForm.username} onChange={e => setPlatformEmailForm(prev => ({ ...prev, username: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                {platformEmailPasswordMasked ? (
                  <div className="flex-row" style={{ gap: '8px' }}>
                    <input className="form-control" value="••••••••" readOnly />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlatformEmailPasswordMasked(false)}>Update</button>
                  </div>
                ) : (
                  <input type="password" className="form-control" value={platformEmailForm.password} onChange={e => setPlatformEmailForm(prev => ({ ...prev, password: e.target.value }))} />
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">From Email</label>
                <input className="form-control" value={platformEmailForm.from_email} onChange={e => setPlatformEmailForm(prev => ({ ...prev, from_email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">From Name</label>
                <input className="form-control" value={platformEmailForm.from_name} onChange={e => setPlatformEmailForm(prev => ({ ...prev, from_name: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Reply-To</label>
              <input className="form-control" value={platformEmailForm.reply_to} onChange={e => setPlatformEmailForm(prev => ({ ...prev, reply_to: e.target.value }))} />
            </div>

            <div className="flex-gap" style={{ marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>Save Platform Email</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handlePlatformEmailTest} disabled={loading || !platformEmail.has_credentials}>Send Test Email</button>
            </div>
          </form>
        </div>
      )}

      {/* SYSTEM ERRORS */}
      {activeTab === 'errors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {systemErrors.length === 0 ? (
            <div className="sl-empty-state">
              <div className="sl-empty-state-title">System Logs Clean</div>
              <div className="sl-empty-state-desc">No system errors have been logged.</div>
            </div>
          ) : (
            systemErrors.map(err => (
              <div key={err.id} className="sl-list-card" style={{ borderLeft: '4px solid var(--danger)' }}>
                <div className="flex-row">
                  <strong style={{ color: 'var(--danger)', fontSize: '11px' }}>{err.source.toUpperCase()}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(err.created_at).toLocaleDateString()}</span>
                </div>
                <p style={{ fontSize: '13px', marginTop: '6px', fontWeight: '600' }}>{err.message}</p>
                {err.stack_trace && <pre style={{ fontSize: '10px', color: 'var(--text-muted)', overflowX: 'auto', background: 'var(--bg-base)', padding: '6px', borderRadius: '4px', marginTop: '6px' }}>{err.stack_trace}</pre>}
              </div>
            ))
          )}
        </div>
      )}

      {/* SYSTEM AUDITS */}
      {activeTab === 'audits' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {systemAudits.map(log => (
            <div key={log.id} className="sl-list-card" style={{ fontSize: '12px' }}>
              <div className="flex-row">
                <strong style={{ textTransform: 'uppercase', color: 'var(--primary)', fontSize: '11px' }}>{log.action.replace(/_/g, ' ')}</strong>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: '6px' }}>
                Admin User: <strong>Super Admin</strong>
              </div>
              {log.org_name && <div>Target: <strong>{log.org_name}</strong></div>}
              {log.reason && <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '4px' }}>Reason: {log.reason}</div>}
            </div>
          ))}
        </div>
      )}

      {/* COMPLIANCE & DELETION REQUESTS */}
      {activeTab === 'compliance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {deletionRequests.length === 0 ? (
            <div className="sl-empty-state">
              <div className="sl-empty-state-title">No requests found</div>
              <div className="sl-empty-state-desc">No compliance or deletion requests found.</div>
            </div>
          ) : (
            deletionRequests.map(req => (
              <div key={req.id} className="sl-list-card">
                <div className="flex-row">
                  <span className="badge badge-info" style={{ textTransform: 'uppercase' }}>
                    {req.request_type.replace(/_/g, ' ')}
                  </span>
                  <span className={`badge ${
                    req.status === 'completed' ? 'badge-success' :
                    req.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                  }`}>
                    {req.status}
                  </span>
                </div>
                
                <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>{req.org_name}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Requested by: <strong>{req.requester_name}</strong> (User ID: {req.requested_by})
                </p>
                
                <div style={{ background: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '4px', fontSize: '12px', margin: '8px 0' }}>
                  <div><strong>Reason:</strong> {req.reason}</div>
                  {req.target_tenant_id && <div><strong>Target Tenant ID:</strong> {req.target_tenant_id}</div>}
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Date: {new Date(req.created_at).toLocaleString()}
                  </div>
                </div>

                {req.status === 'requested' && (
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleProcessDeletion(req.id, 'reject')}
                      disabled={loading}
                    >
                      Reject
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleProcessDeletion(req.id, 'approve')}
                      disabled={loading}
                    >
                      Approve & Anonymize
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}

