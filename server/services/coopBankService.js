/**
 * Co-op Bank (Co-op Connect API) Integration Service
 * Handles OAuth2 token generation, Account Validation, and Account Transactions enquiry
 * according to Co-operative Bank of Kenya developer specs (https://developer.co-opbank.co.ke/).
 */

const ENDPOINTS = {
  sandbox: {
    token: 'https://developer.co-opbank.co.ke:8243/token',
    tokenFallback: 'https://developer.co-opbank.co.ke/token',
    accountValidation: 'https://developer.co-opbank.co.ke:8243/expressEnquiry/accountValidation/1.0.0',
    accountTransactions: 'https://developer.co-opbank.co.ke:8243/expressEnquiry/accountTransactions/1.0.0'
  },
  production: {
    token: 'https://api.co-opbank.co.ke/token',
    tokenFallback: 'https://developer.co-opbank.co.ke:8243/token',
    accountValidation: 'https://api.co-opbank.co.ke/expressEnquiry/accountValidation/1.0.0',
    accountTransactions: 'https://api.co-opbank.co.ke/expressEnquiry/accountTransactions/1.0.0'
  }
};

/**
 * Generate OAuth2 Bearer Token from Co-op Connect API
 * @param {Object} credentials - { consumer_key, consumer_secret }
 * @param {string} environment - 'sandbox' or 'production' / 'live'
 * @returns {Promise<{ success: boolean, access_token?: string, expires_in?: number, responseSummary: string, errorMessage: string|null }>}
 */
export async function getOAuthToken(credentials = {}, environment = 'sandbox') {
  const envKey = environment === 'production' || environment === 'live' ? 'production' : 'sandbox';
  const config = ENDPOINTS[envKey] || ENDPOINTS.sandbox;

  const consumerKey = (credentials.consumer_key || '').trim();
  const consumerSecret = (credentials.consumer_secret || '').trim();

  if (!consumerKey || !consumerSecret) {
    return {
      success: false,
      responseSummary: 'Missing consumer_key or consumer_secret.',
      errorMessage: 'Co-op Connect credentials incomplete.'
    };
  }

  // Check for mock / dummy credentials used in local testing
  const isMock = consumerKey.startsWith('mock') || consumerKey.startsWith('test') || consumerKey === 'dummy' || consumerSecret.startsWith('mock');
  if (isMock) {
    return {
      success: true,
      access_token: `mock_coop_token_${Date.now()}`,
      expires_in: 3600,
      responseSummary: `Co-op Connect ${envKey} mock token generated successfully.`,
      errorMessage: null
    };
  }

  const authHeader = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;
  const bodyData = new URLSearchParams({ grant_type: 'client_credentials' }).toString();

  const urlsToTry = [config.token, config.tokenFallback];

  for (const tokenUrl of urlsToTry) {
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyData,
        signal: AbortSignal.timeout(10000)
      });

      let resJson = {};
      try {
        resJson = await response.json();
      } catch (_e) {
        resJson = {};
      }

      if (response.ok && resJson.access_token) {
        return {
          success: true,
          access_token: resJson.access_token,
          expires_in: resJson.expires_in || 3600,
          responseSummary: `Co-op Connect ${envKey} OAuth token generated successfully.`,
          errorMessage: null
        };
      }

      if (!response.ok) {
        const errorDesc = resJson.error_description || resJson.error || `HTTP ${response.status}`;
        if (tokenUrl === urlsToTry[urlsToTry.length - 1]) {
          return {
            success: false,
            responseSummary: `Co-op Connect ${envKey} OAuth endpoint returned HTTP ${response.status}: ${errorDesc}`,
            errorMessage: `Co-op Connect token request rejected (${errorDesc}). Check Consumer Key and Consumer Secret.`
          };
        }
      }
    } catch (err) {
      if (tokenUrl === urlsToTry[urlsToTry.length - 1]) {
        return {
          success: false,
          responseSummary: `Co-op Connect ${envKey} endpoint unreachable: ${err.message}`,
          errorMessage: `Failed to connect to Co-op Connect ${envKey} endpoint.`
        };
      }
    }
  }

  return {
    success: false,
    responseSummary: `Co-op Connect ${envKey} authentication failed.`,
    errorMessage: 'Could not obtain OAuth token from Co-op Connect API.'
  };
}

/**
 * Perform Account Validation Enquiry against Co-op API
 */
export async function validateAccount(credentials = {}, accountNumber, environment = 'sandbox') {
  const tokenRes = await getOAuthToken(credentials, environment);
  if (!tokenRes.success) {
    return tokenRes;
  }

  const envKey = environment === 'production' || environment === 'live' ? 'production' : 'sandbox';
  const endpoint = ENDPOINTS[envKey].accountValidation;

  const isMock = tokenRes.access_token?.startsWith('mock_');
  if (isMock) {
    return {
      success: true,
      accountName: 'TEST LANDLORD ACCOUNT',
      accountNumber: accountNumber || credentials.account_id,
      status: 'active',
      responseSummary: `Mock Account Validation succeeded for ${accountNumber || credentials.account_id}.`
    };
  }

  const messageNumber = `MSG-${Date.now()}`;
  const payload = {
    MessageNumber: messageNumber,
    AccountNumber: accountNumber || credentials.account_id
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenRes.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        responseSummary: `Account Validation returned HTTP ${res.status}`,
        errorMessage: data.MessageDescription || data.error || 'Account validation enquiry failed.'
      };
    }

    return {
      success: true,
      accountName: data.AccountName || data.AccountTitle || 'Co-op Account',
      accountNumber: data.AccountNumber || accountNumber,
      status: data.Status || 'active',
      raw: data,
      responseSummary: 'Account validation succeeded.'
    };
  } catch (err) {
    return {
      success: false,
      responseSummary: `Account validation failed: ${err.message}`,
      errorMessage: err.message
    };
  }
}

/**
 * Fetch Account Transactions (Statement Feed) from Co-op API
 */
export async function fetchAccountTransactions(credentials = {}, { startDate, endDate }, environment = 'sandbox') {
  const tokenRes = await getOAuthToken(credentials, environment);
  if (!tokenRes.success) {
    return tokenRes;
  }

  const envKey = environment === 'production' || environment === 'live' ? 'production' : 'sandbox';
  const endpoint = ENDPOINTS[envKey].accountTransactions;

  const isMock = tokenRes.access_token?.startsWith('mock_');
  if (isMock) {
    return {
      success: true,
      transactions: [],
      responseSummary: 'Mock Account Transactions retrieved successfully.'
    };
  }

  const messageNumber = `TXMSG-${Date.now()}`;
  const payload = {
    MessageNumber: messageNumber,
    AccountNumber: credentials.account_id,
    StartDate: startDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    EndDate: endDate || new Date().toISOString().split('T')[0]
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenRes.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        responseSummary: `Account Transactions returned HTTP ${res.status}`,
        errorMessage: data.MessageDescription || data.error || 'Failed to fetch account transactions.'
      };
    }

    return {
      success: true,
      transactions: data.Transactions || data.Statement || [],
      raw: data,
      responseSummary: 'Account transactions retrieved successfully.'
    };
  } catch (err) {
    return {
      success: false,
      responseSummary: `Fetch transactions failed: ${err.message}`,
      errorMessage: err.message
    };
  }
}

/**
 * Integration Test Helper: Verifies Co-op Connect token generation
 */
export async function testCoopConnection(credentials = {}, environment = 'sandbox') {
  return await getOAuthToken(credentials, environment);
}
