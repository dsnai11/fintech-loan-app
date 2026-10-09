import PayoutRecord from '../models/PayoutRecord.js';
import ReferralReward from '../models/ReferralReward.js';
import LoyaltyAward from '../models/LoyaltyAward.js';
import PartnerCommission from '../models/PartnerCommission.js';
import Partner from '../models/Partner.js';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { getConfig, setConfig } from './configService.js';
import { audit } from './auditService.js';
import { notify } from './notificationService.js';
import { openHighAlerts } from './amlService.js';
import { isVerified, availability as bankAvailability } from './bankVerifyService.js';
import { getSettings as accountingSettings } from './accountingService.js';
import { markPaid as markLoyaltyPaid } from './rewardsService.js';
import { markPaid as markPartnerPaid } from './partnerService.js';

// Money that goes out without a person pressing a button, when the company chooses "automatic".
//
// Each kind of payment has a switch: manual (a person pays and enters the bank reference, as before) or automatic (the system
// sends the money through the payment provider once every rule is met, and records it). Automatic mode never skips the safety
// rules: it stays inside a daily limit and a limit per payment, needs a bank account, holds anyone with an open high-risk alert,
// can require a verified bank account, never sends the same payment twice, and leaves a payment for a person if it fails three times.
// Loans are paid out automatically only when the agreement is signed, the decision rules approved the loan, and it is within a
// size the company set. Anything outside these limits waits for a person, exactly as in manual mode.

const KINDS = {
  referral: { label: 'Referral rewards', who: 'a customer', manualPage: 'referrals.html' },
  loyalty: { label: 'On-time payment rewards', who: 'a customer', manualPage: 'rewards.html' },
  partner: { label: 'Partner commissions', who: 'a partner', manualPage: 'partners.html' },
  loan: { label: 'Loan payouts to customers', who: 'a customer', manualPage: 'loan-management.html' },
};
export const DEFAULTS = {
  modes: { referral: 'manual', loyalty: 'manual', partner: 'manual', loan: 'manual' },
  limits: { maxSingleReward: 5000, dailyRewardLimit: 50000, maxLoanAmount: 50000, dailyLoanLimit: 500000, requireVerifiedBank: false },
};
const clone = o => JSON.parse(JSON.stringify(o));
const HOUR = 36e5;
const MAX_ATTEMPTS = 3, RETRY_AFTER_HOURS = 6;
const production = () => process.env.PAYMENT_MODE === 'PRODUCTION';
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export function getSettings() {
  try {
    const s = JSON.parse(getConfig('AUTOMATION_SETTINGS', '') || '{}');
    return { modes: { ...DEFAULTS.modes, ...(s.modes || {}) }, limits: { ...DEFAULTS.limits, ...(s.limits || {}) } };
  } catch (e) {
    return clone(DEFAULTS);
  }
}

