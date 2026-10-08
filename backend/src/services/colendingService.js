import ColendingPartner from '../models/ColendingPartner.js';
import ColendingEntry from '../models/ColendingEntry.js';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import { audit } from './auditService.js';

// Co-lending: a partner bank funds a share of each loan with the company, and earns its own rate on that share.
//
// How the money is worked out (for the finance team to compare with the co-lending agreement):
//   - When a loan is paid out, the partner owes its share of the loan amount: "funding".
//   - When the customer pays an instalment, the partner is owed its share of the principal in that instalment, plus interest
//     on its share of the principal still owed, at the partner's rate: "remittance". The company keeps the rest of the
//     interest, and all fees and late fees.
//   - On early closure the partner is owed its share of the principal still owed; on a settlement, its share of the amount
//     received. Losses on write-off are shared as the agreement says, outside this system.
// RBI's co-lending directions set conditions (a minimum share the company keeps, an escrow account, disclosures to the
// customer, and more). Those, and the limits below, are for the compliance team to confirm against the current directions.

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const MAX_PARTNER_SHARE = 90; // the company keeps at least 10%: confirm against the current RBI directions

export function validatePartner(input) {
  const errors = [];
  const name = String(input?.name ?? '').trim();
  const share = Number(input?.partnerSharePercent), rate = Number(input?.partnerRatePercent);
  const min = Number(input?.minAmount ?? 0), max = Number(input?.maxAmount ?? 10000000), cap = Number(input?.monthlyCap ?? 0);
  if (!name || name.length > 80) errors.push('Enter the partner\'s name');
  if (!Number.isFinite(share) || share < 1 || share > MAX_PARTNER_SHARE) errors.push(`The partner\'s share must be between 1 and ${MAX_PARTNER_SHARE} percent, so the company keeps at least ${100 - MAX_PARTNER_SHARE}%`);
  if (!Number.isFinite(rate) || rate < 0 || rate > 60) errors.push('The partner\'s yearly rate must be between 0 and 60 percent');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) errors.push('The smallest loan cannot be above the largest');
  if (!Number.isFinite(cap) || cap < 0) errors.push('The monthly limit cannot be negative');
  return { errors, value: { name, partnerSharePercent: share, partnerRatePercent: rate, minAmount: min, maxAmount: max, monthlyCap: cap, active: input?.active !== false, note: String(input?.note ?? '').slice(0, 300) } };
}

async function usedThisMonth(partnerId, now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await ColendingEntry.aggregate([{ $match: { partnerId, kind: 'funding', createdAt: { $gte: start } } }, { $group: { _id: null, t: { $sum: '$total' } } }]);
  return rows[0]?.t || 0;
}

// Called when a loan is paid out: gives the loan to the first partner that can take it
export async function assign(loan, now = new Date()) {
  if (loan.colending?.partnerId) return null;
  const partners = await ColendingPartner.find({ active: true, minAmount: { $lte: loan.loanAmount }, maxAmount: { $gte: loan.loanAmount } }).sort({ createdAt: 1 });
  for (const p of partners) {
    const funding = r2((loan.loanAmount * p.partnerSharePercent) / 100);
    if (p.monthlyCap > 0 && (await usedThisMonth(p._id, now)) + funding > p.monthlyCap) continue;
    const colending = { partnerId: p._id, partnerName: p.name, partnerShare: p.partnerSharePercent, nbfcShare: 100 - p.partnerSharePercent, partnerRate: p.partnerRatePercent, funding };
    await Loan.updateOne({ _id: loan._id }, { colending });
    try {
      await ColendingEntry.create({ partnerId: p._id, loanId: loan._id, kind: 'funding', source: 'loan', principal: funding, total: funding });
    } catch (e) { return null; }
    await audit({ email: 'system', role: 'system' }, 'COLENDING_ASSIGNED', { type: 'Loan', id: loan._id }, { partner: p.name, share: p.partnerSharePercent, funding }, null);
    return colending;
  }
  return null;
}

// Called when an instalment is paid
export async function onEmiPaid(emiId) {
  const emi = await EMIPayment.findById(emiId).lean();
  if (!emi) return null;
  const loan = await Loan.findById(emi.loanId).select('colending').lean();
  const c = loan?.colending;
  if (!c?.partnerId) return null;
  const unpaidAfter = await EMIPayment.find({ loanId: emi.loanId, status: { $nin: ['PAID', 'WAIVED'] } }).select('principalAmount amount').lean();
  const principalBefore = unpaidAfter.reduce((a, e) => a + (e.principalAmount ?? e.amount), 0) + (emi.principalAmount ?? emi.amount);
  const principal = r2((c.partnerShare / 100) * (emi.principalAmount ?? emi.amount));
  const interest = r2(((c.partnerShare / 100) * principalBefore * (c.partnerRate / 100)) / 12);
  try {
    return await ColendingEntry.create({ partnerId: c.partnerId, loanId: emi.loanId, kind: 'remittance', emiNumber: emi.emiNumber, source: 'emi', principal, interest, total: r2(principal + interest) });
  } catch (e) { return null; }
}

