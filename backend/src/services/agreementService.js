import crypto from 'crypto';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import User from '../models/User.js';
import { getPolicy, aprFor } from './pricingPolicy.js';

export const AGREEMENT_VERSION = 'v2';

const inr = n => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;

// Loans made before offers were stored have no key-facts record, so rebuild what we can from the loan.
function termsFromLoan(loan, policy) {
  if (loan.kfs) return loan.kfs;
  const net = loan.disbursalDetails?.disbursedAmount || loan.loanAmount;
  const total = loan.totalAmount || (loan.monthlyEMI || 0) * loan.tenure;
  return {
    amount: loan.loanAmount,
    processingFee: null,
    gst: null,
    totalCharges: Math.max(0, loan.loanAmount - net),
    netDisbursed: net,
    emi: loan.monthlyEMI,
    tenureMonths: loan.tenure,
    interestRatePercent: loan.interestRate,
    interestType: null,
    totalInterest: total - loan.loanAmount,
    totalRepayable: total,
    aprPercent: aprFor(net, loan.monthlyEMI, loan.tenure),
    lateFee: policy.lateFee,
    foreclosureFeePercent: policy.foreclosureFeePercent,
    coolingOffDays: policy.coolingOffDays,
  };
}

// The text depends only on the loan, its stored offer and the lender's details, never on today's date,
// so the same loan always produces the same text and hash. The hash recorded at acceptance proves
// exactly what was shown.
export function buildAgreement(loan, user) {
  const policy = getPolicy();
  const inst = policy.institution;
  const k = termsFromLoan(loan, policy);
  const acct = user.bankAccount?.accountNumber ? `ending ${String(user.bankAccount.accountNumber).slice(-4)}` : 'registered with us';

  const interestLine = k.interestType === 'flat'
    ? `Interest: ${k.interestRatePercent}% of the loan amount, spread evenly over the instalments`
    : k.interestType === 'reducing'
      ? `Interest: ${k.interestRatePercent}% a year on the balance still owed`
      : `Interest rate: ${k.interestRatePercent}%`;

  const lines = [
    `LOAN AGREEMENT (${AGREEMENT_VERSION})`,
    '',
    `Lender: ${inst.lenderName}${inst.registrationNumber ? ` (registration no. ${inst.registrationNumber})` : ''}`,
    ...(inst.address ? [`Lender address: ${inst.address}`] : []),
    `Borrower: ${user.firstName} ${user.lastName}`,
    `Loan reference: ${loan._id}`,
    '',
    '1. KEY FACTS OF YOUR LOAN',
    `Loan amount: ${inr(k.amount)}`,
    ...(k.processingFee != null ? [`Processing fee (${k.processingFeePercent}%): ${inr(k.processingFee)}`] : []),
    ...(k.gst != null ? [`GST on the processing fee (${k.gstPercent}%): ${inr(k.gst)}`] : []),
    ...(k.totalCharges > 0 ? [`Total fees and charges deducted when the loan is paid out: ${inr(k.totalCharges)}`] : []),
    `Amount you receive: ${inr(k.netDisbursed)}`,
    interestLine,
    `Repayment: ${k.tenureMonths} monthly instalment(s) of ${inr(k.emi)}`,
    `Total interest: ${inr(k.totalInterest)}`,
    `Total you repay: ${inr(k.totalRepayable)}`,
    `Annual percentage rate (APR), counting all fees: ${k.aprPercent}%`,
    `The money is paid to your bank account ${acct}.`,
    '',
    '2. REPAYMENT AND LATE PAYMENT',
    `Instalments are due on the dates in your repayment schedule in the app. If an instalment is not paid on time, a late fee of ${k.lateFee.percentPerMonth}% of the instalment for each month or part of a month it is overdue applies, with a minimum of ${inr(k.lateFee.minimum)}.`,
    '',
    ...(k.coolingOffDays > 0
      ? [
          '3. COOLING-OFF PERIOD',
          `You may cancel this loan within ${k.coolingOffDays} day(s) of receiving the money, with no penalty. You repay the amount you received plus interest for the days you had it, worked out at the APR above. Fees already deducted are not refunded. Use "Cancel this loan" on the loan screen in the app.`,
          '',
        ]
      : []),
    `${k.coolingOffDays > 0 ? '4' : '3'}. EARLY CLOSURE`,
    `After the cooling-off period you may close the loan early at any time through the app. You will pay any overdue instalments and late fees, the outstanding principal, interest accrued up to the day of closure, and a closure fee of ${k.foreclosureFeePercent}% of the outstanding principal. Interest for the remaining period is waived.`,
    '',
    `${k.coolingOffDays > 0 ? '5' : '4'}. DEFAULT`,
    'If instalments remain unpaid for 90 days or more, the loan may be classified as defaulted. We may then take recovery steps permitted by law and this agreement.',
    '',
    `${k.coolingOffDays > 0 ? '6' : '5'}. YOUR INFORMATION`,
    'You confirm the details you gave us are true and complete. You agree that we may use your KYC, identity, bank and loan information to assess and manage this loan, to verify you with third-party verification services, to prevent fraud and money laundering, to meet legal obligations, and to contact you about this loan by app notification, SMS and email. We keep loan and transaction records for as long as the law requires.',
    '',
    `${k.coolingOffDays > 0 ? '7' : '6'}. QUESTIONS AND COMPLAINTS`,
    ...(inst.supportEmail || inst.supportPhone ? [`Support: ${[inst.supportEmail, inst.supportPhone].filter(Boolean).join(' | ')}`] : ['Contact us through the support details shown in the LIFC app.']),
    ...(inst.grievanceOfficerName ? [`Grievance officer: ${[inst.grievanceOfficerName, inst.grievanceOfficerEmail, inst.grievanceOfficerPhone].filter(Boolean).join(' | ')}`] : []),
    '',
    'By accepting, you confirm that you have read and agree to this agreement.',
  ];
  const text = lines.join('\n');

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
