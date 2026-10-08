import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import User from '../models/User.js';
import { getConfig, setConfig } from './configService.js';

// Asset classification (SMA / NPA), accounting stages and provisioning, plus the data files a lender sends to credit
// bureaus and uses for CKYC.
//
// IMPORTANT: the day counts and provision percentages below are STARTING VALUES taken from common RBI practice for
// NBFCs. They are editable on the Regulatory page, and the company's compliance and finance teams must confirm them
// (they depend on the company's RBI category and its board-approved policy) before anything is reported.

const DAY = 864e5;
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];

export const CLASSES = ['STANDARD', 'SMA0', 'SMA1', 'SMA2', 'SUBSTANDARD', 'DOUBTFUL', 'LOSS'];
export const CLASS_LABEL = { STANDARD: 'Standard', SMA0: 'SMA-0 (1-30 days)', SMA1: 'SMA-1 (31-60 days)', SMA2: 'SMA-2 (61-90 days)', SUBSTANDARD: 'NPA: sub-standard', DOUBTFUL: 'NPA: doubtful', LOSS: 'NPA: loss / written off' };
const SHORT = { STANDARD: 'STD', SMA0: 'SMA0', SMA1: 'SMA1', SMA2: 'SMA2', SUBSTANDARD: 'SUB', DOUBTFUL: 'DBT', LOSS: 'LSS' };

export const POLICY_DEFAULTS = {
  sma0From: 1, sma1From: 31, sma2From: 61, npaFrom: 91, doubtfulFrom: 456,
  stage2From: 31, stage3From: 91,
  rates: { STANDARD: 0.4, SMA0: 2, SMA1: 5, SMA2: 10, SUBSTANDARD: 25, DOUBTFUL: 50, LOSS: 100 },
};

export function getPolicy() {
  try {
    const saved = JSON.parse(getConfig('ASSET_POLICY', '') || '{}');
    return { ...POLICY_DEFAULTS, ...saved, rates: { ...POLICY_DEFAULTS.rates, ...(saved.rates || {}) } };
  } catch (e) {
    return { ...POLICY_DEFAULTS, rates: { ...POLICY_DEFAULTS.rates } };
  }
}

export function validatePolicy(input) {
  const errors = [];
  const out = { rates: {} };
  const days = ['sma0From', 'sma1From', 'sma2From', 'npaFrom', 'doubtfulFrom'];
  const labels = { sma0From: 'SMA-0 starts at', sma1From: 'SMA-1 starts at', sma2From: 'SMA-2 starts at', npaFrom: 'NPA starts at', doubtfulFrom: 'Doubtful starts at', stage2From: 'Stage 2 starts at', stage3From: 'Stage 3 starts at' };
  for (const k of [...days, 'stage2From', 'stage3From']) {
    const n = Number(input?.[k] ?? POLICY_DEFAULTS[k]);
    if (!Number.isInteger(n) || n < 1 || n > 2000) errors.push(`${labels[k]} must be a whole number of days between 1 and 2000`);
    else out[k] = n;
  }
  if (!errors.length) {
    if (!(out.sma0From < out.sma1From && out.sma1From < out.sma2From && out.sma2From < out.npaFrom && out.npaFrom < out.doubtfulFrom)) errors.push('The day counts must go up: SMA-0, then SMA-1, then SMA-2, then NPA, then doubtful');
    if (out.stage2From >= out.stage3From) errors.push('Stage 2 must start before Stage 3');
  }
  for (const c of CLASSES) {
    const n = Number(input?.rates?.[c] ?? POLICY_DEFAULTS.rates[c]);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push(`The provision for ${CLASS_LABEL[c]} must be between 0 and 100 percent`);
    else out.rates[c] = n;
  }
  return { errors, policy: out };
}

