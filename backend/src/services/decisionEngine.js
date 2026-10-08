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

// Rules the lender adds themselves, without any code: "when <something> is <over/under/equal to> <a value>,
// send the application to a person (or reject it)". These are the things a rule can look at.
export const CUSTOM_FIELDS = {
  amount: { label: 'Loan amount (Rs)', type: 'number' },
  age: { label: 'Age', type: 'number' },
  bureauScore: { label: 'Credit score (0 if none)', type: 'number' },
  openAmlAlerts: { label: 'Open AML alerts', type: 'number' },
  defaultedLoans: { label: 'Earlier defaulted loans', type: 'number' },
  openLoans: { label: 'Other open loans', type: 'number' },
  overdueEmis: { label: 'Overdue instalments', type: 'number' },
  kycApproved: { label: 'KYC approved', type: 'boolean' },
  phoneVerified: { label: 'Phone verified', type: 'boolean' },
  repeatCustomer: { label: 'Repeat customer', type: 'boolean' },
  monthlyIncome: { label: 'Monthly income (Rs, 0 if not given)', type: 'number' },
  emi: { label: 'EMI of this loan (Rs)', type: 'number' },
};
const OPS = ['>', '>=', '<', '<=', '=', '!='];

function conditionHolds(actual, op, value) {
  switch (op) {
    case '>': return actual > value;
    case '>=': return actual >= value;
    case '<': return actual < value;
    case '<=': return actual <= value;
    case '=': return actual === value;
    case '!=': return actual !== value;
    default: return false;
  }
}

