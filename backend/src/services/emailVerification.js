import { appSecret } from './appSecret.js';
import crypto from 'crypto';
import User from '../models/User.js';
import { sendPlainEmail } from './notificationService.js';
import { getConfig } from './configService.js';
import { audit } from './auditService.js';

// Proves a customer owns the email address on their account, with a one-time code sent by email (through the SMTP account set up
// on the Integrations page). The code is kept only as a keyed hash on the account.
export const COOLDOWN_SECONDS = 30;
export const CODE_MINUTES = 10;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

const hash = (email, code) => crypto.createHmac('sha256', appSecret()).update(`${String(email).toLowerCase()}|${code}`).digest('hex');
const mask = email => String(email).replace(/^(.).*(@.*)$/, '$1***$2');
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

export const emailConfigured = () => !!(getConfig('EMAIL_USER') && getConfig('EMAIL_PASSWORD'));
// With no email account set up (and not in production) the code is handed back so the flow can be tried.
const sandboxAllowed = () => !emailConfigured() && process.env.PAYMENT_MODE !== 'PRODUCTION';
export const mode = () => (emailConfigured() ? 'live' : sandboxAllowed() ? 'test' : 'unavailable');

export async function sendEmailCode(user) {
  if (!user.email) return fail(400, 'There is no email address on this account.');
  if (user.emailVerified && user.emailVerifiedFor === user.email.toLowerCase()) return { status: 200, body: { alreadyVerified: true, email: mask(user.email), message: 'This email is already verified' } };
  if (mode() === 'unavailable') return fail(503, 'Email verification is not available right now. Please contact support.');

  const now = Date.now();
  const rec = user.emailOtp || {};
  let windowStart = now;
  let sentInWindow = 0;
  if (rec.windowStart && now - new Date(rec.windowStart).getTime() < WINDOW_MS) { windowStart = new Date(rec.windowStart).getTime(); sentInWindow = rec.sentInWindow || 0; }
  const since = rec.lastSentAt ? (now - new Date(rec.lastSentAt).getTime()) / 1000 : Infinity;
  if (since < COOLDOWN_SECONDS) return fail(429, `Please wait ${Math.ceil(COOLDOWN_SECONDS - since)} seconds before asking for another code.`, { retryAfterSeconds: Math.ceil(COOLDOWN_SECONDS - since) });
  if (sentInWindow >= MAX_SENDS_PER_WINDOW) return fail(429, 'Too many codes were sent. Please try again in a while.');

  const code = String(crypto.randomInt(100000, 1000000));
  let sent = false;
  if (emailConfigured()) {
    const r = await sendPlainEmail(user.email, 'Your LIFC verification code', `${code} is your LIFC verification code. It is valid for ${CODE_MINUTES} minutes. Do not share it with anyone.`);
    if (r !== 'sent') return fail(502, 'We could not send the email right now. Please try again in a minute.');
    sent = true;
  }
  await User.updateOne({ _id: user._id }, { emailOtp: { hash: hash(user.email, code), expiresAt: new Date(now + CODE_MINUTES * 60000), attempts: 0, lastSentAt: new Date(now), windowStart: new Date(windowStart), sentInWindow: sentInWindow + 1 } });
  return { status: 200, body: { message: sent ? 'We sent a code to your email' : 'Code generated', email: mask(user.email), emailSent: sent, expiresInSeconds: CODE_MINUTES * 60, resendAfterSeconds: COOLDOWN_SECONDS, ...(sandboxAllowed() ? { sandboxCode: code } : {}) } };
}

export async function verifyEmailCode(user, rawCode, req = null) {
  const code = String(rawCode ?? '').trim();
  if (!/^\d{6}$/.test(code)) return fail(400, 'Enter the 6-digit code');
  const rec = user.emailOtp;
  if (!rec || !rec.hash || !rec.expiresAt) return fail(400, 'No code found. Ask for a new one.');
  if (new Date(rec.expiresAt).getTime() < Date.now()) return fail(400, 'That code has expired. Ask for a new one.');
  if ((rec.attempts || 0) >= MAX_ATTEMPTS) return fail(429, 'Too many wrong codes. Ask for a new one.');
  const ok = crypto.timingSafeEqual(Buffer.from(hash(user.email, code)), Buffer.from(rec.hash));
  if (!ok) {
    await User.updateOne({ _id: user._id }, { 'emailOtp.attempts': (rec.attempts || 0) + 1 });
    return fail(400, 'That code is not right.', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - (rec.attempts || 0) - 1) });
  }
  await User.updateOne({ _id: user._id }, { emailVerified: true, emailVerifiedFor: user.email.toLowerCase(), emailVerifiedAt: new Date(), $unset: { emailOtp: 1 } });
  await audit({ email: user.email, role: 'customer' }, 'EMAIL_VERIFIED', { type: 'User', id: user._id }, {}, req);
  return { status: 200, body: { verified: true, message: 'Your email is verified' } };
}

export default { sendEmailCode, verifyEmailCode, mode, emailConfigured };
