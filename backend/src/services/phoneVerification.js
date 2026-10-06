import crypto from 'crypto';
import PhoneOtp from '../models/PhoneOtp.js';
import User from '../models/User.js';
import { sendSms, smsConfigured } from './smsService.js';
import { audit } from './auditService.js';

// Proves a customer owns the phone number on their account, with a one-time code sent by SMS.
export const COOLDOWN_SECONDS = 30; // wait between codes
export const CODE_MINUTES = 5;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

const hash = (phone, code) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-only').update(`${phone}|${code}`).digest('hex');
const mask = phone => String(phone).replace(/(\d{2})\d{6}(\d{2})/, '$1XXXXXX$2');
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

// With no SMS provider set up (and not in production) the code is handed back so the flow can be tried.
const sandboxAllowed = () => !smsConfigured() && process.env.PAYMENT_MODE !== 'PRODUCTION';

export async function sendCode(user) {
  if (user.phoneVerified) return { status: 200, body: { alreadyVerified: true, phone: mask(user.phone), message: 'This number is already verified' } };

  const now = Date.now();
  const phone = user.phone;
  const rec = await PhoneOtp.findOne({ phone });
  let windowStart = now;
  let sentInWindow = 0;
  if (rec) {
    if (now - rec.windowStart.getTime() < WINDOW_MS) { windowStart = rec.windowStart.getTime(); sentInWindow = rec.sentInWindow; }
    const since = rec.lastSentAt ? (now - rec.lastSentAt.getTime()) / 1000 : Infinity;
    if (since < COOLDOWN_SECONDS) return fail(429, `Please wait ${Math.ceil(COOLDOWN_SECONDS - since)} seconds before asking for another code.`, { retryAfterSeconds: Math.ceil(COOLDOWN_SECONDS - since) });
    if (sentInWindow >= MAX_SENDS_PER_WINDOW) {
      const mins = Math.ceil((windowStart + WINDOW_MS - now) / 60000);
      return fail(429, `Too many codes were sent to this number. Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.`, { retryAfterSeconds: mins * 60 });
    }
  }
  if (!smsConfigured() && !sandboxAllowed()) return fail(503, 'Phone verification is not available right now. Please contact support.');

  const code = String(crypto.randomInt(100000, 1000000));
  const sms = await sendSms(phone, `${code} is your LIFC verification code. It is valid for ${CODE_MINUTES} minutes. Do not share it with anyone.`, { otp: code });
  if (sms.configured && !sms.sent) return fail(502, 'We could not send the SMS right now. Please try again in a minute.');

  await PhoneOtp.findOneAndUpdate(
    { phone },
    {
      userId: user._id,
      codeHash: hash(phone, code),
      codeExpiresAt: new Date(now + CODE_MINUTES * 60000),
      attempts: 0,
      lastSentAt: new Date(now),
      windowStart: new Date(windowStart),
      sentInWindow: sentInWindow + 1,
      deleteAt: new Date(windowStart + WINDOW_MS + 60000),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return {
    status: 200,
    body: {
      message: sms.sent ? 'We sent a code to your phone' : 'Code generated',
      phone: mask(phone),
      smsSent: sms.sent,
      expiresInSeconds: CODE_MINUTES * 60,
      resendAfterSeconds: COOLDOWN_SECONDS,
      ...(sandboxAllowed() ? { sandboxOtp: code } : {}),
    },
  };
}

export async function verifyCode(user, rawCode, req = null) {
  const code = String(rawCode ?? '').trim();
  if (!/^\d{6}$/.test(code)) return fail(400, 'Enter the 6-digit code');
  if (user.phoneVerified) return { status: 200, body: { message: 'This number is already verified', verified: true } };

  const rec = await PhoneOtp.findOne({ phone: user.phone });
  if (!rec || !rec.codeHash || !rec.codeExpiresAt) return fail(400, 'No code found. Ask for a new one.');
  if (rec.codeExpiresAt.getTime() < Date.now()) return fail(400, 'That code has expired. Ask for a new one.');

  // Count the attempt first, in one step, so guesses cannot be made in parallel to dodge the limit.
  const counted = await PhoneOtp.findOneAndUpdate({ phone: user.phone, attempts: { $lt: MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true });
  if (!counted) return fail(429, 'Too many wrong codes. Ask for a new one.');

  const a = Buffer.from(hash(user.phone, code));
  const b = Buffer.from(counted.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fail(400, 'That code is not right', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - counted.attempts) });
  }

  await User.updateOne({ _id: user._id }, { phoneVerified: true, phoneVerifiedAt: new Date() });
  await PhoneOtp.updateOne({ phone: user.phone }, { codeHash: '', $unset: { codeExpiresAt: '' }, attempts: 0 });
  await audit({ email: user.email, role: 'customer' }, 'PHONE_VERIFIED', { type: 'User', id: user._id }, {}, req);
  return { status: 200, body: { message: 'Phone number verified', verified: true } };
}

export default { sendCode, verifyCode };
