import crypto from 'crypto';
import DeviceToken from '../models/DeviceToken.js';
import User from '../models/User.js';
import { getConfig } from './configService.js';

// Push notifications to customers' phones through Firebase Cloud Messaging (FCM).
//
// How it routes: once a Firebase project is set up (PUSH_PROVIDER=fcm plus its project id and service-account details,
// on the portal's Integrations page), every notification the app creates also goes out as a push to the customer's
// registered phones. With nothing set up, nothing is sent and nothing breaks: the notification still appears in the
// app's bell. Failures are logged and never hold up loans, payments or messages.
//
// Settings: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (from the service-account key file). Two more exist only
// so tests can point at a pretend server: FCM_TOKEN_URL and FCM_API_BASE.

// What each kind of notification is, for the customer's on/off choices. 'loan' alerts cannot be switched off:
// they are about money and the customer's account.
export const CATEGORIES = [
  { key: 'loan', label: 'Loan and payment alerts', note: 'Approvals, payouts, overdue notices and receipts. These are always on.', locked: true },
  { key: 'reminders', label: 'EMI reminders', note: 'A reminder before an instalment is due.' },
  { key: 'messages', label: 'Replies from our team', note: 'When support answers your message.' },
  { key: 'offers', label: 'Offers and news', note: 'New offers, announcements and referral rewards.' },
];
const TYPE_TO_CATEGORY = {
  EMI_REMINDER: 'reminders',
  SUPPORT_REPLY: 'messages',
  ANNOUNCEMENT: 'offers',
  OFFER: 'offers',
  NUDGE: 'offers',
  REFERRAL_REWARD: 'offers',
};
export const categoryOf = type => TYPE_TO_CATEGORY[type] || 'loan';

const MAX_DEVICES = 5; // per customer, newest first
const PROVIDER = 'fcm';

export const providerName = () => getConfig('PUSH_PROVIDER') || '';
export const missingSettings = () => (providerName() === PROVIDER ? ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'].filter(k => !getConfig(k)) : []);
export const pushConfigured = () => providerName() === PROVIDER && missingSettings().length === 0;

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const tokenUrl = () => getConfig('FCM_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
const apiBase = () => getConfig('FCM_API_BASE') || 'https://fcm.googleapis.com';

let cached = { token: null, until: 0 };
let lastSend = null; // what happened the last time we tried to send: { at, result, detail }
const remember = (result, detail = '') => { lastSend = { at: new Date().toISOString(), result, detail: String(detail).slice(0, 200) }; };

async function accessToken() {
  if (cached.token && Date.now() < cached.until - 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({ iss: getConfig('FCM_CLIENT_EMAIL'), scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUrl(), iat: now, exp: now + 3600 });
  const key = String(getConfig('FCM_PRIVATE_KEY')).replace(/\\n/g, '\n');
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key).toString('base64url');
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Google sign-in answered ${res.status}`);
  const j = await res.json();
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}
export const forgetAccessToken = () => { cached = { token: null, until: 0 }; };

const flatten = data => Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])); // FCM data values must be strings

// One phone. Returns 'sent', 'failed' or 'gone' (the phone no longer has the app).
async function sendOne(token, { title, body, data }) {
  try {
    const res = await fetch(`${apiBase()}/v1/projects/${getConfig('FCM_PROJECT_ID')}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title, body }, data: flatten(data), android: { priority: 'HIGH' }, apns: { payload: { aps: { sound: 'default' } } } } }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) { remember('sent'); return 'sent'; }
    const text = await res.text();
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) { remember('gone', 'The phone no longer has the app'); return 'gone'; }
    if (res.status === 401) forgetAccessToken();
    console.error('Push rejected:', res.status, text.slice(0, 160));
    remember('rejected', `Firebase answered ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 140)}`);
    return 'failed';
  } catch (e) {
    console.error('Push failed:', e.message);
    remember('failed', e.message);
    return 'failed';
  }
}

// Sends to all of one customer's phones, if the provider is set up and the customer has not switched this kind off.
// Returns 'sent', 'failed' or 'skipped'. Never throws.
export async function pushToUser(userId, { title, body, type, data }) {
  try {
    if (!pushConfigured()) return 'skipped';
    const category = categoryOf(type);
    const user = await User.findById(userId).select('pushPrefs');
    if (!user) return 'skipped';
    if (category !== 'loan' && user.pushPrefs?.[category] === false) return 'skipped';
    const devices = await DeviceToken.find({ userId }).sort({ lastSeenAt: -1 }).limit(MAX_DEVICES);
    if (!devices.length) return 'skipped';
    let sent = 0;
    for (const d of devices) {
      const r = await sendOne(d.token, { title, body, data: { type, ...data } });
      if (r === 'sent') sent++;
      if (r === 'gone') await DeviceToken.deleteOne({ _id: d._id });
    }
    return sent ? 'sent' : 'failed';
  } catch (e) {
    console.error('Push error:', e.message);
    return 'failed';
  }
}

