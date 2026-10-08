import EMIPayment from '../models/EMIPayment.js';
import AgreementAcceptance from '../models/AgreementAcceptance.js';

// Where a loan application stands, in the customer's words: what has happened, what is happening now, and what comes next.
// It only shows what the customer is allowed to know (never the internal checks).

const text = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export async function timelineFor(loan) {
  const status = loan.status;
  const accepted = await AgreementAcceptance.findOne({ loanId: loan._id }).lean();
  const emis = ['disbursed', 'closed', 'defaulted', 'written_off'].includes(status) ? await EMIPayment.find({ loanId: loan._id }).sort({ emiNumber: 1 }).lean() : [];
  const paid = emis.filter(e => e.status === 'PAID').length;
  const nextEmi = emis.find(e => ['PENDING', 'OVERDUE', 'FAILED'].includes(e.status));

  const steps = [];
  const step = (key, label, state, at = null, detail = '') => steps.push({ key, label, state, at, detail });

  step('applied', 'Application received', 'done', loan.createdAt, 'We have your application.');

  const reviewed = !['submitted', 'under_review'].includes(status);
  step('review', 'Checks and review', reviewed ? 'done' : 'current', reviewed ? (loan.approvalDate || loan.updatedAt) : null,
    reviewed ? '' : status === 'under_review' ? 'Our team is looking at your application.' : 'We are checking your application. This usually takes a short while.');

  if (status === 'rejected') {
    step('decision', 'Decision', 'stopped', loan.updatedAt, loan.rejectionReason || 'We could not approve this application.');
    return { status, steps, next: 'You can check your offer and apply again later, or message us in the app if you have questions.' };
  }

  step('decision', 'Approved', reviewed ? 'done' : 'todo', reviewed ? loan.approvalDate || loan.updatedAt : null, reviewed ? 'Your loan has been approved.' : '');

  const signed = !!accepted;
  step('agreement', 'Sign the agreement', signed || ['disbursed', 'closed', 'defaulted', 'written_off'].includes(status) ? 'done' : status === 'approved' ? 'current' : 'todo',
    accepted?.acceptedAt || null, status === 'approved' && !signed ? 'Open the loan in the app, read the agreement and sign it. We cannot send the money until you do.' : '');

  const sent = ['disbursed', 'closed', 'defaulted', 'written_off'].includes(status);
  step('payout', 'Money sent to your bank', sent ? 'done' : status === 'approved' && signed ? 'current' : 'todo', loan.disbursementDate || null,
    sent ? '' : status === 'approved' && signed ? 'Your money is being sent. It usually reaches you quickly.' : '');

  const finished = status === 'closed';
  step('repay', 'Repayment', finished ? 'done' : sent ? 'current' : 'todo', loan.closedAt || null,
    finished ? 'Your loan is fully repaid.' : sent ? `${paid} of ${emis.length} EMIs paid${nextEmi ? `. Next one is due on ${text(nextEmi.dueDate)}` : ''}.` : '');

  let next;
  if (status === 'submitted') next = 'We are checking your application. You will get a notification when there is news.';
  else if (status === 'under_review') next = 'Our team is reviewing your application. We will tell you as soon as it is decided.';
  else if (status === 'approved' && !signed) next = 'Sign your loan agreement to get your money.';
  else if (status === 'approved') next = 'Your money is on its way.';
  else if (status === 'disbursed') next = nextEmi ? `Pay your next EMI by ${text(nextEmi.dueDate)}.` : 'All set.';
  else if (status === 'closed') next = 'Thank you for repaying on time. You may be able to borrow again.';
  else next = 'Please contact us in the app if you need help.';
  return { status, steps, next };
}

export default { timelineFor };
