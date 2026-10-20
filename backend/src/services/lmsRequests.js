import crypto from 'crypto';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import LoanServiceRequest from '../models/LoanServiceRequest.js';
import ReminderLog from '../models/ReminderLog.js';
import MandateDebit from '../models/MandateDebit.js';
import { getConfig, setConfig } from './configService.js';
import { audit } from './auditService.js';
import { notify } from './notificationService.js';
import { nearestOnDay } from './dateChange.js';
import { rebuild, withLock, ACTIVE, TYPE_LABEL, requestView } from './lmsService.js';

// Changes to a live loan that a second person approves: waive late fees, move the due day, add months, pause instalments,
// restructure. A request is checked and described when it is made, approved or rejected by someone else, and checked again
// at the moment of approval, so a loan that has changed in the meantime (a payment, another change) is never altered by a stale request.
//
// Two-person approval is on by default. The super admin can switch it off (then a request is applied at once, and still logged).
// Co-lent loans and payday advances can only have late fees waived: the other changes would alter a partner bank's share, or
// do not fit a one-instalment loan.

const DAY = 864e5;
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
export const TYPES = ['waiver', 'date_change', 'extension', 'moratorium', 'restructure'];
const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const round = n => Math.round(n);
const inr = n => `Rs ${Math.round((n || 0) * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dateText = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export const fourEyes = () => getConfig('LMS_FOUR_EYES', '') !== 'false';
export async function setFourEyes(on, by) { await setConfig('LMS_FOUR_EYES', on ? 'true' : 'false', { group: 'app', updatedBy: by }); return on; }

const addMonths = (d, k) => {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + k);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
};

// A fingerprint of what could still change: the unpaid instalments, and the loan's state
export function fingerprint(loan, emis) {
  const rows = emis.filter(e => UNPAID.includes(e.status)).map(e => [e.emiNumber, new Date(e.dueDate).toISOString(), e.amount, e.principalAmount, e.interestAmount, e.penaltyApplied || 0, e.status]);
  return crypto.createHash('sha1').update(JSON.stringify([loan.status, loan.tenure, loan.monthlyEMI, loan.interestRate, rows])).digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------------
// Working out each kind of change. Each returns { ok, summary: [lines], run } where run() does it. Nothing here writes
// until run() is called.
// ---------------------------------------------------------------------------------------------------------------------

function basics(loan, emis, type, now) {
  if (!ACTIVE.includes(loan.status)) return fail(409, 'Only a live loan can be changed');
  const unpaid = emis.filter(e => UNPAID.includes(e.status)).sort((a, b) => a.emiNumber - b.emiNumber);
  if (!unpaid.length) return fail(409, 'There is nothing left to pay on this loan');
  if (type !== 'waiver') {
    if (loan.productKey === 'payday') return fail(409, 'A payday advance is repaid in one go, so only its late fees can be waived');
    if (loan.colending?.partnerId) return fail(409, 'This loan is co-lent. Changing its schedule changes the partner bank\'s share, so ask finance.');
  }
  return { ok: true, unpaid, overdue: unpaid.filter(e => e.dueDate < now) };
}

const planners = {
  waiver(loan, emis, p, now, b) {
    const withFees = b.overdue.filter(e => (e.penaltyApplied || 0) > 0);
    let items;
    if (Array.isArray(p.items) && p.items.length) {
      items = [];
      for (const it of p.items) {
        const e = withFees.find(x => x.emiNumber === Number(it.emiNumber));
        const amount = Number(it.amount);
        if (!e) return fail(400, `Instalment ${it.emiNumber} has no late fee to waive`);
        if (!Number.isFinite(amount) || amount <= 0 || amount > e.penaltyApplied + 0.001) return fail(400, `The late fee on instalment ${e.emiNumber} is ${inr(e.penaltyApplied)}, so you can waive at most that`);
        items.push({ emiNumber: e.emiNumber, amount: Math.round(amount * 100) / 100 });
      }
    } else items = withFees.map(e => ({ emiNumber: e.emiNumber, amount: e.penaltyApplied }));
    if (!items.length) return fail(409, 'There are no late fees to waive on this loan');
    const total = items.reduce((a, i) => a + i.amount, 0);
    return {
      ok: true, total, summary: [...items.map(i => `Waive ${inr(i.amount)} late fee on instalment ${i.emiNumber}`), `Total waived: ${inr(total)}`],
      async run(by, requestId) {
        for (const i of items) {
          const e = emis.find(x => x.emiNumber === i.emiNumber);
          await EMIPayment.updateOne({ _id: e._id }, { $inc: { penaltyApplied: -i.amount, penaltyWaived: i.amount }, notes: `Late fee ${inr(i.amount)} waived by approval ${requestId}`.slice(0, 300) });
        }
        return { waived: total, items };
      },
      customerMessage: `We have waived ${inr(total)} of late fees on your loan.`,
    };
  },

  date_change(loan, emis, p, now, b) {
    const day = Number(p.day);
    if (!Number.isInteger(day) || day < 1 || day > 28) return fail(400, 'Choose a day between 1 and 28');
    if (b.overdue.length) return fail(409, 'Clear or restructure the overdue instalments first');
    const first = b.unpaid[0];
    const target = nearestOnDay(first.dueDate, day);
    const shift = Math.round((target - new Date(first.dueDate)) / DAY);
    if (shift === 0) return fail(409, 'The instalments are already due on that day');
    if (target <= now) return fail(409, 'That date has already passed. Choose a later day');
    const dates = b.unpaid.map((e, i) => { const d = new Date(target); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + i); d.setUTCDate(day); return d; });
    return {
      ok: true, summary: [`Move ${b.unpaid.length} remaining instalment${b.unpaid.length === 1 ? '' : 's'} to day ${day} of the month`, `Next one: ${dateText(first.dueDate)} to ${dateText(target)} (${Math.abs(shift)} days ${shift > 0 ? 'later' : 'earlier'})`, `Last one: ${dateText(dates[dates.length - 1])}`],
      async run(by) {
        for (let i = 0; i < b.unpaid.length; i++) await EMIPayment.updateOne({ _id: b.unpaid[i]._id }, { dueDate: dates[i] });
        await Loan.updateOne({ _id: loan._id }, { $push: { dateChanges: { at: now, fromDay: new Date(first.dueDate).getUTCDate(), toDay: day, shiftDays: shift, by, staff: true } }, nextEmiDate: target });
        await resetNotices(loan._id, b.unpaid.map(e => e._id));
        return { day, nextDue: target };
      },
      customerMessage: `Your remaining EMIs are now due on day ${day} of each month. The next one is on ${dateText(target)}.`,
    };
  },

  extension(loan, emis, p, now, b) {
    const extra = Number(p.extraMonths);
    if (!Number.isInteger(extra) || extra < 1 || extra > 12) return fail(400, 'Add between 1 and 12 months');
    if (b.overdue.length) return fail(409, 'Clear or restructure the overdue instalments first');
    const principal = b.unpaid.reduce((a, e) => a + (e.principalAmount || 0), 0);
    const count = b.unpaid.length + extra;
    if (loan.tenure + extra > 60) return fail(409, 'The loan cannot run longer than 60 months in all');
    const rows = rebuild(principal, loan.interestRate, count, b.unpaid[0].amount, 'reduce_emi');
    if (!rows) return fail(409, 'These figures cannot be worked out');
    const last = b.unpaid[b.unpaid.length - 1];
    const interestBefore = b.unpaid.reduce((a, e) => a + (e.interestAmount || 0), 0), interestAfter = rows.reduce((a, x) => a + x.interest, 0);
    const maxNo = Math.max(...emis.map(e => e.emiNumber));
    return {
      ok: true, summary: [`Add ${extra} month${extra === 1 ? '' : 's'}: ${b.unpaid.length} instalments become ${count}`, `Each instalment: ${inr(b.unpaid[0].amount)} to ${inr(rows[0].amount)}`, `The balance is re-worked at ${loan.interestRate}% a year on the reducing principal, so the interest still to pay goes from ${inr(interestBefore)} to ${inr(interestAfter)}`, `New last due date: ${dateText(addMonths(last.dueDate, extra))}`],
      async run() {
        for (let i = 0; i < count; i++) {
          if (i < b.unpaid.length) await EMIPayment.updateOne({ _id: b.unpaid[i]._id }, { amount: rows[i].amount, principalAmount: rows[i].principal, interestAmount: rows[i].interest });
          else await EMIPayment.create({ loanId: loan._id, userId: loan.userId, emiNumber: maxNo + (i - b.unpaid.length) + 1, dueDate: addMonths(last.dueDate, i - b.unpaid.length + 1), amount: rows[i].amount, principalAmount: rows[i].principal, interestAmount: rows[i].interest, status: 'PENDING' });
        }
        await Loan.updateOne({ _id: loan._id }, { tenure: loan.tenure + extra, monthlyEMI: rows[0].amount });
        await resetNotices(loan._id, b.unpaid.map(e => e._id));
        return { instalments: count, emi: rows[0].amount, interestAfter };
      },
      customerMessage: `Your loan has been extended by ${extra} month${extra === 1 ? '' : 's'}. Your instalment is now ${inr(rows[0].amount)}.`,
    };
  },

  moratorium(loan, emis, p, now, b) {
    const months = Number(p.months);
    if (!Number.isInteger(months) || months < 1 || months > 6) return fail(400, 'Pause for between 1 and 6 months');
    if (b.overdue.length) return fail(409, 'Clear or restructure the overdue instalments first');
    const principal = b.unpaid.reduce((a, e) => a + (e.principalAmount || 0), 0);
    const extraInterest = p.chargeInterest === true ? round(principal * (loan.interestRate / 12 / 100) * months) : 0;
    const share = extraInterest ? Math.floor(extraInterest / b.unpaid.length) : 0;
    const rest = extraInterest - share * b.unpaid.length;
    return {
      ok: true, summary: [`Pause for ${months} month${months === 1 ? '' : 's'}: all ${b.unpaid.length} remaining instalments move ${months} month${months === 1 ? '' : 's'} later`, `Next one: ${dateText(b.unpaid[0].dueDate)} to ${dateText(addMonths(b.unpaid[0].dueDate, months))}`, extraInterest ? `Interest for the pause, ${inr(extraInterest)}, is added across the remaining instalments` : 'No interest is charged for the pause'],
      async run() {
        for (let i = 0; i < b.unpaid.length; i++) {
          const e = b.unpaid[i];
          const add = share + (i === b.unpaid.length - 1 ? rest : 0);
          await EMIPayment.updateOne({ _id: e._id }, { dueDate: addMonths(e.dueDate, months), ...(add ? { amount: e.amount + add, interestAmount: (e.interestAmount || 0) + add } : {}) });
        }
        await Loan.updateOne({ _id: loan._id }, { nextEmiDate: addMonths(b.unpaid[0].dueDate, months), $push: { dateChanges: { at: now, kind: 'moratorium', months, staff: true } } });
        await resetNotices(loan._id, b.unpaid.map(e => e._id));
        return { months, extraInterest };
      },
      customerMessage: `Your instalments have been paused for ${months} month${months === 1 ? '' : 's'}. The next one is due on ${dateText(addMonths(b.unpaid[0].dueDate, months))}.`,
    };
  },

  restructure(loan, emis, p, now, b) {
    const count = Number(p.instalments);
    if (!Number.isInteger(count) || count < 1 || count > 60) return fail(400, 'Choose between 1 and 60 instalments');
    const rate = p.annualRate === undefined || p.annualRate === null || p.annualRate === '' ? loan.interestRate : Number(p.annualRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 60) return fail(400, 'The yearly rate must be between 0 and 60');
    const first = new Date(p.firstDueDate);
    if (Number.isNaN(first.getTime())) return fail(400, 'Choose the first due date');
    if (first.getTime() < now.getTime() + 0) return fail(400, 'The first due date must be in the future');
    if (first.getTime() > now.getTime() + 120 * DAY) return fail(400, 'The first due date cannot be more than 120 days away');
    const fees = b.overdue.reduce((a, e) => a + (e.penaltyApplied || 0), 0);
    if (fees > 0 && p.waiveLateFees !== true) return fail(409, `There are ${inr(fees)} of late fees. Tick "waive the late fees" to restructure, or have them paid first`);
    const principal = b.unpaid.reduce((a, e) => a + (e.principalAmount || 0), 0);
    const arrears = b.overdue.reduce((a, e) => a + (e.interestAmount || 0), 0);
    const capitalise = p.capitaliseArrears !== false;
    const base = principal + (capitalise ? arrears : 0);
    const rows = rebuild(base, rate, count, b.unpaid[0].amount, 'reduce_emi');
    if (!rows) return fail(409, 'These figures cannot be worked out');
    const maxNo = Math.max(...emis.map(e => e.emiNumber));
    const keptCount = emis.filter(e => !UNPAID.includes(e.status)).length;
    const interestBefore = b.unpaid.reduce((a, e) => a + (e.interestAmount || 0), 0), interestAfter = rows.reduce((a, x) => a + x.interest, 0);
    return {
      ok: true, fees, summary: [
        `Replace ${b.unpaid.length} unpaid instalment${b.unpaid.length === 1 ? '' : 's'} (${b.overdue.length} overdue) with ${count} new ones`,
        `Principal ${inr(principal)}${capitalise && arrears ? ` plus ${inr(arrears)} of interest already billed on the overdue instalments = ${inr(base)}` : ''}`,
        `Rate ${loan.interestRate}%${rate !== loan.interestRate ? ` to ${rate}%` : ' (unchanged)'} a year, reducing balance`,
        `Each instalment ${inr(rows[0].amount)} (was ${inr(b.unpaid[0].amount)}), first due ${dateText(first)}, last due ${dateText(addMonths(first, count - 1))}`,
        `Interest still to pay: ${inr(interestBefore)} to ${inr(interestAfter)}`,
        fees ? `Late fees waived: ${inr(fees)}` : 'No late fees to waive',
        'The loan is marked as restructured. Compliance must confirm how a restructured account is classified and reported.',
      ],
      async run(by, requestId) {
        const snapshot = { instalmentsBefore: b.unpaid.length, principalBefore: principal, emiBefore: b.unpaid[0].amount, rateBefore: loan.interestRate, arrearsCapitalised: capitalise ? arrears : 0, feesWaived: fees };
        await EMIPayment.deleteMany({ _id: { $in: b.unpaid.map(e => e._id) } });
        for (let i = 0; i < count; i++) await EMIPayment.create({ loanId: loan._id, userId: loan.userId, emiNumber: maxNo + i + 1, dueDate: addMonths(first, i), amount: rows[i].amount, principalAmount: rows[i].principal, interestAmount: rows[i].interest, status: 'PENDING' });
        await Loan.updateOne({ _id: loan._id }, { status: 'disbursed', tenure: keptCount + count, monthlyEMI: rows[0].amount, interestRate: rate, nextEmiDate: first, restructure: { at: now, by, requestId: String(requestId), ...snapshot, instalmentsAfter: count, emiAfter: rows[0].amount, rateAfter: rate }, $unset: { collectionStage: 1, collectionStageSince: 1, assignedTo: 1, assignedAt: 1 } });
        await resetNotices(loan._id, b.unpaid.map(e => e._id));
        return { ...snapshot, instalmentsAfter: count, emiAfter: rows[0].amount, firstDue: first };
      },
      customerMessage: `Your loan has been restructured. You now pay ${inr(rows[0].amount)} a month for ${count} months, starting ${dateText(first)}.`,
    };
  },
};

async function resetNotices(loanId, emiIds) {
  await ReminderLog.deleteMany({ emiId: { $in: emiIds } }).catch(() => {});
  await MandateDebit.deleteMany({ loanId, status: 'notified' }).catch(() => {});
}

export function plan(type, payload, loan, emis, now = new Date()) {
  if (!TYPES.includes(type)) return fail(400, 'Choose what to change');
  const b = basics(loan, emis, type, now);
  if (!b.ok) return b;
  return planners[type](loan, emis, payload || {}, now, b);
}

// ---------------------------------------------------------------------------------------------------------------------
// Asking, approving, rejecting
// ---------------------------------------------------------------------------------------------------------------------

async function applyNow(loan, emis, req, by, now) {
  const pl = plan(req.type, req.payload, loan, emis, now);
  if (!pl.ok) return pl;
  const result = await pl.run(by, req._id, now);
  await audit({ email: by, role: 'staff' }, `LMS_${req.type.toUpperCase()}_APPLIED`, { type: 'Loan', id: loan._id }, { requestId: String(req._id), requestedBy: req.requestedBy, summary: req.summary, result }, null);
  await notify(loan.userId, { type: 'EMI_REMINDER', title: 'Your loan has been updated', message: pl.customerMessage, loanId: loan._id }, { sms: true }).catch(() => {});
  return { ok: true, result };
}

export async function createRequest(loanId, { type, payload, reason }, by, { dryRun = false, now = new Date() } = {}) {
  const loan = await Loan.findById(loanId);
  if (!loan) return fail(404, 'Loan not found');
  const emis = await EMIPayment.find({ loanId }).sort({ emiNumber: 1 });
  const pl = plan(type, payload, loan, emis, now);
  if (!pl.ok) return pl;
  if (dryRun) return { ok: true, preview: { type, typeLabel: TYPE_LABEL[type], summary: pl.summary, needsApproval: fourEyes() } };
  const why = String(reason ?? '').trim();
  if (why.length < 5) return fail(400, 'Write why this change is being made (at least a few words)');
  if (await LoanServiceRequest.exists({ loanId, status: 'pending', type })) return fail(409, 'A request of this kind is already waiting for approval on this loan');

  const req = await LoanServiceRequest.create({ loanId, userId: loan.userId, type, payload: payload || {}, reason: why.slice(0, 400), summary: pl.summary, baseHash: fingerprint(loan, emis), requestedBy: by, requestedAt: now });
  await audit({ email: by, role: 'staff' }, 'LMS_CHANGE_REQUESTED', { type: 'Loan', id: loanId }, { requestId: String(req._id), type, reason: why, summary: pl.summary }, null);
  if (fourEyes()) return { ok: true, request: requestView(req), applied: false };

  // Two-person approval is switched off: apply it straight away
  const done = await withLock(loanId, async lockedLoan => {
    const fresh = await EMIPayment.find({ loanId }).sort({ emiNumber: 1 });
    return applyNow(lockedLoan, fresh, req, by, now);
  });
  if (!done.ok) { req.status = 'failed'; req.result = { error: done.error }; await req.save(); return done; }
  req.status = 'approved'; req.autoApplied = true; req.decidedBy = by; req.decidedAt = now; req.decisionNote = 'Applied at once: two-person approval is switched off'; req.result = done.result;
  await req.save();
  return { ok: true, request: requestView(req), applied: true };
}

export async function decide(requestId, decision, note, by, { now = new Date() } = {}) {
  const req = await LoanServiceRequest.findById(requestId);
  if (!req) return fail(404, 'Request not found');
  if (req.status !== 'pending') return fail(409, `This request was already ${req.status}`);
  if (!['approve', 'reject'].includes(decision)) return fail(400, 'Choose approve or reject');
  const text = String(note ?? '').trim().slice(0, 300);
  if (decision === 'reject') {
    if (text.length < 3) return fail(400, 'Say why it is being rejected');
    req.status = 'rejected'; req.decidedBy = by; req.decidedAt = now; req.decisionNote = text;
    await req.save();
    await audit({ email: by, role: 'staff' }, 'LMS_CHANGE_REJECTED', { type: 'Loan', id: req.loanId }, { requestId: String(req._id), type: req.type, requestedBy: req.requestedBy, note: text }, null);
    return { ok: true, request: requestView(req) };
  }
  if (fourEyes() && req.requestedBy === by) return fail(403, 'A different person has to approve this. You cannot approve your own request.');

  const done = await withLock(req.loanId, async loan => {
    const emis = await EMIPayment.find({ loanId: req.loanId }).sort({ emiNumber: 1 });
    if (fingerprint(loan, emis) !== req.baseHash) return fail(409, 'The loan has changed since this was asked for (a payment or another change). Reject it and ask again with the new figures.');
    return applyNow(loan, emis, req, by, now);
  });
  if (!done.ok) {
    if (done.status === 409 && /changed since/.test(done.error)) { req.status = 'failed'; req.result = { error: done.error }; await req.save(); }
    return done;
  }
  req.status = 'approved'; req.decidedBy = by; req.decidedAt = now; req.decisionNote = text; req.result = done.result;
  await req.save();
  return { ok: true, request: requestView(req) };
}

export async function withdraw(requestId, by) {
  const req = await LoanServiceRequest.findById(requestId);
  if (!req) return fail(404, 'Request not found');
  if (req.status !== 'pending') return fail(409, `This request was already ${req.status}`);
  if (req.requestedBy !== by) return fail(403, 'Only the person who asked can withdraw it');
  req.status = 'withdrawn'; req.decidedBy = by; req.decidedAt = new Date();
  await req.save();
  await audit({ email: by, role: 'staff' }, 'LMS_CHANGE_WITHDRAWN', { type: 'Loan', id: req.loanId }, { requestId: String(req._id) }, null);
  return { ok: true, request: requestView(req) };
}

export async function listRequests({ status = '', loanId = '', limit = 100 } = {}) {
  const where = {};
  if (status) where.status = status;
  if (loanId) where.loanId = loanId;
  const list = await LoanServiceRequest.find(where).sort({ requestedAt: -1 }).limit(Math.min(200, limit)).populate('userId', 'firstName lastName phone');
  return list.map(r => ({ ...requestView(r), customer: r.userId ? `${r.userId.firstName} ${r.userId.lastName}` : '', phone: r.userId?.phone || '' }));
}

export { TYPE_LABEL, requestView };
export default { plan, createRequest, decide, withdraw, listRequests, requestView, fingerprint, fourEyes, setFourEyes, TYPES, TYPE_LABEL };