export const DEFAULTS = {
  mode: 'shadow',
  age: { min: 21, max: 65, hardMin: 18, hardMax: 75 }, // between min and max: fine. Outside that but inside the hard limits: a person decides. Outside the hard limits: rejected
  kyc: { requireApproved: true },
  selfie: { requirePassed: true }, // the photo and blink check must have passed (not still waiting for staff)
  foir: { enabled: false, maxPercent: 50 }, // the EMI as a share of monthly income; above it a person decides
  phone: { requireVerified: true },
  amount: { firstLoanAutoMax: 25000, repeatAutoMax: 100000 }, // above these a person decides
  bureau: {
    requireScore: false, // true: no credit score on file means a person decides
    autoMinScore: 650, // this score or higher is clean; below it a person decides
    rejectBelow: null, // optional: a score below this is rejected instead
  },
  // How much a customer is offered (what the app shows, and the most they can apply for).
  offer: {
    noScoreLimit: 30000, // no credit score on file
    scoreLimits: [ // at this score or higher
      { min: 750, limit: 100000 },
      { min: 700, limit: 60000 },
      { min: 650, limit: 40000 },
    ],
    belowCleanLimit: 10000, // a score below the lowest line above: a small offer, and a person decides
    repeatLimit: 100000, // at least this for a customer who has repaid a loan
    validDays: 30,
    roundTo: 1000,
  },
  history: { rejectIfDefaulted: true, maxOpenLoans: 1, referIfOverdue: true },
  aml: { referOnOpenAlert: true },
  custom: [], // the lender's own rules: { id, name, field, op, value, result: 'refer' | 'reject', message }
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
  out.selfie.requirePassed = bool(r.selfie?.requirePassed);
  out.foir.enabled = bool(r.foir?.enabled);
  out.foir.maxPercent = num(r.foir?.maxPercent, 5, 100, 'Highest EMI as a share of income (%)', errors);
  out.phone.requireVerified = bool(r.phone?.requireVerified);
  out.amount.firstLoanAutoMax = num(r.amount?.firstLoanAutoMax, 0, 10000000, 'Largest automatic approval for a new customer', errors, { int: true });
  out.amount.repeatAutoMax = num(r.amount?.repeatAutoMax, 0, 10000000, 'Largest automatic approval for a repeat customer', errors, { int: true });

  out.bureau.requireScore = bool(r.bureau?.requireScore);
  out.bureau.autoMinScore = num(r.bureau?.autoMinScore, 300, 900, 'Clean credit score', errors, { int: true });
  out.bureau.rejectBelow = num(r.bureau?.rejectBelow, 300, 900, 'Reject below score', errors, { int: true, allowNull: true });
  if (!errors.length && out.bureau.rejectBelow !== null && out.bureau.rejectBelow > out.bureau.autoMinScore) errors.push('The reject score cannot be above the clean score');

  out.offer.noScoreLimit = num(r.offer?.noScoreLimit, 0, 10000000, 'Offer with no credit score', errors, { int: true });
  out.offer.belowCleanLimit = num(r.offer?.belowCleanLimit, 0, 10000000, 'Offer for a low credit score', errors, { int: true });
  out.offer.repeatLimit = num(r.offer?.repeatLimit, 0, 10000000, 'Offer for a repeat customer', errors, { int: true });
  out.offer.validDays = num(r.offer?.validDays, 1, 365, 'Days an offer stays valid', errors, { int: true });
  out.offer.roundTo = num(r.offer?.roundTo, 1, 100000, 'Round offers down to', errors, { int: true });
  out.offer.scoreLimits = [];
  for (const [i, b] of (Array.isArray(r.offer?.scoreLimits) ? r.offer.scoreLimits : []).entries()) {
    const min = num(b?.min, 300, 900, `Offer line ${i + 1}: score`, errors, { int: true });
    const limit = num(b?.limit, 0, 10000000, `Offer line ${i + 1}: amount`, errors, { int: true });
    if (min !== undefined && limit !== undefined) out.offer.scoreLimits.push({ min, limit });
  }
  out.offer.scoreLimits.sort((a, b) => b.min - a.min);
  if (!errors.length) {
    const lines = out.offer.scoreLimits;
    for (let i = 1; i < lines.length; i++) if (lines[i].limit > lines[i - 1].limit) errors.push('A lower score cannot be offered more than a higher score');
    if (lines.length && out.offer.belowCleanLimit > lines[lines.length - 1].limit) errors.push('The offer for a low score cannot be above the offer for the lowest score line');
  }
  out.custom = [];
  const list = Array.isArray(r.custom) ? r.custom : [];
  if (list.length > 30) errors.push('Too many of your own rules (up to 30)');
  const seen = new Set();
  list.slice(0, 30).forEach((c, i) => {
    const label = `Your rule ${i + 1}`;
    const name = String(c?.name ?? '').trim();
    if (!name || name.length > 60) { errors.push(`${label} needs a name of up to 60 characters`); return; }
    const spec = CUSTOM_FIELDS[c.field];
    if (!spec) { errors.push(`${name}: choose what the rule looks at`); return; }
    if (!OPS.includes(c.op) || (spec.type === 'boolean' && !['=', '!='].includes(c.op))) { errors.push(`${name}: that comparison does not fit "${spec.label}"`); return; }
    let value;
    if (spec.type === 'boolean') value = c.value === true || c.value === 'true' ? true : c.value === false || c.value === 'false' ? false : undefined;
    else value = c.value === '' || c.value === null || c.value === undefined ? undefined : Number(c.value);
    if (value === undefined || (spec.type === 'number' && (!Number.isFinite(value) || value < -1e9 || value > 1e9))) { errors.push(`${name}: enter a value to compare with`); return; }
    if (!['refer', 'reject'].includes(c.result)) { errors.push(`${name}: choose whether it sends the application to a person or rejects it`); return; }
    let id = String(c.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || `rule_${i + 1}`;
    while (seen.has(id)) id += '_x';
    seen.add(id);
    out.custom.push({ id, name, field: c.field, op: c.op, value, result: c.result, message: String(c.message ?? '').trim().slice(0, 120) });
  });
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

  // The photo taken at sign-up
  if (rules.selfie.requirePassed) {
    const s = f.selfieStatus;
    add('SELFIE', 'Photo and blink check', s === 'passed' ? 'pass' : 'refer', s === 'passed' ? 'Passed' : s === 'review' ? 'The photo is waiting for a staff check' : 'No verified photo on file');
  }

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

  // The lender's own rules
  for (const c of rules.custom || []) {
    const hit = conditionHolds(f[c.field], c.op, c.value);
    add(`CUSTOM_${c.id}`, c.name, hit ? c.result : 'pass', hit ? (c.message || `${c.name} applies`) : 'Does not apply');
  }

  // Rules that need data we do not collect yet
  if (rules.foir.enabled) {
    if (!(f.monthlyIncome > 0)) add('FOIR', 'Income against EMIs (FOIR)', 'refer', 'Monthly income is not on file');
    else {
      const share = Math.round((f.emi / f.monthlyIncome) * 1000) / 10;
      add('FOIR', 'Income against EMIs (FOIR)', share > rules.foir.maxPercent ? 'refer' : 'pass', `The EMI is ${share}% of monthly income, against a limit of ${rules.foir.maxPercent}%`);
    }
  } else add('FOIR', 'Income against EMIs (FOIR)', 'skip', 'Switched off. Turn it on to compare the EMI with monthly income.');
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
    selfieStatus: user.selfie?.status || 'none',
    monthlyIncome: user.employment?.monthlyIncome || 0,
    emi: loan.monthlyEMI || 0,
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

// ── The offer: how much this customer can borrow ────────────────────────────────────────────────

// Works out the amount a customer is offered from what we know about them. DECLINED means no offer;
// REVIEW means a smaller offer that a person will look at; OFFER is the normal case.
export function computeOffer(rules, f, policy) {
  const o = rules.offer;
  let reason = null;
  if (f.age > 0 && (f.age < rules.age.hardMin || f.age > rules.age.hardMax)) reason = CUSTOMER_REASON.AGE;
  else if (rules.history.rejectIfDefaulted && f.defaultedLoans > 0) reason = CUSTOMER_REASON.HISTORY_DEFAULT;
  else if (f.bureauScore > 0 && rules.bureau.rejectBelow !== null && f.bureauScore < rules.bureau.rejectBelow) reason = CUSTOMER_REASON.BUREAU_LOW;
  if (reason) return { status: 'DECLINED', amount: 0, reason };

  let status = 'OFFER';
  let limit;
  if (f.bureauScore > 0) {
    const line = o.scoreLimits.find(l => f.bureauScore >= l.min);
    if (line) limit = line.limit;
    else { limit = o.belowCleanLimit; status = 'REVIEW'; }
  } else limit = o.noScoreLimit;
  if (f.repeatCustomer) limit = Math.max(limit, o.repeatLimit);

  limit = Math.min(limit, policy.maxAmount);
  limit = Math.floor(limit / o.roundTo) * o.roundTo;
  if (limit < policy.minAmount) return { status: 'DECLINED', amount: 0, reason: 'We are not able to offer a loan at this time.' };
  return { status, amount: limit, reason: null };
}

// What we know about a customer before they ask for a particular amount.
export async function gatherUserFacts(user) {
  const others = await Loan.find({ userId: user._id }).select('status closureType');
  const open = ['submitted', 'under_review', 'approved', 'disbursed'];
  return {
    age: user.dateOfBirth ? yearsSince(user.dateOfBirth) : 0,
    defaultedLoans: others.filter(l => ['defaulted', 'written_off'].includes(l.status)).length,
    openLoans: others.filter(l => open.includes(l.status)).length,
    repeatCustomer: others.some(l => l.status === 'closed' && l.closureType !== 'cooling_off'),
    bureauScore: user.creditScore || 0,
  };
}

export default { getRules, saveRules, validateRules, evaluate, computeOffer, gatherUserFacts, gatherFacts, decideLoan, DEFAULTS, MODES };
