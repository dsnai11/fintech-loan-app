import Loan from '../models/Loan.js';
import User from '../models/User.js';
import EMIPayment from '../models/EMIPayment.js';
import AmlAlert from '../models/AmlAlert.js';
import { getConfig, setConfig } from './configService.js';
import { getPolicy } from './pricingPolicy.js';
import { incomeBasis } from './aaService.js';
import { termsRequiredFor } from './terms.js';
import { setupStatus } from './onboardingService.js';
import { offerCap } from './offerService.js';

// The payday loan: a small advance against the customer's salary, paid back in one go on their next payday.
// The customer tells us their salary day; the most they can borrow is a share of their monthly income (less any
// instalments they already pay); the cost is a single flat fee taken from the amount they receive.
//
// The numbers are the company's credit and pricing policy. Compliance and finance must confirm them (the fee, the
// advertised cost per year, and that this product is within the licence) before it is switched on.

const DAY = 864e5;
export const DEFAULTS = {
  enabled: false,
  minAmount: 1000,
  maxAmount: 25000,
  maxIncomePercent: 50, // the most one advance may be, as a share of monthly income
  feePercent: 4, // one flat fee on the amount, before GST, whatever the number of days
  minDaysToPayday: 5, // if payday is closer than this, the advance is due on the payday after
  repayDaysAfterSalary: 1, // due the day after the salary arrives
  requireVerifiedIncome: false, // true: only income seen in the customer's bank statements counts
  requireSalaried: true,
};

const LIVE = ['submitted', 'under_review', 'approved', 'disbursed', 'defaulted'];
const clone = o => JSON.parse(JSON.stringify(o));

export function getSettings() {
  let stored = null;
  try {
    const raw = getConfig('PAYDAY_SETTINGS', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* defaults */ }
  const s = clone(DEFAULTS);
  if (stored && typeof stored === 'object') for (const k of Object.keys(s)) if (k in stored) s[k] = stored[k];
  return s;
}

// A quote that depends on the number of days: the cost is flat, so the yearly rate is highest for the shortest advance.
export function aprFor(totalCharges, net, days) {
  if (!(net > 0) || !(days > 0)) return 0;
  return Math.round(((totalCharges / net) * (365 / days) * 100) * 10) / 10;
}

export function validateSettings(input) {
  const errors = [];
  const s = clone(DEFAULTS);
  const num = (v, min, max, label, int = false) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) { errors.push(`${label} must be ${int ? 'a whole number ' : ''}between ${min} and ${max}`); return undefined; }
    return n;
  };
  s.enabled = input?.enabled === true || input?.enabled === 'true';
  s.requireVerifiedIncome = input?.requireVerifiedIncome === true || input?.requireVerifiedIncome === 'true';
  s.requireSalaried = input?.requireSalaried !== false && input?.requireSalaried !== 'false';
  s.minAmount = num(input?.minAmount ?? DEFAULTS.minAmount, 100, 1000000, 'Smallest advance', true);
  s.maxAmount = num(input?.maxAmount ?? DEFAULTS.maxAmount, 100, 1000000, 'Largest advance', true);
  s.maxIncomePercent = num(input?.maxIncomePercent ?? DEFAULTS.maxIncomePercent, 1, 100, 'Share of monthly income', true);
  s.feePercent = num(input?.feePercent ?? DEFAULTS.feePercent, 0, 20, 'Fee');
  s.minDaysToPayday = num(input?.minDaysToPayday ?? DEFAULTS.minDaysToPayday, 1, 20, 'Fewest days to payday', true);
  s.repayDaysAfterSalary = num(input?.repayDaysAfterSalary ?? DEFAULTS.repayDaysAfterSalary, 0, 10, 'Days after payday', true);
  if (!errors.length && s.minAmount > s.maxAmount) errors.push('Smallest advance is above the largest advance');
  // The yearly cost of the shortest advance must stay under the ceiling the company set in Pricing
  const ceiling = getPolicy().maxAprPercent;
  if (!errors.length && ceiling != null) {
    const fee = (1000 * s.feePercent) / 100;
    const apr = aprFor(fee * (1 + getPolicy().gstPercent / 100), 1000 - fee * (1 + getPolicy().gstPercent / 100), s.minDaysToPayday + s.repayDaysAfterSalary);
    if (apr > ceiling) errors.push(`With this fee the cost per year can reach ${apr}%, above your ceiling of ${ceiling}% in Pricing. Lower the fee or raise the fewest days.`);
  }
  return { errors, settings: s };
}

