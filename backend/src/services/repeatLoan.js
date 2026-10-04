import Loan from '../models/Loan.js';
import User from '../models/User.js';
import AmlAlert from '../models/AmlAlert.js';

// Repeat borrowing: a customer who has repaid a loan in good standing may be offered a higher limit than a
// first-time borrower. The NBFC turns it on and sets the numbers on the Pricing page.
const LIVE = ['submitted', 'under_review', 'approved', 'disbursed'];
const BAD = ['defaulted', 'written_off'];

// Rounds down to the nearest Rs 500 so offers look like offers.
const tidy = n => Math.floor(n / 500) * 500;

export async function repeatEligibility(userId, policy) {
  const rule = policy.repeat;
  const out = { enabled: !!rule.enabled, eligible: false, reason: '', maxAmount: policy.maxAmount, standardMax: policy.maxAmount, closedLoans: 0 };
  if (!rule.enabled) { out.reason = 'Repeat loan limits are not switched on'; return out; }

  const user = await User.findById(userId).select('kycStatus status');
  if (!user || user.status !== 'active') { out.reason = 'Account is not active'; return out; }
  if (user.kycStatus !== 'approved') { out.reason = 'KYC is not approved yet'; return out; }

  const loans = await Loan.find({ userId }).select('status closureType loanAmount');
  if (loans.some(l => BAD.includes(l.status))) { out.reason = 'A previous loan was defaulted or written off'; return out; }
  if (loans.some(l => LIVE.includes(l.status))) { out.reason = 'Finish or close your current loan first'; return out; }

  // Cancelling inside the cooling-off window does not count as a repayment record.
  const good = loans.filter(l => l.status === 'closed' && l.closureType !== 'cooling_off');
  out.closedLoans = good.length;
  if (good.length < rule.minClosedLoans) { out.reason = `Repay ${rule.minClosedLoans} loan(s) in full to unlock a higher limit`; return out; }
  if (await AmlAlert.exists({ userId, status: 'OPEN' })) { out.reason = 'Your account is under review'; return out; }

  const largest = Math.max(...good.map(l => l.loanAmount));
  const offer = Math.min(rule.maxLoanAmount, tidy(largest * (1 + rule.stepUpPercent / 100)));
  out.eligible = true;
  out.maxAmount = Math.max(policy.maxAmount, offer);
  out.offerAmount = offer;
  return out;
}

// The most this customer may borrow right now.
export async function maxAmountFor(userId, policy) {
  if (!policy.repeat.enabled || !userId) return policy.maxAmount;
  return (await repeatEligibility(userId, policy)).maxAmount;
}

export default { repeatEligibility, maxAmountFor };
