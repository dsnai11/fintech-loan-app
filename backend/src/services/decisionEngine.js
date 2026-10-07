import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import AmlAlert from '../models/AmlAlert.js';
import { getConfig, setConfig } from './configService.js';
import { audit } from './auditService.js';
import { notify, templates } from './notificationService.js';

// The decision engine looks at a new application and says what to do with it:
//   APPROVE  the application is clean, within every rule
//   REJECT   a hard rule is broken (shown to the customer in plain words)
//   REFER    something needs a person to look at it, and why
// It runs when an application is submitted. In "shadow" mode it only records what it would have done, so the
// rules can be checked against real applications before anything is automatic.

export const MODES = ['off', 'shadow', 'auto'];

export const DEFAULTS = {
  mode: 'shadow',
  age: { min: 21, max: 65, hardMin: 18, hardMax: 75 }, // between min and max: fine. Outside that but inside the hard limits: a person decides. Outside the hard limits: rejected
  kyc: { requireApproved: true },
  phone: { requireVerified: true },
  amount: { firstLoanAutoMax: 25000, repeatAutoMax: 100000 }, // above these a person decides
  bureau: {
    requireScore: false, // true: no credit score on file means a person decides
    autoMinScore: 650, // this score or higher is clean; below it a person decides
    rejectBelow: null, // optional: a score below this is rejected instead
  },
  history: { rejectIfDefaulted: true, maxOpenLoans: 1, referIfOverdue: true },
  aml: { referOnOpenAlert: true },
};

const clone = o => JSON.parse(JSON.stringify(o));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function overlay(base, input) {
  if (!isObj(input)) return base;
  for (const k of Object.keys(base)) {
    if (!(k in input)) continue;
    if (isObj(base[k])) base[k] = overlay(base[k], input[k]);
    else base[k] = input[k];
  }
  return base;
}

export function getRules() {
  let stored = null;
  try {
    const raw = getConfig('DECISION_RULES', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* defaults */ }
  return overlay(clone(DEFAULTS), stored);
}

const bool = v => v === true || v === 'true';
function num(v, min, max, name, errors, { int = false, allowNull = false } = {}) {
  if (allowNull && (v === null || v === '' || v === undefined)) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    errors.push(`${name} must be ${int ? 'a whole number ' : 'a number '}between ${min} and ${max}`);
    return undefined;
  }
  return n;
}

export function validateRules(candidate) {
  const errors = [];
  const r = clone(candidate);
  const out = clone(DEFAULTS);

  out.mode = MODES.includes(r.mode) ? r.mode : (errors.push('Mode must be off, shadow or auto'), DEFAULTS.mode);

  out.age.min = num(r.age?.min, 18, 100, 'Youngest age without a check', errors, { int: true });
  out.age.max = num(r.age?.max, 18, 100, 'Oldest age without a check', errors, { int: true });
  out.age.hardMin = num(r.age?.hardMin, 18, 100, 'Youngest age we lend to', errors, { int: true });
  out.age.hardMax = num(r.age?.hardMax, 18, 100, 'Oldest age we lend to', errors, { int: true });
  if (!errors.length && !(out.age.hardMin <= out.age.min && out.age.min < out.age.max && out.age.max <= out.age.hardMax)) errors.push('Ages must run in order: youngest we lend to, youngest without a check, oldest without a check, oldest we lend to');

  out.kyc.requireApproved = bool(r.kyc?.requireApproved);
  out.phone.requireVerified = bool(r.phone?.requireVerified);
  out.amount.firstLoanAutoMax = num(r.amount?.firstLoanAutoMax, 0, 10000000, 'Largest automatic approval for a new customer', errors, { int: true });
  out.amount.repeatAutoMax = num(r.amount?.repeatAutoMax, 0, 10000000, 'Largest automatic approval for a repeat customer', errors, { int: true });

  out.bureau.requireScore = bool(r.bureau?.requireScore);
  out.bureau.autoMinScore = num(r.bureau?.autoMinScore, 300, 900, 'Clean credit score', errors, { int: true });
  out.bureau.rejectBelow = num(r.bureau?.rejectBelow, 300, 900, 'Reject below score', errors, { int: true, allowNull: true });
  if (!errors.length && out.bureau.rejectBelow !== null && out.bureau.rejectBelow > out.bureau.autoMinScore) errors.push('The reject score cannot be above the clean score');

  out.history.rejectIfDefaulted = bool(r.history?.rejectIfDefaulted);
  out.history.referIfOverdue = bool(r.history?.referIfOverdue);
  out.history.maxOpenLoans = num(r.history?.maxOpenLoans, 0, 20, 'Open loans allowed', errors, { int: true });
  out.aml.referOnOpenAlert = bool(r.aml?.referOnOpenAlert);
  return { errors, rules: out };
}

