import EMIPayment from '../models/EMIPayment.js';
import LoyaltyAward from '../models/LoyaltyAward.js';
import User from '../models/User.js';
import { getConfig, setConfig } from './configService.js';
import { notify } from './notificationService.js';
import { audit } from './auditService.js';

// Rewards for paying on time. A "streak" is how many EMIs in a row were paid on the due date (or within the grace days).
// A late payment, or an EMI that is overdue now, ends it. Reaching a milestone earns a badge and, if the company sets one,
// a cash reward that finance pays by hand (like referral rewards). The company sets the milestones and any cash amounts;
// cash rewards are a cost and may be taxable, so confirm them with finance.

const DAY = 864e5;
export const DEFAULTS = {
  enabled: false,
  graceDays: 1,
  milestones: [
    { streak: 3, title: 'On-time starter', cashback: 0 },
    { streak: 6, title: 'Steady payer', cashback: 0 },
    { streak: 12, title: 'Gold payer', cashback: 0 },
  ],
};
const clone = o => JSON.parse(JSON.stringify(o));

export function getProgram() {
  try {
    const saved = JSON.parse(getConfig('REWARDS_PROGRAM', '') || '{}');
    return { ...clone(DEFAULTS), ...saved, milestones: Array.isArray(saved.milestones) ? saved.milestones : clone(DEFAULTS.milestones) };
  } catch (e) {
    return clone(DEFAULTS);
  }
}

export function validateProgram(input) {
  const errors = [];
  const out = { enabled: input?.enabled === true, graceDays: Number(input?.graceDays ?? DEFAULTS.graceDays), milestones: [] };
  if (!Number.isInteger(out.graceDays) || out.graceDays < 0 || out.graceDays > 7) errors.push('Grace days must be a whole number between 0 and 7');
  const list = Array.isArray(input?.milestones) ? input.milestones : DEFAULTS.milestones;
  if (list.length < 1 || list.length > 10) errors.push('Have between 1 and 10 milestones');
  const seen = new Set();
  list.slice(0, 10).forEach((m, i) => {
    const streak = Number(m?.streak), cashback = Number(m?.cashback ?? 0), title = String(m?.title ?? '').trim();
    if (!Number.isInteger(streak) || streak < 1 || streak > 120) errors.push(`Milestone ${i + 1}: the number of EMIs must be between 1 and 120`);
    if (seen.has(streak)) errors.push(`Two milestones are at ${streak} EMIs`);
    seen.add(streak);
    if (!title || title.length > 40) errors.push(`Milestone ${i + 1}: the name must be 1 to 40 characters`);
    if (!Number.isFinite(cashback) || cashback < 0 || cashback > 5000) errors.push(`Milestone ${i + 1}: the cash reward must be between 0 and 5000`);
    out.milestones.push({ streak, title, cashback });
  });
  out.milestones.sort((a, b) => a.streak - b.streak);
  return { errors, program: out };
}

