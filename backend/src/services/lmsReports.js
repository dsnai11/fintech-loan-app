import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import CollectionNote from '../models/CollectionNote.js';
import User from '../models/User.js';
import LoanServiceRequest from '../models/LoanServiceRequest.js';
import { classify } from './regulatoryService.js';

// Numbers for the LMS: the overview page, ageing with provisions, demand-collection-balance by month, agent performance
// and the write-off register. Provision rates come from the regulatory policy (editable there, and for finance to confirm).

const DAY = 864e5;
const round2 = n => Math.round((n || 0) * 100) / 100;
export const AGEING = [['current', 'Not late', 0, 0], ['1-30', '1 to 30 days', 1, 30], ['31-60', '31 to 60 days', 31, 60], ['61-90', '61 to 90 days', 61, 90], ['91-180', '91 to 180 days', 91, 180], ['181+', 'Over 180 days', 181, 1e9]];
const bucketOf = dpd => AGEING.find(([, , lo, hi]) => dpd >= lo && dpd <= hi)[0];

// ---------------------------------------------------------------------------------------------------------------------
export async function ageing(now = new Date()) {
  const c = await classify(now);
  const live = c.loans.filter(r => r.status !== 'written_off');
  const out = AGEING.map(([key, label]) => ({ key, label, loans: 0, outstanding: 0, overdue: 0, provision: 0, share: 0 }));
  const idx = Object.fromEntries(out.map((b, i) => [b.key, i]));
  for (const r of live) {
    const b = out[idx[bucketOf(r.dpd)]];
    b.loans++; b.outstanding += r.outstanding; b.overdue += r.overdueAmount; b.provision += r.provision;
  }
  const book = out.reduce((a, b) => a + b.outstanding, 0);
  for (const b of out) { b.outstanding = round2(b.outstanding); b.overdue = round2(b.overdue); b.provision = round2(b.provision); b.share = book ? round2((b.outstanding / book) * 100) : 0; }
  const written = c.loans.filter(r => r.status === 'written_off');
  return {
    asOf: now, buckets: out,
    totals: { loans: live.length, outstanding: round2(book), overdue: round2(out.reduce((a, b) => a + b.overdue, 0)), provision: round2(out.reduce((a, b) => a + b.provision, 0)), lateLoans: live.filter(r => r.dpd > 0).length, grossNpaPercent: c.totals.grossNpaPercent },
    classes: c.summary, writtenOff: { loans: written.length, outstanding: round2(written.reduce((a, r) => a + r.outstanding, 0)) },
    note: 'Provision rates are the starting values in the Regulatory settings. Finance and compliance must confirm them before the figures are used in the books.',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Demand, collection and balance by calendar month (UTC)
// ---------------------------------------------------------------------------------------------------------------------
export async function dcb({ months = 12, now = new Date() } = {}) {
  const n = Math.min(24, Math.max(1, Number(months) || 12));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const sameMonth = { $and: [{ $eq: ['$status', 'PAID'] }, { $eq: [{ $year: '$paidDate' }, { $year: '$dueDate' }] }, { $eq: [{ $month: '$paidDate' }, { $month: '$dueDate' }] }] };
  const paidAmt = { $ifNull: ['$paidAmount', '$amount'] };
  const [due, paid] = await Promise.all([
    EMIPayment.aggregate([
      { $match: { dueDate: { $gte: start, $lt: end }, status: { $ne: 'WAIVED' } } },
      { $group: { _id: { y: { $year: '$dueDate' }, m: { $month: '$dueDate' } }, demand: { $sum: '$amount' }, count: { $sum: 1 }, onTime: { $sum: { $cond: [sameMonth, paidAmt, 0] } }, onTimeCount: { $sum: { $cond: [sameMonth, 1, 0] } }, stillOpen: { $sum: { $cond: [{ $in: ['$status', ['PENDING', 'OVERDUE', 'FAILED']] }, '$amount', 0] } } } },
    ]),
    EMIPayment.aggregate([
      { $match: { status: 'PAID', paidDate: { $gte: start, $lt: end } } },
      { $group: { _id: { y: { $year: '$paidDate' }, m: { $month: '$paidDate' } }, collected: { $sum: paidAmt }, arrears: { $sum: { $cond: [{ $lt: ['$dueDate', { $dateFromParts: { year: { $year: '$paidDate' }, month: { $month: '$paidDate' }, day: 1 } }] }, paidAmt, 0] } } } },
    ]),
  ]);
  const dueOf = new Map(due.map(r => [`${r._id.y}-${r._id.m}`, r]));
  const paidOf = new Map(paid.map(r => [`${r._id.y}-${r._id.m}`, r]));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const a = dueOf.get(k) || {}, b = paidOf.get(k) || {};
    const demand = round2(a.demand || 0);
    rows.push({
      month: d.toISOString().slice(0, 7), demand, instalments: a.count || 0,
      collectedOnTime: round2(a.onTime || 0), onTimeCount: a.onTimeCount || 0, balance: round2(a.stillOpen || 0),
      collectedInMonth: round2(b.collected || 0), arrearsCollected: round2(b.arrears || 0),
      efficiencyPercent: demand ? round2(((a.onTime || 0) / demand) * 100) : null,
      overallEfficiencyPercent: demand ? round2(((b.collected || 0) / demand) * 100) : null,
    });
  }
  return { asOf: now, months: rows, note: 'Efficiency = collected in the same month as the instalment fell due, divided by the demand for that month. "Overall" counts everything collected in the month, including arrears.' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Collection agents
// ---------------------------------------------------------------------------------------------------------------------
export async function agentPerformance({ from, to, now = new Date() } = {}) {
  const end = to ? new Date(to) : now, begin = from ? new Date(from) : new Date(end.getTime() - 30 * DAY);
  const notes = await CollectionNote.find({ createdAt: { $gte: begin, $lte: end }, createdBy: { $ne: 'system' } }).select('createdBy type promiseDate promiseAmount amount loanId createdAt outcome').lean();
  const agents = new Map();
  const get = e => { if (!agents.has(e)) agents.set(e, { agent: e, calls: 0, connected: 0, promises: 0, promisesKept: 0, promisesBroken: 0, recovered: 0, assigned: 0, collectedOnAssigned: 0 }); return agents.get(e); };
  for (const note of notes) {
    const a = get(note.createdBy);
    if (note.type === 'CALL') { a.calls++; if (note.outcome === 'CONNECTED' || note.outcome === 'PROMISED') a.connected++; }
    if (note.type === 'PROMISE_TO_PAY' && note.promiseDate) {
      a.promises++;
      const open = await EMIPayment.countDocuments({ loanId: note.loanId, dueDate: { $lte: note.promiseDate }, status: { $nin: ['PAID', 'WAIVED'] } });
      if (open === 0) a.promisesKept++; else if (new Date(note.promiseDate) < now) a.promisesBroken++;
    }
    if (note.type === 'RECOVERY') a.recovered += note.amount || 0;
  }
  const assigned = await Loan.find({ assignedTo: { $exists: true, $ne: null }, status: { $in: ['disbursed', 'defaulted'] } }).select('assignedTo').lean();
  const byAgent = new Map();
  for (const l of assigned) { if (!byAgent.has(l.assignedTo)) byAgent.set(l.assignedTo, []); byAgent.get(l.assignedTo).push(l._id); }
  for (const [email, ids] of byAgent) {
    const a = get(email);
    a.assigned = ids.length;
    const s = await EMIPayment.aggregate([{ $match: { loanId: { $in: ids.slice(0, 5000) }, status: 'PAID', paidDate: { $gte: begin, $lte: end } } }, { $group: { _id: null, total: { $sum: { $ifNull: ['$paidAmount', '$amount'] } } } }]);
    a.collectedOnAssigned = round2(s[0]?.total || 0);
  }
  const list = [...agents.values()].map(a => ({ ...a, recovered: round2(a.recovered), keepRatePercent: a.promises ? round2((a.promisesKept / a.promises) * 100) : null })).sort((x, y) => y.collectedOnAssigned - x.collectedOnAssigned);
  return { from: begin, to: end, agents: list };
}

// ---------------------------------------------------------------------------------------------------------------------
export async function writeOffRegister() {
  const loans = await Loan.find({ status: 'written_off' }).sort({ writtenOffAt: -1 }).limit(500).populate('userId', 'firstName lastName phone');
  const rows = loans.map(l => ({ loanId: String(l._id), customer: l.userId ? `${l.userId.firstName} ${l.userId.lastName}` : '', phone: l.userId?.phone || '', writtenOffAt: l.writtenOffAt || null, writtenOffAmount: l.writtenOffAmount || 0, recovered: l.recoveredAmount || 0, stillToRecover: Math.max(0, (l.writtenOffAmount || 0) - (l.recoveredAmount || 0)), reason: l.writeOffReason || '' }));
  const sum = k => round2(rows.reduce((a, r) => a + r[k], 0));
  return { loans: rows, totals: { loans: rows.length, writtenOff: sum('writtenOffAmount'), recovered: sum('recovered'), stillToRecover: sum('stillToRecover'), recoveryPercent: sum('writtenOffAmount') ? round2((sum('recovered') / sum('writtenOffAmount')) * 100) : null } };
}

// ---------------------------------------------------------------------------------------------------------------------
// The overview page: the numbers someone running the book wants first
// ---------------------------------------------------------------------------------------------------------------------
export async function overview(now = new Date()) {
  const [age, d, pending] = await Promise.all([ageing(now), dcb({ months: 1, now }), LoanServiceRequest.countDocuments({ status: 'pending' })]);
  const lateIds = (await classify(now)).loans.filter(r => r.dpd > 0 && r.status !== 'written_off').map(r => r.loanId);
  const unassigned = lateIds.length ? await Loan.countDocuments({ _id: { $in: lateIds }, $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }] }) : 0;
  const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const notes = await CollectionNote.find({ type: 'PROMISE_TO_PAY', promiseDate: { $ne: null } }).sort({ createdAt: -1 }).limit(300).select('loanId promiseDate').lean();
  const latest = new Map();
  for (const n of notes) if (!latest.has(String(n.loanId))) latest.set(String(n.loanId), n);
  let dueToday = 0, broken = 0;
  for (const n of latest.values()) {
    const open = await EMIPayment.countDocuments({ loanId: n.loanId, dueDate: { $lte: n.promiseDate }, status: { $nin: ['PAID', 'WAIVED'] } });
    if (!open) continue;
    const day = new Date(n.promiseDate);
    if (day < startToday) broken++; else if (day < new Date(startToday.getTime() + DAY)) dueToday++;
  }
  const m = d.months[0] || {};
  return {
    asOf: now, liveLoans: age.totals.loans, outstanding: age.totals.outstanding, lateLoans: age.totals.lateLoans, overdueAmount: age.totals.overdue, grossNpaPercent: age.totals.grossNpaPercent, provision: age.totals.provision,
    thisMonth: { month: m.month, demand: m.demand || 0, collected: m.collectedInMonth || 0, efficiencyPercent: m.efficiencyPercent ?? null },
    pendingApprovals: pending, unassignedCases: unassigned, promisesDueToday: dueToday, promisesBroken: broken,
  };
}

export default { ageing, dcb, agentPerformance, writeOffRegister, overview, AGEING };
