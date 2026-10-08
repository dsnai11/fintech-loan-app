import { getConfig } from './configService.js';
import { smsConfigured } from './smsService.js';
import { bureauConfigured, providerName as bureauProvider, missingSettings as bureauMissing, PROVIDERS as BUREAUS } from './bureauService.js';
import { pushConfigured, providerName as pushProvider, missingSettings as pushMissing } from './pushService.js';
import { modeNow as digilockerMode, providerName as digilockerProvider, PROVIDERS as DIGILOCKERS } from './digilockerService.js';

// One place that says, for every outside service, whether the app is using the real thing or its test mode, and
// what is missing. The settings are saved as configuration values; secrets are never sent back, only whether they are set.
//
// Rule everywhere: once a real provider is set up, every request goes to it and the test mode stops being used.
// In production with no provider the feature says "not available"; it never makes up data.

const production = () => process.env.PAYMENT_MODE === 'PRODUCTION';
const field = (key, label, extra = {}) => ({ key, label, ...extra });

export const INTEGRATIONS = [
  {
    id: 'sms', label: 'SMS (OTP and alerts)', purpose: 'Phone verification codes, EMI reminders and alerts.',
    fields: [
      field('SMS_PROVIDER', 'Provider', { options: ['', 'fast2sms', 'msg91', 'twilio'] }),
      field('SMS_API_KEY', 'API key (Fast2SMS or MSG91)', { secret: true }),
      field('SMS_SENDER_ID', 'Sender ID (6 letters)'),
      field('MSG91_TEMPLATE_ID', 'MSG91 template ID'),
      field('TWILIO_ACCOUNT_SID', 'Twilio account SID'),
      field('TWILIO_AUTH_TOKEN', 'Twilio auth token', { secret: true }),
      field('TWILIO_PHONE', 'Twilio phone number'),
    ],
    status: () => {
      if (smsConfigured()) return { mode: 'live', provider: getConfig('SMS_PROVIDER') };
      return production() ? { mode: 'unavailable', note: 'No SMS provider is set up, so customers cannot verify their phone number.' } : { mode: 'test', note: 'The code is shown on screen instead of being sent.' };
    },
  },
  {
    id: 'email', label: 'Email', purpose: 'Password links, loan updates and receipts by email.',
    fields: [
      field('EMAIL_SERVICE', 'Service (gmail, outlook, or your provider)'),
      field('EMAIL_USER', 'Sender address / username'),
      field('EMAIL_PASSWORD', 'Password or app password', { secret: true }),
    ],
    status: () => (getConfig('EMAIL_USER') && getConfig('EMAIL_PASSWORD') ? { mode: 'live', provider: getConfig('EMAIL_SERVICE') || 'gmail' } : { mode: 'off', note: 'No email account is set up. Emails are skipped; customers still get in-app notifications.' }),
  },
  {
    id: 'push', label: 'Push notifications (Firebase)', purpose: 'Sends loan, EMI and offer alerts to customers\' phones, even when the app is closed.',
    fields: [
      field('PUSH_PROVIDER', 'Provider', { options: ['', 'fcm'], hint: 'Create a free Firebase project, then paste its service-account details below. Leave empty for in-app notifications only.' }),
      field('FCM_PROJECT_ID', 'Firebase project ID'),
      field('FCM_CLIENT_EMAIL', 'Service account email'),
      field('FCM_PRIVATE_KEY', 'Service account private key', { secret: true, long: true }),
    ],
    status: () => {
      const p = pushProvider();
      if (p && p !== 'fcm') return { mode: 'misconfigured', provider: p, note: `"${p}" is not a push provider here. Choose fcm.` };
      if (p && pushMissing().length) return { mode: 'misconfigured', provider: p, missing: pushMissing(), note: 'Fill in the missing settings.' };
      if (pushConfigured()) return { mode: 'live', provider: 'fcm', note: 'Customers\' phones also need the app build with Firebase added (see the setup steps).' };
      return { mode: 'off', note: 'Not set up. Alerts still appear in the app\'s notification bell.' };
    },
  },
  {
    id: 'bureau', label: 'Credit bureau', purpose: 'The credit score behind each customer\'s loan offer.',
    fields: [
      field('BUREAU_PROVIDER', 'Provider', { options: ['', ...Object.keys(BUREAUS)], hint: '"generic" calls any bureau or aggregator that returns a JSON score. Leave empty for test mode.' }),
      field('BUREAU_API_URL', 'Address (URL) to call'),
      field('BUREAU_API_KEY', 'API key', { secret: true }),
      field('BUREAU_METHOD', 'Method (POST or GET)'),
      field('BUREAU_AUTH_HEADER', 'Header carrying the key (default Authorization)'),
      field('BUREAU_AUTH_SCHEME', 'Text before the key (default "Bearer ")'),
      field('BUREAU_REQUEST_TEMPLATE', 'Request body (JSON; may use {{pan}} {{name}} {{dob}} {{phone}} {{email}})', { long: true }),
      field('BUREAU_SCORE_PATH', 'Where the score is in the reply (like data.score)'),
    ],
    status: () => {
      const p = bureauProvider();
      if (p && !BUREAUS[p]) return { mode: 'misconfigured', provider: p, note: `"${p}" is not an installed adapter. Choose one from the list.` };
      if (p && bureauMissing().length) return { mode: 'misconfigured', provider: p, missing: bureauMissing(), note: 'Fill in the missing settings. Until then the test mode or "no score" is used.' };
      if (bureauConfigured()) return { mode: 'live', provider: p };
      return production() ? { mode: 'unavailable', note: 'No bureau is set up. Offers are worked out without a credit score.' } : { mode: 'test', note: 'A test score made from the PAN is used.' };
    },
  },
  {
    id: 'digilocker', label: 'DigiLocker (KYC)', purpose: 'Identity check from the customer\'s Aadhaar record, through a provider with the government registration.',
    fields: [field('DIGILOCKER_PROVIDER', 'Provider', { options: ['', ...Object.keys(DIGILOCKERS)], hint: 'A provider\'s adapter is installed once you have an account with them (Digio, Signzy, Setu, IDfy).' })],
    status: () => {
      const p = digilockerProvider();
      if (p && !DIGILOCKERS[p]) return { mode: 'misconfigured', provider: p, note: `No adapter for "${p}" is installed yet, so ${production() ? 'customers see "not available"' : 'the test page is used'}. Ask for it to be added.` };
      const m = digilockerMode();
      if (m === 'digilocker') return { mode: 'live', provider: p };
      return m === 'sandbox' ? { mode: 'test', note: 'A stand-in DigiLocker page is used. KYC is never auto-approved in test mode.' } : { mode: 'unavailable', note: 'No provider is set up, so the KYC step says it is not available.' };
    },
  },
  {
    id: 'payments', label: 'Payments (Razorpay)', purpose: 'Loan payouts and EMI collection.',
    envOnly: ['PAYMENT_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_ACCOUNT_ID', 'RAZORPAY_WEBHOOK_SECRET'],
    fields: [],
    status: () => {
      const missing = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_ACCOUNT_ID'].filter(k => !process.env[k]);
      if (production()) return missing.length ? { mode: 'misconfigured', missing, note: 'Production mode is on but these are not set in Railway.' } : { mode: 'live', provider: 'razorpay' };
      return { mode: 'test', note: 'Test mode: payouts and collections are simulated. Switch PAYMENT_MODE to PRODUCTION in Railway when the keys are in.' };
    },
  },
  {
    id: 'liveness', label: 'Selfie liveness', purpose: 'Checks the customer\'s selfie is a live person.',
    fields: [],
    status: () => ({ mode: 'device', note: 'The blink check runs on the phone and staff review the photos. A certified liveness provider can replace it later.' }),
  },
];

const isSet = k => !!getConfig(k);

export function integrationsView() {
  return {
    productionMode: production(),
    integrations: INTEGRATIONS.map(i => ({
      id: i.id, label: i.label, purpose: i.purpose, envOnly: i.envOnly || null,
      status: i.status(),
      fields: i.fields.map(f => ({ key: f.key, label: f.label, secret: !!f.secret, options: f.options || null, hint: f.hint || '', long: !!f.long, set: isSet(f.key), value: f.secret ? '' : (getConfig(f.key) || '') })),
    })),
  };
}

export const editableKeys = () => new Map(INTEGRATIONS.flatMap(i => i.fields.map(f => [f.key, { secret: !!f.secret, group: i.id }])));

export default { INTEGRATIONS, integrationsView, editableKeys };
