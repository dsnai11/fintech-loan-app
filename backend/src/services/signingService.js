import crypto from 'crypto';
import mongoose from 'mongoose';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import EsignSession from '../models/EsignSession.js';
import PhoneOtp from '../models/PhoneOtp.js';
import { getConfig } from './configService.js';
import { baseUrl } from './passwordReset.js';
import { sendSms, smsConfigured } from './smsService.js';
import { audit, clientIp } from './auditService.js';
import { buildAgreement } from './agreementService.js';

// How a customer signs the loan agreement. Staff choose on the Integrations page:
//   click    - ticks "I agree" (what the app did first)
//   otp      - ticks "I agree" and enters a code sent by SMS to the phone on the account
//   aadhaar  - signs with an Aadhaar eSign through a signing provider (Digio, Leegality, Signzy, Protean)
// Whichever is used, the exact text, its hash, the time, the device address and the proof are stored with the loan.
// A real eSign provider's adapter is registered in PROVIDERS once the lender has an account:
//   { start({ user, loan, session, agreement, redirectUrl }) -> { providerRef, url },
//     fetch({ session }) -> { signerName, certificateId?, signedAt? } }
// Until then, outside production, "aadhaar" runs with a stand-in signing page. In production with no provider it says it is
// not available (customers cannot sign), rather than quietly falling back to a weaker method.

export const METHODS = ['click', 'otp', 'aadhaar'];
export const signingMethod = () => (METHODS.includes(getConfig('AGREEMENT_SIGNING')) ? getConfig('AGREEMENT_SIGNING') : 'click');
export const PROVIDERS = {};
export const providerName = () => getConfig('ESIGN_PROVIDER') || '';
const realProvider = () => PROVIDERS[providerName()] || null;
export const sandboxAllowed = () => !realProvider() && process.env.PAYMENT_MODE !== 'PRODUCTION';
export const esignMode = () => (realProvider() ? 'esign' : sandboxAllowed() ? 'sandbox' : 'unavailable');
const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const mask = phone => String(phone).replace(/(\d{2})\d{6}(\d{2})/, '$1XXXXXX$2');

async function record({ loan, user, agreement, method, signature, req }) {
  let doc;
  try {
    doc = await AgreementAcceptance.create({
      loanId: loan._id, userId: user._id, version: agreement.version, hash: agreement.hash, text: agreement.text,
      method, signature, ip: req ? clientIp(req) : undefined, userAgent: req ? String(req.headers?.['user-agent'] || '').slice(0, 300) : undefined,
    });
  } catch (e) {
    if (e.code === 11000) return { ok: true, already: true, doc: await AgreementAcceptance.findOne({ loanId: loan._id }) };
    throw e;
  }
  await audit({ email: user.email, role: 'customer' }, 'AGREEMENT_ACCEPTED', { type: 'Loan', id: loan._id }, { version: agreement.version, hash: agreement.hash, method }, req);
  return { ok: true, doc };
}

// Checks the loan can be signed now and the agreement the customer saw is the current one
function checkReady(loan, user, hash) {
  if (loan.status !== 'approved') return fail(400, 'Only an approved loan can be accepted');
  const agreement = buildAgreement(loan, user);
  if (hash !== agreement.hash) return fail(409, 'The agreement has changed. Please read it again.');
  return { ok: true, agreement };
}

// ── click ────────────────────────────────────────────────────────────────────────────────────
export async function acceptByClick(loan, user, { hash, confirmed }, req) {
  if (signingMethod() !== 'click') return fail(403, 'This loan needs to be signed with a code or Aadhaar eSign.', { code: 'SIGNING_REQUIRED', method: signingMethod() });
  if (confirmed !== true) return fail(400, 'Please confirm that you have read and agree');
  const ready = checkReady(loan, user, hash);
  if (!ready.ok) return ready;
  return record({ loan, user, agreement: ready.agreement, method: 'click', signature: { acceptedFrom: 'app' }, req });
}

// ── otp ──────────────────────────────────────────────────────────────────────────────────────
const CODE_MINUTES = 10, COOLDOWN = 30, MAX_ATTEMPTS = 5, MAX_PER_HOUR = 5;
const key = loan => `sign:${loan._id}`;
const hashCode = (k, code) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-only').update(`${k}|${code}`).digest('hex');
const otpSandbox = () => !smsConfigured() && process.env.PAYMENT_MODE !== 'PRODUCTION';

