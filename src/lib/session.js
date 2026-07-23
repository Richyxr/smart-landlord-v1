import { auth } from './firebase';

const SESSION_KEY = 'smart_landlord_session_token';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function isApiRequest(input) {
  const rawUrl = typeof input === 'string' ? input : input?.url;

  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }

  if (rawUrl.startsWith('/api/')) {
    return true;
  }

  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function rewriteApiRequest(input) {
  if (!API_BASE_URL) {
    return input;
  }

  if (typeof input === 'string' && input.startsWith('/api/')) {
    return `${API_BASE_URL}${input}`;
  }

  if (typeof input === 'string') {
    try {
      const parsed = new URL(input, window.location.origin);

      if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')) {
        return `${API_BASE_URL}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return input;
    }
  }

  return input;
}

export function getSessionToken() {
  return window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token) {
  if (token) {
    window.localStorage.setItem(SESSION_KEY, token);
  }
}

export function clearSessionToken() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function installAuthFetch() {
  if (window.__smartLandlordAuthFetchInstalled) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const shouldAttachToken = isApiRequest(input);
    const rewrittenInput = rewriteApiRequest(input);
    let token = null;
    
    if (shouldAttachToken) {
      if (!auth.currentUser) {
        await auth.authStateReady();
      }

      // Wait for auth.currentUser to populate if it's temporarily null
      let retries = 50;
      while (!auth.currentUser && retries > 0) {
        await new Promise(r => setTimeout(r, 100));
        retries--;
      }

      if (auth.currentUser) {
        try {
          token = await auth.currentUser.getIdToken();
        } catch (e) {
          console.warn('Failed to get Firebase token, falling back to legacy session', e);
          token = getSessionToken();
        }
      } else {
        console.warn('auth.currentUser is still null after waiting. API calls might fail.');
        token = getSessionToken();
      }
    }

    if (!token) {
      return originalFetch(rewrittenInput, init);
    }

    const headers = new Headers(init.headers || {});
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return originalFetch(rewrittenInput, {
      ...init,
      headers
    });
  };

  window.__smartLandlordAuthFetchInstalled = true;
}
