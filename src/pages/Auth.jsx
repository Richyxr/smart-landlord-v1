import React, { useState } from 'react';
import { Mail, Smartphone, Lock } from 'lucide-react';
import { setSessionToken } from '../lib/session.js';
import { auth } from '../lib/firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const isGoogleHostedEmail = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.endsWith('@gmail.com') || normalized.endsWith('@googlemail.com');
};

function getFriendlyAuthError(error) {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please check your details and try again.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Please sign in instead.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Please allow popups and try again.';
    default:
      return 'Sign in failed. Please try again.';
  }
}

export default function Auth({ onAuthSuccess }) {
  const initialResetToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';
  const [screen, setScreen] = useState(initialResetToken ? 'reset_password' : 'welcome'); // welcome, login, register, forgot_password, reset_password, verify_email, verify_phone, pin_setup
  
  // Registration State
  const [isCompany, setIsCompany] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('Kenya');
  const [currency, setCurrency] = useState('KES');
  const [regNum, setRegNum] = useState('');
  const [taxId, setTaxId] = useState('');

  // KYC Profile Additions
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [representativeFirstName, setRepresentativeFirstName] = useState('');
  const [representativeLastName, setRepresentativeLastName] = useState('');
  const [representativeRole, setRepresentativeRole] = useState('');
  const [representativePhone, setRepresentativePhone] = useState('');
  const [representativeEmail, setRepresentativeEmail] = useState('');
  const [representativeAuthorized, setRepresentativeAuthorized] = useState(false);
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [registerStep, setRegisterStep] = useState(1); // 1 = Details, 2 = Review & Confirm
  
  const [userId, setUserId] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [error, setError] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetComplete, setResetComplete] = useState(false);

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTab, setLoginTab] = useState('landlord'); // landlord, caretaker
  const [caretakerPhone, setCaretakerPhone] = useState('');
  const [caretakerPin, setCaretakerPin] = useState('');

  // Pin State
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const resolveFirebaseProfile = async (firebaseUser, profile = {}) => {
    const idToken = await firebaseUser.getIdToken();

    const res = await fetch('/api/auth/firebase-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify(profile)
    });

    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.message || data.error || 'Failed to load landlord profile.');
      error.code = data.error;
      throw error;
    }

    return data;
  };

  const getFirebaseAuthHeaders = async () => {
    if (!auth.currentUser) {
      throw new Error('Registration session expired. Please sign in again.');
    }

    const idToken = await auth.currentUser.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    };
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // STEP 1 Validation
    if (registerStep === 1) {
      if (isCompany) {
        if (!companyName.trim()) return setError('Company name is required.');
        if (!regNum.trim()) return setError('Business registration number is required.');
        if (!taxId.trim()) return setError('KRA PIN / Tax Identifier is required.');
        if (!representativeFirstName.trim() || !representativeLastName.trim()) {
          return setError('Representative first and last names are required.');
        }
        if (!representativeRole.trim()) return setError('Representative role/title is required.');
        if (!emailRegex.test(representativeEmail)) {
          return setError('Invalid representative email address format.');
        }
        if (!representativePhone.trim()) return setError('Representative phone number is required.');
      } else {
        if (!firstName.trim() || !lastName.trim()) {
          return setError('First name and last name are required.');
        }
      }

      if (!emailRegex.test(email)) {
        return setError('Invalid email address format.');
      }
      if (!phone.trim()) {
        return setError('Phone number is required.');
      }
      if (!password || password.length < 6) {
        return setError('Password must be at least 6 characters.');
      }
      if (isGoogleHostedEmail(email)) {
        return setError('Gmail accounts must use Continue with Google. Please sign in with Google instead.');
      }

      // Proceed to review step
      setRegisterStep(2);
      return;
    }

    // STEP 2 Validation & Submission
    if (!profileConfirmed) {
      return setError('You must confirm the profile details are accurate.');
    }
    if (isCompany && !representativeAuthorized) {
      return setError('You must confirm you are authorized to represent the company.');
    }

    setLoading(true);

    const prefix = country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '';
    
    // Normalize main phone
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (!normalizedPhone.startsWith('+') && !normalizedPhone.startsWith('254') && !normalizedPhone.startsWith('256') && !normalizedPhone.startsWith('255')) {
      if (normalizedPhone.startsWith('0')) normalizedPhone = normalizedPhone.substring(1);
      normalizedPhone = prefix + normalizedPhone;
    } else if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+' + normalizedPhone;
    }

    // Normalize rep phone
    let normalizedRepPhone = '';
    if (isCompany && representativePhone) {
      normalizedRepPhone = representativePhone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
      if (!normalizedRepPhone.startsWith('+') && !normalizedRepPhone.startsWith('254') && !normalizedRepPhone.startsWith('256') && !normalizedRepPhone.startsWith('255')) {
        if (normalizedRepPhone.startsWith('0')) normalizedRepPhone = normalizedRepPhone.substring(1);
        normalizedRepPhone = prefix + normalizedRepPhone;
      } else if (!normalizedRepPhone.startsWith('+')) {
        normalizedRepPhone = '+' + normalizedRepPhone;
      }
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();
      const res = await fetch('/api/auth/registration/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          type: isCompany ? 'company' : 'individual',
          first_name: firstName,
          last_name: lastName,
          email,
          phone_number: normalizedPhone,
          country,
          billing_currency: currency,
          company_name: companyName,
          registration_number: regNum,
          tax_identifier: taxId,
          representative_first_name: representativeFirstName,
          representative_last_name: representativeLastName,
          representative_role: representativeRole,
          representative_phone_e164: normalizedRepPhone,
          representative_email: representativeEmail,
          representative_authorized: representativeAuthorized,
          profile_confirmed: profileConfirmed
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to start email verification.');
      }

      setUserId(data.user_id);
      setOrgId(data.organization_id);
      setEmailOtp('');
      setScreen('verify_email');
    } catch (err) {
      setError(getFriendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailOtp = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(emailOtp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      const headers = await getFirebaseAuthHeaders();
      const res = await fetch('/api/auth/registration/verify-email', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, otp: emailOtp })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Email verification failed.');
      }

      setUserId(data.user.id);
      setOrgId(data.organization.id);
      setAuthToken(data.auth_token);
      setSessionToken(data.auth_token);
      setScreen('pin_setup');
    } catch (err) {
      setError(err.message || 'Email verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmailOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const headers = await getFirebaseAuthHeaders();
      const res = await fetch('/api/auth/registration/resend-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Could not resend verification code.');
      }

      setEmailOtp('');
    } catch (err) {
      setError(err.message || 'Could not resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(loginEmail)) {
      setError('Invalid email address format.');
      setLoading(false);
      return;
    }
    if (!loginPassword) {
      setError('Password is required.');
      setLoading(false);
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const data = await resolveFirebaseProfile(credential.user);

      onAuthSuccess(data.user, data.role, data.organization, data.auth_token);
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setEmail(loginEmail);
        setEmailOtp('');
        setScreen('verify_email');
        setError('Please verify your email address before continuing.');
        return;
      }
      setError(getFriendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setForgotSent(false);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(forgotEmail)) {
      setError('Invalid email address format.');
      return;
    }

    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });

      setForgotSent(true);
    } catch (_err) {
      setForgotSent(true);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!resetPassword || resetPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (resetPassword !== resetConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: resetToken,
          new_password: resetPassword,
          confirm_password: resetConfirmPassword
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Password reset link is invalid or expired. Please request a new one.');
      }

      setResetComplete(true);
      setResetPassword('');
      setResetConfirmPassword('');
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (err) {
      setError(err.message || 'Password reset link is invalid or expired. Please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  const handleCaretakerLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(caretakerPhone)) {
      setError('Phone Number must be in E.164 format (e.g. +254722111222).');
      setLoading(false);
      return;
    }
    if (!caretakerPin || caretakerPin.length !== 6) {
      setError('Caretaker PIN must be exactly 6 digits.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/caretaker/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: caretakerPhone, pin: caretakerPin })
      });

      const raw = await res.text();
      let data = {};
      let isJson = true;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        isJson = false;
      }

      const isHtml = typeof raw === 'string' && (raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html'));

      if (!isJson || isHtml) {
        setError('Caretaker login is temporarily unavailable. Please try again later.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || data.message || 'Caretaker login is temporarily unavailable. Please try again later.');
        setLoading(false);
        return;
      }

      onAuthSuccess(data.user, data.role, data.organization, data.auth_token);
    } catch (err) {
      setError('Caretaker login is temporarily unavailable. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });

      const credential = await signInWithPopup(auth, provider);
      const data = await resolveFirebaseProfile(credential.user, {
        name: credential.user.displayName || '',
        email: credential.user.email || '',
        phone_number: credential.user.phoneNumber || '',
        country,
        billing_currency: currency,
        type: 'individual'
      });

      onAuthSuccess(data.user, data.role, data.organization, data.auth_token);
    } catch (err) {
      setError(getFriendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSetupPin = async (e) => {
    e.preventDefault();
    setError('');

    if (pin.length !== 6 || confirmPin.length !== 6) {
      setError('PIN must be exactly 6 digits.');
      return;
    }

    if (pin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({ organization_id: orgId, pin })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to set PIN.');
      }

      const profileData = await resolveFirebaseProfile(auth.currentUser);
      onAuthSuccess(profileData.user, profileData.role, profileData.organization, profileData.auth_token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`auth-page ${screen === 'register' ? 'register-auth-page' : ''} ${screen === 'register' && isCompany ? 'company-auth-page' : ''}`}>
      
      {/* WELCOME SCREEN */}
      {screen === 'welcome' && (
        <div className="auth-panel auth-welcome-block" style={{ textAlign: 'center' }}>
          <img
            src="/icons/maskable-512.png"
            alt="Smart Landlord"
            className="auth-logo"
          />
          <h1 className="auth-title">
            Smart <span className="auth-title-accent">Landlord</span>
          </h1>
          <p className="auth-subtitle">
            <span className="auth-copy-mobile">Run your rental properties, payments, and bank reconciliation from one secure mobile app.</span>
<span className="auth-copy-desktop">Run your rental properties, payments, and bank reconciliation from one secure web app.</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <button className="btn btn-primary" onClick={() => setScreen('register')}>
              Create Landlord Account
            </button>
            <button className="btn btn-secondary" onClick={() => setScreen('login')}>
              Sign In to Account
            </button>
            <button
              type="button"
              aria-label="Welcome Google Sign In"
              className="btn btn-secondary"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              {loading ? 'Connecting...' : 'Continue with Google'}
            </button>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '-8px', marginBottom: '8px', textAlign: 'center' }}>
              Use Continue with Google for Gmail accounts.
            </p>
          </div>
        </div>
      )}

      {/* LOGIN SCREEN */}
      {screen === 'login' && (
        <div className="auth-panel">
          {/* Brand Header */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img
              src="/icons/maskable-192.png"
              alt="Smart Landlord"
              style={{
                width: '64px',
                height: '64px',
                margin: '0 auto 10px auto',
                display: 'block',
                borderRadius: '14px',
                boxShadow: '0 8px 20px rgba(99, 102, 241, 0.22)'
              }}
            />
            <h1 style={{
              fontFamily: 'var(--font-title)',
              fontSize: '22px',
              fontWeight: '700',
              margin: '0 0 2px 0',
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}>
              Smart <span style={{ color: 'var(--primary)' }}>Landlord</span>
            </h1>
            <p style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              margin: '0 0 4px 0',
              fontWeight: '500'
            }}>
              Property management made simple.
            </p>
            <p style={{
              fontSize: '10px',
              color: 'var(--primary)',
              opacity: 0.85,
              margin: 0,
              fontWeight: '600',
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}>
              Secure property management portal
            </p>
          </div>

          <h2 style={{ fontSize: '18px', marginBottom: '4px', textAlign: 'center', fontWeight: '600' }}>Welcome Back</h2>
          <p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>Sign in to access your properties and payments.</p>

          <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface-elevated)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '20px' }}>
            <button
              type="button"
              style={{
                flex: 1,
                background: loginTab === 'landlord' ? 'var(--primary)' : 'none',
                color: loginTab === 'landlord' ? 'white' : 'var(--text-secondary)',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => { setLoginTab('landlord'); setError(''); }}
            >
              Landlord Login
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                background: loginTab === 'caretaker' ? 'var(--primary)' : 'none',
                color: loginTab === 'caretaker' ? 'white' : 'var(--text-secondary)',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => { setLoginTab('caretaker'); setError(''); }}
            >
              Caretaker Login
            </button>
          </div>

          {loginTab === 'landlord' ? (
            <>
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    required
                    className="form-control"
                    placeholder="landlord@demo.com"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    required
                    className="form-control"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(loginEmail);
                      setForgotSent(false);
                      setError('');
                      setScreen('forgot_password');
                    }}
                    style={{ alignSelf: 'flex-end', marginTop: '6px', background: 'none', border: 'none', color: 'var(--primary)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: 0 }}
                  >
                    Forgot Password?
                  </button>
                </div>

                {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

                <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>
              </form>

              <button
                type="button"
                aria-label="Login Google Sign In"
                className="btn btn-secondary"
                disabled={loading}
                style={{ marginTop: '12px' }}
                onClick={handleGoogleSignIn}
              >
                {loading ? 'Connecting...' : 'Continue with Google'}
              </button>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px', textAlign: 'center' }}>
                Use Continue with Google for Gmail accounts.
              </p>
            </>
          ) : (
            <form onSubmit={handleCaretakerLogin}>
              <div className="form-group">
                <label className="form-label">Phone Number (E.164)</label>
                <input
                  type="tel"
                  required
                  className="form-control"
                  placeholder="+254722111222"
                  value={caretakerPhone}
                  onChange={e => setCaretakerPhone(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Caretaker PIN (6 digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  className="form-control"
                  placeholder="••••••"
                  maxLength="6"
                  value={caretakerPin}
                  onChange={e => setCaretakerPin(e.target.value.replace(/[^0-9]/g, ''))}
                  style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '4px' }}
                />
              </div>

              {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

              <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
                {loading ? 'Signing In...' : 'Sign In as Caretaker'}
              </button>
            </form>
          )}

          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => setScreen('welcome')}>
            Go Back
          </button>
        </div>
      )}

      {/* FORGOT PASSWORD SCREEN */}
      {screen === 'forgot_password' && (
        <div className="auth-panel">
          {/* Brand Header */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <img
              src="/icons/maskable-192.png"
              alt="Smart Landlord"
              style={{
                width: '60px',
                height: '60px',
                margin: '0 auto 8px auto',
                display: 'block',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-sm)'
              }}
            />
            <h1 style={{
              fontFamily: 'var(--font-title)',
              fontSize: '20px',
              fontWeight: '600',
              margin: '0 0 2px 0',
              color: 'var(--text-primary)'
            }}>
              Smart <span style={{ color: 'var(--primary)' }}>Landlord</span>
            </h1>
            <p style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              margin: 0
            }}>
              Property management made simple.
            </p>
          </div>

          <h2 style={{ fontSize: '20px', marginBottom: '4px', textAlign: 'center' }}>Reset Password</h2>
          <p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>Enter your email address and we will send password reset instructions.</p>

          {forgotSent ? (
            <>
              <div role="status" style={{ color: 'var(--success)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
                If this email exists, we have sent password reset instructions.
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setError('');
                  setScreen('login');
                }}
              >
                Back to Sign In
              </button>
            </>
          ) : (
            <form onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="form-control"
                  placeholder="landlord@demo.com"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                />
              </div>

              {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

              <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
                {loading ? 'Sending...' : 'Send Reset Instructions'}
              </button>
            </form>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: '12px' }}
            onClick={() => {
              setForgotSent(false);
              setError('');
              setScreen('login');
            }}
          >
            Go Back
          </button>
        </div>
      )}

      {/* RESET PASSWORD SCREEN */}
      {screen === 'reset_password' && (
        <div className="auth-panel">
          {/* Brand Header */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <img
              src="/icons/maskable-192.png"
              alt="Smart Landlord"
              style={{
                width: '60px',
                height: '60px',
                margin: '0 auto 8px auto',
                display: 'block',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-sm)'
              }}
            />
            <h1 style={{
              fontFamily: 'var(--font-title)',
              fontSize: '20px',
              fontWeight: '600',
              margin: '0 0 2px 0',
              color: 'var(--text-primary)'
            }}>
              Smart <span style={{ color: 'var(--primary)' }}>Landlord</span>
            </h1>
            <p style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              margin: 0
            }}>
              Property management made simple.
            </p>
          </div>

          <h2 style={{ fontSize: '20px', marginBottom: '4px', textAlign: 'center' }}>Create New Password</h2>
          <p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>Choose a new password for your Smart Landlord account.</p>

          {resetComplete ? (
            <>
              <div role="status" style={{ color: 'var(--success)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
                Your password has been reset. You can now sign in with your new password.
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setResetComplete(false);
                  setError('');
                  setScreen('login');
                }}
              >
                Back to Sign In
              </button>
            </>
          ) : (
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  required
                  className="form-control"
                  placeholder="••••••••"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  required
                  className="form-control"
                  placeholder="••••••••"
                  value={resetConfirmPassword}
                  onChange={e => setResetConfirmPassword(e.target.value)}
                />
              </div>

              {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

              <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: '12px' }}
            onClick={() => {
              setResetComplete(false);
              setError('');
              setScreen('login');
              if (typeof window !== 'undefined') {
                window.history.replaceState({}, '', window.location.pathname);
              }
            }}
          >
            Back to Sign In
          </button>
        </div>
      )}

      {/* REGISTER SCREEN */}
      {screen === 'register' && (
        <div className={`auth-panel auth-onboarding-panel register-panel ${isCompany ? 'company-panel' : ''}`}>
          <div className="auth-brand-rail">
            <img src="/icons/maskable-192.png" alt="Smart Landlord" className="auth-brand-rail-logo" />
            <div>
              <h1 className="auth-brand-rail-title">
                Smart <span>Landlord</span>
              </h1>
              <p className="auth-brand-rail-copy">Property management made simple.</p>
              <p className="auth-brand-rail-kicker">Secure property management portal</p>
            </div>
          </div>

          <div className="auth-form-section">
            {/* Brand Header */}
            <div className="register-brand" style={{ textAlign: 'center', marginBottom: '20px' }}>
            <img
              src="/icons/maskable-192.png"
              alt="Smart Landlord"
              className="register-brand-logo"
              style={{
                width: '64px',
                height: '64px',
                margin: '0 auto 10px auto',
                display: 'block',
                borderRadius: '14px',
                boxShadow: '0 8px 20px rgba(99, 102, 241, 0.22)'
              }}
            />
            <h1 className="register-brand-title" style={{
              fontFamily: 'var(--font-title)',
              fontSize: '22px',
              fontWeight: '700',
              margin: '0 0 2px 0',
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}>
              Smart <span style={{ color: 'var(--primary)' }}>Landlord</span>
            </h1>
            <p className="register-brand-copy" style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              margin: '0 0 4px 0',
              fontWeight: '500'
            }}>
              Property management made simple.
            </p>
            <p className="register-brand-kicker" style={{
              fontSize: '10px',
              color: 'var(--primary)',
              opacity: 0.85,
              margin: 0,
              fontWeight: '600',
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}>
              Secure property management portal
            </p>
          </div>

          <h2 className="register-heading" style={{ fontSize: '18px', marginBottom: '4px', textAlign: 'center', fontWeight: '600' }}>
            {registerStep === 1 ? (
              <>
                <span className="register-title-mobile">Get Started</span>
                <span className="register-title-desktop">Register Profile</span>
              </>
            ) : 'Confirm Your Details'}
          </h2>
          <p className="register-intro" style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {registerStep === 1 ? 'Set up your landlord profile.' : 'Please review and confirm your profile details.'}
          </p>

          <form onSubmit={handleRegister}>
            {registerStep === 1 ? (
              <>
                <div className="form-group">
                  <label className="form-label">Registering as</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="button"
                      className={`btn ${!isCompany ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      style={{ flex: 1 }}
                      onClick={() => setIsCompany(false)}
                    >
                      Individual
                    </button>
                    <button
                      type="button"
                      className={`btn ${isCompany ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      style={{ flex: 1 }}
                      onClick={() => setIsCompany(true)}
                    >
                      Company
                    </button>
                  </div>
                </div>

                {isCompany ? (
                  <div className="auth-form-grid">
                    <div className="form-group auth-field-full">
                      <label className="form-label">Company Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Kamau Properties Ltd"
                        value={companyName}
                        onChange={e => setCompanyName(e.target.value)}
                      />
                    </div>
                    <div className="form-group auth-field-half">
                      <label className="form-label">Reg. Number</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="CPR/2022/123"
                        value={regNum}
                        onChange={e => setRegNum(e.target.value)}
                      />
                    </div>
                    <div className="form-group auth-field-half">
                      <label className="form-label">KRA PIN</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="P051234567A"
                        value={taxId}
                        onChange={e => setTaxId(e.target.value)}
                      />
                    </div>

                    <div className="register-section-divider auth-field-full" style={{ margin: '20px 0 10px 0', borderTop: '1px solid var(--border)', paddingTop: '15px' }}>
                      <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>Representative Details</h3>
                    </div>

                    <div className="form-group auth-field-half">
                      <label className="form-label">Rep. First Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Maina"
                        value={representativeFirstName}
                        onChange={e => setRepresentativeFirstName(e.target.value)}
                      />
                    </div>
                    <div className="form-group auth-field-half">
                      <label className="form-label">Rep. Last Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Kamau"
                        value={representativeLastName}
                        onChange={e => setRepresentativeLastName(e.target.value)}
                      />
                    </div>

                    <div className="form-group auth-field-full">
                      <label className="form-label">Rep. Role / Title</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Director"
                        value={representativeRole}
                        onChange={e => setRepresentativeRole(e.target.value)}
                      />
                    </div>

                    <div className="form-group auth-field-half">
                      <label className="form-label">Rep. Email</label>
                      <input
                        type="email"
                        required
                        className="form-control"
                        placeholder="rep@kamauproperties.co.ke"
                        value={representativeEmail}
                        onChange={e => setRepresentativeEmail(e.target.value)}
                      />
                    </div>

                    <div className="form-group auth-field-half">
                      <label className="form-label">Rep. Phone Number</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span className="register-phone-prefix" style={{
                          padding: '8px 12px',
                          background: 'var(--bg-surface-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          fontSize: '14px',
                          display: 'flex',
                          alignItems: 'center',
                          color: 'var(--text-secondary)'
                        }}>
                          {country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '+'}
                        </span>
                        <input
                          type="tel"
                          required
                          className="form-control"
                          placeholder="7XXXXXXXX"
                          value={representativePhone}
                          onChange={e => setRepresentativePhone(e.target.value.replace(/[^0-9]/g, ''))}
                          style={{ flex: 1 }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">First Name</label>
                        <input
                          type="text"
                          required
                          className="form-control"
                          placeholder="Maina"
                          value={firstName}
                          onChange={e => setFirstName(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Last Name</label>
                        <input
                          type="text"
                          required
                          className="form-control"
                          placeholder="Kamau"
                          value={lastName}
                          onChange={e => setLastName(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">KRA PIN (Optional)</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="P051234567A"
                        value={taxId}
                        onChange={e => setTaxId(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <div className="register-section-divider" style={{ margin: '20px 0 10px 0', borderTop: '1px solid var(--border)', paddingTop: '15px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>Account Settings</h3>
                </div>

                <div className={isCompany ? 'auth-form-grid' : ''}>
                  <div className={isCompany ? 'form-group auth-field-half' : 'form-group'}>
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      required
                      className="form-control"
                      placeholder="landlord@demo.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />
                  </div>

                  <div className={isCompany ? 'form-group auth-field-half' : 'form-group'}>
                    <label className="form-label">Phone Number</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span className="register-phone-prefix" style={{
                        padding: '8px 12px',
                        background: 'var(--bg-surface-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--text-secondary)'
                      }}>
                        {country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '+'}
                      </span>
                      <input
                        type="tel"
                        required
                        className="form-control"
                        placeholder="7XXXXXXXX"
                        value={phone}
                        onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>

                  <div className={isCompany ? 'form-group auth-field-full' : 'form-group'}>
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      required
                      className="form-control"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                  </div>
                </div>

                <div className={isCompany ? 'auth-form-grid' : 'grid-2'}>
                  <div className="form-group auth-field-half">
                    <label className="form-label">Country</label>
                    <select className="form-control" value={country} onChange={e => {
                      setCountry(e.target.value);
                      if (e.target.value === 'Kenya') setCurrency('KES');
                      else if (e.target.value === 'Uganda') setCurrency('UGX');
                      else if (e.target.value === 'Tanzania') setCurrency('TZS');
                    }}>
                      <option value="Kenya">Kenya</option>
                      <option value="Uganda">Uganda</option>
                      <option value="Tanzania">Tanzania</option>
                    </select>
                  </div>
                  <div className="form-group auth-field-half">
                    <label className="form-label">Currency</label>
                    <select className="form-control" value={currency} onChange={e => setCurrency(e.target.value)}>
                      <option value="KES">KES</option>
                      <option value="UGX">UGX</option>
                      <option value="TZS">TZS</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="register-review-card" style={{ background: 'var(--bg-surface-elevated)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '20px', fontSize: '13px', lineHeight: '1.6' }}>
                  {isCompany ? (
                    <>
                      <div style={{ marginBottom: '8px' }}><strong>Company Name:</strong> {companyName}</div>
                      <div style={{ marginBottom: '8px' }}><strong>Reg. Number:</strong> {regNum}</div>
                      <div style={{ marginBottom: '8px' }}><strong>KRA PIN:</strong> {taxId}</div>
                      <div style={{ margin: '12px 0 8px 0', borderTop: '1px solid var(--border)', paddingTop: '8px' }}><strong>Representative:</strong> {representativeFirstName} {representativeLastName} ({representativeRole})</div>
                      <div style={{ marginBottom: '8px' }}><strong>Rep. Email:</strong> {representativeEmail}</div>
                      <div style={{ marginBottom: '8px' }}><strong>Rep. Phone:</strong> {(country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '') + representativePhone}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ marginBottom: '8px' }}><strong>Landlord Name:</strong> {firstName} {lastName}</div>
                      {taxId && <div style={{ marginBottom: '8px' }}><strong>KRA PIN:</strong> {taxId}</div>}
                    </>
                  )}
                  <div style={{ margin: '12px 0 8px 0', borderTop: '1px solid var(--border)', paddingTop: '8px' }}><strong>Account Email:</strong> {email}</div>
                  <div style={{ marginBottom: '8px' }}><strong>Account Phone:</strong> {(country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '') + phone}</div>
                  <div style={{ marginBottom: '8px' }}><strong>Country:</strong> {country}</div>
                  <div><strong>Currency:</strong> {currency}</div>
                </div>

                {isCompany && (
                  <label className="checkbox-container" style={{ display: 'flex', gap: '8px', marginBottom: '12px', fontSize: '12px', cursor: 'pointer', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      required
                      checked={representativeAuthorized}
                      onChange={e => setRepresentativeAuthorized(e.target.checked)}
                      style={{ marginTop: '3px' }}
                    />
                    <span>I confirm I am authorized to represent this company.</span>
                  </label>
                )}

                <label className="checkbox-container" style={{ display: 'flex', gap: '8px', marginBottom: '20px', fontSize: '12px', cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    required
                    checked={profileConfirmed}
                    onChange={e => setProfileConfirmed(e.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>I confirm that all details are accurate.</span>
                </label>
              </>
            )}

            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

            <div className="register-actions" style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
              {registerStep === 2 && (
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setRegisterStep(1)}>
                  Edit Details
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Creating Account...' : registerStep === 1 ? 'Continue' : 'Confirm & Register'}
              </button>
            </div>
          </form>

          {registerStep === 1 && !isCompany && (
            <>
              <button
                type="button"
                aria-label="Register Google Sign In"
                className="btn btn-secondary"
                disabled={loading}
                style={{ marginTop: '12px' }}
                onClick={handleGoogleSignIn}
              >
                {loading ? 'Connecting...' : 'Continue with Google'}
              </button>
              <p className="register-google-help" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px', textAlign: 'center' }}>
                Use Continue with Google for Gmail accounts.
              </p>
            </>
          )}

          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => {
            if (registerStep === 2) {
              setRegisterStep(1);
            } else {
              setScreen('welcome');
            }
          }}>
            Go Back
          </button>
          </div>
        </div>
      )}

      {/* VERIFY EMAIL */}
      {screen === 'verify_email' && (
        <div className="auth-panel" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', color: 'var(--primary)' }}>
            <Mail size={48} />
          </div>
          <h2 style={{ fontSize: '24px', margin: '12px 0 6px 0' }}>Verify Your Email</h2>
          <p style={{ marginBottom: '24px', fontSize: '13px' }}>
            We've sent a 6-digit verification code to <strong>{email}</strong>.
          </p>
          <form onSubmit={handleVerifyEmailOtp}>
            <div className="form-group" style={{ alignItems: 'center' }}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="0 0 0 0 0 0"
                className="form-control"
                style={{ textAlign: 'center', fontSize: '24px', letterSpacing: '6px', width: '190px' }}
                maxLength="6"
                value={emailOtp}
                onChange={e => setEmailOtp(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '12px' }}>
              {loading ? 'Verifying...' : 'Verify Email Address'}
            </button>
          </form>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={handleResendEmailOtp}
            style={{ marginTop: '12px' }}
          >
            Resend Code
          </button>
        </div>
      )}

      {/* VERIFY PHONE */}
      {screen === 'verify_phone' && (
        <div className="auth-panel" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', color: 'var(--primary)' }}>
            <Smartphone size={48} />
          </div>
          <h2 style={{ fontSize: '24px', margin: '12px 0 6px 0' }}>Verify Phone Number</h2>
          <p style={{ marginBottom: '24px', fontSize: '13px' }}>
            We've sent a mock SMS code to <strong>{phone}</strong>.
          </p>
          <div className="form-group" style={{ alignItems: 'center' }}>
            <input
              type="text"
              placeholder="0 0 0 0"
              className="form-control"
              style={{ textAlign: 'center', fontSize: '24px', letterSpacing: '6px', width: '140px' }}
              maxLength="4"
              defaultValue="5678"
            />
          </div>
          <button className="btn btn-primary" onClick={() => setScreen('pin_setup')} style={{ marginTop: '12px' }}>
            Verify Phone Number
          </button>
        </div>
      )}

      {/* PIN SETUP */}
      {screen === 'pin_setup' && (
        <div className="auth-panel">
          <h2 style={{ fontSize: '24px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lock size={24} /> Create Security PIN
          </h2>
          <p style={{ marginBottom: '24px', fontSize: '13px' }}>
            Define a 6-digit security PIN to protect critical financial actions like payment matches, voids, and archives.
          </p>

          <form onSubmit={handleSetupPin}>
            <div className="form-group">
              <label className="form-label">Create Security PIN (6 digits)</label>
              <input
                type="password"
                inputMode="numeric"
                required
                className="form-control"
                placeholder="••••••"
                maxLength="6"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '4px' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Security PIN</label>
              <input
                type="password"
                inputMode="numeric"
                required
                className="form-control"
                placeholder="••••••"
                maxLength="6"
                value={confirmPin}
                onChange={e => setConfirmPin(e.target.value.replace(/[^0-9]/g, ''))}
                style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '4px' }}
              />
            </div>

            {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
              {loading ? 'Saving PIN...' : 'Save & Finalize'}
            </button>
          </form>
        </div>
      )}

    </div>
  );
}








