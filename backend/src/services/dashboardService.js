import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import User from '../models/User.js';
import AmlAlert from '../models/AmlAlert.js';
import SupportThread from '../models/SupportThread.js';
import ChangeRequest from '../models/ChangeRequest.js';
import { getConfig, setConfig } from './configService.js';
import { setupStatus } from './onboardingService.js';

// The numbers leadership looks at: how much was lent and collected, how healthy the book is, how customers move through
// the sign-up funnel, how fast decisions are, and what needs attention today. Everything is worked out from the
// live data, for a chosen period and the period just before it, so every figure comes with a change.

const DAY = 864e5;
const REPAYING = ['disbursed', 'closed', 'defaulted', 'written_off'];
const LIVE = ['disbursed', 'defaulted'];
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
const customers = { role: { $in: [null, 'customer'] }, email: { $ne: (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase() } };

const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : 0);
const change = (now, before) => (before ? +(((now - before) / before) * 100).toFixed(1) : now ? null : 0); // null = new, no earlier figure
const median = list => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const TARGET_DEFAULTS = { monthlyDisbursal: 0, collectionEfficiencyPct: 0, monthlyNewCustomers: 0 };
export function getTargets() {
  try { return { ...TARGET_DEFAULTS, ...JSON.parse(getConfig('LEADERSHIP_TARGETS', '') || '{}') }; } catch (e) { return { ...TARGET_DEFAULTS }; }
}
export async function saveTargets(input, by) {
  const out = { ...TARGET_DEFAULTS };
  for (const k of Object.keys(TARGET_DEFAULTS)) {
    const n = Number(input?.[k] ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 1e10) return { ok: false, error: `${k} must be a number, zero or more` };
    if (k === 'collectionEfficiencyPct' && n > 100) return { ok: false, error: 'Collection efficiency target cannot be above 100' };
    out[k] = n;
  }
  await setConfig('LEADERSHIP_TARGETS', JSON.stringify(out), { group: 'app', updatedBy: by });
  return { ok: true, targets: out };
}

// Figures for [from, to)
async function figures(from, to) {
  const inRange = f => ({ [f]: { $gte: from, $lt: to } });
  const [applied, approved, rejected, disbursed, collected, newCustomers, due, tat] = await Promise.all([
    Loan.aggregate([{ $match: inRange('createdAt') }, { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: '$loanAmount' } } }]),
    Loan.countDocuments({ ...inRange('createdAt'), status: { $in: ['approved', ...REPAYING] } }),
    Loan.countDocuments({ ...inRange('createdAt'), status: 'rejected' }),
    Loan.aggregate([{ $match: { ...inRange('disbursementDate'), status: { $in: REPAYING } } }, { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: { $ifNull: ['$disbursedAmount', '$loanAmount'] } } } }]),
    EMIPayment.aggregate([{ $match: { ...inRange('paidDate'), status: 'PAID' } }, { $group: { _id: null, amount: { $sum: '$paidAmount' } } }]),
    User.countDocuments({ ...customers, ...inRange('createdAt') }),
    EMIPayment.aggregate([{ $match: { ...inRange('dueDate'), status: { $ne: 'WAIVED' } } }, { $group: { _id: null, due: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, { $ifNull: ['$paidAmount', '$amount'] }, 0] } } } }]),
    Loan.find({ ...inRange('createdAt'), status: { $in: ['approved', ...REPAYING] } }).select('createdAt approvalDate disbursementDate').lean(),
  ]);
  const decideHours = tat.filter(l => l.approvalDate).map(l => (new Date(l.approvalDate) - new Date(l.createdAt)) / 36e5).filter(h => h >= 0);
  const payoutHours = tat.filter(l => l.disbursementDate).map(l => (new Date(l.disbursementDate) - new Date(l.createdAt)) / 36e5).filter(h => h >= 0);
  return {
    applications: applied[0]?.n || 0,
    appliedAmount: applied[0]?.amount || 0,
    approvalRate: pct(approved, approved + rejected),
    disbursedLoans: disbursed[0]?.n || 0,
    disbursedAmount: disbursed[0]?.amount || 0,
    averageTicket: disbursed[0]?.n ? Math.round(disbursed[0].amount / disbursed[0].n) : 0,
    collected: collected[0]?.amount || 0,
    newCustomers,
    collectionEfficiency: pct(due[0]?.paid || 0, due[0]?.due || 0),
    medianDecisionHours: median(decideHours) == null ? null : +median(decideHours).toFixed(1),
    medianPayoutHours: median(payoutHours) == null ? null : +median(payoutHours).toFixed(1),
  };
}

