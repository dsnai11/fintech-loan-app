import { getConfig, setConfig } from './configService.js';

// One place for every number that decides what a loan costs. The NBFC edits it from the admin portal
// (Pricing page); nothing else in the code should hard-code a rate, fee or charge.
// The defaults below are placeholders to be replaced with the NBFC's board-approved terms.

const envFee = Number(process.env.FORECLOSURE_FEE_PCT);

export const DEFAULTS = {
  minAmount: 1000,
  maxAmount: 500000,
  offerAmount: 30000, // the amount shown in the quick application flow
  annualRatePercent: 15, // standard reducing-balance loan
  minTenureMonths: 1,
  maxTenureMonths: 60,
  processingFeePercent: 2.5,
  gstPercent: 18, // charged on the processing fee
  plans: {
    one_time: { label: 'One-time repayment', enabled: true, tenureMonths: 1, flatInterestPercent: 0 },
    '3_emi': { label: '3-month EMI plan', enabled: true, tenureMonths: 3, flatInterestPercent: 5 },
    '6_emi': { label: '6-month EMI plan', enabled: true, tenureMonths: 6, flatInterestPercent: 9 },
  },
  lateFee: { percentPerMonth: 2, minimum: 500 }, // per overdue instalment
  foreclosureFeePercent: Number.isFinite(envFee) && envFee >= 0 ? envFee : 2,
  coolingOffDays: 3, // days after disbursal in which the customer may cancel (set by the NBFC)
  maxAprPercent: null, // optional ceiling: pricing that would exceed it cannot be saved
  // Higher limit for customers who have repaid before. Off until the NBFC switches it on.
  // Internal controls. With four-eyes on, the person who approved a loan cannot also release its payout.
  controls: { fourEyesDisbursal: false },
  repeat: { enabled: false, maxLoanAmount: 100000, stepUpPercent: 25, minClosedLoans: 1 },
  institution: {
    lenderName: 'Laxmi India Finance Ltd.',
    registrationNumber: '',
    address: '',
    website: '',
    supportEmail: '',
    supportPhone: '',
    grievanceOfficerName: '',
    grievanceOfficerEmail: '',
    grievanceOfficerPhone: '',
  },
};

export const PLAN_KEYS = Object.keys(DEFAULTS.plans);
export const INSTITUTION_REQUIRED = [
  ['registrationNumber', 'NBFC registration number'],
  ['address', 'Registered address'],
  ['supportEmail', 'Support email'],
  ['supportPhone', 'Support phone'],
  ['grievanceOfficerName', 'Grievance officer name'],
  ['grievanceOfficerEmail', 'Grievance officer email'],
  ['grievanceOfficerPhone', 'Grievance officer phone'],
];

const clone = o => JSON.parse(JSON.stringify(o));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Overlays only the keys the defaults know about, so stray or hostile fields never get stored.
function overlay(base, input) {
  if (!isObj(input)) return base;
  for (const key of Object.keys(base)) {
    if (!(key in input)) continue;
    if (isObj(base[key])) base[key] = overlay(base[key], input[key]);
    else base[key] = input[key];
  }
  return base;
}

export function getPolicy() {
  let stored = null;
  try {
    const raw = getConfig('PRICING_POLICY', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* fall back to defaults */ }
  return overlay(clone(DEFAULTS), stored);
}

const num = (v, min, max, name, errors, { int = false, allowNull = false } = {}) => {
  if (allowNull && (v === null || v === '' || v === undefined)) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    errors.push(`${name} must be ${int ? 'a whole number ' : 'a number '}between ${min} and ${max}`);
    return undefined;
  }
  return n;
};
const text = (v, max, name, errors) => {
  const s = String(v ?? '').trim();
  if (s.length > max) { errors.push(`${name} is too long (max ${max} characters)`); return undefined; }
  return s;
};