// For announcements to many customers: a few at a time, in the background. Returns how many were sent.
export async function pushToMany(userIds, payload, concurrency = 10) {
  let sent = 0;
  const queue = [...userIds];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if ((await pushToUser(id, payload)) === 'sent') sent++;
    }
  }));
  return sent;
}

export async function registerDevice(userId, { token, platform, appVersion }) {
  await DeviceToken.updateOne({ token }, { userId, platform, appVersion: appVersion || '', lastSeenAt: new Date(), $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  // keep only the newest few
  const all = await DeviceToken.find({ userId }).sort({ lastSeenAt: -1 }).select('_id');
  if (all.length > MAX_DEVICES) await DeviceToken.deleteMany({ _id: { $in: all.slice(MAX_DEVICES).map(d => d._id) } });
}

// For the portal's "Check push set-up": tries the connection to Google without sending anything to anyone.
export async function checkSetup() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const p = providerName();
  add('Provider chosen', p === PROVIDER, p === PROVIDER ? 'fcm' : p ? `"${p}" is not a push provider here. Choose fcm.` : 'No provider is chosen. Pick fcm and save.');
  const missing = missingSettings();
  add('Settings filled in', p === PROVIDER && !missing.length, missing.length ? `Missing: ${missing.join(', ')}` : p === PROVIDER ? `Project ${getConfig('FCM_PROJECT_ID')}` : 'Choose the provider first');
  let keyOk = false;
  if (p === PROVIDER && !missing.length) {
    const key = String(getConfig('FCM_PRIVATE_KEY')).replace(/\\n/g, '\n');
    try { crypto.createPrivateKey(key); keyOk = true; } catch (e) { keyOk = false; }
    add('Private key is readable', keyOk, keyOk ? 'The key text is complete and well formed' : 'The key text is not a complete private key. Paste everything from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----, including both lines.');
  }
  if (keyOk) {
    try { forgetAccessToken(); await accessToken(); add('Google accepts the key', true, 'Google gave us permission to send. The email, project and key match.'); }
    catch (e) { add('Google accepts the key', false, `${e.message}. The email or key may be wrong, or the key was deleted in Firebase. Create a new key and paste it again.`); }
  }
  const phones = await DeviceToken.countDocuments();
  const people = (await DeviceToken.distinct('userId')).length;
  add('Phones registered', phones > 0, phones ? `${phones} phone(s) for ${people} customer(s)` : 'No phone has registered yet. On the phone: install the newest app, sign in, open Profile, Notifications, and tap "Turn on notifications".');
  return { ok: checks.every(c => c.ok), checks, lastSend, platforms: await DeviceToken.aggregate([{ $group: { _id: '$platform', n: { $sum: 1 } } }]) };
}

// Sends a test notification to the customer's own phones and says what happened, so a problem can be seen from the app.
export async function testToUser(userId) {
  if (!pushConfigured()) return { ok: false, code: 'not_configured', message: 'Phone notifications are not switched on at the company yet.' };
  const devices = await DeviceToken.find({ userId }).sort({ lastSeenAt: -1 }).limit(MAX_DEVICES);
  if (!devices.length) return { ok: false, code: 'no_devices', message: 'The server does not have your phone yet. Tap "Turn on notifications" first.' };
  const results = [];
  for (const d of devices) {
    const r = await sendOne(d.token, { title: 'LIFC test notification', body: 'If you can read this in your notification tray, notifications work on this phone.', data: { type: 'TEST' } });
    results.push({ platform: d.platform, result: r, detail: r === 'sent' ? '' : (lastSend && lastSend.detail) || '' });
    if (r === 'gone') await DeviceToken.deleteOne({ _id: d._id });
  }
  const sent = results.filter(r => r.result === 'sent').length;
  return { ok: sent > 0, code: 'tried', results, message: sent ? `Sent to ${sent} phone${sent === 1 ? '' : 's'}. It should appear in the notification tray in a few seconds.` : `Could not send. ${results[0]?.detail || 'The notification service did not accept it.'}` };
}

export const unregisterDevice = (userId, token) => DeviceToken.deleteOne({ userId, token });

export const deviceCount = userIds => DeviceToken.distinct('userId', userIds ? { userId: { $in: userIds } } : {}).then(a => a.length);

export default { pushToUser, pushToMany, registerDevice, unregisterDevice, pushConfigured, CATEGORIES, categoryOf };