export async function saveSettings(input, by) {
  const { errors, settings } = validateSettings(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('PAYDAY_SETTINGS', JSON.stringify(settings), { group: 'app', updatedBy: by });
  return { ok: true, settings };
}

// ── Dates ───────────────────────────────────────────────────────────────────────────────────
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
// The date the advance falls due: the next salary day that is at least `minDays` away, plus the days after salary
export function nextPayday(salaryDay, from = new Date(), s = getSettings()) {
  const today = utc(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let m = 0; m < 4; m++) {
    const first = utc(today.getUTCFullYear(), today.getUTCMonth() + m, 1);
    const last = utc(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getUTCDate();
    const salary = utc(first.getUTCFullYear(), first.getUTCMonth(), Math.min(salaryDay, last));
    const due = new Date(salary.getTime() + s.repayDaysAfterSalary * DAY);
    if (Math.round((due - today) / DAY) >= s.minDaysToPayday) return { salary, due, days: Math.round((due - today) / DAY) };
  }
  return null;
}

// ── Money ───────────────────────────────────────────────────────────────────────────────────
export function quoteFor(amount, salaryDay, now = new Date()) {
  const s = getSettings();
  const policy = getPolicy();
  const p = nextPayday(salaryDay, now, s);
  if (!p) return null;
  const fee = Math.round((amount * s.feePercent) / 100);
  const gst = Math.round((fee * policy.gstPercent) / 100);
  const totalCharges = fee + gst;
  const netDisbursed = amount - totalCharges;
  return {
    planType: 'standard', label: 'Payday advance', interestType: 'flat',
    amount, tenureMonths: 1, interestRatePercent: 0, emi: amount, totalInterest: 0,
    chargesMode: 'flat', charges: [{ id: 'advance_fee', name: `Advance fee (${s.feePercent}%)`, optional: false, basis: 'percent', rate: s.feePercent, charge: fee, gst, total: totalCharges }], addOns: [],
    processingFeePercent: s.feePercent, processingFee: fee, gstPercent: policy.gstPercent, gst, totalCharges, netDisbursed,
    totalRepayable: amount, totalCostOfCredit: totalCharges, aprPercent: aprFor(totalCharges, netDisbursed, p.days),
    lateFee: { ...policy.lateFee }, foreclosureFeePercent: 0, coolingOffDays: policy.coolingOffDays,
    productKey: 'payday', productName: 'Payday Advance',
    payday: { salaryDay, salaryDate: p.salary, dueDate: p.due, days: p.days },
  };
}

// ── Who may borrow, and how much ────────────────────────────────────────────────────────────
export async function eligibility(user, now = new Date()) {
  const s = getSettings();
  const checks = [];
  const add = (key, label, ok, hint) => checks.push({ key, label, ok: !!ok, hint: ok ? '' : hint });
  const inc = incomeBasis(user);
  const salaryDay = user.employment?.salaryDay || null;

  add('phone', 'Phone number verified', process.env.REQUIRE_PHONE_VERIFIED === 'false' || user.phoneVerified, 'Verify your phone number first.');
  add('setup', 'Account set up', process.env.REQUIRE_ONBOARDING === 'false' || setupStatus(user).complete, 'Finish setting up your account: details, a photo and your bank account.');
  add('terms', 'Latest terms accepted', !termsRequiredFor(user), 'Accept the updated terms and conditions.');
  if (s.requireSalaried) add('salaried', 'Salaried', user.employment?.status === 'Employed', 'This advance is for people who receive a monthly salary.');
  add('salaryDay', 'Salary day added', !!salaryDay, 'Tell us the day of the month your salary arrives.');
  add('income', s.requireVerifiedIncome ? 'Income checked from your bank statements' : 'Monthly income added', s.requireVerifiedIncome ? inc.source === 'bank statements' : inc.amount > 0, s.requireVerifiedIncome ? 'Share your bank statements in Income check.' : 'Add your monthly income.');

  const loans = await Loan.find({ userId: user._id, status: { $in: LIVE } }).select('status productKey monthlyEMI loanAmount').lean();
  const livePayday = loans.find(l => l.productKey === 'payday');
  add('one', 'No other payday advance running', !livePayday, 'Repay your current payday advance first.');
  const behind = loans.some(l => l.status === 'defaulted') || !!(await EMIPayment.exists({ userId: user._id, status: { $in: ['OVERDUE', 'FAILED'] } }));
  add('overdue', 'No payment overdue', !behind, 'Pay what is overdue first.');
  add('review', 'No account review open', !(await AmlAlert.exists({ userId: user._id, status: 'OPEN' })), 'Your account is under review.');

  // The most they can borrow: a share of income, less the instalments they already pay, and within their credit offer
  const running = loans.filter(l => l.status === 'disbursed' && l.productKey !== 'payday').reduce((a, l) => a + (l.monthlyEMI || 0), 0);
  let cap = 0;
  let declined = false;
  if (inc.amount > 0) {
    const share = Math.floor(((inc.amount * s.maxIncomePercent) / 100 - running) / 100) * 100;
    const { cap: offerLimit, offer } = await offerCap(user, getPolicy());
    declined = !!offer && offer.status === 'DECLINED';
    cap = Math.max(0, Math.min(s.maxAmount, share, Number.isFinite(offerLimit) ? Math.floor(offerLimit / 100) * 100 : s.maxAmount));
  }
  add('offer', 'Credit check passed', !declined, 'We are not able to offer you a loan at this time.');
  add('room', 'Room to borrow', cap >= s.minAmount || checks.some(c => !c.ok), running > 0 ? 'Your income, after the instalments you already pay, leaves too little room.' : 'Your income leaves too little room for an advance.');

  const open = checks.filter(c => !c.ok);
  const p = salaryDay ? nextPayday(salaryDay, now, s) : null;
  return {
    enabled: s.enabled, eligible: s.enabled && open.length === 0,
    checks, firstProblem: open[0]?.hint || null,
    minAmount: s.minAmount, maxAmount: open.length ? 0 : cap, step: 100,
    salaryDay, income: inc, running,
    nextPayday: p ? { salaryDate: p.salary, dueDate: p.due, days: p.days } : null,
    feePercent: s.feePercent, livePaydayLoanId: livePayday?._id || null,
  };
}

// ── Applying ────────────────────────────────────────────────────────────────────────────────
export async function apply(user, amount, req, deps) {
  const e = await eligibility(user);
  if (!e.enabled) return { status: 400, error: 'The payday advance is not available right now.', code: 'PAYDAY_OFF' };
  if (!e.eligible) return { status: 403, error: e.firstProblem, code: 'PAYDAY_NOT_ELIGIBLE' };
  if (!Number.isInteger(amount) || amount < e.minAmount || amount > e.maxAmount) {
    return { status: 400, error: `Choose an amount between Rs ${e.minAmount.toLocaleString('en-IN')} and Rs ${e.maxAmount.toLocaleString('en-IN')}.`, code: 'ABOVE_LIMIT' };
  }
  const quote = quoteFor(amount, e.salaryDay);
  if (!quote) return { status: 400, error: 'We could not work out your payday date. Check your salary day.' };
  const ceiling = getPolicy().maxAprPercent;
  if (ceiling != null && quote.aprPercent > ceiling) return { status: 400, error: 'The cost of this advance is above what we are allowed to charge. Please contact support.', code: 'ABOVE_CEILING' };

  const loan = await Loan.create({
    userId: user._id, loanAmount: amount, tenure: 1, purpose: 'Personal', loanType: 'Micro Loan', productKey: 'payday',
    interestRate: 0, monthlyEMI: amount, totalAmount: amount, status: 'submitted', kfs: quote,
    payday: { salaryDay: e.salaryDay, dueDate: quote.payday.dueDate, days: quote.payday.days, fee: quote.totalCharges },
    disbursalDetails: { disbursedAmount: quote.netDisbursed },
  });
  user.loanHistory.push(loan._id);
  await user.save();
  await deps.audit(req.user, 'LOAN_APPLIED', { type: 'Loan', id: loan._id }, { amount, tenure: 1, product: 'payday' }, req);
  await deps.recordDevice(req, user._id, 'apply');
  await deps.screenLoan(loan, user);
  await deps.decideLoan(loan, user);
  return { status: 201, loan, quote };
}

// The date the single repayment falls due when the money is paid out. If payday has come close while the loan
// waited for approval, it moves to the next payday rather than leaving the customer a day or two.
export function dueDateAtPayout(loan, now = new Date()) {
  const s = getSettings();
  const planned = loan.payday?.dueDate ? new Date(loan.payday.dueDate) : null;
  if (planned && Math.round((planned - now) / DAY) >= Math.min(s.minDaysToPayday, 2)) return planned;
  const p = nextPayday(loan.payday?.salaryDay || 1, now, s);
  return p ? p.due : new Date(now.getTime() + 30 * DAY);
}

export async function saveSalaryDay(user, { salaryDay, monthlyIncome, company }) {
  const d = Number(salaryDay);
  if (!Number.isInteger(d) || d < 1 || d > 31) return { ok: false, error: 'Salary day must be a day of the month, from 1 to 31.' };
  const inc = monthlyIncome === undefined || monthlyIncome === null || monthlyIncome === '' ? null : Number(monthlyIncome);
  if (inc !== null && (!Number.isFinite(inc) || inc < 1000 || inc > 10000000)) return { ok: false, error: 'Monthly income must be between Rs 1,000 and Rs 1,00,00,000.' };
  if (await Loan.exists({ userId: user._id, productKey: 'payday', status: { $in: LIVE } })) return { ok: false, error: 'You cannot change your salary day while a payday advance is running.' };
  user.set('employment.status', 'Employed');
  user.set('employment.salaryDay', d);
  if (inc !== null) user.set('employment.monthlyIncome', inc);
  if (company) user.set('employment.company', String(company).slice(0, 80));
  await user.save();
  return { ok: true };
}

// ── For the staff page ──────────────────────────────────────────────────────────────────────
export async function overview(now = new Date()) {
  const s = getSettings();
  const loans = await Loan.find({ productKey: 'payday' }).populate('userId', 'firstName lastName phone').sort({ createdAt: -1 }).lean();
  const ids = loans.map(l => l._id);
  const emis = ids.length ? await EMIPayment.find({ loanId: { $in: ids } }).lean() : [];
  const emiOf = new Map(emis.map(e => [String(e.loanId), e]));
  const who = l => `${l.userId?.firstName || ''} ${l.userId?.lastName || ''}`.trim() || 'Customer';
  const row = l => { const e = emiOf.get(String(l._id)); return { loanId: l._id, who: who(l), phone: l.userId?.phone || '', amount: l.loanAmount, dueDate: e?.dueDate || l.payday?.dueDate, status: e?.status || l.status, fee: l.payday?.fee || 0 }; };
  const out = loans.filter(l => l.status === 'disbursed' || l.status === 'defaulted').map(row);
  const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = r => Math.round((new Date(r.dueDate) - startDay) / DAY);
  const unpaid = out.filter(r => r.status !== 'PAID');
  const closed = loans.filter(l => l.status === 'closed');
  const onTime = closed.filter(l => { const e = emiOf.get(String(l._id)); return e?.paidDate && e.dueDate && new Date(e.paidDate) <= new Date(new Date(e.dueDate).getTime() + DAY); });
  return {
    settings: s,
    waiting: loans.filter(l => ['submitted', 'under_review', 'approved'].includes(l.status)).length,
    outstanding: { count: unpaid.length, amount: unpaid.reduce((a, r) => a + r.amount, 0) },
    dueToday: unpaid.filter(r => days(r) === 0).map(r => ({ ...r })),
    dueThisWeek: unpaid.filter(r => days(r) >= 0 && days(r) <= 7).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    overdue: unpaid.filter(r => days(r) < 0 || r.status === 'OVERDUE' || r.status === 'FAILED').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    totals: { advances: loans.filter(l => ['disbursed', 'closed', 'defaulted'].includes(l.status)).length, repaid: closed.length, onTimePercent: closed.length ? Math.round((onTime.length / closed.length) * 100) : null, feesEarned: loans.filter(l => ['disbursed', 'closed', 'defaulted'].includes(l.status)).reduce((a, l) => a + (l.payday?.fee || 0), 0) },
    recent: loans.slice(0, 20).map(l => ({ ...row(l), loanStatus: l.status, at: l.createdAt })),
  };
}

export default { getSettings, saveSettings, validateSettings, eligibility, apply, quoteFor, nextPayday, dueDateAtPayout, saveSalaryDay, overview };
