import React, { useState } from 'react';

export default function DevSwitcher({ currentRole, onChangeRole, currentOrgId, onTriggerLockout, onRefreshData }) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Webhook Simulation State
  const [transId, setTransId] = useState(`TXID${Math.floor(100000 + Math.random() * 900000)}`);
  const [amount, setAmount] = useState('45000');
  const [billRef, setBillRef] = useState('ACC-0010-A1');
  const [phone, setPhone] = useState('254711222333');
  const [payerName, setPayerName] = useState('David Kiprop');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const triggerWebhook = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          TransID: transId,
          TransAmount: amount,
          BillRefNumber: billRef,
          MSISDN: phone,
          FirstName: payerName.split(' ')[0] || 'Demo',
          LastName: payerName.split(' ')[1] || 'Payer'
        })
      });

      if (res.ok) {
        setMessage('Callback simulated! Ledger or Staging updated.');
        setTransId(`TXID${Math.floor(100000 + Math.random() * 900000)}`);
        onRefreshData();
      } else {
        setMessage('Simulation failed.');
      }
    } catch (err) {
      setMessage('Network error.');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerLockout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/saas/trigger-bill-run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-organization-id': currentOrgId.toString(),
          'x-user-id': '2'
        }
      });
      if (res.ok) {
        onTriggerLockout();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dev-switcher">
      <button 
        className="dev-switcher-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Developer Testing Panel"
      >
        🛠️
      </button>

      {isOpen && (
        <div className="dev-switcher-panel">
          <div className="dev-section-title">🎭 Switch Role</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button 
              className={`btn btn-secondary btn-sm ${currentRole === 'landlord' ? 'btn-primary' : ''}`}
              style={{ flex: '1 1 45%' }}
              onClick={() => { onChangeRole('landlord'); setIsOpen(false); }}
            >
              Landlord
            </button>
            <button 
              className={`btn btn-secondary btn-sm ${currentRole === 'caretaker' ? 'btn-primary' : ''}`}
              style={{ flex: '1 1 45%' }}
              onClick={() => { onChangeRole('caretaker'); setIsOpen(false); }}
            >
              Caretaker
            </button>
            <button 
              className={`btn btn-secondary btn-sm ${currentRole === 'super_admin' ? 'btn-primary' : ''}`}
              style={{ flex: '1 1 100%' }}
              onClick={() => { onChangeRole('super_admin'); setIsOpen(false); }}
            >
              Super Admin
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />

          <div className="dev-section-title">⚡ Simulate M-Pesa Callback</div>
          <form onSubmit={triggerWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div className="grid-2">
              <input 
                type="text" 
                placeholder="Ref (e.g. QWE123R)" 
                className="form-control" 
                style={{ fontSize: '11px', padding: '6px' }}
                value={transId}
                onChange={e => setTransId(e.target.value)}
              />
              <input 
                type="number" 
                placeholder="Amount" 
                className="form-control" 
                style={{ fontSize: '11px', padding: '6px' }}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <input 
              type="text" 
              placeholder="Ref Account (e.g. ACC-0010-A1)" 
              className="form-control" 
              style={{ fontSize: '11px', padding: '6px' }}
              value={billRef}
              onChange={e => setBillRef(e.target.value)}
            />
            <button 
              type="submit" 
              className="btn btn-primary btn-sm"
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Fire Webhook Callback'}
            </button>
          </form>

          {message && (
            <div style={{ fontSize: '10px', color: 'var(--success)', textAlign: 'center', marginTop: '4px', fontWeight: 'bold' }}>
              {message}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />

          <div className="dev-section-title">💳 SaaS Billing Test</div>
          <button 
            className="btn btn-danger btn-sm" 
            onClick={handleTriggerLockout}
            disabled={loading || currentRole !== 'landlord'}
            style={{ width: '100%' }}
          >
            Trigger SaaS Lockout
          </button>
        </div>
      )}
    </div>
  );
}
