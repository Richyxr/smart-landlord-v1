import React, { useState } from 'react';
import { Lock, Mail, ArrowLeft, ShieldAlert } from 'lucide-react';
import { getSessionToken } from '../lib/session.js';

export default function SecurityPinModal({ isOpen, onClose, onSuccess, organizationId }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');

  if (!isOpen) return null;

  const backdropStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    padding: '16px',
    backgroundColor: 'rgba(3, 4, 7, 0.72)',
    backdropFilter: 'blur(10px)',
    zIndex: 1000
  };

  const modalStyle = {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    padding: '24px',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: 'var(--shadow-lg)'
  };

  const inputStyle = {
    textAlign: 'center',
    fontSize: '28px',
    letterSpacing: '8px',
    width: '180px',
    padding: '8px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-surface-elevated)',
    color: 'var(--text-primary)'
  };

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

    setLoading(true);
    setError('');
    setResetSuccess('');

    try {
      const res = await fetch('/api/auth/security-pin/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {})
        },
        body: JSON.stringify({})
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to request PIN reset.');
      }

      setResetSuccess(data.message || 'If your account can receive email, reset instructions have been sent.');
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
      <div className="modal-backdrop" style={backdropStyle}>
        <div className="modal-content" style={modalStyle}>
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
            We will send reset instructions to your account email.
          </p>

          <form onSubmit={handleForgotSubmit}>
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
                disabled={loading}
                style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--primary, #6b46c1)', color: '#fff', border: 'none' }}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" style={backdropStyle}>
      <div className="modal-content" style={modalStyle}>
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
              style={inputStyle}
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
