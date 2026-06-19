import React, { useState, useEffect } from 'react';
import {
  Button,
  DashboardCard,
  EmptyState,
  MetricCard,
  SectionCard,
  SetupAlert,
  StatusBadge
} from '../components/ui-smart';
import { AlertTriangle, Building2, Home, Wallet, ReceiptText, Zap, HandCoins } from 'lucide-react';

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
        readinessStatus: readiness.is_ready
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

  const invoiceStatusTone = (status) => {
    if (status === 'paid') return 'success';
    if (status === 'overdue') return 'danger';
    return 'warning';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div className="pulse-primary" style={{ padding: '20px', borderRadius: '50%', background: 'var(--bg-surface)' }}>
          ⏳ Loading Dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="sl-dashboard-stack">
      <DashboardCard accent="primary">
        <p className="kpi-lbl" style={{ color: 'var(--primary)' }}>Organization</p>
        <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'var(--font-title)', marginTop: '2px' }}>
          {organization.name}
        </h2>
        <div className="flex-row" style={{ marginTop: '12px' }}>
          <StatusBadge tone={stats.saasLocked ? 'danger' : 'success'}>
            {stats.saasLocked ? 'Locked' : 'Active Subscription'}
          </StatusBadge>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Currency: <strong>{organization.billing_currency}</strong>
          </span>
        </div>
      </DashboardCard>

      {!stats.readinessStatus && (
        <SetupAlert
          title="Setup Not Completed"
          description="Configure your SMS gateway, PIN, and properties to get ready."
          actionLabel="Review"
          onClick={() => onNavigate('landlord_settings')}
        />
      )}

      {(stats.unmatchedCount > 0 || stats.pendingReadingsCount > 0) && (
        <div className="sl-dashboard-stack">
          {stats.unmatchedCount > 0 && (
            <SetupAlert
              icon={HandCoins}
              tone="danger"
              title={`${stats.unmatchedCount} Unmatched Payments`}
              description="Incoming statement entries require reconciliation."
              actionLabel="Review"
              onClick={() => onNavigate('landlord_reconciliation')}
            />
          )}

          {stats.pendingReadingsCount > 0 && (
            <SetupAlert
              icon={Zap}
              tone="warning"
              title={`${stats.pendingReadingsCount} Pending Readings`}
              description="Caretaker submitted meter readings require approval."
              actionLabel="Approve"
              onClick={() => onNavigate('landlord_settings')}
            />
          )}
        </div>
      )}

      <div className="sl-dashboard-grid">
        <MetricCard
          label="Total Properties"
          value={stats.propertiesCount}
          icon={Building2}
        />
        <MetricCard
          label="Occupancy"
          value={`${stats.occupiedCount} / ${stats.unitsCount}`}
          helper="Units occupied"
          icon={Home}
        />
        <MetricCard
          label="Collected"
          value={formatCurrency(stats.collectedRent)}
          helper="Current month"
          icon={Wallet}
          tone="success"
        />
        <MetricCard
          label="Arrears"
          value={formatCurrency(stats.arrears)}
          helper="Outstanding balance"
          icon={AlertTriangle}
          tone={stats.arrears > 0 ? 'danger' : 'default'}
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
          <Button size="sm" onClick={() => onNavigate('landlord_reconciliation')}>
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
          <Button size="sm" onClick={() => onNavigate('landlord_invoices')}>
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
  );
}