export async function savePolicy(input, by) {
  const { errors, policy } = validatePolicy(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('ASSET_POLICY', JSON.stringify(policy), { group: 'app', updatedBy: by });
  return { ok: true, policy };
}

const classOf = (dpd, p) => (dpd >= p.doubtfulFrom ? 'DOUBTFUL' : dpd >= p.npaFrom ? 'SUBSTANDARD' : dpd >= p.sma2From ? 'SMA2' : dpd >= p.sma1From ? 'SMA1' : dpd >= p.sma0From ? 'SMA0' : 'STANDARD');
const stageOf = (dpd, p) => (dpd >= p.stage3From ? 3 : dpd >= p.stage2From ? 2 : 1);
const worse = (a, b) => (CLASSES.indexOf(a) >= CLASSES.indexOf(b) ? a : b);
const round2 = n => Math.round(n * 100) / 100;

// Every live loan with its days past due, class, accounting stage, amount outstanding and provision.
// A borrower with several loans is classified on the worst of them (the usual rule for lenders).
export async function classify(now = new Date()) {
  const policy = getPolicy();
  const loans = await Loan.find({ status: { $in: ['disbursed', 'defaulted', 'written_off'] } }).lean();
  const emis = await EMIPayment.find({ loanId: { $in: loans.map(l => l._id) }, status: { $in: UNPAID } }).select('loanId amount principalAmount interestAmount dueDate penaltyApplied').lean();
  const users = await User.find({ _id: { $in: loans.map(l => l.userId) } }).select('firstName lastName phone').lean();
  const who = Object.fromEntries(users.map(u => [String(u._id), u]));
  const byLoan = new Map();
  for (const e of emis) { const k = String(e.loanId); if (!byLoan.has(k)) byLoan.set(k, []); byLoan.get(k).push(e); }

  const rows = loans.map(l => {
    const list = byLoan.get(String(l._id)) || [];
    const overdue = list.filter(e => new Date(e.dueDate) < now);
    const oldest = overdue.length ? Math.min(...overdue.map(e => +new Date(e.dueDate))) : null;
    const dpd = oldest ? Math.max(0, Math.floor((now - oldest) / DAY)) : 0;
    const principal = list.reduce((a, e) => a + (e.principalAmount ?? Math.max(0, e.amount - (e.interestAmount || 0))), 0);
    const written = l.status === 'written_off';
    const outstanding = written ? Math.max(0, (l.writtenOffAmount || 0) - (l.recoveredAmount || 0)) : principal;
    return {
      loanId: String(l._id), userId: String(l.userId), customer: who[String(l.userId)] ? `${who[String(l.userId)].firstName} ${who[String(l.userId)].lastName}`.trim() : 'Unknown', phone: who[String(l.userId)]?.phone,
      status: l.status, dpd, overdueAmount: round2(overdue.reduce((a, e) => a + e.amount + (e.penaltyApplied || 0), 0)), outstanding: round2(outstanding),
      loanClass: written ? 'LOSS' : classOf(dpd, policy), sanctioned: l.loanAmount, disbursedOn: l.disbursementDate || null,
    };
  });

  const worst = new Map(), worstDpd = new Map();
  for (const r of rows) {
    worst.set(r.userId, worse(worst.get(r.userId) || 'STANDARD', r.loanClass));
    worstDpd.set(r.userId, Math.max(worstDpd.get(r.userId) || 0, r.dpd));
  }
  for (const r of rows) {
    r.class = worst.get(r.userId);
    r.stage = ['SUBSTANDARD', 'DOUBTFUL', 'LOSS'].includes(r.class) ? 3 : stageOf(worstDpd.get(r.userId), policy);
    r.provisionRate = policy.rates[r.class];
    r.provision = round2((r.outstanding * r.provisionRate) / 100);
    r.carriedFromOtherLoan = r.class !== r.loanClass;
  }

  const summary = Object.fromEntries(CLASSES.map(c => [c, { label: CLASS_LABEL[c], loans: 0, outstanding: 0, provision: 0 }]));
  const stages = { 1: { loans: 0, outstanding: 0, provision: 0 }, 2: { loans: 0, outstanding: 0, provision: 0 }, 3: { loans: 0, outstanding: 0, provision: 0 } };
  for (const r of rows) {
    const s = summary[r.class]; s.loans++; s.outstanding += r.outstanding; s.provision += r.provision;
    const g = stages[r.stage]; g.loans++; g.outstanding += r.outstanding; g.provision += r.provision;
  }
  for (const s of [...Object.values(summary), ...Object.values(stages)]) { s.outstanding = round2(s.outstanding); s.provision = round2(s.provision); }
  const total = round2(rows.reduce((a, r) => a + r.outstanding, 0));
  const npa = round2(['SUBSTANDARD', 'DOUBTFUL', 'LOSS'].reduce((a, c) => a + summary[c].outstanding, 0));
  const provision = round2(rows.reduce((a, r) => a + r.provision, 0));
  return {
    asOf: now, policy, loans: rows.sort((a, b) => b.dpd - a.dpd), summary, stages,
    totals: { loans: rows.length, outstanding: total, npa, grossNpaPercent: total ? round2((npa / total) * 100) : 0, provision, provisionCoveragePercent: npa ? round2((provision / npa) * 100) : null },
  };
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────
const cell = v => {
  let s = v instanceof Date ? v.toISOString() : String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
export const toCsv = (header, rows) => [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
const ddmmyyyy = d => {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, '0')}${String(x.getUTCMonth() + 1).padStart(2, '0')}${x.getUTCFullYear()}`;
};
const lastFour = v => { const s = String(v ?? '').replace(/\D/g, ''); return s.length >= 4 ? `XXXXXXXX${s.slice(-4)}` : ''; };

// One tidy monthly file of every account to report. Each bureau (CIBIL, Experian, Equifax, CRIF) gives its own layout once the
// company is a member; this holds the same facts so that layout can be filled from it.
export async function bureauFile(now = new Date()) {
  const c = await classify(now);
  const since = new Date(+now - 35 * DAY);
  const closed = await Loan.find({ status: 'closed', closedAt: { $gte: since } }).lean();
  const ids = [...c.loans.map(l => l.loanId), ...closed.map(l => String(l._id))];
  const loans = Object.fromEntries((await Loan.find({ _id: { $in: ids } }).lean()).map(l => [String(l._id), l]));
  const users = Object.fromEntries((await User.find({ _id: { $in: [...new Set(Object.values(loans).map(l => String(l.userId)))] } }).lean()).map(u => [String(u._id), u]));
  const lastPaid = Object.fromEntries((await EMIPayment.aggregate([{ $match: { loanId: { $in: Object.values(loans).map(l => l._id) }, status: 'PAID' } }, { $group: { _id: '$loanId', at: { $max: '$paidDate' } } }])).map(x => [String(x._id), x.at]));

  const header = ['Account number', 'Account type', 'Ownership', 'Consumer name', 'Date of birth (DDMMYYYY)', 'Gender', 'PAN', 'Mobile', 'Address', 'City', 'State', 'PIN', 'Date opened (DDMMYYYY)', 'Date of last payment (DDMMYYYY)', 'Date closed (DDMMYYYY)', 'As of (DDMMYYYY)', 'Sanctioned amount', 'Current balance', 'Amount overdue', 'Days past due', 'Asset classification', 'Instalment amount', 'Tenure (months)', 'Payment frequency', 'Written-off amount'];
  const row = (loan, extra) => {
    const u = users[String(loan.userId)] || {};
    const a = u.address || {};
    return [String(loan._id), 'Personal loan', 'Individual', `${u.firstName || ''} ${u.lastName || ''}`.trim(), ddmmyyyy(u.dateOfBirth), u.gender || '', u.panNumber || '', u.phone || '', a.street || '', a.city || '', a.state || '', a.zipCode || '',
      ddmmyyyy(loan.disbursementDate), ddmmyyyy(lastPaid[String(loan._id)]), ddmmyyyy(loan.closedAt), ddmmyyyy(now), loan.loanAmount, extra.balance, extra.overdue, extra.dpd, extra.cls, loan.monthlyEMI ?? '', loan.tenure, 'Monthly', loan.writtenOffAmount ?? ''];
  };
  const rows = [
    ...c.loans.map(l => row(loans[l.loanId], { balance: l.outstanding, overdue: l.overdueAmount, dpd: l.dpd, cls: SHORT[l.class] })),
    ...closed.map(l => row(l, { balance: 0, overdue: 0, dpd: 0, cls: l.closureType === 'settlement' ? 'SETTLED' : 'CLSD' })),
  ];
  return { header, rows };
}

const CKYC_FIELDS = [
  ['name', 'Full name', u => `${u.firstName || ''} ${u.lastName || ''}`.trim()],
  ['dob', 'Date of birth', u => u.dateOfBirth],
  ['gender', 'Gender', u => u.gender],
  ['pan', 'PAN', u => u.panNumber],
  ['address', 'Street address', u => u.address?.street],
  ['city', 'City', u => u.address?.city],
  ['state', 'State', u => u.address?.state],
  ['pin', 'PIN code', u => u.address?.zipCode],
  ['phone', 'Mobile', u => u.phone],
  ['kyc', 'KYC approved', u => (u.kycStatus === 'approved' ? 'yes' : '')],
];

async function ckycCustomers() {
  const ids = await Loan.distinct('userId', { status: { $in: ['disbursed', 'closed', 'defaulted', 'written_off'] } });
  return User.find({ _id: { $in: ids } }).lean();
}

// How many borrowers have everything a CKYC upload needs. The father's or spouse's name is also required by CKYC and is not
// collected today; it is reported as a gap so the team can decide how to collect it.
export async function ckycReadiness() {
  const users = await ckycCustomers();
  const missing = Object.fromEntries(CKYC_FIELDS.map(f => [f[0], { label: f[1], count: 0 }]));
  let ready = 0;
  for (const u of users) {
    let ok = true;
    for (const [k, , get] of CKYC_FIELDS) if (!get(u)) { missing[k].count++; ok = false; }
    if (ok) ready++;
  }
  return { borrowers: users.length, ready, notReady: users.length - ready, missing: Object.values(missing).filter(m => m.count), notCollected: ['Father\'s or spouse\'s name', 'Passport-size photo copy (the selfie is held, not exported)'] };
}

// Aadhaar is never exported in full: only the last four digits, as the Aadhaar rules expect.
export async function ckycFile() {
  const users = await ckycCustomers();
  const cols = CKYC_FIELDS.filter(f => f[0] !== 'kyc');
  const header = ['Customer id', ...cols.map(f => f[1]), 'Aadhaar (last 4 only)', 'KYC approved', 'KYC complete'];
  const rows = users.map(u => [
    String(u._id),
    ...cols.map(([, , get]) => { const v = get(u); return v instanceof Date ? ddmmyyyy(v) : v; }),
    lastFour(u.aadharNumber),
    u.kycStatus === 'approved' ? 'yes' : 'no',
    CKYC_FIELDS.every(([, , get]) => get(u)) ? 'yes' : 'no',
  ]);
  return { header, rows };
}

export async function classificationFile(now = new Date()) {
  const c = await classify(now);
  return {
    header: ['Loan id', 'Customer', 'Status', 'Days past due', 'Loan class', 'Borrower class', 'Accounting stage', 'Overdue amount', 'Outstanding principal', 'Provision %', 'Provision'],
    rows: c.loans.map(l => [l.loanId, l.customer, l.status, l.dpd, CLASS_LABEL[l.loanClass], CLASS_LABEL[l.class], l.stage, l.overdueAmount, l.outstanding, l.provisionRate, l.provision]),
  };
}

export default { classify, getPolicy, savePolicy, validatePolicy, bureauFile, ckycFile, ckycReadiness, classificationFile, toCsv, CLASSES, CLASS_LABEL };