export async function saveRules(candidate, updatedBy) {
  const { errors, rules } = validateRules(candidate);
  if (errors.length) return { ok: false, errors };
  await setConfig('DECISION_RULES', JSON.stringify(rules), { group: 'decisions', updatedBy });
  return { ok: true, rules };
}

// ── The rules themselves, on plain facts so they can be tested and tried out without a database ──────────

// What a customer is told when a hard rule rejects them. Never the internal detail.
const CUSTOMER_REASON = {
  AGE: 'We are not able to offer a loan for your age at this time.',
  HISTORY_DEFAULT: 'We cannot offer a new loan while an earlier loan is not fully repaid.',
  BUREAU_LOW: 'We are not able to offer a loan based on your credit record at this time.',
};

export function evaluate(rules, f) {
  const checks = [];
  const add = (code, name, result, detail) => checks.push({ code, name, result, detail });

  // Age
  if (!(f.age > 0)) add('AGE', 'Age', 'refer', 'Date of birth is not on file');
  else if (f.age < rules.age.hardMin || f.age > rules.age.hardMax) add('AGE', 'Age', 'reject', `Age ${f.age} is outside ${rules.age.hardMin} to ${rules.age.hardMax}`);
  else if (f.age < rules.age.min) add('AGE', 'Age', 'refer', `Age ${f.age} is under ${rules.age.min}`);
  else if (f.age > rules.age.max) add('AGE', 'Age', 'refer', `Age ${f.age} is over ${rules.age.max}`);
  else add('AGE', 'Age', 'pass', `Age ${f.age}`);

  // Identity and contact
  if (rules.kyc.requireApproved) add('KYC', 'KYC', f.kycApproved ? 'pass' : 'refer', f.kycApproved ? 'KYC approved' : 'KYC is not approved yet');
  if (rules.phone.requireVerified) add('PHONE', 'Phone number', f.phoneVerified ? 'pass' : 'refer', f.phoneVerified ? 'Verified' : 'Phone number is not verified');

  // Compliance
  if (rules.aml.referOnOpenAlert) add('AML', 'AML alerts', f.openAmlAlerts > 0 ? 'refer' : 'pass', f.openAmlAlerts > 0 ? `${f.openAmlAlerts} open alert(s)` : 'No open alerts');

  // History with us
  if (rules.history.rejectIfDefaulted && f.defaultedLoans > 0) add('HISTORY_DEFAULT', 'Earlier loans', 'reject', `${f.defaultedLoans} earlier loan(s) defaulted or written off`);
  else add('HISTORY_DEFAULT', 'Earlier loans', 'pass', f.defaultedLoans > 0 ? 'Earlier default is allowed by the rules' : 'No default on record');
  add('OPEN_LOANS', 'Open loans', f.openLoans > rules.history.maxOpenLoans ? 'refer' : 'pass', `${f.openLoans} other open loan(s), up to ${rules.history.maxOpenLoans} allowed`);
  if (rules.history.referIfOverdue) add('OVERDUE', 'Overdue instalments', f.overdueEmis > 0 ? 'refer' : 'pass', f.overdueEmis > 0 ? `${f.overdueEmis} overdue instalment(s)` : 'None overdue');

  // Amount
  const limit = f.repeatCustomer ? rules.amount.repeatAutoMax : rules.amount.firstLoanAutoMax;
  add('AMOUNT', 'Loan amount', f.amount > limit ? 'refer' : 'pass', `Rs ${f.amount} against an automatic limit of Rs ${limit} for a ${f.repeatCustomer ? 'repeat' : 'new'} customer`);

  // Credit score
  if (f.bureauScore > 0) {
    const s = f.bureauScore;
    if (rules.bureau.rejectBelow !== null && s < rules.bureau.rejectBelow) add('BUREAU_LOW', 'Credit score', 'reject', `Score ${s} is below ${rules.bureau.rejectBelow}`);
    else if (s >= rules.bureau.autoMinScore) add('BUREAU', 'Credit score', 'pass', `Score ${s}`);
    else add('BUREAU', 'Credit score', 'refer', `Score ${s} is below ${rules.bureau.autoMinScore}`);
  } else if (rules.bureau.requireScore) add('BUREAU', 'Credit score', 'refer', 'No credit score on file');
  else add('BUREAU', 'Credit score', 'skip', 'No credit score on file. Connect a credit bureau to use this rule.');

  // Rules that need data we do not collect yet
  add('FOIR', 'Income against EMIs (FOIR)', 'skip', 'Income is not collected yet, so this rule is not running.');
  add('EWS', 'Early warning (bureau history)', 'skip', 'Needs credit bureau data, so this rule is not running.');

  const rejects = checks.filter(c => c.result === 'reject');
  const refers = checks.filter(c => c.result === 'refer');
  const outcome = rejects.length ? 'REJECT' : refers.length ? 'REFER' : 'APPROVE';
  return {
    outcome,
    checks,
    customerReason: rejects.length ? CUSTOMER_REASON[rejects[0].code] || 'We could not approve your application at this time.' : null,
  };
}

