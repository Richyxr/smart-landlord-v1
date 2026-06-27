import crypto from 'node:crypto';

export function normalizeKenyanPhoneNumber(phone) {
  if (!phone) {
    throw new Error('Phone number is required.');
  }
  let cleaned = String(phone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+254')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.startsWith('07') && cleaned.length === 10) {
    cleaned = '254' + cleaned.slice(1);
  } else if (cleaned.startsWith('01') && cleaned.length === 10) {
    cleaned = '254' + cleaned.slice(1);
  }
  
  if (/^254[71]\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  
  throw new Error(`Invalid Kenyan phone number format: "${phone}". Expected 07XXXXXXXX, 01XXXXXXXX, or 2547XXXXXXXX.`);
}

export async function sendSmsViaAdapter({
  provider,
  api_url,
  api_key,
  client_id,
  sender_id,
  to,
  message
}) {
  const normalizedTo = normalizeKenyanPhoneNumber(to);
  const providerName = String(provider || '').trim().toLowerCase();

  if (providerName === 'mock') {
    if (!api_key) {
      return { success: false, status: 'failed', error: 'SMS Gateway API Key / Token is required.' };
    }
    if (api_key === 'invalid-key') {
      return { success: false, status: 'failed', error: 'Invalid API Key / Token.' };
    }
    if (api_url && api_url.includes('invalid-url')) {
      return { success: false, status: 'failed', error: 'Unreachable SMS Gateway API URL.' };
    }
    return {
      success: true,
      messageId: `mock-sms-${crypto.randomUUID()}`,
      status: 'sent'
    };
  }

  if (providerName === 'mobitech' || providerName === 'mobifour') {
    if (!api_key) {
      return { success: false, status: 'failed', error: 'Mobitech API key is required.' };
    }
    if (!client_id) {
      return { success: false, status: 'failed', error: 'Mobitech Partner ID (Client ID) is required.' };
    }
    if (!api_url) {
      return { success: false, status: 'failed', error: 'Mobitech API base URL is required.' };
    }

    const payload = {
      apikey: api_key,
      partnerID: client_id,
      message: message,
      shortcode: sender_id || 'SMARTLANDY',
      mobile: normalizedTo
    };

    try {
      const url = api_url.replace(/\/$/, '') + '/api/services/sendsms/';
      const apiRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      const text = await apiRes.text();
      let apiData = null;
      try {
        apiData = JSON.parse(text);
      } catch {}

      if (!apiRes.ok) {
        return {
          success: false,
          status: 'failed',
          error: `HTTP Error Status ${apiRes.status}: ${text.substring(0, 100)}`
        };
      }

      const firstResponse = apiData?.responses?.[0];
      const responseCode = firstResponse?.['respose-code'];
      const responseDesc = firstResponse?.['response-description'] || 'No description';

      if (responseCode !== 200 && responseCode !== '200') {
        return {
          success: false,
          status: 'failed',
          error: `Mobitech Gateway Error ${responseCode}: ${responseDesc}`
        };
      }

      return {
        success: true,
        messageId: firstResponse?.messageid ? String(firstResponse.messageid) : `mobitech-${crypto.randomUUID()}`,
        status: 'sent'
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        error: `Mobitech request failed: ${error.message}`
      };
    }
  }

  return {
    success: false,
    status: 'failed',
    error: `Unsupported SMS provider: "${provider}"`
  };
}
