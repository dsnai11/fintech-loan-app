import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import User from '../models/User.js';
import { setupStatus } from './onboardingService.js';

// Reports on how the loan book behaves over time.
//   Vintage: loans grouped by the month they were paid out; how much of each group is late, month after month.
//   Roll rate: of the loans in each lateness bucket at one date, where were they at a later date.
//   Acquisition: where customers came from, and how far each source got.
// Lateness on any past date is rebuilt from the instalment schedule and the dates payments were made, so no daily snapshot is
// needed. Amounts are rupees of principal still owed.

const DAY = 864e5;
const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];
export const BUCKET_LABEL = { current: 'On time', '1-30': '1-30 days late', '31-60': '31-60 days late', '61-90': '61-90 days late', '90+': 'Over 90 days late', closed: 'Closed', written_off: 'Written off' };
const bucketOf = dpd => (dpd <= 0 ? 'current' : dpd <= 30 ? '1-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+');
const principal = e => e.principalAmount ?? e.amount ?? 0;
const addMonths = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; };
const endOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 1) - 1);

// A loan's position on a date: its lateness and what is still owed
export function positionAt(loan, emis, asof) {
  const t = +asof;
  if (loan.disbursementDate && +new Date(loan.disbursementDate) > t) return { state: 'not_yet' };
  if (loan.status === 'written_off' && loan.writtenOffAt && +new Date(loan.writtenOffAt) <= t) return { state: 'written_off', owed: 0 };
  if (loan.status === 'closed' && loan.closedAt && +new Date(loan.closedAt) <= t) return { state: 'closed', owed: 0 };
  const unpaid = emis.filter(e => {
    if (e.status === 'PAID') return +new Date(e.paidDate || e.dueDate) > t;
    if (e.status === 'WAIVED') return !(loan.closedAt && +new Date(loan.closedAt) <= t);
    return true;
  });
  const owed = unpaid.reduce((a, e) => a + principal(e), 0);
  const late = unpaid.filter(e => +new Date(e.dueDate) <= t).map(e => +new Date(e.dueDate));
  const dpd = late.length ? Math.max(0, Math.floor((t - Math.min(...late)) / DAY)) : 0;
  return { state: 'open', dpd, bucket: bucketOf(dpd), owed };
}

async function loadBook(since) {
  const loans = await Loan.find({ disbursementDate: { $gte: since } }).select('loanAmount status disbursementDate closedAt writtenOffAt closureType').limit(20000).lean();
  const emis = await EMIPayment.find({ loanId: { $in: loans.map(l => l._id) } }).select('loanId status dueDate paidDate principalAmount amount').lean();
  const by = new Map();
  for (const e of emis) { const k = String(e.loanId); if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return { loans, emisOf: l => by.get(String(l._id)) || [] };
}

// ── Vintage ────────────────────────────────────────────────────────────────────────────────────
export async function vintage({ months = 12, threshold = 30, now = new Date() } = {}) {
  const th = [30, 60, 90].includes(Number(threshold)) ? Number(threshold) : 30;
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const { loans, emisOf } = await loadBook(first);
  const cohorts = new Map();
  for (const l of loans) {
    const d = new Date(l.disbursementDate);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!cohorts.has(key)) cohorts.set(key, { month: key, y: d.getUTCFullYear(), m: d.getUTCMonth(), loans: [] });
    cohorts.get(key).loans.push(l);
  }
  const out = [];
  for (const c of [...cohorts.values()].sort((a, b) => a.month.localeCompare(b.month))) {
    const amount = c.loans.reduce((a, l) => a + l.loanAmount, 0);
    const cells = [];
    for (let k = 1; k <= 12; k++) {
      const asof = endOfMonth(c.y, c.m + k);
      if (asof > now) break;
      let late = 0;
      for (const l of c.loans) {
        const p = positionAt(l, emisOf(l), asof);
        if (p.state === 'open' && p.dpd >= th) late += p.owed;
        if (p.state === 'written_off') late += Math.max(0, (l.writtenOffAmount || 0));
      }
      cells.push({ mob: k, percent: amount ? Math.round((late / amount) * 1000) / 10 : 0, amount: Math.round(late) });
    }
    out.push({ month: c.month, loans: c.loans.length, disbursed: amount, cells });
  }
  return { threshold: th, months, cohorts: out };
}