// Takes the policy as it should become (current settings with the admin's changes laid over them).
export function validatePolicy(candidate) {
  const errors = [];
  const p = clone(candidate);

  p.minAmount = num(p.minAmount, 100, 10000000, 'Minimum amount', errors, { int: true });
  p.maxAmount = num(p.maxAmount, 100, 10000000, 'Maximum amount', errors, { int: true });
  p.offerAmount = num(p.offerAmount, 100, 10000000, 'Offer amount', errors, { int: true });
  p.annualRatePercent = num(p.annualRatePercent, 0, 60, 'Annual interest rate', errors);
  p.minTenureMonths = num(p.minTenureMonths, 1, 60, 'Minimum tenure', errors, { int: true });
  p.maxTenureMonths = num(p.maxTenureMonths, 1, 60, 'Maximum tenure', errors, { int: true });
  p.processingFeePercent = num(p.processingFeePercent, 0, 20, 'Processing fee', errors);
  p.gstPercent = num(p.gstPercent, 0, 40, 'GST', errors);
  p.lateFee.percentPerMonth = num(p.lateFee.percentPerMonth, 0, 20, 'Late fee percent', errors);
  p.lateFee.minimum = num(p.lateFee.minimum, 0, 100000, 'Minimum late fee', errors);
  p.foreclosureFeePercent = num(p.foreclosureFeePercent, 0, 10, 'Early closure fee', errors);
  p.coolingOffDays = num(p.coolingOffDays, 0, 30, 'Cooling-off days', errors, { int: true });
  p.maxAprPercent = num(p.maxAprPercent, 1, 200, 'Maximum APR', errors, { allowNull: true });
  p.controls.fourEyesDisbursal = p.controls.fourEyesDisbursal === true || p.controls.fourEyesDisbursal === 'true';
  p.repeat.enabled = p.repeat.enabled === true || p.repeat.enabled === 'true';
  p.repeat.maxLoanAmount = num(p.repeat.maxLoanAmount, 100, 10000000, 'Repeat-customer largest loan', errors, { int: true });
  p.repeat.stepUpPercent = num(p.repeat.stepUpPercent, 0, 500, 'Repeat-customer step-up', errors);
  p.repeat.minClosedLoans = num(p.repeat.minClosedLoans, 1, 20, 'Loans to repay before a higher limit', errors, { int: true });

  if (errors.length === 0) {
    if (p.minAmount > p.maxAmount) errors.push('Minimum amount cannot be above the maximum amount');
    if (p.offerAmount < p.minAmount || p.offerAmount > p.maxAmount) errors.push('Offer amount must be between the minimum and maximum amount');
    if (p.minTenureMonths > p.maxTenureMonths) errors.push('Minimum tenure cannot be above the maximum tenure');
  }

  for (const key of PLAN_KEYS) {
    const plan = p.plans[key];
    plan.label = text(plan.label, 60, `${key} label`, errors);
    if (!plan.label) errors.push(`${key} needs a label`);
    plan.enabled = plan.enabled === true || plan.enabled === 'true';
    plan.tenureMonths = num(plan.tenureMonths, 1, 60, `${plan.label || key} tenure`, errors, { int: true });
    plan.flatInterestPercent = num(plan.flatInterestPercent, 0, 100, `${plan.label || key} interest`, errors);
  }

  const inst = p.institution;
  for (const [k, max] of [['lenderName', 120], ['registrationNumber', 60], ['address', 400], ['website', 200], ['supportEmail', 120], ['supportPhone', 30], ['grievanceOfficerName', 120], ['grievanceOfficerEmail', 120], ['grievanceOfficerPhone', 30]]) {
    inst[k] = text(inst[k], max, k, errors);
  }
  if (!inst.lenderName) errors.push('Lender name is required');
  for (const k of ['supportEmail', 'grievanceOfficerEmail']) {
    if (inst[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inst[k])) errors.push(`${k} is not a valid email address`);
  }
  for (const k of ['supportPhone', 'grievanceOfficerPhone']) {
    if (inst[k] && !/^[0-9+()\-\s]{5,30}$/.test(inst[k])) errors.push(`${k} is not a valid phone number`);
  }
  if (inst.website && !/^https?:\/\/[^\s]+$/i.test(inst.website)) errors.push('Website must start with http:// or https://');

  return { errors, policy: p };
}

// ── The arithmetic ──────────────────────────────────────────────────────────────────────────

// Annualised cost of the loan including every fee: the monthly rate at which the amount the customer
// actually receives grows into the instalments they pay, times 12.
export function aprFor(netReceived, emi, months) {
  if (!(netReceived > 0) || !(emi > 0) || !(months > 0)) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const r = (lo + hi) / 2;
    let pv = 0;
    for (let k = 1; k <= months; k++) pv += emi / Math.pow(1 + r, k);
    if (pv > netReceived) lo = r; else hi = r;
  }
  return Math.round(((lo + hi) / 2) * 12 * 1000) / 10;
}

export function lateFeeFor(policy, emiAmount, monthsLate) {
  const { percentPerMonth, minimum } = policy.lateFee;
  return Math.round(Math.max(emiAmount * (percentPerMonth / 100) * Math.max(1, monthsLate), minimum));
}

// Returns an error message, or null when the request is acceptable under the policy.
// `maxAmount` lets a repeat customer's own limit replace the standard one.
export function checkRequest(policy, { amount, planType, tenureMonths }, maxAmount = policy.maxAmount) {
  if (!Number.isInteger(amount)) return 'Amount must be a whole number of rupees';
  if (amount < policy.minAmount || amount > maxAmount) {
    return `Amount must be between Rs ${policy.minAmount.toLocaleString('en-IN')} and Rs ${maxAmount.toLocaleString('en-IN')}`;
  }
  if (planType && planType !== 'standard') {
    const plan = policy.plans[planType];
    if (!plan || !plan.enabled) return 'That repayment plan is not available';
    return null;
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths < policy.minTenureMonths || tenureMonths > policy.maxTenureMonths) {
    return `Tenure must be between ${policy.minTenureMonths} and ${policy.maxTenureMonths} months`;
  }
  return null;
}