async function funnel(from, to) {
  const users = await User.find({ ...customers, createdAt: { $gte: from, $lt: to } })
    .select('phoneVerified bureauConsentAt kycDigilocker dateOfBirth gender address employment selfie bankAccount').limit(20000).lean();
  const ids = users.map(u => u._id);
  const usersWith = async status => (await Loan.distinct('userId', { userId: { $in: ids }, ...(status ? { status: { $in: status } } : {}) })).length;
  const steps = [
    { key: 'registered', label: 'Registered', count: users.length },
    { key: 'phone', label: 'Phone verified', count: users.filter(u => u.phoneVerified).length },
    { key: 'setup', label: 'Account set-up done', count: users.filter(u => setupStatus(u).complete).length },
    { key: 'checked', label: 'Credit check done', count: users.filter(u => u.bureauConsentAt).length },
    { key: 'applied', label: 'Applied for a loan', count: await usersWith(null) },
    { key: 'approved', label: 'Approved', count: await usersWith(['approved', ...REPAYING]) },
    { key: 'disbursed', label: 'Received the money', count: await usersWith(REPAYING) },
  ];
  return steps.map(s => ({ ...s, ofRegistered: pct(s.count, steps[0].count) }));
}

// Overdue loans by how late the worst instalment is, and the share of the book that is late
async function bookHealth(now) {
  const liveIds = await Loan.find({ status: { $in: LIVE } }).distinct('_id');
  const emis = await EMIPayment.find({ loanId: { $in: liveIds }, status: { $in: UNPAID } }).select('loanId principalAmount amount dueDate').lean();
  const perLoan = new Map();
  for (const e of emis) {
    const k = String(e.loanId);
    const row = perLoan.get(k) || { principal: 0, overdue: 0, age: 0 };
    row.principal += e.principalAmount || 0;
    if (new Date(e.dueDate) < now) { row.overdue += e.amount || 0; row.age = Math.max(row.age, Math.floor((now - new Date(e.dueDate)) / DAY)); }
    perLoan.set(k, row);
  }
  const buckets = [
    { key: 'current', label: 'Not late', min: -1, max: 0 },
    { key: 'd1_30', label: '1 to 30 days late', min: 1, max: 30 },
    { key: 'd31_60', label: '31 to 60 days late', min: 31, max: 60 },
    { key: 'd61_90', label: '61 to 90 days late', min: 61, max: 90 },
    { key: 'd90', label: 'Over 90 days late', min: 91, max: Infinity },
  ].map(b => ({ ...b, loans: 0, principal: 0, overdueAmount: 0 }));
  let outstanding = 0;
  for (const r of perLoan.values()) {
    outstanding += r.principal;
    const b = buckets.find(x => r.age >= x.min && r.age <= x.max) || buckets[0];
    b.loans += 1; b.principal += r.principal; b.overdueAmount += r.overdue;
  }
  const late = min => buckets.filter(b => b.min >= min).reduce((a, b) => a + b.principal, 0);
  return {
    outstandingPrincipal: Math.round(outstanding),
    liveLoans: perLoan.size,
    par30: pct(late(31), outstanding),
    par90: pct(late(91), outstanding),
    buckets: buckets.map(({ key, label, loans, principal, overdueAmount }) => ({ key, label, loans, principal: Math.round(principal), overdueAmount: Math.round(overdueAmount) })),
  };
}

