import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import Transaction from '../models/Transaction.js';
import { notify, templates } from './notificationService.js';
import { audit } from './auditService.js';
import { getPolicy, aprFor } from './pricingPolicy.js';

const DAY = 24 * 60 * 60 * 1000;
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const fmtDate = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

// A short window after the money arrives in which the customer can walk away: they give back what they
// received plus interest for the days they had it, at the loan's own APR. Fees already taken stay.
// The NBFC's compliance team should confirm this formula against the current RBI rule.
export async function getCoolingOffQuote(loanId, now = new Date()) {
  const loan = await Loan.findById(loanId);
  if (!loan) throw fail(404, 'Loan not found');
  if (loan.status !== 'disbursed') throw fail(400, 'Only an active loan can be cancelled');

  // The window is the one printed in the offer the customer accepted, not whatever the policy says today.
  const days = loan.kfs?.coolingOffDays ?? getPolicy().coolingOffDays;
  if (!days) throw fail(400, 'This loan has no cooling-off period');
  const start = loan.disbursementDate;
  if (!start) throw fail(400, 'This loan has not been paid out yet');

  const windowEndsAt = new Date(start.getTime() + days * DAY);
  if (now > windowEndsAt) throw fail(400, `The ${days}-day cooling-off period ended on ${fmtDate(windowEndsAt)}. You can still close the loan early.`);

  const emis = await EMIPayment.find({ loanId });
  if (emis.some(e => e.status === 'PAID')) throw fail(400, 'An instalment has already been paid, so use early closure instead');
  if (emis.some(e => e.dueDate < now)) throw fail(400, 'An instalment is overdue, so use early closure instead');

  const principal = loan.disbursedAmount ?? loan.disbursalDetails?.disbursedAmount ?? loan.loanAmount;
  const aprPercent = loan.kfs?.aprPercent ?? aprFor(principal, loan.monthlyEMI, loan.tenure);
  const daysHeld = Math.max(1, Math.ceil((now - start) / DAY)); // part of a day counts as a day
  const accruedInterest = Math.round((principal * (aprPercent / 100) * daysHeld) / 365);

  return {
    loan,
    emis,
    quote: {
      loanId: String(loanId),
      principal,
      aprPercent,
      daysHeld,
      accruedInterest,
      total: principal + accruedInterest,
      windowEndsAt,
      note: 'You repay what you received plus interest for the days you had it. Fees already deducted are not refunded.',
    },
  };
}

export async function executeCoolingOff(loanId, expectedTotal, paidBy) {
  if (process.env.PAYMENT_MODE === 'PRODUCTION') {
    throw fail(501, 'Online cancellation is not enabled yet. Please contact support.');
  }
  const now = new Date();
  const { loan, quote } = await getCoolingOffQuote(loanId, now);

  if (!Number.isFinite(expectedTotal) || Math.abs(expectedTotal - quote.total) > 1) {
    throw fail(409, 'The amount changed. Please review the new quote.', { quote });
  }

  const claimed = await Loan.findOneAndUpdate(
    { _id: loanId, status: 'disbursed' },
    {
      status: 'closed',
      closedAt: now,
      closureType: 'cooling_off',
      foreclosure: { date: now, amount: quote.total, principal: quote.principal, accruedInterest: quote.accruedInterest, fee: 0 },
    },
    { new: true }
  );
  if (!claimed) throw fail(409, 'This loan is already closed.');

  await EMIPayment.updateMany({ loanId }, { status: 'WAIVED', notes: 'Waived: loan cancelled in the cooling-off period' });
  try { await (await import('./partnerService.js')).onLoanCancelled(loanId); } catch (e) { console.error('Partner commission cancel failed:', e.message); }
  await Transaction.create({
    loanId,
    userId: loan.userId,
    type: 'EMI_PAYMENT',
    amount: quote.total,
    status: 'COMPLETED',
    paymentGateway: 'SANDBOX',
    referenceId: 'COOLING_OFF',
    metadata: { sandbox: true, initiatedBy: paidBy, completedAt: now },
  });
  await audit({ email: paidBy, role: 'customer' }, 'LOAN_COOLING_OFF_EXIT', { type: 'Loan', id: loanId }, { total: quote.total, daysHeld: quote.daysHeld });
  await notify(loan.userId, templates.coolingOff(loan, quote.total), { sms: true });
  return { quote, status: 'CLOSED' };
}

export default { getCoolingOffQuote, executeCoolingOff };
