import User from '../models/User.js';
import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import { checkCredit } from './bureauService.js';
import { audit } from './auditService.js';

// The customer's credit score, free, with what affects it and what they can do about it.
// The score comes from the credit bureau (or the clearly marked test score in test mode). The bands are a guide: each bureau
// draws its own lines. Tips are worked out from the customer's own repayments with us and, where the bureau gives them, from
// the details in the credit report. Looking at the score here is a "soft" check made with the customer's consent.

const DAY = 864e5;
export const REFRESH_DAYS = 30;
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];

export const bandOf = score => (!score ? null : score >= 750 ? { key: 'excellent', label: 'Excellent' } : score >= 650 ? { key: 'good', label: 'Good' } : score >= 550 ? { key: 'fair', label: 'Fair' } : { key: 'poor', label: 'Needs work' });

// How the customer has paid us
export async function repaymentRecord(userId) {
  const emis = await EMIPayment.find({ userId }).select('status dueDate paidDate').lean();
  const now = Date.now();
  const due = emis.filter(e => new Date(e.dueDate) <= now || e.status === 'PAID');
  const paid = emis.filter(e => e.status === 'PAID');
  const late = paid.filter(e => e.paidDate && new Date(e.paidDate) - new Date(e.dueDate) > DAY).length;
  const overdue = emis.filter(e => UNPAID.includes(e.status) && new Date(e.dueDate) < now).length;
  return { instalments: due.length, paid: paid.length, paidLate: late, overdue, onTimePercent: paid.length ? Math.round(((paid.length - late) / paid.length) * 100) : null };
}

export function tipsFor({ score, record, report }) {
  const tips = [];
  const add = (id, title, text) => tips.push({ id, title, text });
  if (record.overdue > 0) add('overdue', 'Pay your overdue EMI', 'An unpaid EMI hurts your score the most, and every extra day makes it worse. Pay it today in the app.');
  if (record.paidLate > 0) add('late', 'Pay on or before the due date', `${record.paidLate} of your EMIs were paid late. Turning on auto-debit means you never forget.`);
  if (report?.maxDpd > 0) add('dpd', 'Late payments stay on your record', `Your credit report shows payments up to ${report.maxDpd} days late in the last year. Paying every EMI on time for the next few months will lift your score.`);
  if (report?.enquiries90 >= 3) add('enquiries', 'Too many applications in a short time', `Your report shows ${report.enquiries90} loan or card applications in the last 3 months. Each one lowers your score a little. Apply only when you need to.`);
  if (report?.activeLoans >= 4) add('active', 'Many running loans', `You have ${report.activeLoans} live loans. Closing the small ones early can help.`);
  if (score && score < 650 && !record.overdue) add('build', 'Build a record of on-time payments', 'Repaying one loan fully and on time is the quickest way to move up. Scores improve slowly, so check again in a month or two.');
  if (score && score >= 750) add('great', 'Keep it up', 'Your score is excellent. A high score can help you get bigger offers and better terms.');
  else if (score && score >= 650 && tips.length === 0) add('good', 'You are doing well', 'Keep paying on time and avoid applying for many loans at once to move into the excellent range.');
  if (!score) add('check', 'See your score', 'Allow a credit check to see where you stand and get tips.');
  return tips;
}

export async function summary(user) {
  const record = await repaymentRecord(user._id);
  const report = user.bureauReport || null;
  const score = user.creditScore > 0 ? user.creditScore : null;
  const next = user.creditScoreAt ? new Date(+new Date(user.creditScoreAt) + REFRESH_DAYS * DAY) : null;
  return {
    score, band: bandOf(score), min: 300, max: 900,
    source: user.creditScoreSource || null, test: user.creditScoreSource === 'sandbox',
    at: user.creditScoreAt || null,
    canRefresh: !next || next <= new Date(),
    nextRefreshAt: next && next > new Date() ? next : null,
    consented: !!user.bureauConsentAt,
    factors: {
      onTimePercent: record.onTimePercent, paidLate: record.paidLate, overdue: record.overdue, instalments: record.instalments,
      enquiries90: report ? report.enquiries90 ?? null : null, maxDpd: report ? report.maxDpd ?? null : null, activeLoans: report ? report.activeLoans ?? null : null,
    },
    history: (user.creditScoreHistory || []).slice(-12).map(h => ({ at: h.at, score: h.score })),
    tips: tipsFor({ score, record, report }),
    note: 'Different credit bureaus use different scales and can show different scores. This is a guide.',
  };
}

export async function refresh(user, { consent } = {}, req = null) {
  if (!user.bureauConsentAt) {
    if (consent !== true) return { ok: false, status: 400, error: 'We need your permission to check your credit record.', code: 'CONSENT_REQUIRED' };
    await User.updateOne({ _id: user._id }, { bureauConsentAt: new Date() });
    user.bureauConsentAt = new Date();
    await audit({ email: user.email, role: 'customer' }, 'CREDIT_CHECK_CONSENT', { type: 'User', id: user._id }, { via: 'credit-score' }, req);
  }
  if (user.creditScoreAt && Date.now() - new Date(user.creditScoreAt).getTime() < REFRESH_DAYS * DAY && user.creditScore > 0) {
    return { ok: false, status: 429, error: `Your score was checked recently. You can check again after ${new Date(+new Date(user.creditScoreAt) + REFRESH_DAYS * DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`, code: 'TOO_SOON' };
  }
  const r = await checkCredit(user, { force: true });
  if (!r.score) return { ok: false, status: 503, error: 'We could not get your score right now. Please try again later.', code: 'UNAVAILABLE' };
  const fresh = await User.findByIdAndUpdate(user._id, { $push: { creditScoreHistory: { $each: [{ at: new Date(), score: r.score, source: r.source }], $slice: -12 } } }, { new: true });
  await audit({ email: user.email, role: 'customer' }, 'CREDIT_SCORE_VIEWED', { type: 'User', id: user._id }, { source: r.source }, req);
  return { ok: true, summary: await summary(fresh) };
}

export default { summary, refresh, bandOf, tipsFor, repaymentRecord };
