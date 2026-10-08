import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import Transaction from '../models/Transaction.js';
import { notify, templates } from './notificationService.js';
import User from '../models/User.js';
import { audit } from './auditService.js';
import { flagEarlyClosure } from './amlService.js';
import { getPolicy, lateFeeFor } from './pricingPolicy.js';

const DAY = 24 * 60 * 60 * 1000;
const feePct = () => getPolicy().foreclosureFeePercent;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// Same rule the overdue job uses: the late fee from the pricing policy, for each month or part of a month late.
export const penaltyFor = (emi, now) => lateFeeFor(getPolicy(), emi.amount, Math.ceil((now - emi.dueDate) / DAY / 30));

export async function getForeclosureQuote(loanId, now = new Date()) {
  const loan = await Loan.findById(loanId);
  if (!loan) throw fail(404, 'Loan not found');
  if (loan.status !== 'disbursed') throw fail(400, 'Only active loans can be closed early');

  const unpaid = await EMIPayment.find({ loanId, status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] } }).sort({ emiNumber: 1 });
  if (!unpaid.length) throw fail(400, 'No unpaid EMIs on this loan');

  const overdue = unpaid.filter(e => e.dueDate < now);
  const future = unpaid.filter(e => e.dueDate >= now);

  const overdueItems = overdue.map(e => ({ emi: e, penalty: penaltyFor(e, now) }));
  const overdueAmount = overdueItems.reduce((a, o) => a + o.emi.amount + o.penalty, 0);

  const principal = future.reduce((a, e) => a + (e.principalAmount || 0), 0);

  let accruedInterest = 0;
  if (future.length) {
    const first = future[0];
    let periodStart = loan.disbursementDate || loan.createdAt;
    const prev = await EMIPayment.findOne({ loanId, emiNumber: first.emiNumber - 1 }).select('dueDate');
    if (prev) periodStart = prev.dueDate;
    const days = Math.max(0, (now - periodStart) / DAY);
    accruedInterest = Math.round((first.interestAmount || 0) * Math.min(1, days / 30));
  }

  const fee = Math.round((principal * feePct()) / 100);
  const total = overdueAmount + principal + accruedInterest + fee;

  return {
    loan,
    overdueItems,
    future,
    quote: {
      loanId: String(loanId),
      overdueEmis: overdue.length,
      overdueAmount,
      remainingEmis: future.length,
      principal,
      accruedInterest,
      feePercent: feePct(),
      fee,
      total,
      note: 'Future interest is waived. The quote is calculated for today and may change tomorrow.',
    },
  };
}

export async function executeForeclosure(loanId, expectedTotal, paidBy, { gatewayPaid = false, paymentId = null } = {}) {
  // In production the money must come through the payment provider (see onlinePayments.js); only that path sets gatewayPaid
  if (process.env.PAYMENT_MODE === 'PRODUCTION' && !gatewayPaid) {
    throw fail(501, 'Online early closure is not enabled yet. Please contact support.');
  }
  const now = new Date();
  const { loan, overdueItems, future, quote } = await getForeclosureQuote(loanId, now);

  // A payment already made through the provider was for the quote we gave, so it is honoured even if the figure moved overnight
  if (!gatewayPaid && (!Number.isFinite(expectedTotal) || Math.abs(expectedTotal - quote.total) > 1)) {
    throw fail(409, 'The amount changed. Please review the new quote.', { quote });
  }

  // Claim the loan atomically so a double-tap cannot close it twice.
  const claimed = await Loan.findOneAndUpdate(
    { _id: loanId, status: 'disbursed' },
    {
      status: 'closed',
      closedAt: now,
      closureType: 'foreclosure',
      foreclosure: {
        date: now,
        amount: quote.principal + quote.accruedInterest + quote.fee,
        principal: quote.principal,
        accruedInterest: quote.accruedInterest,
        fee: quote.fee,
      },
    },
    { new: true }
  );
  if (!claimed) throw fail(409, 'This loan is already closed.');

  for (const { emi, penalty } of overdueItems) {
    await EMIPayment.updateOne(
      { _id: emi._id },
      { status: 'PAID', paidDate: now, paidAmount: emi.amount + penalty, penaltyApplied: penalty, paymentId: paymentId || `foreclosure_${Date.now()}`, notes: 'Paid as part of early closure' }
    );
  }
  await EMIPayment.updateMany(
    { _id: { $in: future.map(e => e._id) } },
    { status: 'WAIVED', notes: 'Waived on early closure' }
  );

  await Transaction.create({
    loanId,
    userId: loan.userId,
    type: 'EMI_PAYMENT',
    amount: quote.total,
    status: 'COMPLETED',
    paymentGateway: gatewayPaid ? 'RAZORPAY' : 'SANDBOX',
    referenceId: gatewayPaid && paymentId ? String(paymentId) : 'FORECLOSURE',
    metadata: { sandbox: !gatewayPaid, initiatedBy: paidBy, completedAt: now },
  });

  await audit({ email: paidBy, role: 'customer' }, 'LOAN_FORECLOSED', { type: 'Loan', id: loanId }, { total: quote.total, fee: quote.fee });
  const borrower = await User.findById(loan.userId);
  if (borrower) await flagEarlyClosure(loan, borrower);
  await notify(loan.userId, templates.foreclosed(loan, quote.total), { sms: true });
  return { quote, status: 'CLOSED' };
}

export default { getForeclosureQuote, executeForeclosure };
