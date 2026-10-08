import crypto from 'crypto';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import AmlAlert from '../models/AmlAlert.js';
import Referral from '../models/Referral.js';
import ReferralReward from '../models/ReferralReward.js';
import { getConfig, setConfig } from './configService.js';
import { notify } from './notificationService.js';
import { audit } from './auditService.js';

// Refer a friend. A customer shares their code; the friend enters it when signing up. When the friend's first loan is
// paid out and stays in good standing for a waiting period, both are owed a reward. Finance pays the reward and marks
// it paid on the portal. Nothing happens unless staff switch the programme on.

export const PROGRAM_DEFAULTS = {
  enabled: false,
  referrerReward: 100, // rupees owed to the customer who referred
  refereeReward: 100, // rupees owed to the new customer
  minLoanAmount: 5000, // the friend's loan must be at least this much
  holdDays: 30, // how long the friend's loan must stay in good standing before rewards are owed
  maxRewardsPerReferrer: 10, // referrals per customer that can earn a reward
  terms: 'Refer a friend with your code. When your friend signs up with it and takes a loan, and the loan is repaid on time for the first month, you both earn a reward. Rewards are paid to your bank account by the company. Only genuine, first-time customers count. Rewards can be withdrawn if the loan falls overdue, and the company may refuse or cancel rewards where it suspects misuse. Rewards may be taxable.',
};

export function getProgram() {
  try { return { ...PROGRAM_DEFAULTS, ...JSON.parse(getConfig('REFERRAL_PROGRAM', '') || '{}') }; } catch (e) { return { ...PROGRAM_DEFAULTS }; }
}

export function validateProgram(input) {
  const errors = [];
  const out = { ...PROGRAM_DEFAULTS };
  const num = (k, label, min, max, int = true) => {
    const n = Number(input?.[k] ?? PROGRAM_DEFAULTS[k]);
    if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) errors.push(`${label} must be ${int ? 'a whole number ' : ''}between ${min} and ${max}`);
    else out[k] = n;
  };
  out.enabled = input?.enabled === true;
  num('referrerReward', 'The reward for the person who refers', 0, 10000);
  num('refereeReward', 'The reward for the new customer', 0, 10000);
  num('minLoanAmount', 'The smallest qualifying loan', 0, 10000000);
  num('holdDays', 'The waiting period (days)', 0, 365);
  num('maxRewardsPerReferrer', 'The most referrals that can earn a reward per customer', 1, 1000);
  const terms = String(input?.terms ?? PROGRAM_DEFAULTS.terms).trim();
  if (terms.length < 20 || terms.length > 3000) errors.push('The terms must be 20 to 3000 characters');
  out.terms = terms;
  if (out.enabled && out.referrerReward + out.refereeReward === 0) errors.push('Set a reward for at least one side, or switch the programme off');
  return { errors, program: out };
}