export function validateSettings(input) {
  const errors = [];
  const out = clone(DEFAULTS);
  for (const k of Object.keys(KINDS)) {
    const v = input?.modes?.[k] ?? DEFAULTS.modes[k];
    if (!['manual', 'auto'].includes(v)) errors.push(`${KINDS[k].label}: choose manual or automatic`);
    else out.modes[k] = v;
  }
  const num = (k, label, min, max) => {
    const n = Number(input?.limits?.[k] ?? DEFAULTS.limits[k]);
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${label} must be between ${min} and ${max}`);
    else out.limits[k] = n;
  };
  num('maxSingleReward', 'The most for one reward or commission', 1, 100000);
  num('dailyRewardLimit', 'The most for all rewards and commissions in a day', 1, 5000000);
  num('maxLoanAmount', 'The largest loan paid out automatically', 1000, 10000000);
  num('dailyLoanLimit', 'The most for all automatic loan payouts in a day', 1000, 100000000);
  out.limits.requireVerifiedBank = input?.limits?.requireVerifiedBank === true;
  if (out.limits.maxSingleReward > out.limits.dailyRewardLimit) errors.push('The limit for one payment cannot be above the daily limit');
  if (out.limits.maxLoanAmount > out.limits.dailyLoanLimit) errors.push('The largest automatic loan cannot be above the daily limit for loans');
  return { errors, settings: out };
}

export async function saveSettings(input, by) {
  const { errors, settings } = validateSettings(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('AUTOMATION_SETTINGS', JSON.stringify(settings), { group: 'app', updatedBy: by });
  return { ok: true, settings };
}

// ── The payment provider ───────────────────────────────────────────────────────────────────────
const rzpBase = () => getConfig('RAZORPAY_API_BASE') || 'https://api.razorpay.com/v1';
const rzpAuth = () => 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

export const providerMode = () => (production() ? (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_ACCOUNT_ID ? 'live' : 'unavailable') : 'test');

// -> { status: 'processing' | 'processed', ref }   throws when the provider refuses
async function sendMoney({ bank, name, email, phone, amount, referenceId, narration }) {
  if (providerMode() === 'test') return { provider: 'sandbox', status: 'processed', ref: `sbx_${referenceId}` };
  const res = await fetch(`${rzpBase()}/payouts`, {
    method: 'POST',
    headers: { Authorization: rzpAuth(), 'Content-Type': 'application/json', 'X-Payout-Idempotency': referenceId },
    body: JSON.stringify({
      account_number: process.env.RAZORPAY_ACCOUNT_ID, amount: Math.round(amount * 100), currency: 'INR', mode: 'NEFT', purpose: 'payout', queue_if_low_balance: true,
      reference_id: referenceId, narration: narration.slice(0, 30),
      fund_account: { account_type: 'bank_account', bank_account: { name: bank.accountHolder || name, ifsc: bank.ifscCode, account_number: bank.accountNumber }, contact: { name, email, contact: phone, type: 'customer' } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.description || `The payment provider answered ${res.status}`);
  return { provider: 'razorpay', status: ['processed', 'completed'].includes(j.status) ? 'processed' : 'processing', ref: j.id };
}

// ── What is waiting, and why ───────────────────────────────────────────────────────────────────
async function paidToday(kinds) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const rows = await PayoutRecord.aggregate([{ $match: { kind: { $in: kinds }, status: { $in: ['processing', 'processed'] }, createdAt: { $gte: start } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]);
  return rows[0]?.t || 0;
}

async function bankProblem(user, limits) {
  const b = user?.bankAccount;
  if (!b?.accountNumber || !b?.ifscCode) return 'No bank account on file';
  if (limits.requireVerifiedBank && bankAvailability().mode !== 'unavailable' && !isVerified(user)) return 'Bank account is not verified';
  return null;
}

// Everything that could be paid, with the amount and the reason it is not going out yet (or null when it will)
export async function waiting() {
  const s = getSettings();
  const items = [];
  const L = s.limits;
  const tds = accountingSettings().tds;

  const checkCommon = async (kind, userId, amount) => {
    const user = await User.findById(userId).select('firstName lastName phone email bankAccount bankVerification');
    if (!user) return { user: null, problem: 'Account not found' };
    const alerts = await openHighAlerts(userId);
    if (alerts.length) return { user, problem: 'Open high-risk alert on this customer' };
    const bp = await bankProblem(user, L);
    if (bp) return { user, problem: bp };
    void kind; void amount;
    return { user, problem: null };
  };
  const stuck = async (kind, id) => {
    const recs = await PayoutRecord.find({ kind, targetId: id }).sort({ attempt: -1 }).lean();
    if (recs.some(r => ['processing', 'processed'].includes(r.status))) return 'Already sent, waiting for the bank to confirm';
    if (recs.length >= MAX_ATTEMPTS) return `Failed ${recs.length} times: ${recs[0].failureReason || 'unknown reason'}. A person must pay it`;
    if (recs[0] && Date.now() - +new Date(recs[0].createdAt) < RETRY_AFTER_HOURS * HOUR) return `Failed just now (${recs[0].failureReason || 'unknown reason'}); will try again`;
    return null;
  };

  for (const r of await ReferralReward.find({ status: 'due' }).lean()) {
    const c = await checkCommon('referral', r.userId, r.amount);
    let problem = c.problem;
    if (!problem && tds.referral > 0) problem = 'Tax applies to this kind of payment: a person must pay it';
    if (!problem && r.amount > L.maxSingleReward) problem = `Above the limit of ₹${L.maxSingleReward} for one payment`;
    if (!problem) problem = await stuck('referral', r._id);
    items.push({ kind: 'referral', id: String(r._id), who: c.user ? `${c.user.firstName} ${c.user.lastName}` : '', amount: r.amount, send: r.amount, problem });
  }
  for (const a of await LoyaltyAward.find({ status: 'due' }).lean()) {
    const c = await checkCommon('loyalty', a.userId, a.cashback);
    let problem = c.problem;
    if (!problem && tds.loyalty > 0) problem = 'Tax applies to this kind of payment: a person must pay it';
    if (!problem && a.cashback > L.maxSingleReward) problem = `Above the limit of ₹${L.maxSingleReward} for one payment`;
    if (!problem) problem = await stuck('loyalty', a._id);
    items.push({ kind: 'loyalty', id: String(a._id), who: c.user ? `${c.user.firstName} ${c.user.lastName}` : '', amount: a.cashback, send: a.cashback, problem });
  }
  for (const m of await PartnerCommission.find({ status: 'due' }).lean()) {
    const p = await Partner.findById(m.partnerId).lean();
    const net = r2(m.gross - (m.gross * (tds.partner || 0)) / 100);
    let problem = null;
    if (!p || p.status !== 'active') problem = 'Partner is not active';
    else if (!p.bank?.accountNumber || !p.bank?.ifscCode) problem = 'No bank account on file for the partner';
    else if (!p.panNumber && (tds.partner || 0) > 0) problem = 'No PAN on file, so the right tax cannot be worked out';
    if (!problem && m.gross > L.maxSingleReward) problem = `Above the limit of ₹${L.maxSingleReward} for one payment`;
    if (!problem) problem = await stuck('partner', m._id);
    items.push({ kind: 'partner', id: String(m._id), who: p?.name || '', amount: m.gross, send: net, problem });
  }
  for (const l of await Loan.find({ status: 'approved' }).populate('userId').lean()) {
    let problem = null;
    const u = l.userId;
    const amount = l.disbursalDetails?.disbursedAmount || l.loanAmount;
    if (process.env.REQUIRE_LOAN_AGREEMENT !== 'false' && !(await (await import('../models/AgreementAcceptance.js')).default.exists({ loanId: l._id }))) problem = 'The customer has not signed the agreement';
    else if (l.loanAmount > L.maxLoanAmount) problem = `Above the automatic limit of ₹${L.maxLoanAmount}: a person must release it`;
    else if (!u) problem = 'Account not found';
    else if ((await openHighAlerts(u._id)).length) problem = 'Open high-risk alert on this customer';
    else if (await bankProblem(u, L)) problem = await bankProblem(u, L);
    else {
      const tx = await Transaction.find({ loanId: l._id, type: 'DISBURSEMENT' }).sort({ createdAt: -1 }).lean();
      if (tx.some(t => ['PROCESSING', 'COMPLETED'].includes(t.status))) problem = 'Already sent, waiting for the bank to confirm';
      else if (tx[0] && Date.now() - +new Date(tx[0].createdAt) < 24 * HOUR) problem = `The last attempt failed (${tx[0].error || 'unknown reason'}). A person should look at it`;
    }
    items.push({ kind: 'loan', id: String(l._id), who: u ? `${u.firstName} ${u.lastName}` : '', amount: l.loanAmount, send: amount, problem });
  }
  return { settings: s, items };
}

// ── Paying ─────────────────────────────────────────────────────────────────────────────────────
async function payOne(item) {
  const attempt = (await PayoutRecord.countDocuments({ kind: item.kind, targetId: item.id })) + 1;
  const referenceId = `AUTO-${item.kind.toUpperCase().slice(0, 3)}-${item.id}-${attempt}`;
  if (item.kind === 'loan') {
    const { PaymentService } = await import('./paymentService.js');
    const loan = await Loan.findById(item.id).populate('userId');
    try {
      const r = await PaymentService.initiateTransfer(loan._id, loan, 'automatic');
      await PayoutRecord.create({ kind: 'loan', targetId: loan._id, userId: loan.userId._id, amount: item.send, attempt, referenceId, status: r.status === 'COMPLETED' ? 'processed' : 'processing', provider: production() ? 'razorpay' : 'sandbox', providerRef: r.transferId, finishedAt: r.status === 'COMPLETED' ? new Date() : undefined });
      await audit({ email: 'system', role: 'system' }, 'AUTO_LOAN_PAYOUT', { type: 'Loan', id: loan._id }, { amount: item.send, status: r.status }, null);
      return { ok: true };
    } catch (e) {
      await PayoutRecord.create({ kind: 'loan', targetId: loan._id, userId: loan.userId._id, amount: item.send, attempt, referenceId, status: 'failed', provider: production() ? 'razorpay' : 'sandbox', failureReason: String(e.message).slice(0, 200), finishedAt: new Date() });
      return { ok: false, reason: e.message };
    }
  }

  let target, user, bank, name, who;
  if (item.kind === 'partner') {
    target = await PartnerCommission.findById(item.id);
    const p = await Partner.findById(target.partnerId);
    bank = p.bank; name = p.name; who = { email: p.email, phone: p.phone };
  } else {
    target = item.kind === 'referral' ? await ReferralReward.findById(item.id) : await LoyaltyAward.findById(item.id);
    user = await User.findById(target.userId);
    bank = user.bankAccount; name = `${user.firstName} ${user.lastName}`; who = { email: user.email, phone: user.phone };
  }
  const rec = await PayoutRecord.create({ kind: item.kind, targetId: target._id, userId: user?._id, amount: item.send, attempt, referenceId, provider: production() ? 'razorpay' : 'sandbox' });
  try {
    const r = await sendMoney({ bank, name, ...who, amount: item.send, referenceId, narration: item.kind === 'partner' ? 'LIFC commission' : 'LIFC reward' });
    rec.provider = r.provider; rec.providerRef = r.ref;
    if (r.status === 'processed') { rec.status = 'processed'; rec.finishedAt = new Date(); await rec.save(); await finishItem(rec); } else await rec.save();
    return { ok: true };
  } catch (e) {
    rec.status = 'failed'; rec.failureReason = String(e.message).slice(0, 200); rec.finishedAt = new Date(); await rec.save();
    return { ok: false, reason: e.message };
  }
}

// The money has gone: record it as paid exactly as a person would have
async function finishItem(rec) {
  const ref = rec.providerRef || rec.referenceId;
  if (rec.kind === 'referral') {
    const r = await ReferralReward.findOneAndUpdate({ _id: rec.targetId, status: 'due' }, { status: 'paid', paidAt: new Date(), paidBy: 'automatic', reference: ref }, { new: true });
    if (r) {
      await audit({ email: 'system', role: 'system' }, 'REFERRAL_REWARD_PAID', { type: 'ReferralReward', id: r._id }, { amount: r.amount, reference: ref, mode: 'automatic' }, null);
      await notify(r.userId, { type: 'REFERRAL_REWARD', title: 'Referral reward paid', message: `Your referral reward of ₹${r.amount.toLocaleString('en-IN')} has been paid to your bank account. Reference: ${ref}.` }, { sms: false });
    }
  } else if (rec.kind === 'loyalty') await markLoyaltyPaid(rec.targetId, ref, 'automatic');
  else if (rec.kind === 'partner') await markPartnerPaid(rec.targetId, ref, 'automatic');
  // a loan is finished by the existing payout confirmation
}

// A confirmation (or failure) from the payment provider for a payout we started
export async function handleProviderEvent(event, payout) {
  const rec = await PayoutRecord.findOne({ providerRef: payout.id });
  if (!rec) return null;
  if (event === 'payout.processed' || event === 'payout.completed') {
    if (rec.status !== 'processed') { rec.status = 'processed'; rec.finishedAt = new Date(); await rec.save(); await finishItem(rec); }
  } else if (event === 'payout.failed' || event === 'payout.rejected') {
    rec.status = 'failed'; rec.failureReason = payout.failure_reason || 'The bank rejected the payment'; rec.finishedAt = new Date(); await rec.save();
  } else if (event === 'payout.reversed') {
    rec.status = 'reversed'; rec.failureReason = 'The payment was reversed'; await rec.save();
    await audit({ email: 'system', role: 'system' }, 'AUTO_PAYOUT_REVERSED', { type: 'Payout', id: rec._id }, { kind: rec.kind, amount: rec.amount }, null);
  }
  return rec;
}

// Run often. Sends everything that is allowed, inside the limits. Returns what happened.
export async function runAutoPayouts() {
  const s = getSettings();
  const out = { sent: 0, failed: 0, held: 0, limit: 0, off: Object.values(s.modes).every(m => m !== 'auto') };
  if (out.off) return out;
  // Things that become due by themselves first
  try { await (await import('./referralService.js')).settleReferrals(); } catch (e) { /* the reminders job also does this */ }
  const w = await waiting();
  let rewardSent = await paidToday(['referral', 'loyalty', 'partner']);
  let loanSent = await paidToday(['loan']);
  for (const item of w.items) {
    if (s.modes[item.kind] !== 'auto') continue;
    if (item.problem) { out.held++; continue; }
    if (item.kind === 'loan') {
      if (loanSent + item.send > s.limits.dailyLoanLimit) { out.limit++; continue; }
    } else if (rewardSent + item.send > s.limits.dailyRewardLimit) { out.limit++; continue; }
    const r = await payOne(item);
    if (r.ok) { out.sent++; if (item.kind === 'loan') loanSent += item.send; else rewardSent += item.send; } else out.failed++;
  }
  return out;
}

export async function overview() {
  const w = await waiting();
  const recent = await PayoutRecord.find({}).sort({ createdAt: -1 }).limit(40).lean();
  return {
    settings: w.settings, kinds: KINDS, provider: providerMode(),
    held: w.items.filter(i => w.settings.modes[i.kind] === 'auto' && i.problem),
    willSend: w.items.filter(i => w.settings.modes[i.kind] === 'auto' && !i.problem),
    manual: w.items.filter(i => w.settings.modes[i.kind] !== 'auto').length,
    today: { rewards: r2(await paidToday(['referral', 'loyalty', 'partner'])), loans: r2(await paidToday(['loan'])) },
    recent: recent.map(r => ({ id: String(r._id), kind: r.kind, amount: r.amount, status: r.status, attempt: r.attempt, providerRef: r.providerRef || null, failureReason: r.failureReason || null, at: r.createdAt })),
  };
}

export default { getSettings, saveSettings, validateSettings, runAutoPayouts, handleProviderEvent, overview, waiting, providerMode };
