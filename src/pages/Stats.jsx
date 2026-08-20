import React, { useState, useEffect } from 'react';
import {
  Activity,
  BarChart3,
  Home,
  ReceiptText,
  Wallet,
  Percent,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Users,
  Coins,
  RefreshCw
} from 'lucide-react';
import { EmptyState } from '../components/ui-smart';
import { getSessionToken } from '../lib/session.js';

export default function Stats() {
  const [activeTab, setActiveTab] = useState('collections');
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  
  const [data, setData] = useState({
    propertiesCount: 0,
    unitsCount: 0,
    occupiedCount: 0,
    tenantsCount: 0,
    totalExpected: 0,
    totalCollected: 0,
    totalArrears: 0,
    allocatedPaymentsCount: 0,
    totalPaymentsCount: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStatsData();
  }, []);

  const fetchStatsData = async () => {
    setLoading(true);
    setError('');
    try {
      const token = getSessionToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const fetchResult = async (url, fallback) => {
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) {
            console.error(`Stats fetch failed [${res.status}] for ${url}`);
            return fallback;
          }
          const json = await res.json();
          return json;
        } catch (e) {
          console.error(`Stats fetch exception for ${url}:`, e);
          return fallback;
        }
      };

      const [propsData, untsData, tntsData, invsData, pmtsData] = await Promise.all([
        fetchResult('/api/properties', []),
        fetchResult('/api/units', []),
        fetchResult('/api/tenants', []),
        fetchResult('/api/invoices', []),
        fetchResult('/api/payments', [])
      ]);

      const extractArray = (data, keys = []) => {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return [];
        for (const k of keys) {
          if (Array.isArray(data[k])) return data[k];
        }
        return [];
      };

      const props = extractArray(propsData, ['properties']);
      const unts = extractArray(untsData, ['units']);
      const tnts = extractArray(tntsData, ['tenants']);
      const invs = extractArray(invsData, ['invoices']);
      const pmts = extractArray(pmtsData, ['payments', 'transactions']);

      setProperties(props);
      setUnits(unts);
      setTenants(tnts);
      setInvoices(invs);
      setPayments(pmts);

      const expected = unts.reduce((acc, u) => acc + Number(u.rent_amount || 0), 0);
      const collected = invs
        .filter(i => String(i.status || '').toLowerCase() === 'paid')
        .reduce((acc, i) => acc + Number(i.amount_paid || 0), 0);
      const arrears = invs
        .filter(i => String(i.status || '').toLowerCase() === 'overdue' || String(i.status || '').toLowerCase() === 'partially_paid')
        .reduce((acc, i) => acc + Number(i.balance || 0), 0);

      const allocatedPayments = pmts.filter(p => p.allocation_status === 'fully_allocated' || p.allocation_status === 'partially_allocated').length;

      setData({
        propertiesCount: props.length,
        unitsCount: unts.length,
        occupiedCount: unts.filter(u => String(u.status || '').toLowerCase() === 'occupied').length,
        tenantsCount: tnts.length,
        totalExpected: expected,
        totalCollected: collected,
        totalArrears: arrears,
        allocatedPaymentsCount: allocatedPayments,
        totalPaymentsCount: pmts.length
      });
    } catch (err) {
      console.error('Failed to load stats:', err);
      setError('Failed to fetch stats dashboard data. Please click Refresh to try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(val);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '10px' }}>
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading stats reports...</p>
      </div>
    );
  }

  const occupancyRate = data.unitsCount > 0 ? Math.round((data.occupiedCount / data.unitsCount) * 100) : 0;
  const collectionRate = (data.totalCollected + data.totalArrears) > 0 ? Math.round((data.totalCollected / (data.totalCollected + data.totalArrears)) * 100) : 0;
  const matchingRate = data.totalPaymentsCount > 0 ? Math.round((data.allocatedPaymentsCount / data.totalPaymentsCount) * 100) : 0;

  const tabs = [
    { id: 'collections', label: 'Collections' },
    { id: 'arrears', label: 'Arrears' },
    { id: 'occupancy', label: 'Occupancy' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'payments', label: 'Payments' },
    { id: 'reconciliation', label: 'Reconciliation' },
    { id: 'trends', label: 'Monthly Trends' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>Reports & Performance</h2>
          <p className="text-muted" style={{ fontSize: '12px', margin: '4px 0 0 0' }}>
            Real-time financial metrics, collections efficiency, and operational trends.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={fetchStatsData}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ padding: '12px', display: 'block', textAlign: 'left' }}>
          {error}
        </div>
      )}

      {/* Reports navigation sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', overflowX: 'auto', gap: '4px' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'none',
              color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : 'none',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '12px',
              whiteSpace: 'nowrap'
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT: COLLECTIONS */}
      {activeTab === 'collections' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="grid-2">
            <div className="card">
              <span className="kpi-lbl">Billed Monthly Rent</span>
              <h3 style={{ fontSize: '24px', margin: '4px 0' }}>{formatCurrency(data.totalExpected)}</h3>
            </div>
            <div className="card">
              <span className="kpi-lbl">Collected Collections</span>
              <h3 style={{ fontSize: '24px', color: 'var(--success)', margin: '4px 0' }}>{formatCurrency(data.totalCollected)}</h3>
            </div>
          </div>

          <div className="card">
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700' }}>Collection Performance Rate</h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
              <span>Billed vs Received</span>
              <strong>{collectionRate}%</strong>
            </div>
            <div style={{ width: '100%', height: '14px', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${collectionRate}%`, height: '100%', backgroundColor: '#4caf50' }} />
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: ARREARS */}
      {activeTab === 'arrears' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card">
            <span className="kpi-lbl">Outstanding Debt</span>
            <h3 style={{ fontSize: '24px', color: 'var(--danger)', margin: '4px 0' }}>{formatCurrency(data.totalArrears)}</h3>
          </div>

          <div className="card">
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700' }}>Due Tenants Account Breakdown</h4>
            {(Array.isArray(tenants) ? tenants : []).filter(t => t.balance > 0).length === 0 ? (
              <EmptyState icon={CheckCircle} title="No Outstanding Arrears" description="All active tenant accounts are fully settled." />
            ) : (
              <table className="sl-table">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Unit</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(tenants) ? tenants : []).filter(t => t.balance > 0).map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: '600' }}>{t.full_name}</td>
                      <td>{t.unit_code}</td>
                      <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--danger)' }}>{formatCurrency(t.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: OCCUPANCY */}
      {activeTab === 'occupancy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card">
            <span className="kpi-lbl">Occupancy Rate</span>
            <h3 style={{ fontSize: '24px', margin: '4px 0' }}>{occupancyRate}%</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {data.occupiedCount} occupied of {data.unitsCount} registered units.
            </p>
          </div>

          <div className="card">
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700' }}>Property Occupancy Details</h4>
            {(Array.isArray(properties) ? properties : []).length === 0 ? (
              <EmptyState icon={Home} title="No Properties Found" description="Configure properties to track occupancy." />
            ) : (
              <table className="sl-table">
                <thead>
                  <tr>
                    <th>Property Name</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Occupied / Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(properties) ? properties : []).map(p => {
                    const totalUnits = (Array.isArray(units) ? units : []).filter(u => u.property_id === p.id).length;
                    const occupiedUnits = (Array.isArray(units) ? units : []).filter(u => u.property_id === p.id && u.status === 'occupied').length;
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: '600' }}>{p.name}</td>
                        <td>{p.property_type}</td>
                        <td style={{ textAlign: 'right', fontWeight: '700' }}>{occupiedUnits} / {totalUnits}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: INVOICES */}
      {activeTab === 'invoices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="grid-2">
            <div className="card">
              <span className="kpi-lbl">Total Issued Invoices</span>
              <h3 style={{ fontSize: '24px', margin: '4px 0' }}>{(Array.isArray(invoices) ? invoices : []).length}</h3>
            </div>
            <div className="card">
              <span className="kpi-lbl">Overdue Invoices</span>
              <h3 style={{ fontSize: '24px', color: 'var(--danger)', margin: '4px 0' }}>
                {(Array.isArray(invoices) ? invoices : []).filter(i => i.status === 'overdue').length}
              </h3>
            </div>
          </div>

          <div className="card">
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700' }}>Invoice Lifecycle Distribution</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Paid Invoices</span>
                <strong>{(Array.isArray(invoices) ? invoices : []).filter(i => i.status === 'paid').length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Partially Paid Invoices</span>
                <strong>{(Array.isArray(invoices) ? invoices : []).filter(i => i.status === 'partially_paid').length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Overdue Invoices</span>
                <strong>{(Array.isArray(invoices) ? invoices : []).filter(i => i.status === 'overdue').length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Drafts</span>
                <strong>{(Array.isArray(invoices) ? invoices : []).filter(i => i.status === 'draft').length}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: PAYMENTS */}
      {activeTab === 'payments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="grid-2">
            <div className="card">
              <span className="kpi-lbl">Total Recorded Payments</span>
              <h3 style={{ fontSize: '24px', margin: '4px 0' }}>{(Array.isArray(payments) ? payments : []).length}</h3>
            </div>
            <div className="card">
              <span className="kpi-lbl">Collection Value</span>
              <h3 style={{ fontSize: '24px', color: 'var(--success)', margin: '4px 0' }}>
                {formatCurrency(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0))}
              </h3>
            </div>
          </div>

          <div className="card">
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '700' }}>Payment Channel Share</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>M-Pesa Collections</span>
                <strong>{(Array.isArray(payments) ? payments : []).filter(p => p.payment_method === 'mpesa').length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Bank Deposits</span>
                <strong>{(Array.isArray(payments) ? payments : []).filter(p => p.payment_method === 'bank_transfer' || p.payment_method === 'bank').length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Cash Receipts</span>
                <strong>{(Array.isArray(payments) ? payments : []).filter(p => p.payment_method === 'cash').length}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card">
            <span className="kpi-lbl">Bank Matching Efficiency</span>
            <h3 style={{ fontSize: '24px', margin: '4px 0' }}>{matchingRate}%</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {data.allocatedPaymentsCount} transactions matched of {data.totalPaymentsCount} total statement payments.
            </p>
          </div>

          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-surface-elevated)', borderRadius: '8px', padding: '16px' }}>
            <Coins size={20} style={{ color: 'var(--primary)' }} />
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: '700' }}>Reconciliation Efficiency Log</h4>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                View unmatched items and perform manual allocations inside the <strong>Banking</strong> flow under Billing.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: MONTHLY TRENDS */}
      {activeTab === 'trends' && (
        <EmptyState
          icon={Percent}
          title="Monthly Trends Coming Soon"
          description="Collection cycle trends, historical arrears tracking, and year-on-year revenue charts will populate as you capture consecutive billing data."
        />
      )}

    </div>
  );
}
