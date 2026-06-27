import assert from 'node:assert';
import { sendSmsViaAdapter } from '../server/smsProviderService.js';

async function main() {
  console.log('[LIVE-SMS-TEST] Verifying environment requirements...');

  if (process.env.ALLOW_LIVE_SMS_TEST !== 'I_UNDERSTAND_THIS_SENDS_REAL_SMS') {
    console.error('\nERROR: Live SMS test skipped.');
    console.error('To run live SMS test, set:');
    console.error('  $env:ALLOW_LIVE_SMS_TEST="I_UNDERSTAND_THIS_SENDS_REAL_SMS"');
    console.error('  $env:LIVE_SMS_TEST_PHONE="2547XXXXXXXX"');
    console.error('  $env:LIVE_SMS_PROVIDER="mobitech"');
    console.error('  $env:LIVE_SMS_API_URL="https://sms.textsms.co.ke"');
    console.error('  $env:LIVE_SMS_API_KEY="your-real-key"');
    console.error('  $env:LIVE_SMS_CLIENT_ID="your-partner-id"\n');
    process.exit(0);
  }

  const phone = process.env.LIVE_SMS_TEST_PHONE;
  const provider = process.env.LIVE_SMS_PROVIDER || 'mobitech';
  const api_url = process.env.LIVE_SMS_API_URL;
  const api_key = process.env.LIVE_SMS_API_KEY;
  const client_id = process.env.LIVE_SMS_CLIENT_ID;

  if (!phone || !api_url || !api_key || !client_id) {
    console.error('Error: Missing live configuration settings (phone, api_url, api_key, client_id).');
    process.exit(1);
  }

  console.log(`[LIVE-SMS-TEST] Sending real SMS to ${phone} via ${provider}...`);

  const result = await sendSmsViaAdapter({
    provider,
    api_url,
    api_key,
    client_id,
    sender_id: 'SMARTLANDY',
    to: phone,
    message: 'Smart Landlord LIVE Gateway Connection Verification.'
  });

  console.log('[LIVE-SMS-TEST] Result:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('🎉 Live SMS sent successfully!');
  } else {
    console.error('❌ Live SMS failed:', result.error);
    process.exitCode = 1;
  }
}

main().catch(console.error);
