import React from 'react';
import { Activity, BarChart3, Home, LineChart, ReceiptText, Wallet } from 'lucide-react';

const statsCards = [
  { title: 'Collections', icon: Wallet },
  { title: 'Arrears', icon: Activity },
  { title: 'Occupancy', icon: Home },
  { title: 'Invoice Status', icon: ReceiptText },
  { title: 'Payment Matching', icon: BarChart3 },
  { title: 'Monthly Trends', icon: LineChart }
];

export default function Stats() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h2 className="page-title" style={{ margin: 0 }}>Stats</h2>
        <p className="text-muted" style={{ fontSize: '12px', margin: '4px 0 0 0', maxWidth: '680px' }}>
          Track collections, arrears, occupancy, invoice status, and payment matching performance.
        </p>
      </div>

      <div className="grid-2">
        {statsCards.map(({ title, icon: Icon }) => (
          <div key={title} className="sl-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span className="sl-metric-icon" style={{ display: 'flex', alignItems: 'center' }}>
                <Icon size={18} />
              </span>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '800' }}>{title}</h3>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Coming Soon</p>
          </div>
        ))}
      </div>
    </div>
  );
}
