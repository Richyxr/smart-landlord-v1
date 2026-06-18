import React, { useState } from 'react';

export default function SecurityPinModal({ isOpen, onClose, onSuccess, organizationId }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ organization_id: organizationId, pin })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Incorrect security PIN.');
      }

      setLoading(false);
      onSuccess(pin);
      setPin('');
      onClose();
    } catch (err) {
      setLoading(false);
      setError(err.message);
    }
  };

  const handlePinChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length <= 6) {
      setPin(value);
      setError('');
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h3 className="card-title" style={{ fontSize: '18px', textAlign: 'center', marginBottom: '10px' }}>
          🔒 Enter Security PIN
        </h3>
        <p style={{ fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>
          This is a protected action. Please input your 6-digit security PIN to confirm.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ alignItems: 'center' }}>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="form-control"
              value={pin}
              onChange={handlePinChange}
              placeholder="••••••"
              style={{
                textAlign: 'center',
                fontSize: '28px',
                letterSpacing: '8px',
                width: '180px',
                padding: '8px'
              }}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', textAlign: 'center', marginBottom: '16px', fontWeight: '500' }}>
              ⚠️ {error}
            </div>
          )}

          <div className="flex-gap" style={{ marginTop: '20px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || pin.length !== 6}
            >
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
