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
    subscriptionExpiresAt: null
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

      const props = await resProps.json();
      const units = await resUnits.json();
      const tenants = await resTenants.json();
      const invoices = await resInvoices.json();
      const staging = await resStaging.json();
      const readings = await resReadings.json();
      const saas = await resSaaS.json();
      const readiness = await resReadiness.json();
      const payments = await resPayments.json();

      const expected = units.reduce((acc, curr) => acc + (curr.rent_amount || 0), 0);
      const collected = invoices
        .filter((i) => i.status === 'paid')
        .reduce((acc, curr) => acc + (curr.amount_paid || 0), 0);
      const outstanding = invoices
        .filter((i) => i.status === 'overdue' || i.status === 'partially_paid')
        .reduce((acc, curr) => acc + (curr.balance || 0), 0);

      setStats({
        propertiesCount: props.length,
        unitsCount: units.length,
        occupiedCount: units.filter((u) => u.status === 'occupied').length,
        vacantCount: units.filter((u) => u.status === 'vacant').length,
        expectedRent: expected,
        collectedRent: collected,
        arrears: outstanding,
        unmatchedCount: staging.filter((r) => r.status === 'unmatched' || r.status === 'needs_review').length,
        pendingReadingsCount: readings.filter((r) => r.status === 'submitted').length,
        saasLocked: saas.organization.is_locked,
        readinessStatus: readiness.is_ready,
        subscriptionStatus: saas.organization.subscription_status,
        trialEndsAt: saas.organization.trial_ends_at,
        subscriptionExpiresAt: saas.organization.subscription_expires_at
      });

      setRecentPayments(payments.slice(0, 3));
      setRecentInvoices(invoices.slice(0, 3));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
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
            value={stats.propertiesCount}
            icon={Building2}
            onClick={() => onNavigate('landlord_properties', 'properties')}
          />
          <MetricCard
            label="Occupancy"
            value={`${stats.occupiedCount} / ${stats.unitsCount}`}
            helper="Active units"
            icon={Home}
            onClick={() => onNavigate('landlord_properties', 'units')}
          />
          <MetricCard
            label="Rent Collected"
            value={formatCurrency(stats.collectedRent)}
            helper="Current month"
            icon={Wallet}
            tone="success"
            onClick={() => onNavigate('landlord_invoices', 'overview')}
          />
          <MetricCard
            label="Arrears"
            value={formatCurrency(stats.arrears)}
            helper="Unpaid balance"
            icon={AlertTriangle}
            tone={stats.arrears > 0 ? 'danger' : 'default'}
            onClick={() => onNavigate('landlord_invoices', 'due_tenants')}
          />
        </div>

        <DashboardCard accent="success">
          <span className="kpi-lbl">Current Month Collections</span>
          <h3 style={{ fontSize: '28px', color: 'var(--success)', fontFamily: 'var(--font-title)', fontWeight: '800', margin: '4px 0' }}>
            {formatCurrency(stats.collectedRent)}
          </h3>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

          <div className="grid-2">
            <div>
              <span className="kpi-lbl">Expected Revenue</span>
              <div style={{ fontSize: '15px', fontWeight: '600' }}>
                {formatCurrency(stats.expectedRent)}
              </div>
            </div>
            <div>
              <span className="kpi-lbl">Outstanding Arrears</span>
              <div style={{ fontSize: '15px', fontWeight: '600', color: stats.arrears > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                {formatCurrency(stats.arrears)}
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