export async function saveProgram(input, by) {
  const { errors, program } = validateProgram(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('REWARDS_PROGRAM', JSON.stringify(program), { group: 'app', updatedBy: by });
  return { ok: true, program };
}

// The current and best run of on-time EMIs
export async function streakFor(userId, grace = getProgram().graceDays, now = new Date()) {
  const emis = await EMIPayment.find({ userId, status: { $in: ['PAID', 'PENDING', 'OVERDUE', 'FAILED'] } }).sort({ dueDate: 1 }).select('status dueDate paidDate').lean();
  let run = 0, best = 0, onTime = 0;
  for (const e of emis) {
    if (e.status === 'PAID') {
      const ok = e.paidDate && new Date(e.paidDate) - new Date(e.dueDate) <= grace * DAY + 36e5;
      if (ok) { run++; onTime++; best = Math.max(best, run); } else run = 0;
    } else if (new Date(e.dueDate) < now) {
      run = 0; // overdue now
    }
  }
  return { current: run, best, onTime, total: emis.filter(e => e.status === 'PAID').length };
}

// Called after an EMI is paid: hands out any milestone reached
export async function afterPayment(userId) {
  const program = getProgram();
  if (!program.enabled) return [];
  const { current } = await streakFor(userId, program.graceDays);
  const given = [];
  for (const m of program.milestones) {
    if (current < m.streak) continue;
    const key = `streak-${m.streak}`;
    try {
      await LoyaltyAward.create({ userId, key, streak: m.streak, title: m.title, cashback: m.cashback, status: m.cashback > 0 ? 'due' : 'earned' });
    } catch (e) { continue; } // already has it
    given.push(m);
    await notify(userId, { type: 'REWARD', title: `New badge: ${m.title}`, message: `${m.streak} EMIs paid on time in a row. ${m.cashback > 0 ? `You have earned a reward of Rs ${m.cashback}. We will pay it to your bank account soon.` : 'Keep it going!'}` }, { email: false, sms: false });
  }
  return given;
}

export async function mine(userId) {
  const program = getProgram();
  if (!program.enabled) return { enabled: false };
  const s = await streakFor(userId, program.graceDays);
  const awards = await LoyaltyAward.find({ userId }).sort({ streak: 1 }).lean();
  const earned = new Set(awards.map(a => a.key));
  const next = program.milestones.find(m => !earned.has(`streak-${m.streak}`) && m.streak > s.current) || null;
  return {
    enabled: true, graceDays: program.graceDays, streak: s.current, best: s.best, onTime: s.onTime, paidEmis: s.total,
    badges: awards.map(a => ({ title: a.title, streak: a.streak, cashback: a.cashback, status: a.status, at: a.awardedAt })),
    next: next ? { title: next.title, streak: next.streak, toGo: next.streak - s.current, cashback: next.cashback } : null,
    milestones: program.milestones.map(m => ({ title: m.title, streak: m.streak, cashback: m.cashback, earned: earned.has(`streak-${m.streak}`) })),
  };
}

export async function overview() {
  const awards = await LoyaltyAward.find({}).sort({ awardedAt: -1 }).limit(300).populate('userId', 'firstName lastName phone bankAccount').lean();
  return {
    program: getProgram(),
    totals: { earned: awards.length, due: awards.filter(a => a.status === 'due').length, dueAmount: awards.filter(a => a.status === 'due').reduce((s, a) => s + a.cashback, 0), paidAmount: awards.filter(a => a.status === 'paid').reduce((s, a) => s + a.cashback, 0) },
    awards: awards.map(a => ({ id: String(a._id), customer: a.userId ? `${a.userId.firstName} ${a.userId.lastName}`.trim() : '', phone: a.userId?.phone || '', account: a.userId?.bankAccount?.accountNumber ? `ending ${String(a.userId.bankAccount.accountNumber).slice(-4)}${a.userId.bankAccount.ifscCode ? ', ' + a.userId.bankAccount.ifscCode : ''}` : '', title: a.title, streak: a.streak, cashback: a.cashback, status: a.status, at: a.awardedAt, paidReference: a.paidReference || null })),
  };
}

export async function markPaid(id, reference, by) {
  const ref = String(reference || '').trim();
  if (!ref || ref.length > 80) return { ok: false, status: 400, error: 'Enter the bank or UPI reference of the payment.' };
  const a = await LoyaltyAward.findOneAndUpdate({ _id: id, status: 'due' }, { status: 'paid', paidAt: new Date(), paidReference: ref, paidBy: by }, { new: true });
  if (!a) return { ok: false, status: 409, error: 'That reward is not waiting to be paid.' };
  await audit({ email: by, role: 'staff' }, 'LOYALTY_REWARD_PAID', { type: 'User', id: a.userId }, { cashback: a.cashback, reference: ref, title: a.title }, null);
  await notify(a.userId, { type: 'REWARD', title: 'Your reward was paid', message: `We sent Rs ${a.cashback} to your bank account as a reward for paying on time. Reference ${ref}.` }, { email: false, sms: true });
  return { ok: true, award: a };
}

export default { getProgram, saveProgram, validateProgram, streakFor, afterPayment, mine, overview, markPaid };
