import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import AmlAlert from '../models/AmlAlert.js';
import { getConfig } from './configService.js';

// A customer with a loan still running can borrow more (a "top-up"), but only up to their limit minus what they still owe,
// and only if they are paying on time and have repaid a fair part of the current loan. Without this a customer with a
// live loan could keep taking new loans up to the full limit each time.
//
// The settings are the company's credit policy: confirm them with the credit head.
//   TOPUP_ENABLED          'false' stops customers with a running loan from borrowing more at all (default on)
//   TOPUP_MIN_PAID_PERCENT share of the running loans' principal that must be repaid first (default 50)

const LIVE = ['submitted', 'under_review', 'approved', 'disbursed'];
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
export const settings = () => ({
  enabled: getConfig('TOPUP_ENABLED', 'true') !== 'false',
  minPaidPercent: Math.min(100, Math.max(0, Number(getConfig('TOPUP_MIN_PAID_PERCENT', '50')) || 0)),
});

// What the customer owes on loans that are running, and whether they are paying on time
export async function position(userId) {
  const loans = await Loan.find({ userId, status: { $in: [...LIVE, 'defaulted'] } }).select('status loanAmount').lean();
  const disbursed = loans.filter(l => l.status === 'disbursed');
  // Applications still being looked at are the decision rules' business; an approved loan not yet paid out counts as owed
  const pending = loans.filter(l => l.status === 'approved');
  const defaulted = loans.filter(l => l.status === 'defaulted');
  const emis = disbursed.length ? await EMIPayment.find({ loanId: { $in: disbursed.map(l => l._id) } }).select('status principalAmount amount dueDate').lean() : [];
  const principal = e => e.principalAmount ?? e.amount;
  const total = emis.reduce((a, e) => a + principal(e), 0);
  const unpaid = emis.filter(e => UNPAID.includes(e.status));
  const outstanding = unpaid.reduce((a, e) => a + principal(e), 0) + pending.reduce((a, l) => a + l.loanAmount, 0);
  return {
    hasLiveLoan: disbursed.length + pending.length + defaulted.length > 0, disbursedCount: disbursed.length, pendingCount: pending.length, defaultedCount: defaulted.length,
    outstanding: Math.round(outstanding),
    paidPercent: total ? Math.round(((total - unpaid.reduce((a, e) => a + principal(e), 0)) / total) * 100) : 0,
    overdue: unpaid.some(e => e.status === 'OVERDUE' || e.status === 'FAILED' || new Date(e.dueDate) < new Date()),
  };
}

// limit = the most the customer could borrow in total (their offer or product limit)
export async function topUp(userId, limit) {
  const pos = await position(userId);
  if (!pos.hasLiveLoan) return { hasLiveLoan: false, eligible: true, maxAmount: limit, outstanding: 0 };
  const s = settings();
  const base = { hasLiveLoan: true, outstanding: pos.outstanding, paidPercent: pos.paidPercent, minPaidPercent: s.minPaidPercent };
  const no = reason => ({ ...base, eligible: false, maxAmount: 0, reason });
  if (!s.enabled) return no('Finish or close your current loan first.');
  if (pos.defaultedCount) return no('A loan of yours is in default. Please clear it first.');
  if (pos.overdue) return no('Pay your overdue EMI first. After that you can borrow more.');
  if (pos.disbursedCount && pos.paidPercent < s.minPaidPercent) return no(`Repay ${s.minPaidPercent}% of your current loan to borrow more. You have repaid ${pos.paidPercent}%.`);
  if (await AmlAlert.exists({ userId, status: 'OPEN' })) return no('Your account is under review.');
  const room = Math.max(0, Math.floor((limit - pos.outstanding) / 500) * 500);
  return { ...base, eligible: room > 0, maxAmount: room, reason: room > 0 ? null : 'You have already borrowed up to your limit. Repay some of your current loan to borrow more.' };
}

export default { position, topUp, settings };
