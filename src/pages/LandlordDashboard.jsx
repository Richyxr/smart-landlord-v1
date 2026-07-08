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

      const [
        resProps,
        resUnits,
        resTenants,
        resInvoices,
        resStaging,
        resReadings,
        resSaaS,
        resReadiness,
        resPayments
      ] = await Promise.all([
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

      const [
        propsPayload,
        unitsPayload,
        tenantsPayload,
        invoicesPayload,
        stagingPayload,
        readingsPayload,
        saas,
        readiness,
        paymentsPayload
      ] = await Promise.all([
        resProps.json(),
        resUnits.json(),
        resTenants.json(),
        resInvoices.json(),
        resStaging.json(),
        resReadings.json(),
        resSaaS.json(),
        resReadiness.json(),
        resPayments.json()
      ]);

      const props = extractArray(propsPayload, ['properties']);
      const units = extractArray(unitsPayload, ['units']);
      const tenants = extractArray(tenantsPayload, ['tenants']);
      const invoices = extractArray(invoicesPayload, ['invoices']);
      const staging = extractArray(stagingPayload, ['rows', 'staging']);
      const readings = extractArray(readingsPayload, ['meter_readings', 'readings']);
      const payments = extractArray(paymentsPayload, ['payments', 'transactions']);

      const propertyUnitCount = props.reduce((acc, prop) => acc + toNumber(prop.total_units), 0);
      const propertyOccupiedCount = props.reduce((acc, prop) => acc + toNumber(prop.occupied_units), 0);
      const unitCount = units.length > 0 ? units.length : propertyUnitCount;
      const occupiedCount = units.length > 0
        ? units.filter((u) => String(u.status || '').toLowerCase() === 'occupied').length
        : propertyOccupiedCount;

      const expected = units.length > 0
        ? units.reduce((acc, curr) => acc + toNumber(curr.rent_amount), 0)
        : props.reduce((acc, curr) => acc + toNumber(curr.expected_rent), 0);
      const collected = payments.length > 0
        ? payments
          .filter(isCurrentMonthPayment)
          .reduce((acc, curr) => acc + toNumber(curr.amount), 0)
        : invoices
          .filter((i) => String(i.status || '').toLowerCase() === 'paid')
          .reduce((acc, curr) => acc + toNumber(curr.amount_paid), 0);
      const outstanding = invoices.length > 0
        ? invoices
          .filter((i) => ['overdue', 'partially_paid', 'issued'].includes(String(i.status || '').toLowerCase()))
          .reduce((acc, curr) => acc + toNumber(curr.balance), 0)
        : tenants.reduce((acc, curr) => acc + toNumber(curr.balance), 0);

      setStats({
        propertiesCount: props.length,
        unitsCount: unitCount,
        occupiedCount,
        vacantCount: units.length > 0
          ? units.filter((u) => String(u.status || '').toLowerCase() === 'vacant').length
          : Math.max(unitCount - occupiedCount, 0),
        expectedRent: expected,
        collectedRent: collected,
        arrears: outstanding,
        unmatchedCount: staging.filter((r) => r.status === 'unmatched' || r.status === 'needs_review').length,
        pendingReadingsCount: readings.filter((r) => r.status === 'submitted').length,
        saasLocked: !!saas.organization?.is_locked,
        readinessStatus: readiness.is_ready !== false,
        subscriptionStatus: saas.organization?.subscription_status || 'trial',
        trialEndsAt: saas.organization?.trial_ends_at || null,
        subscriptionExpiresAt: saas.organization?.subscription_expires_at || null,
        hasPropertiesData: Array.isArray(propsPayload) || Array.isArray(propsPayload?.properties),
        hasUnitsData: Array.isArray(unitsPayload) || Array.isArray(unitsPayload?.units) || propertyUnitCount > 0,
        hasPaymentsData: Array.isArray(paymentsPayload) || Array.isArray(paymentsPayload?.payments) || Array.isArray(paymentsPayload?.transactions),
        hasInvoicesData: Array.isArray(invoicesPayload) || Array.isArray(invoicesPayload?.invoices)
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
  }

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
            value={stats.hasPropertiesData ? stats.propertiesCount : 'No data yet'}
            icon={Building2}
            onClick={() => onNavigate('landlord_properties', 'properties')}
          />
          <MetricCard
            label="Occupancy"
            value={stats.hasUnitsData ? `${stats.occupiedCount} / ${stats.unitsCount}` : 'No data yet'}
            helper="Active units"
            icon={Home}
            onClick={() => onNavigate('landlord_properties', 'units')}
          />
          <MetricCard
            label="Rent Collected"
            value={(stats.hasPaymentsData || stats.hasInvoicesData) ? formatCurrency(stats.collectedRent) : 'No data yet'}
            helper="Current month"
            icon={Wallet}
            tone="success"
            onClick={() => onNavigate('landlord_invoices', 'overview')}
          />
          <MetricCard
            label="Arrears"
            value={stats.hasInvoicesData ? formatCurrency(stats.arrears) : 'No data yet'}
            helper="Unpaid balance"
            icon={AlertTriangle}
            tone={stats.arrears > 0 ? 'danger' : 'default'}
            onClick={() => onNavigate('landlord_invoices', 'due_tenants')}
          />
        </div>

        <DashboardCard accent="success">
          <span className="kpi-lbl">Current Month Collections</span>
          <h3 style={{ fontSize: '28px', color: 'var(--success)', fontFamily: 'var(--font-title)', fontWeight: '800', margin: '4px 0' }}>
            {(stats.hasPaymentsData || stats.hasInvoicesData) ? formatCurrency(stats.collectedRent) : 'No data yet'}
          </h3>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

          <div className="grid-2">
            <div>
              <span className="kpi-lbl">Expected Revenue</span>
              <div style={{ fontSize: '15px', fontWeight: '600' }}>
                {stats.hasUnitsData ? formatCurrency(stats.expectedRent) : 'No data yet'}
              </div>
            </div>
            <div>
              <span className="kpi-lbl">Outstanding Arrears</span>
              <div style={{ fontSize: '15px', fontWeight: '600', color: stats.arrears > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                {stats.hasInvoicesData ? formatCurrency(stats.arrears) : 'No data yet'}
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
          {recentPayments.length === 0 ? (
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
          {recentInvoices.length === 0 ? (
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
