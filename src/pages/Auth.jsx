import React, { useState } from 'react';
import { setSessionToken } from '../lib/session.js';
import { auth } from '../lib/firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export default function Auth({ onAuthSuccess }) {
  const [screen, setScreen] = useState('welcome'); // welcome, login, register, verify_email, verify_phone, pin_setup
  
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
  
  const [userId, setUserId] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

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
      throw new Error(data.message || data.error || 'Failed to load landlord profile.');
    }

    return data;
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!name.trim()) {
      setError('Name is required.');
      setLoading(false);
      return;
    }
    if (!emailRegex.test(email)) {
      setError('Invalid email address format.');
      setLoading(false);
      return;
    }
    if (!phoneRegex.test(phone)) {
      setError('Phone Number must be in E.164 format (e.g. +254712345678).');
      setLoading(false);
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      setLoading(false);
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);

      try {
        await sendEmailVerification(credential.user);
      } catch (verifyError) {
        console.warn('Firebase email verification could not be sent immediately.', verifyError);
      }

      const data = await resolveFirebaseProfile(credential.user, {
        name,
        email,
        phone_number: phone,
        country,
        billing_currency: currency,
        type: isCompany ? 'company' : 'individual',
        registration_number: regNum,
        tax_identifier: taxId
      });

      setUserId(data.user.id);
      setOrgId(data.organization.id);
      setAuthToken(data.auth_token);
      setSessionToken(data.auth_token);
      setScreen('pin_setup');
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
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
      setError(err.message);
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
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
      
      {/* WELCOME SCREEN */}
      {screen === 'welcome' && (
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '36px', fontWeight: '800', marginBottom: '8px', fontFamily: 'var(--font-title)' }}>
            Smart <span style={{ color: 'var(--primary)' }}>Landlord</span>
          </h1>
          <p style={{ marginBottom: '40px', fontSize: '15px' }}>
            Run your rental properties, payments, and bank reconciliation from one secure mobile app.
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
          </div>
        </div>
      )}

      {/* LOGIN SCREEN */}
      {screen === 'login' && (
        <div>
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Welcome Back</h2>
          <p style={{ marginBottom: '24px' }}>Sign in to access your properties and payments.</p>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                required
                className="form-control"
                placeholder="landlord@demo.com or caretaker@demo.com"
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
            </div>

            {error && <div style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>⚠️ {error}</div>}

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

          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => setScreen('welcome')}>
            Go Back
          </button>
        </div>
      )}

      {/* REGISTER SCREEN */}
      {screen === 'register' && (
        <div>
          <h2 style={{ fontSize: '24px', marginBottom: '4px' }}>Get Started</h2>
          <p style={{ marginBottom: '20px', fontSize: '13px' }}>Set up your landlord profile.</p>

          <form onSubmit={handleRegister}>
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

            <div className="form-group">
              <label className="form-label">{isCompany ? 'Company Name' : 'Full Name'}</label>
              <input
                type="text"
                required
                className="form-control"
                placeholder={isCompany ? 'Kamau Properties Ltd' : 'Maina Kamau'}
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
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

            <div className="form-group">
              <label className="form-label">Phone Number (E.164)</label>
              <input
                type="tel"
                required
                className="form-control"
                placeholder="+254712345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>

            <div className="form-group">
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

            {isCompany && (
              <div className="grid-2">
                <div className="form-group">
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
                <div className="form-group">
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
              </div>
            )}

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Country</label>
                <select className="form-control" value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="Kenya">Kenya</option>
                  <option value="Uganda">Uganda</option>
                  <option value="Tanzania">Tanzania</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-control" value={currency} onChange={e => setCurrency(e.target.value)}>
                  <option value="KES">KES</option>
                  <option value="UGX">UGX</option>
                  <option value="TZS">TZS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            {error && <div style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>⚠️ {error}</div>}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
              {loading ? 'Creating Profile...' : 'Register Profile'}
            </button>
          </form>

          {!isCompany && (
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
          )}

          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => setScreen('welcome')}>
            Go Back
          </button>
        </div>
      )}

      {/* VERIFY EMAIL */}
      {screen === 'verify_email' && (
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '48px' }}>✉️</span>
          <h2 style={{ fontSize: '24px', margin: '12px 0 6px 0' }}>Verify Your Email</h2>
          <p style={{ marginBottom: '24px', fontSize: '13px' }}>
            We've sent a mock verification email to <strong>{email}</strong>.
          </p>
          <div className="form-group" style={{ alignItems: 'center' }}>
            <input
              type="text"
              placeholder="0 0 0 0"
              className="form-control"
              style={{ textAlign: 'center', fontSize: '24px', letterSpacing: '6px', width: '140px' }}
              maxLength="4"
              defaultValue="1234"
            />
          </div>
          <button className="btn btn-primary" onClick={() => setScreen('verify_phone')} style={{ marginTop: '12px' }}>
            Verify Email Address
          </button>
        </div>
      )}

      {/* VERIFY PHONE */}
      {screen === 'verify_phone' && (
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '48px' }}>📱</span>
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
        <div>
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>🔒 Create Security PIN</h2>
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

            {error && <div style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>⚠️ {error}</div>}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
              {loading ? 'Saving PIN...' : 'Save & Finalize'}
            </button>
          </form>
        </div>
      )}

    </div>
  );
}