// Everything a customer must be shown before they commit (the Key Fact Statement), worked out in one
// place so the app, the portal, the agreement and the stored loan can never disagree.
export function computeQuote(policy, { amount, planType, tenureMonths }) {
  const plan = planType && planType !== 'standard' ? policy.plans[planType] : null;
  const months = plan ? plan.tenureMonths : tenureMonths;

  const processingFee = Math.round((amount * policy.processingFeePercent) / 100);
  const gst = Math.round((processingFee * policy.gstPercent) / 100);
  const netDisbursed = amount - processingFee - gst;

  let emi;
  if (plan) {
    emi = Math.round((amount * (1 + plan.flatInterestPercent / 100)) / months);
  } else {
    const r = policy.annualRatePercent / 12 / 100;
    emi = r === 0 ? Math.round(amount / months) : Math.round((amount * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1));
  }
  const totalRepayable = emi * months;

  return {
    planType: plan ? planType : 'standard',
    label: plan ? plan.label : `${months}-month loan`,
    interestType: plan ? 'flat' : 'reducing',
    amount,
    tenureMonths: months,
    interestRatePercent: plan ? plan.flatInterestPercent : policy.annualRatePercent,
    emi,
    totalInterest: totalRepayable - amount,
    processingFeePercent: policy.processingFeePercent,
    processingFee,
    gstPercent: policy.gstPercent,
    gst,
    totalCharges: processingFee + gst,
    netDisbursed,
    totalRepayable,
    totalCostOfCredit: totalRepayable - netDisbursed,
    aprPercent: aprFor(netDisbursed, emi, months),
    lateFee: { ...policy.lateFee },
    foreclosureFeePercent: policy.foreclosureFeePercent,
    coolingOffDays: policy.coolingOffDays,
  };
}

// What customers (and the unauthenticated app) are allowed to see.
export function publicPolicy(policy) {
  return {
    minAmount: policy.minAmount,
    maxAmount: policy.maxAmount,
    offerAmount: policy.offerAmount,
    annualRatePercent: policy.annualRatePercent,
    minTenureMonths: policy.minTenureMonths,
    maxTenureMonths: policy.maxTenureMonths,
    processingFeePercent: policy.processingFeePercent,
    gstPercent: policy.gstPercent,
    plans: Object.fromEntries(
      Object.entries(policy.plans).filter(([, p]) => p.enabled).map(([k, p]) => [k, { label: p.label, tenureMonths: p.tenureMonths, flatInterestPercent: p.flatInterestPercent }])
    ),
    lateFee: policy.lateFee,
    foreclosureFeePercent: policy.foreclosureFeePercent,
    coolingOffDays: policy.coolingOffDays,
    institution: policy.institution,
  };
}

// Sample quotes at the offer amount, for the admin to see the real cost of what they have set.
export function sampleQuotes(policy) {
  const out = [];
  for (const [key, plan] of Object.entries(policy.plans)) {
    if (plan.enabled) out.push(computeQuote(policy, { amount: policy.offerAmount, planType: key }));
  }
  const months = Math.min(policy.maxTenureMonths, Math.max(policy.minTenureMonths, 12));
  out.push(computeQuote(policy, { amount: policy.offerAmount, planType: 'standard', tenureMonths: months }));
  return out;
}

export function missingInstitutionDetails(policy) {
  return INSTITUTION_REQUIRED.filter(([k]) => !policy.institution[k]).map(([, label]) => label);
}

// Saves a validated policy. Refuses pricing whose APR would break the ceiling the NBFC set.
export async function savePolicy(candidate, updatedBy) {
  const { errors, policy } = validatePolicy(candidate);
  if (errors.length) return { ok: false, status: 400, errors };

  if (policy.maxAprPercent != null) {
    const over = sampleQuotes(policy).filter(q => q.aprPercent > policy.maxAprPercent);
    if (over.length) {
      return {
        ok: false,
        status: 409,
        errors: over.map(q => `${q.label}: APR ${q.aprPercent}% is above your ceiling of ${policy.maxAprPercent}%`),
      };
    }
  }
  await setConfig('PRICING_POLICY', JSON.stringify(policy), { group: 'pricing', updatedBy });
  return { ok: true, policy };
}

export default { getPolicy, validatePolicy, savePolicy, computeQuote, checkRequest, aprFor, lateFeeFor, publicPolicy, sampleQuotes, missingInstitutionDetails, DEFAULTS };