// ── Roll rate ──────────────────────────────────────────────────────────────────────────────────
export async function rollRate({ from, to, now = new Date() } = {}) {
  const B = to ? new Date(`${to}T23:59:59.999Z`) : now;
  const A = from ? new Date(`${from}T23:59:59.999Z`) : new Date(+B - 30 * DAY);
  const { loans, emisOf } = await loadBook(new Date(+A - 400 * DAY));
  const cols = [...BUCKETS, 'closed', 'written_off'];
  const matrix = Object.fromEntries(BUCKETS.map(b => [b, Object.fromEntries(cols.map(c => [c, { loans: 0, amount: 0 }]))]));
  for (const l of loans) {
    const emis = emisOf(l);
    const a = positionAt(l, emis, A);
    if (a.state !== 'open') continue;
    const b = positionAt(l, emis, B);
    const to_ = b.state === 'open' ? b.bucket : b.state === 'not_yet' ? 'current' : b.state;
    const cell = matrix[a.bucket][to_];
    cell.loans++; cell.amount += a.owed;
  }
  const order = [...BUCKETS];
  const rows = BUCKETS.map(b => {
    const r = matrix[b];
    const total = cols.reduce((a, c) => a + r[c].loans, 0), totalAmt = cols.reduce((a, c) => a + r[c].amount, 0);
    const worse = cols.filter(c => (order.indexOf(c) > order.indexOf(b)) || c === 'written_off').reduce((a, c) => a + r[c].loans, 0);
    const worseAmt = cols.filter(c => (order.indexOf(c) > order.indexOf(b)) || c === 'written_off').reduce((a, c) => a + r[c].amount, 0);
    return { bucket: b, label: BUCKET_LABEL[b], loans: total, amount: Math.round(totalAmt), cells: cols.map(c => ({ to: c, label: BUCKET_LABEL[c], loans: r[c].loans, amount: Math.round(r[c].amount) })), rollPercent: total ? Math.round((worse / total) * 1000) / 10 : null, rollAmountPercent: totalAmt ? Math.round((worseAmt / totalAmt) * 1000) / 10 : null };
  });
  return { from: A.toISOString().slice(0, 10), to: B.toISOString().slice(0, 10), columns: cols.map(c => ({ key: c, label: BUCKET_LABEL[c] })), rows };
}

// ── Where customers came from ──────────────────────────────────────────────────────────────────
export async function acquisition({ from, to } = {}) {
  const start = from ? new Date(`${from}T00:00:00Z`) : new Date(Date.now() - 90 * DAY);
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  const users = await User.find({ role: 'customer', createdAt: { $gte: start, $lte: end } }).select('acquisition referredBy createdAt employment address dateOfBirth gender bankAccount selfie kycDigilocker').lean();
  const loans = await Loan.find({ userId: { $in: users.map(u => u._id) } }).select('userId status loanAmount').lean();
  const byUser = new Map();
  for (const l of loans) { const k = String(l.userId); if (!byUser.has(k)) byUser.set(k, []); byUser.get(k).push(l); }
  const rows = new Map();
  for (const u of users) {
    const a = u.acquisition || {};
    const source = a.source || (u.referredBy ? 'referral' : 'app');
    const key = `${source}|${a.campaign || ''}`;
    const r = rows.get(key) || { source, campaign: a.campaign || '', signups: 0, setupDone: 0, applied: 0, approved: 0, disbursed: 0, amount: 0, bad: 0 };
    r.signups++;
    if (setupStatus(u).complete) r.setupDone++;
    const ls = byUser.get(String(u._id)) || [];
    if (ls.length) r.applied++;
    if (ls.some(l => ['approved', 'disbursed', 'closed', 'defaulted', 'written_off'].includes(l.status))) r.approved++;
    const paid = ls.filter(l => ['disbursed', 'closed', 'defaulted', 'written_off'].includes(l.status));
    if (paid.length) { r.disbursed++; r.amount += paid.reduce((s, l) => s + l.loanAmount, 0); }
    if (ls.some(l => ['defaulted', 'written_off'].includes(l.status))) r.bad++;
    rows.set(key, r);
  }
  const list = [...rows.values()].map(r => ({ ...r, appliedPercent: r.signups ? Math.round((r.applied / r.signups) * 100) : 0, disbursedPercent: r.signups ? Math.round((r.disbursed / r.signups) * 100) : 0, badPercent: r.disbursed ? Math.round((r.bad / r.disbursed) * 100) : null })).sort((a, b) => b.signups - a.signups);
  const total = list.reduce((a, r) => ({ signups: a.signups + r.signups, applied: a.applied + r.applied, disbursed: a.disbursed + r.disbursed, amount: a.amount + r.amount }), { signups: 0, applied: 0, disbursed: 0, amount: 0 });
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), rows: list, total };
}

export default { vintage, rollRate, acquisition, positionAt };