// ── Facts about a real application ────────────────────────────────────────────────────────────

const yearsSince = d => Math.floor((Date.now() - new Date(d).getTime()) / (365.25 * 86400000));

export async function gatherFacts(loan, user) {
  const others = await Loan.find({ userId: user._id, _id: { $ne: loan._id } }).select('status closureType');
  const open = ['submitted', 'under_review', 'approved', 'disbursed'];
  const [overdueEmis, openAmlAlerts] = await Promise.all([
    EMIPayment.countDocuments({ userId: user._id, status: 'OVERDUE' }),
    AmlAlert.countDocuments({ userId: user._id, status: 'OPEN' }),
  ]);
  return {
    amount: loan.loanAmount,
    age: user.dateOfBirth ? yearsSince(user.dateOfBirth) : 0,
    kycApproved: user.kycStatus === 'approved',
    phoneVerified: !!user.phoneVerified,
    openAmlAlerts,
    defaultedLoans: others.filter(l => ['defaulted', 'written_off'].includes(l.status)).length,
    openLoans: others.filter(l => open.includes(l.status)).length,
    overdueEmis,
    repeatCustomer: others.some(l => l.status === 'closed' && l.closureType !== 'cooling_off'),
    bureauScore: user.creditScore || 0, // filled by a credit bureau integration
  };
}

// Decide on a new application. Records what the engine found on the loan, and in "auto" mode acts on it.
// Never throws: a problem here must not stop the customer's application from being saved.
export async function decideLoan(loan, user, { rules = getRules() } = {}) {
  try {
    if (rules.mode === 'off') return null;
    const result = evaluate(rules, await gatherFacts(loan, user));
    let applied = false;

    if (rules.mode === 'auto' && loan.status === 'submitted') {
      if (result.outcome === 'APPROVE') {
        loan.status = 'approved';
        loan.approvedBy = 'system:decision-engine';
        loan.approvalDate = new Date();
        loan.approvalNotes = 'Approved automatically: every decision rule passed.';
        applied = true;
      } else if (result.outcome === 'REJECT') {
        loan.status = 'rejected';
        loan.rejectedBy = 'system:decision-engine';
        loan.rejectionReason = result.customerReason;
        loan.rejectionNotes = result.checks.filter(c => c.result === 'reject').map(c => c.detail).join('; ');
        applied = true;
      }
    }

    loan.decision = { outcome: result.outcome, mode: rules.mode, applied, checks: result.checks, customerReason: result.customerReason, at: new Date() };
    loan.markModified('decision');
    await loan.save();

    if (applied) {
      const approved = result.outcome === 'APPROVE';
      await audit({ email: 'system:decision-engine', role: 'system' }, approved ? 'LOAN_AUTO_APPROVED' : 'LOAN_AUTO_REJECTED', { type: 'Loan', id: loan._id },
        { amount: loan.loanAmount, checks: result.checks.filter(c => c.result !== 'pass' && c.result !== 'skip').map(c => c.code) });
      await notify(loan.userId, approved ? templates.approved(loan) : templates.rejected(loan, result.customerReason), { sms: true });
    }
    return loan.decision;
  } catch (e) {
    console.error('Decision engine failed:', e.message);
    return null;
  }
}

export default { getRules, saveRules, validateRules, evaluate, gatherFacts, decideLoan, DEFAULTS, MODES };