export async function saveProgram(input, by) {
  const { errors, program } = validateProgram(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('REFERRAL_PROGRAM', JSON.stringify(program), { group: 'app', updatedBy: by });
  return { ok: true, program };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to mix up
const makeCode = () => 'LIFC' + Array.from(crypto.randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join('');
export const normalizeCode = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

export async function codeFor(userId) {
  const u = await User.findById(userId).select('referralCode');
  if (!u) return null;
  if (u.referralCode) return u.referralCode;
  for (let i = 0; i < 6; i++) {
    const code = makeCode();
    try {
      const r = await User.updateOne({ _id: userId, referralCode: { $exists: false } }, { referralCode: code });
      if (r.modifiedCount) return code;
      return (await User.findById(userId).select('referralCode')).referralCode;
    } catch (e) { /* a code collision: try another */ }
  }
  return null;
}

// Checked before the account is created. Returns { referrer } or { error }.
export async function checkCode(raw, { phone, email } = {}) {
  const code = normalizeCode(raw);
  if (!code) return { none: true };
  if (!getProgram().enabled) return { error: 'Referral codes are not being accepted right now. You can leave the code empty and carry on.' };
  const referrer = await User.findOne({ referralCode: code }).select('_id phone email status');
  if (!referrer || referrer.status === 'blocked') return { error: 'That referral code is not valid. Check it, or leave it empty.' };
  if ((phone && referrer.phone === phone) || (email && referrer.email === email)) return { error: 'You cannot use your own referral code.' };
  return { referrer, code };
}

export async function attach(newUser, referrer, code, req = null) {
  await Referral.create({ referrerId: referrer._id, refereeId: newUser._id, code });
  await User.updateOne({ _id: newUser._id }, { referredBy: referrer._id });
  await audit({ email: newUser.email, role: 'customer' }, 'REFERRAL_CREATED', { type: 'User', id: newUser._id }, { referrerId: String(referrer._id), code }, req);
}

// Called when any loan is paid out. The friend's first qualifying loan starts the waiting period.
export async function onLoanDisbursed(loan) {
  const p = getProgram();
  if (!p.enabled) return null;
  const ref = await Referral.findOne({ refereeId: loan.userId, status: 'signed_up' });
  if (!ref) return null;
  if ((loan.loanAmount || 0) < p.minLoanAmount) return null;
  ref.status = 'in_hold';
  ref.loanId = loan._id;
  ref.eligibleAt = new Date(Date.now() + p.holdDays * 864e5);
  await ref.save();
  return ref;
}

const rupees = n => `₹${Number(n).toLocaleString('en-IN')}`;

// Works out rewards for referrals whose waiting period is over. Safe to run any number of times.
export async function settleReferrals(now = new Date()) {
  const p = getProgram();
  const result = { rewarded: 0, voided: 0, waiting: 0 };
  if (!p.enabled) return result;
  const due = await Referral.find({ status: 'in_hold', eligibleAt: { $lte: now } });
  for (const ref of due) {
    const [loan, referrer, referee] = await Promise.all([Loan.findById(ref.loanId).select('status'), User.findById(ref.referrerId).select('kycStatus firstName'), User.findById(ref.refereeId).select('firstName')]);
    const voidIt = async reason => { ref.status = 'void'; ref.voidReason = reason; await ref.save(); result.voided++; };
    if (!loan || ['defaulted', 'written_off'].includes(loan.status)) { await voidIt('The referred customer\'s loan went overdue during the waiting period'); continue; }
    if (!referrer || !referee) { await voidIt('An account was removed'); continue; }
    const earned = await Referral.countDocuments({ referrerId: ref.referrerId, status: 'rewarded' });
    if (earned >= p.maxRewardsPerReferrer) { await voidIt(`The referrer reached the limit of ${p.maxRewardsPerReferrer} rewarded referrals`); continue; }
    // Held (not cancelled) while there is something to check
    const blocked = (await AmlAlert.countDocuments({ userId: { $in: [ref.referrerId, ref.refereeId] }, status: 'OPEN', severity: 'HIGH' })) > 0 || referrer.kycStatus !== 'approved';
    if (blocked) { result.waiting++; continue; }

    const rows = [];
    if (p.referrerReward > 0) rows.push({ userId: ref.referrerId, role: 'referrer', amount: p.referrerReward });
    if (p.refereeReward > 0) rows.push({ userId: ref.refereeId, role: 'referee', amount: p.refereeReward });
    for (const r of rows) {
      try { await ReferralReward.create({ referralId: ref._id, ...r }); } catch (e) { if (e.code !== 11000) throw e; }
      await notify(r.userId, { type: 'REFERRAL_REWARD', title: 'You earned a referral reward', message: `You earned ${rupees(r.amount)} for ${r.role === 'referrer' ? `referring ${referee.firstName}` : 'joining through a friend'}. We will pay it to your bank account.` }, { sms: false });
    }
    ref.status = 'rewarded';
    await ref.save();
    result.rewarded++;
  }
  return result;
}

const mask = u => (u ? `${u.firstName} ${String(u.lastName || '').slice(0, 1)}.`.trim() : 'A customer');

// What the customer sees on the Refer and earn screen
export async function myReferral(user) {
  const p = getProgram();
  const code = p.enabled ? await codeFor(user._id) : null;
  const refs = await Referral.find({ referrerId: user._id }).sort({ createdAt: -1 }).limit(50).lean();
  const people = await User.find({ _id: { $in: refs.map(r => r.refereeId) } }).select('firstName lastName').lean();
  const byId = Object.fromEntries(people.map(u => [String(u._id), u]));
  const rewards = await ReferralReward.find({ userId: user._id }).lean();
  const sum = status => rewards.filter(r => r.status === status).reduce((a, r) => a + r.amount, 0);
  const wording = { signed_up: 'Signed up', in_hold: 'Loan taken, reward coming', rewarded: 'Reward earned', void: 'No reward' };
  return {
    enabled: p.enabled,
    code,
    referrerReward: p.referrerReward,
    refereeReward: p.refereeReward,
    minLoanAmount: p.minLoanAmount,
    terms: p.terms,
    shareText: code ? `I use LIFC for personal loans with every charge shown up front. Sign up with my code ${code}${p.refereeReward ? ` and earn a ${rupees(p.refereeReward)} reward after your first loan` : ''}.` : '',
    stats: { invited: refs.length, rewarded: refs.filter(r => r.status === 'rewarded').length, earned: sum('due') + sum('paid'), paid: sum('paid'), toBePaid: sum('due') },
    referrals: refs.map(r => ({ name: mask(byId[String(r.refereeId)]), status: r.status, label: wording[r.status], at: r.createdAt })),
    referredBy: user.referredBy ? true : false,
  };
}

export default { getProgram, saveProgram, validateProgram, codeFor, checkCode, attach, onLoanDisbursed, settleReferrals, myReferral, normalizeCode };