async function mixes(from, to) {
  const [products, repeat, reasons, decisions] = await Promise.all([
    Loan.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: { $ifNull: ['$productKey', 'personal'] }, loans: { $sum: 1 }, amount: { $sum: '$loanAmount' } } }, { $sort: { amount: -1 } }]),
    (async () => {
      const loans = await Loan.find({ disbursementDate: { $gte: from, $lt: to }, status: { $in: REPAYING } }).select('userId disbursementDate').lean();
      if (!loans.length) return { total: 0, repeat: 0 };
      const earlier = await Loan.distinct('userId', { userId: { $in: loans.map(l => l.userId) }, status: { $in: REPAYING }, disbursementDate: { $lt: from } });
      const set = new Set(earlier.map(String));
      return { total: loans.length, repeat: loans.filter(l => set.has(String(l.userId))).length };
    })(),
    Loan.aggregate([{ $match: { createdAt: { $gte: from, $lt: to }, status: 'rejected', rejectionReason: { $nin: [null, ''] } } }, { $group: { _id: '$rejectionReason', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
    Loan.aggregate([{ $match: { createdAt: { $gte: from, $lt: to }, decision: { $exists: true } } }, { $group: { _id: { outcome: '$decision.outcome', applied: '$decision.applied' }, n: { $sum: 1 } } }]),
  ]);
  const auto = decisions.filter(d => d._id.applied === true).reduce((a, d) => a + d.n, 0);
  const all = decisions.reduce((a, d) => a + d.n, 0);
  return {
    products: products.map(p => ({ product: p._id, loans: p.loans, amount: p.amount })),
    repeatShare: pct(repeat.repeat, repeat.total),
    repeatLoans: repeat.repeat,
    rejectionReasons: reasons.map(r => ({ reason: String(r._id).slice(0, 120), count: r.n })),
    decisions: { total: all, automatic: auto, automaticShare: pct(auto, all) },
  };
}

async function trend(from, to, days) {
  const grain = days <= 31 ? '%Y-%m-%d' : '%G-W%V';
  const key = f => ({ $dateToString: { format: grain, date: `$${f}` } });
  const [apps, disb, coll] = await Promise.all([
    Loan.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: key('createdAt'), n: { $sum: 1 } } }]),
    Loan.aggregate([{ $match: { disbursementDate: { $gte: from, $lt: to }, status: { $in: REPAYING } } }, { $group: { _id: key('disbursementDate'), amount: { $sum: { $ifNull: ['$disbursedAmount', '$loanAmount'] } } } }]),
    EMIPayment.aggregate([{ $match: { paidDate: { $gte: from, $lt: to }, status: 'PAID' } }, { $group: { _id: key('paidDate'), amount: { $sum: '$paidAmount' } } }]),
  ]);
  const map = new Map();
  const put = (k, f, v) => { const r = map.get(k) || { label: k, applications: 0, disbursed: 0, collected: 0 }; r[f] = v; map.set(k, r); };
  apps.forEach(r => put(r._id, 'applications', r.n));
  disb.forEach(r => put(r._id, 'disbursed', r.amount));
  coll.forEach(r => put(r._id, 'collected', r.amount));
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function attention() {
  const [toDecide, toDisburse, kyc, aml, support, changes] = await Promise.all([
    Loan.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
    Loan.countDocuments({ status: 'approved' }),
    User.countDocuments({ ...customers, kycStatus: 'pending', $or: [{ 'kycDigilocker.status': { $exists: true } }, { 'selfie.status': { $in: ['review', 'passed'] } }] }),
    AmlAlert.countDocuments({ status: 'OPEN' }),
    SupportThread.countDocuments({ status: 'open', lastFrom: 'customer' }),
    ChangeRequest.countDocuments({ status: 'pending' }),
  ]);
  return [
    { key: 'decide', label: 'Loan applications waiting for a decision', count: toDecide, href: 'loan-management.html' },
    { key: 'disburse', label: 'Approved loans waiting for payout', count: toDisburse, href: 'loan-management.html' },
    { key: 'kyc', label: 'Customers waiting for a KYC review', count: kyc, href: 'compliance.html' },
    { key: 'aml', label: 'Open AML alerts', count: aml, href: 'compliance.html' },
    { key: 'support', label: 'Customer messages waiting for a reply', count: support, href: 'support.html' },
    { key: 'changes', label: 'Pricing or banner changes waiting for approval', count: changes, href: 'approvals.html' },
  ];
}