// Early closure: the partner's share of the principal still owed, plus its interest to date
export async function onForeclosure(loanId, { principal }) {
  const loan = await Loan.findById(loanId).select('colending').lean();
  const c = loan?.colending;
  if (!c?.partnerId) return null;
  const pr = r2((c.partnerShare / 100) * (principal || 0));
  const it = r2(((c.partnerShare / 100) * (principal || 0) * (c.partnerRate / 100)) / 12);
  try {
    return await ColendingEntry.create({ partnerId: c.partnerId, loanId, kind: 'remittance', source: 'foreclosure', principal: pr, interest: it, total: r2(pr + it) });
  } catch (e) { return null; }
}

// A settlement: the partner's share of what was received
export async function onSettlement(loanId, received) {
  const loan = await Loan.findById(loanId).select('colending').lean();
  const c = loan?.colending;
  if (!c?.partnerId) return null;
  const total = r2((c.partnerShare / 100) * received);
  try {
    return await ColendingEntry.create({ partnerId: c.partnerId, loanId, kind: 'remittance', source: 'settlement', principal: total, interest: 0, total });
  } catch (e) { return null; }
}

export async function settle(id, reference, by) {
  const ref = String(reference || '').trim();
  if (!ref || ref.length > 80) return { ok: false, status: 400, error: 'Enter the bank reference.' };
  const e = await ColendingEntry.findOneAndUpdate({ _id: id, status: 'pending' }, { status: 'settled', settledAt: new Date(), settledBy: by, reference: ref }, { new: true });
  if (!e) return { ok: false, status: 409, error: 'That entry is already settled.' };
  await audit({ email: by, role: 'staff' }, 'COLENDING_SETTLED', { type: 'Loan', id: e.loanId }, { kind: e.kind, total: e.total, reference: ref }, null);
  return { ok: true, entry: e };
}

export async function overview() {
  const partners = await ColendingPartner.find({}).sort({ createdAt: 1 }).lean();
  const agg = await ColendingEntry.aggregate([{ $group: { _id: { p: '$partnerId', k: '$kind', s: '$status' }, n: { $sum: 1 }, total: { $sum: '$total' }, interest: { $sum: '$interest' } } }]);
  const loans = await Loan.aggregate([{ $match: { 'colending.partnerId': { $exists: true } } }, { $group: { _id: '$colending.partnerId', n: { $sum: 1 }, amount: { $sum: '$loanAmount' }, funding: { $sum: '$colending.funding' } } }]);
  const by = {};
  for (const a of agg) { const k = String(a._id.p); by[k] = by[k] || {}; by[k][`${a._id.k}_${a._id.s}`] = { n: a.n, total: r2(a.total), interest: r2(a.interest) }; }
  const lb = Object.fromEntries(loans.map(l => [String(l._id), l]));
  const zero = { n: 0, total: 0, interest: 0 };
  return partners.map(p => {
    const b = by[String(p._id)] || {};
    return {
      id: String(p._id), name: p.name, active: p.active, partnerSharePercent: p.partnerSharePercent, nbfcSharePercent: 100 - p.partnerSharePercent, partnerRatePercent: p.partnerRatePercent,
      minAmount: p.minAmount, maxAmount: p.maxAmount, monthlyCap: p.monthlyCap, note: p.note,
      loans: lb[String(p._id)]?.n || 0, loanAmount: r2(lb[String(p._id)]?.amount || 0), funding: r2(lb[String(p._id)]?.funding || 0),
      fundingPending: b.funding_pending || zero, fundingSettled: b.funding_settled || zero,
      remitPending: b.remittance_pending || zero, remitSettled: b.remittance_settled || zero,
    };
  });
}

export async function entries({ status, partnerId } = {}) {
  const q = {};
  if (['pending', 'settled'].includes(status)) q.status = status;
  if (partnerId) q.partnerId = partnerId;
  const rows = await ColendingEntry.find(q).sort({ createdAt: -1 }).limit(500).lean();
  const names = Object.fromEntries((await ColendingPartner.find({ _id: { $in: rows.map(r => r.partnerId) } }).select('name').lean()).map(p => [String(p._id), p.name]));
  return rows.map(r => ({ id: String(r._id), partner: names[String(r.partnerId)] || '', loanId: String(r.loanId), kind: r.kind, source: r.source, emiNumber: r.emiNumber || null, principal: r.principal, interest: r.interest, total: r.total, status: r.status, at: r.createdAt, settledAt: r.settledAt || null, reference: r.reference || null }));
}

export default { assign, onEmiPaid, onForeclosure, onSettlement, settle, overview, entries, validatePartner, MAX_PARTNER_SHARE };
