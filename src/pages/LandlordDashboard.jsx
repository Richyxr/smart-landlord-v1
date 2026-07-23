import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Building2,
  Home,
  ReceiptText,
  Wallet,
  Zap,
  HandCoins,
  ShieldCheck,
  PlusCircle,
  FileSpreadsheet
} from 'lucide-react';
import { DashboardCard, MetricCard, SetupAlert, SectionCard, StatusBadge, Button, EmptyState } from '../components/ui-smart';
import { getSessionToken } from '../lib/session.js';

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
    readinessStatus: true,
    subscriptionStatus: 'trial',
    trialEndsAt: null,
    subscriptionExpiresAt: null,
    // Error tracking
    propsError: false,
    propsStatus: 200,
    unitsError: false,
    unitsStatus: 200,
    tenantsError: false,
    tenantsStatus: 200,
    invoicesError: false,
    invoicesStatus: 200,
    paymentsError: false,
    paymentsStatus: 200,
    stagingError: false,
    stagingStatus: 200,
    readingsError: false,
    readingsStatus: 200,
    saasError: false,
    saasStatus: 200,
    readinessError: false,
    readinessFetchStatus: 200,
    // Data presence flags
    hasPropertiesData: false,
    hasUnitsData: false,
    hasPaymentsData: false,
    hasInvoicesData: false
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
      const token = getSessionToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const fetchResult = async (url, fallback) => {
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) {
            return { error: true, status: res.status, data: fallback };
          }
          const data = await res.json();
          return { error: false, status: res.status, data };
        } catch (err) {
          return { error: true, status: 500, message: err.message, data: fallback };
        }
      };

      const [
        propsRes,
        unitsRes,
        tenantsRes,
        invoicesRes,
        stagingRes,
        readingsRes,
        saasRes,
        readinessRes,
        paymentsRes
      ] = await Promise.all([
        fetchResult('/api/properties', []),
        fetchResult('/api/units', []),
        fetchResult('/api/tenants', []),
        fetchResult('/api/invoices', []),
        fetchResult('/api/reconciliation/staging', []),
        fetchResult('/api/meter-readings', []),
        fetchResult('/api/saas/status', {}),
        fetchResult('/api/settings/readiness', {}),
        fetchResult('/api/payments', [])
      ]);

      const props = extractArray(propsRes.data, ['properties']);
      const units = extractArray(unitsRes.data, ['units']);
      const tenants = extractArray(tenantsRes.data, ['tenants']);
      const invoices = extractArray(invoicesRes.data, ['invoices']);
      const staging = extractArray(stagingRes.data, ['rows', 'staging']);
      const readings = extractArray(readingsRes.data, ['meter_readings', 'readings']);
      const payments = extractArray(paymentsRes.data, ['payments', 'transactions']);

      const propertyUnitCount = props.reduce((acc, prop) => acc + toNumber(prop.total_units), 0);
      const propertyOccupiedCount = props.reduce((acc, prop) => acc + toNumber(prop.occupied_units), 0);
      const unitCount = (Array.isArray(units) ? units : []).length > 0 ? (Array.isArray(units) ? units : []).length : propertyUnitCount;
      const occupiedCount = (Array.isArray(units) ? units : []).length > 0
        ? (Array.isArray(units) ? units : []).filter((u) => String(u.status || '').toLowerCase() === 'occupied').length
        : propertyOccupiedCount;

      const activeTenants = (Array.isArray(tenants) ? tenants : []).filter((t) => t.status === 'active');
      const expected = activeTenants.reduce((acc, curr) => acc + toNumber(curr.rent_amount), 0);
      const collected = invoices
        .filter((inv) => String(inv.status || '').toLowerCase() === 'paid')
        .reduce((acc, curr) => acc + toNumber(curr.amount_paid), 0);
      const outstanding = activeTenants.reduce((acc, curr) => acc + toNumber(curr.balance), 0);

      const saas = saasRes.data || {};
      const readiness = readinessRes.data || {};

      setStats({
        propertiesCount: props.length,
        unitsCount: unitCount,
        occupiedCount,
        vacantCount: (Array.isArray(units) ? units : []).length > 0
          ? (Array.isArray(units) ? units : []).filter((u) => String(u.status || '').toLowerCase() === 'vacant').length
          : Math.max(unitCount - occupiedCount, 0),
        expectedRent: expected,
        collectedRent: collected,
        arrears: outstanding,
        unmatchedCount: (Array.isArray(staging) ? staging : []).filter((r) => r.status === 'unmatched' || r.status === 'needs_review').length,
        pendingReadingsCount: (Array.isArray(readings) ? readings : []).filter((r) => r.status === 'submitted').length,
        saasLocked: !!saas.organization?.is_locked,
        readinessStatus: readiness.is_ready !== false,
        subscriptionStatus: saas.organization?.subscription_status || 'trial',
        trialEndsAt: saas.organization?.trial_ends_at || null,
        subscriptionExpiresAt: saas.organization?.subscription_expires_at || null,
        // Error tracking
        propsError: propsRes.error,
        propsStatus: propsRes.status,
        unitsError: unitsRes.error,
        unitsStatus: unitsRes.status,
        tenantsError: tenantsRes.error,
        tenantsStatus: tenantsRes.status,
        invoicesError: invoicesRes.error,
        invoicesStatus: invoicesRes.status,
        paymentsError: paymentsRes.error,
        paymentsStatus: paymentsRes.status,
        stagingError: stagingRes.error,
        stagingStatus: stagingRes.status,
        readingsError: readingsRes.error,
        readingsStatus: readingsRes.status,
        saasError: saasRes.error,
        saasStatus: saasRes.status,
        readinessError: readinessRes.error,
        readinessFetchStatus: readinessRes.status,
        // Data presence flags
        hasPropertiesData: !propsRes.error,
        hasUnitsData: !unitsRes.error,
        hasPaymentsData: !paymentsRes.error,
        hasInvoicesData: !invoicesRes.error
      });

      setRecentPayments(payments.slice(0, 3));
      setRecentInvoices(invoices.slice(0, 3));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const extractArray = (payload, keys = []) => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  };

  const isCurrentMonthPayment = (payment) => {
    const rawDate = payment.transaction_date || payment.received_at || payment.reconciled_at || payment.created_at;
    if (!rawDate) return false;
    const paymentDate = new Date(rawDate);
    if (Number.isNaN(paymentDate.getTime())) return false;
    const now = new Date();
    return paymentDate.getFullYear() === now.getFullYear() && paymentDate.getMonth() === now.getMonth();
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: organization.billing_currency || 'KES',
      maximumFractionDigits: 0
    }).format(val);
  };

  const getSubscriptionStatusText = () => {
    if (stats.saasLocked) {
      return 'Locked';
    }
    if (stats.subscriptionStatus === 'trial') {
      if (stats.trialEndsAt) {
        const dateStr = new Date(stats.trialEndsAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        return `Trial expires: ${dateStr}`;
      }
      return 'Trial';
    }
    if (stats.subscriptionStatus === 'active') {
      if (stats.subscriptionExpiresAt) {
        const dateStr = new Date(stats.subscriptionExpiresAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        return `Expiry: ${dateStr}`;
      }
      return 'Active Subscription';
    }
    if (stats.subscriptionStatus === 'overdue') {
      return 'Subscription Overdue';
    }
    return 'Active Subscription';
  };

  const invoiceStatusTone = (status) => {
    if (status === 'paid') return 'success';
    if (status === 'overdue') return 'danger';
    return 'warning';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div className="sl-loading-pill">
          <span className="sl-loading-spinner" aria-hidden="true"></span>
          <span>Loading Dashboard...</span>
        </div>
      </div>
    );
  }  const getMetricValue = (key, formatter = (val) => val) => {
    if (key === 'properties') {
      if (stats.propsError) {
        return stats.propsStatus === 404 ? 'Unavailable' : 'Unable to load';
      }
      return stats.propertiesCount > 0 ? formatter(stats.propertiesCount) : 'No data yet';
    }
    
    if (key === 'occupancy') {
      if (stats.unitsError || stats.propsError) {
        const is404 = stats.unitsStatus === 404 || stats.propsStatus === 404;
        return is404 ? 'Unavailable' : 'Unable to load';
      }
      return stats.propertiesCount > 0 ? `${stats.occupiedCount} / ${stats.unitsCount}` : 'No data yet';
    }
    
    if (key === 'collected') {
      if (stats.invoicesError) {
        return stats.invoicesStatus === 404 ? 'Unavailable' : 'Unable to load';
      }
      if (stats.propertiesCount === 0) {
        return 'No data yet';
      }
      return formatter(stats.collectedRent);
    }
    
    if (key === 'expected') {
      if (stats.tenantsError) {
        return stats.tenantsStatus === 404 ? 'Unavailable' : 'Unable to load';
      }
      if (stats.propertiesCount === 0) {
        return 'No data yet';
      }
      return formatter(stats.expectedRent);
    }
    
    if (key === 'arrears') {
      if (stats.tenantsError) {
        return stats.tenantsStatus === 404 ? 'Unavailable' : 'Unable to load';
      }
      if (stats.propertiesCount === 0) {
        return 'No data yet';
      }
      return formatter(stats.arrears);
    }
    
    return 'No data yet';
  };

  return (
    <div className="sl-dashboard-stack" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* SECTION 1: ACCOUNT STATUS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <DashboardCard accent="primary">
          <p className="kpi-lbl" style={{ color: 'var(--primary)' }}>
            {organization.type === 'company' ? 'Company Portfolio' : 'Landlord Profile'}
          </p>
          <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'var(--font-title)', marginTop: '2px' }}>
            {organization.name}
          </h2>
          <div className="flex-row" style={{ marginTop: '12px' }}>
            <StatusBadge tone={(stats.saasLocked || stats.subscriptionStatus === 'overdue') ? 'danger' : 'success'}>
              {getSubscriptionStatusText()}
            </StatusBadge>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Currency: <strong>{organization.billing_currency}</strong>
            </span>
          </div>
        </DashboardCard>

        {!stats.readinessStatus && (
          <SetupAlert
            title="Setup Checklist Incomplete"
            description="Complete the initial configuration tasks to ensure SMS dispatching and security PIN are ready."
            actionLabel="Review Setup"
            onClick={() => onNavigate('landlord_settings', 'readiness')}
          />
        )}
      </div>

      {/* SECTION 2: ATTENTION REQUIRED */}
      {(stats.arrears > 0 || stats.unmatchedCount > 0 || stats.pendingReadingsCount > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h4 style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attention Required</h4>
          
          {stats.arrears > 0 && (
            <SetupAlert
              icon={AlertTriangle}
              tone="danger"
              title="Outstanding Arrears"
              description={`Landlord has ${formatCurrency(stats.arrears)} in outstanding arrears from overdue tenant invoices.`}
              actionLabel="View Due Tenants"
              onClick={() => onNavigate('landlord_invoices', 'due_tenants')}
            />
          )}

          {stats.unmatchedCount > 0 && (
            <SetupAlert
              icon={HandCoins}
              tone="warning"
              title={`${stats.unmatchedCount} Unresolved Bank Transactions`}
              description="New statement transactions require reconciliation matching."
              actionLabel="Resolve"
              onClick={() => onNavigate('landlord_invoices', 'banking')}
            />
          )}

          {stats.pendingReadingsCount > 0 && (
            <SetupAlert
              icon={Zap}
              tone="info"
              title={`${stats.pendingReadingsCount} Submitted Caretaker Readings`}
              description="Submitted utility meter readings require review and confirmation before billing."
              actionLabel="Approve"
              onClick={() => onNavigate('landlord_settings', 'readings')}
            />
          )}
        </div>
      )}

      {/* SECTION 3: TODAY'S BUSINESS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h4 style={{ margin: '0', fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today's Business</h4>

        <div className="sl-dashboard-grid">
          <MetricCard
            label="Total Properties"
            value={getMetricValue('properties')}
            icon={Building2}
            onClick={() => onNavigate('landlord_properties', 'properties')}
          />
          <MetricCard
            label="Occupancy"
            value={getMetricValue('occupancy')}
            helper="Active units"
            icon={Home}
            onClick={() => onNavigate('landlord_properties', 'units')}
          />
          <MetricCard
            label="Rent Collected"
            value={getMetricValue('collected', formatCurrency)}
            helper="Current month"
            icon={Wallet}
            tone="success"
            onClick={() => onNavigate('landlord_invoices', 'overview')}
          />
          <MetricCard
            label="Arrears"
            value={getMetricValue('arrears', formatCurrency)}
            helper="Unpaid balance"
            icon={AlertTriangle}
            tone={stats.arrears > 0 ? 'danger' : 'default'}
            onClick={() => onNavigate('landlord_invoices', 'due_tenants')}
          />
        </div>

        <DashboardCard accent="success">
          <span className="kpi-lbl">Current Month Collections</span>
          <h3 style={{ fontSize: '28px', color: 'var(--success)', fontFamily: 'var(--font-title)', fontWeight: '800', margin: '4px 0' }}>
            {getMetricValue('collected', formatCurrency)}
          </h3>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

          <div className="grid-2">
            <div>
              <span className="kpi-lbl">Expected Revenue</span>
              <div style={{ fontSize: '15px', fontWeight: '600' }}>
                {getMetricValue('expected', formatCurrency)}
              </div>
            </div>
            <div>
              <span className="kpi-lbl">Outstanding Arrears</span>
              <div style={{ fontSize: '15px', fontWeight: '600', color: stats.arrears > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                {getMetricValue('arrears', formatCurrency)}
              </div>
            </div>
          </div>
        </DashboardCard>

         <SectionCard
          title="Recent Payments"
          action={
            <Button size="sm" onClick={() => onNavigate('landlord_invoices', 'payments')}>
              View All
            </Button>
          }
        >
          {stats.paymentsError ? (
            <div style={{ color: 'var(--danger)', fontSize: '13px', padding: '12px', textAlign: 'center' }}>
              {stats.paymentsStatus === 404 ? 'Payments feature unavailable' : 'Unable to load recent payments'}
            </div>
          ) : recentPayments.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No payments yet"
              description="Recorded payments will appear here."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentPayments.map((pay) => (
                <div key={pay.id} className="flex-row" style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: '600' }}>{pay.tenant_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Ref: {pay.reference_number} • {new Date(pay.transaction_date).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ color: 'var(--success)', fontWeight: '700' }}>
                    +{formatCurrency(pay.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent Invoices"
          action={
            <Button size="sm" onClick={() => onNavigate('landlord_invoices', 'invoices')}>
              View All
            </Button>
          }
        >
          {stats.invoicesError ? (
            <div style={{ color: 'var(--danger)', fontSize: '13px', padding: '12px', textAlign: 'center' }}>
              {stats.invoicesStatus === 404 ? 'Invoices feature unavailable' : 'Unable to load recent invoices'}
            </div>
          ) : recentInvoices.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No invoices yet"
              description="Created invoices will appear here."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentInvoices.map((inv) => (
                <div key={inv.id} className="flex-row" style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: '600' }}>{inv.tenant_name} ({inv.unit_code})</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Due: {inv.due_date} • {inv.invoice_number}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <div style={{ fontWeight: '600' }}>{formatCurrency(inv.total)}</div>
                    <StatusBadge tone={invoiceStatusTone(inv.status)}>
                      {inv.status}
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* SECTION 4: QUICK ACTIONS */}
      <SectionCard title="Quick Actions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
          <Button size="sm" onClick={() => onNavigate('landlord_properties', 'properties')}>
            Manage Properties
          </Button>
          <Button size="sm" onClick={() => onNavigate('landlord_invoices', 'invoices')}>
            Manage Invoices
          </Button>
          <Button size="sm" onClick={() => onNavigate('landlord_invoices', 'banking')}>
            Reconcile Banking
          </Button>
          <Button size="sm" onClick={() => onNavigate('landlord_properties', 'tenants')}>
            Manage Tenants
          </Button>
        </div>
      </SectionCard>

    </div>
  );
}