const fmtPct = n => (n === null ? 'new' : `${n > 0 ? '+' : ''}${n}%`);
const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;

function insights(cur, prev, health, targets, mtd) {
  const out = [];
  const d = change(cur.disbursedAmount, prev.disbursedAmount);
  if (cur.disbursedAmount || prev.disbursedAmount) out.push({ tone: d !== null && d < -10 ? 'warn' : 'good', text: `Money lent: ${inr(cur.disbursedAmount)} in this period (${fmtPct(d)} against the period before).` });
  if (cur.collectionEfficiency) out.push({ tone: targets.collectionEfficiencyPct && cur.collectionEfficiency < targets.collectionEfficiencyPct ? 'warn' : 'good', text: `Collection efficiency is ${cur.collectionEfficiency}% (${prev.collectionEfficiency}% before)${targets.collectionEfficiencyPct ? `, target ${targets.collectionEfficiencyPct}%` : ''}.` });
  if (health.par30 > 0) out.push({ tone: health.par30 >= 5 ? 'bad' : 'warn', text: `${health.par30}% of the money still owed is more than 30 days late; ${health.par90}% is more than 90 days late.` });
  const a = change(cur.applications, prev.applications);
  if (cur.applications || prev.applications) out.push({ tone: 'info', text: `${cur.applications} applications (${fmtPct(a)}); ${cur.approvalRate}% of decided applications were approved.` });
  if (targets.monthlyDisbursal) out.push({ tone: mtd.disbursedAmount >= mtd.expectedByNow ? 'good' : 'warn', text: `This month so far: ${inr(mtd.disbursedAmount)} lent against a monthly target of ${inr(targets.monthlyDisbursal)} (${pct(mtd.disbursedAmount, targets.monthlyDisbursal)}% reached, ${mtd.monthElapsedPct}% of the month gone).` });
  return out;
}

export async function dashboard(days = 30, now = new Date()) {
  days = [7, 30, 90, 365].includes(days) ? days : 30;
  const to = new Date(now), from = new Date(now - days * DAY), prevFrom = new Date(now - 2 * days * DAY);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const targets = getTargets();

  const [cur, prev, mtd, health, fun, mix, series, needs] = await Promise.all([
    figures(from, to), figures(prevFrom, from), figures(monthStart, to), bookHealth(now), funnel(from, to), mixes(from, to), trend(from, to, days), attention(),
  ]);
  const monthElapsedPct = pct(now - monthStart, nextMonth - monthStart);
  const monthly = { disbursedAmount: mtd.disbursedAmount, newCustomers: mtd.newCustomers, collectionEfficiency: mtd.collectionEfficiency, monthElapsedPct, expectedByNow: Math.round((targets.monthlyDisbursal * monthElapsedPct) / 100) };

  const kpi = (key, label, kind, field) => ({ key, label, kind, value: cur[field], previous: prev[field], change: change(cur[field] ?? 0, prev[field] ?? 0) });
  return {
    generatedAt: now, days, from, to,
    kpis: [
      kpi('disbursed', 'Money lent', 'money', 'disbursedAmount'),
      kpi('collected', 'Money collected', 'money', 'collected'),
      kpi('applications', 'Applications', 'number', 'applications'),
      kpi('customers', 'New customers', 'number', 'newCustomers'),
      kpi('approval', 'Approval rate', 'percent', 'approvalRate'),
      kpi('efficiency', 'Collection efficiency', 'percent', 'collectionEfficiency'),
      kpi('ticket', 'Average loan', 'money', 'averageTicket'),
      kpi('decision', 'Median time to decision (hours)', 'hours', 'medianDecisionHours'),
    ],
    book: health,
    funnel: fun,
    mix,
    trend: { grain: days <= 31 ? 'day' : 'week', rows: series },
    needsAttention: needs,
    targets,
    monthToDate: monthly,
    insights: insights(cur, prev, health, targets, monthly),
  };
}

export default { dashboard, getTargets, saveTargets };
