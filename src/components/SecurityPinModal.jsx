import React, { useState } from 'react';
import { Lock, Mail, ArrowLeft, ShieldAlert } from 'lucide-react';
import { getSessionToken } from '../lib/session.js';

export default function SecurityPinModal({ isOpen, onClose, onSuccess, organizationId }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pin.length < 4 || pin.length > 6) {
      setError('PIN must be between 4 and 6 digits.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/security-pin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {})
        },
        body: JSON.stringify({ pin })
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'PIN_LOCKED') {
          throw new Error('Security PIN is temporarily locked due to too many failed attempts. Please try again later or reset your PIN.');
        }
        throw new Error(data.message || 'Incorrect security PIN.');
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

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!resetEmail) {
      setError('Email address is required.');
      return;
    }

    setLoading(true);
    setError('');
    setResetSuccess('');

    try {
      const res = await fetch('/api/auth/security-pin/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: resetEmail })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to request PIN reset.');
      }

      setResetSuccess(data.message || 'If the email matches a registered account, reset instructions have been sent.');
      setResetEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePinChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length <= 6) {
      setPin(value);
      setError('');
    }
  };

  if (showForgot) {
    return (
      <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }}>
        <div className="modal-content" style={{ backgroundColor: 'var(--card-bg, #ffffff)', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' }}>
          <button 
            type="button" 
            className="btn-back" 
            onClick={() => { setShowForgot(false); setError(''); setResetSuccess(''); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', padding: 0 }}
          >
            <ArrowLeft size={16} /> Back to PIN
          </button>

          <h3 className="card-title" style={{ fontSize: '18px', textAlign: 'center', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Mail size={18} /> Reset Security PIN
          </h3>
          <p style={{ fontSize: '13px', textAlign: 'center', marginBottom: '20px', color: 'var(--text-secondary)' }}>
            Enter your registered email address to receive secure instructions to create a new Security PIN.
          </p>

          <form onSubmit={handleForgotSubmit}>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <input
                type="email"
                className="form-control"
                value={resetEmail}
                onChange={(e) => { setResetEmail(e.target.value); setError(''); }}
                placeholder="email@example.com"
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color, #e2e8f0)' }}
                disabled={loading}
                required
              />
            </div>

            {error && (
              <div role="alert" style={{ color: 'var(--danger, #ef4444)', fontSize: '12px', textAlign: 'center', marginBottom: '16px', fontWeight: '500' }}>
                {error}
              </div>
            )}

            {resetSuccess && (
              <div role="status" style={{ color: 'var(--success, #10b981)', fontSize: '12px', textAlign: 'center', marginBottom: '16px', fontWeight: '500' }}>
                {resetSuccess}
              </div>
            )}

            <div className="flex-gap" style={{ marginTop: '20px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setShowForgot(false); onClose(); setError(''); setResetSuccess(''); }}
                disabled={loading}
                style={{ padding: '8px 16px', borderRadius: '6px' }}
              >
                Close
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !resetEmail}
                style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--primary, #6b46c1)', color: '#fff', border: 'none' }}
              >
                {loading ? 'Sending...' : 'Send Link'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }}>
      <div className="modal-content" style={{ backgroundColor: 'var(--card-bg, #ffffff)', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)' }}>
        <h3 className="card-title" style={{ fontSize: '18px', textAlign: 'center', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Lock size={18} /> Enter Security PIN
        </h3>
        <p style={{ fontSize: '13px', textAlign: 'center', marginBottom: '20px', color: 'var(--text-secondary)' }}>
          This is a protected action. Please input your 4 to 6-digit security PIN to confirm.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
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
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #e2e8f0)'
              }}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div role="alert" style={{ color: 'var(--danger, #ef4444)', fontSize: '12px', textAlign: 'center', marginBottom: '16px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              <ShieldAlert size={14} /> {error}
            </div>
          )}

          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <button
              type="button"
              className="link-btn"
              onClick={() => { setShowForgot(true); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--primary, #6b46c1)', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
            >
              Forgot PIN?
            </button>
          </div>

          <div className="flex-gap" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setPin(''); setError(''); onClose(); }}
              disabled={loading}
              style={{ padding: '8px 16px', borderRadius: '6px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || pin.length < 4 || pin.length > 6}
              style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--primary, #6b46c1)', color: '#fff', border: 'none' }}
            >
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
