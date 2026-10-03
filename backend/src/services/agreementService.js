import crypto from 'crypto';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import User from '../models/User.js';

export const AGREEMENT_VERSION = 'v1';

const inr = n => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;
const feePct = () => {
  const v = Number(process.env.FORECLOSURE_FEE_PCT);
  return Number.isFinite(v) && v >= 0 ? v : 2;
};

// The text depends only on loan and customer data, never on today's date, so the same loan always
// produces the same text and hash. The hash recorded at acceptance proves exactly what was shown.
export function buildAgreement(loan, user) {
  const received = loan.disbursalDetails?.disbursedAmount || loan.loanAmount;
  const deductions = Math.max(0, loan.loanAmount - received);
  const acct = user.bankAccount?.accountNumber ? `ending ${String(user.bankAccount.accountNumber).slice(-4)}` : 'registered with us';
  const total = loan.totalAmount || (loan.monthlyEMI || 0) * loan.tenure;

  const text = [
    `LOAN AGREEMENT (${AGREEMENT_VERSION})`,
    '',
    `Lender: Laxmi India Finance Ltd.`,
    `Borrower: ${user.firstName} ${user.lastName}`,
    `Loan reference: ${loan._id}`,
    '',
    '1. LOAN TERMS',
    `Loan amount: ${inr(loan.loanAmount)}`,
    deductions > 0 ? `Fees and charges deducted at disbursal: ${inr(deductions)} (you receive ${inr(received)})` : `Amount you receive: ${inr(received)}`,
    `Repayment: ${loan.tenure} monthly instalment(s) of ${inr(loan.monthlyEMI)}`,
    `Total repayable: ${inr(total)}`,
    `Interest rate: ${loan.interestRate}%`,
    `Disbursal to bank account ${acct}.`,
    '',
    '2. REPAYMENT AND LATE PAYMENT',
    'Instalments are due on the dates in your repayment schedule in the app. If an instalment is not paid on time, a late fee of 2% of the instalment for each month or part of a month it is overdue applies, with a minimum of Rs 500.',
    '',
    '3. EARLY CLOSURE',
    `You may close the loan early at any time through the app. You will pay any overdue instalments and late fees, the outstanding principal, interest accrued up to the day of closure, and a closure fee of ${feePct()}% of the outstanding principal. Interest for the remaining period is waived.`,
    '',
    '4. DEFAULT',
    'If instalments remain unpaid for 90 days or more, the loan may be classified as defaulted. We may then take recovery steps permitted by law and this agreement.',
    '',
    '5. YOUR INFORMATION',
    'You confirm the details you gave us are true and complete. You agree that we may use your KYC, identity, bank and loan information to assess and manage this loan, to verify you with third-party verification services, to prevent fraud and money laundering, to meet legal obligations, and to contact you about this loan by app notification, SMS and email. We keep loan and transaction records for as long as the law requires.',
    '',
    '6. QUESTIONS AND COMPLAINTS',
    'Contact us through the support details shown in the LIFC app.',
    '',
    'By accepting, you confirm that you have read and agree to this agreement.',
  ].join('\n');

  return { version: AGREEMENT_VERSION, text, hash: crypto.createHash('sha256').update(text).digest('hex') };
}

export async function getAcceptance(loanId) {
  return AgreementAcceptance.findOne({ loanId });
}

export async function agreementFor(loan) {
  const user = await User.findById(loan.userId);
  return buildAgreement(loan, user);
}

export default { buildAgreement, agreementFor, getAcceptance, AGREEMENT_VERSION };