export async function sendSigningCode(loan, user) {
  if (signingMethod() !== 'otp') return fail(400, 'This agreement is not signed with a code.');
  if (loan.status !== 'approved') return fail(400, 'Only an approved loan can be accepted');
  if (!smsConfigured() && !otpSandbox()) return fail(503, 'Sending the code is not available right now. Please contact support.');
  const k = key(loan), now = Date.now();
  const rec = await PhoneOtp.findOne({ phone: k });
  let windowStart = now, sent = 0;
  if (rec) {
    if (now - rec.windowStart.getTime() < 3600e3) { windowStart = rec.windowStart.getTime(); sent = rec.sentInWindow; }
    const since = rec.lastSentAt ? (now - rec.lastSentAt.getTime()) / 1000 : Infinity;
    if (since < COOLDOWN) return fail(429, `Please wait ${Math.ceil(COOLDOWN - since)} seconds before asking for another code.`);
    if (sent >= MAX_PER_HOUR) return fail(429, 'Too many codes were sent. Please try again in a while.');
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const sms = await sendSms(user.phone, `${code} is your LIFC code to sign your loan agreement. Valid ${CODE_MINUTES} minutes. Do not share it with anyone.`, { otp: code });
  if (sms.configured && !sms.sent) return fail(502, 'We could not send the SMS right now. Please try again in a minute.');
  await PhoneOtp.findOneAndUpdate({ phone: k }, { userId: user._id, codeHash: hashCode(k, code), codeExpiresAt: new Date(now + CODE_MINUTES * 60000), attempts: 0, lastSentAt: new Date(now), windowStart: new Date(windowStart), sentInWindow: sent + 1, deleteAt: new Date(windowStart + 3600e3 + 60000) }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return { ok: true, phone: mask(user.phone), expiresInSeconds: CODE_MINUTES * 60, resendAfterSeconds: COOLDOWN, ...(otpSandbox() ? { sandboxOtp: code } : {}) };
}

export async function acceptByCode(loan, user, { hash, code, confirmed }, req) {
  if (signingMethod() !== 'otp') return fail(400, 'This agreement is not signed with a code.');
  if (confirmed !== true) return fail(400, 'Please confirm that you have read and agree');
  const c = String(code ?? '').trim();
  if (!/^\d{6}$/.test(c)) return fail(400, 'Enter the 6-digit code');
  const ready = checkReady(loan, user, hash);
  if (!ready.ok) return ready;
  const k = key(loan);
  const rec = await PhoneOtp.findOne({ phone: k });
  if (!rec || !rec.codeHash || !rec.codeExpiresAt) return fail(400, 'No code found. Ask for a new one.');
  if (rec.codeExpiresAt.getTime() < Date.now()) return fail(400, 'That code has expired. Ask for a new one.');
  const counted = await PhoneOtp.findOneAndUpdate({ phone: k, attempts: { $lt: MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true });
  if (!counted) return fail(429, 'Too many wrong codes. Ask for a new one.');
  const a = Buffer.from(hashCode(k, c)), b = Buffer.from(counted.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(400, 'That code is not right', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - counted.attempts) });
  await PhoneOtp.deleteOne({ phone: k });
  return record({ loan, user, agreement: ready.agreement, method: 'otp', signature: { phone: mask(user.phone), verifiedAt: new Date() }, req });
}

// ── aadhaar ──────────────────────────────────────────────────────────────────────────────────
const SESSION_MINUTES = 20;
export async function startEsign(loan, user, hash) {
  if (signingMethod() !== 'aadhaar') return fail(400, 'This agreement is not signed with Aadhaar eSign.');
  const mode = esignMode();
  if (mode === 'unavailable') return fail(503, 'Aadhaar eSign is not available right now. Please contact support.', { code: 'UNAVAILABLE' });
  const ready = checkReady(loan, user, hash);
  if (!ready.ok) return ready;
  const recent = await EsignSession.countDocuments({ userId: user._id, createdAt: { $gte: new Date(Date.now() - 3600e3) } });
  if (recent >= 6) return fail(429, 'You have tried a lot of times in the last hour. Please wait a little and try again.');
  const now = Date.now();
  const session = await EsignSession.create({ userId: user._id, loanId: loan._id, agreementHash: ready.agreement.hash, mode, expiresAt: new Date(now + SESSION_MINUTES * 60000), deleteAt: new Date(now + 24 * 3600e3) });
  let url;
  if (mode === 'esign') {
    const started = await realProvider().start({ user, loan, session, agreement: ready.agreement, redirectUrl: `${baseUrl()}/api/esign/callback?session=${session._id}` });
    session.providerRef = started.providerRef;
    await session.save();
    url = started.url;
  } else {
    url = `${baseUrl()}/api/esign/sandbox/${session._id}`;
  }
  return { ok: true, session, url, mode, expiresInSeconds: SESSION_MINUTES * 60 };
}

export async function completeEsign(session, signed, req = null) {
  const loan = await mongoose.model('Loan').findById(session.loanId);
  const user = await mongoose.model('User').findById(session.userId);
  if (!loan || !user) return fail(404, 'Not found');
  const agreement = buildAgreement(loan, user);
  if (agreement.hash !== session.agreementHash) { session.status = 'failed'; session.result = { error: 'The agreement changed while signing' }; await session.save(); return fail(409, 'The agreement changed while signing. Please read it again.'); }
  const r = await record({ loan, user, agreement, method: 'aadhaar', signature: { provider: session.mode === 'sandbox' ? 'test' : providerName(), providerRef: session.providerRef || String(session._id), signerName: signed?.signerName || '', certificateId: signed?.certificateId || '', signedAt: signed?.signedAt || new Date(), test: session.mode === 'sandbox' }, req });
  session.status = 'completed';
  session.result = { signedAt: r.doc?.acceptedAt };
  await session.save();
  return r;
}

export async function finishWithProvider(session, req = null) {
  const p = realProvider();
  if (!p || session.mode !== 'esign') return fail(400, 'This is not an eSign session');
  try {
    return await completeEsign(session, await p.fetch({ session }), req);
  } catch (e) {
    session.status = 'failed';
    session.result = { error: String(e.message).slice(0, 120) };
    await session.save();
    return fail(502, 'We could not confirm your signature. Please try again.');
  }
}

export function describeSigning(user) {
  const method = signingMethod();
  return { method, available: method !== 'aadhaar' || esignMode() !== 'unavailable', test: method === 'aadhaar' && esignMode() === 'sandbox', phone: method === 'otp' ? mask(user.phone) : undefined };
}

export default { signingMethod, acceptByClick, sendSigningCode, acceptByCode, startEsign, completeEsign, finishWithProvider, describeSigning, esignMode, PROVIDERS, METHODS };
