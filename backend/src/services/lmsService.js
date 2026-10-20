import Loan from '../models/Loan.js';
import User from '../models/User.js';
import EMIPayment from '../models/EMIPayment.js';
import LoanReceipt from '../models/LoanReceipt.js';
import Transaction from '../models/Transaction.js';
import { getPolicy } from './pricingPolicy.js';
import { getForeclosureQuote, executeForeclosure } from './foreclosureService.js';
import { markEMIPaid, isFlatInterest } from './emiService.js';
import { audit } from './auditService.js';
import { timelineFor } from './loanTimeline.js';

// Servicing a live loan: the account view, payments staff record (cash, UPI, bank transfer, cheque), reversing the last one,
// part-prepayment, and closing a loan early. Everything sits on top of the loan's instalments (EMIPayment rows).
//
// Rules in one place:
//  - A payment clears the oldest unpaid instalments first, each with its late fee. Whatever is left over is kept on the loan
//    as "paid in advance" and used by the next payment (or refunded if the loan closes).
//  - Paying instalments that are not yet due is allowed only when staff say so ("pay ahead").
//  - Only the most recent payment on a loan can be reversed, so the books always unwind in order.
//  - A flat-rate loan (all current plans) cannot be part-prepaid, because its interest is fixed. It is repaid by paying
//    instalments ahead, or closed early. Reducing-balance loans can be part-prepaid.
//  - Part-prepayment lowers the principal; the interest on the next instalment is worked out on the lower balance.

const DAY = 24 * 60 * 60 * 1000;
export const MODES = ['CASH', 'UPI', 'NEFT', 'CHEQUE', 'CARD', 'OTHER'];
export const ACTIVE = ['disbursed', 'defaulted'];
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
const MAX_AMOUNT = 1e7;

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const round = n => Math.round(n);
const receiptNo = () => `RCP-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

// ---------------------------------------------------------------------------------------------------------------------
// What a live loan looks like today
// ---------------------------------------------------------------------------------------------------------------------

// What is owed on one instalment right now: the instalment and its late fee
const dueOf = (emi, now) => emi.amount + (emi.dueDate < now ? emi.penaltyApplied || 0 : 0);
export const daysOver = (emi, now) => (emi.dueDate < now ? Math.floor((now - emi.dueDate) / DAY) : 0);

export function figuresFor(loan, emis, now = new Date()) {
  const unpaid = emis.filter(e => UNPAID.includes(e.status));
  const overdue = unpaid.filter(e => e.dueDate < now);
  const next = unpaid.filter(e => e.dueDate >= now)[0] || null;
  const paid = emis.filter(e => e.status === 'PAID');
  const dpd = overdue.length ? Math.max(...overdue.map(e => daysOver(e, now))) : 0;
  const closed = loan.status === 'closed';
  const advance = loan.advanceBalance || 0;
  return {
    principalOutstanding: unpaid.reduce((a, e) => a + (e.principalAmount || 0), 0),
    unpaidEmis: unpaid.length,
    paidEmis: paid.length,
    totalEmis: emis.filter(e => e.status !== 'WAIVED').length,
    overdueEmis: overdue.length,
    overdueAmount: overdue.reduce((a, e) => a + dueOf(e, now), 0),
    lateFeesOutstanding: overdue.reduce((a, e) => a + (e.penaltyApplied || 0), 0),
    dpd,
    nextDue: next ? { emiNumber: next.emiNumber, dueDate: next.dueDate, amount: next.amount } : null,
    totalPaid: round(paid.reduce((a, e) => a + (e.paidAmount || 0), 0)),
    advanceBalance: advance,
    refundDue: closed ? advance : 0,
    payableNow: overdue.reduce((a, e) => a + dueOf(e, now), 0),
  };
}

const scheduleView = (emis, now) => emis.map(e => ({
  emiNumber: e.emiNumber, dueDate: e.dueDate, amount: e.amount, principal: e.principalAmount || 0, interest: e.interestAmount || 0,
  lateFee: e.dueDate < now ? e.penaltyApplied || 0 : 0, status: e.status === 'PENDING' && e.dueDate < now ? 'OVERDUE' : e.status,
  daysOverdue: UNPAID.includes(e.status) ? daysOver(e, now) : 0, paidDate: e.paidDate || null, paidAmount: e.paidAmount ?? null,
  method: e.paymentMethod || null, gateway: e.paymentGateway || null, reference: e.transactionId || e.paymentId || null,
}));

export const receiptView = r => ({
  id: String(r._id), receiptNo: r.receiptNo, type: r.type, amount: r.amount, mode: r.mode, reference: r.reference || '', valueDate: r.valueDate,
  note: r.note || '', allocations: r.allocations || [], advanceBefore: r.advanceBefore, advanceAfter: r.advanceAfter, prepayment: r.prepayment || null,
  postedBy: r.postedBy, postedAt: r.createdAt, status: r.status, reversal: r.reversal || null,
});

// Plain-words lines for the "Transactions" list: disbursement, payments (by provider or by staff), late fees, closure
function statementLines(loan, emis, receipts, now) {
  const lines = [];
  if (loan.disbursementDate) lines.push({ date: loan.disbursementDate, kind: 'Paid out', text: 'Loan amount paid to the customer', debit: loan.disbursedAmount || loan.loanAmount, credit: 0 });
  const viaReceipt = new Set(receipts.filter(r => r.status === 'posted').flatMap(r => (r.allocations || []).map(a => a.emiNumber)));
  for (const e of emis) {
    if (e.status === 'PAID' && !viaReceipt.has(e.emiNumber) && e.paidDate) lines.push({ date: e.paidDate, kind: 'Payment', text: `Instalment ${e.emiNumber} paid (${(e.paymentGateway || '').toLowerCase() || 'online'}${e.paymentId ? ', ' + e.paymentId : ''})`, debit: 0, credit: round(e.paidAmount || e.amount) });
    if (e.status === 'WAIVED') lines.push({ date: e.updatedAt || e.dueDate, kind: 'Waived', text: `Instalment ${e.emiNumber} waived${e.notes ? ' (' + e.notes + ')' : ''}`, debit: 0, credit: 0 });
  }
  for (const r of receipts) {
    lines.push({ date: r.valueDate, kind: r.type === 'foreclosure' ? 'Closure' : r.type === 'prepayment' ? 'Prepayment' : 'Payment', text: `${r.receiptNo}, ${r.mode}${r.reference ? ' ' + r.reference : ''}${r.status === 'reversed' ? ' (reversed)' : ''}`, debit: 0, credit: r.status === 'reversed' ? 0 : r.amount, receipt: r.receiptNo });
    if (r.status === 'reversed' && r.reversal) lines.push({ date: r.reversal.at, kind: 'Reversal', text: `${r.receiptNo} reversed: ${r.reversal.reason}`, debit: r.amount, credit: 0 });
  }
  return lines.sort((a, b) => new Date(a.date) - new Date(b.date));
}

export async function accountView(loanId, now = new Date()) {
  const loan = await Loan.findById(loanId);
  if (!loan) return fail(404, 'Loan not found');
  const [user, emis, receipts] = await Promise.all([
    User.findById(loan.userId).select('firstName lastName phone email'),
    EMIPayment.find({ loanId }).sort({ emiNumber: 1 }),
    LoanReceipt.find({ loanId }).sort({ createdAt: -1 }),
  ]);
  const flat = isFlatInterest(loan, loan.monthlyEMI || 0) || loan.productKey === 'payday';
  const figures = figuresFor(loan, emis, now);
  let closeQuote = null;
  if (loan.status === 'disbursed' && figures.unpaidEmis) {
    try { closeQuote = (await getForeclosureQuote(loanId, now)).quote; } catch { /* not available */ }
  }
  const canPrepay = loan.status !== 'disbursed' ? { allowed: false, reason: 'Only a live loan that is not in default can be part-prepaid' }
    : flat ? { allowed: false, reason: 'This loan has a flat rate, so its interest is fixed. Take the money as a payment (pay ahead) or close the loan early.' }
      : figures.overdueEmis ? { allowed: false, reason: 'Clear the overdue instalments first' } : { allowed: true };
  return {
    ok: true,
    loan: {
      id: String(loan._id), status: loan.status, productKey: loan.productKey, amount: loan.loanAmount, tenure: loan.tenure, rate: loan.interestRate, emi: loan.monthlyEMI,
      flatRate: flat, disbursedAt: loan.disbursementDate || null, closedAt: loan.closedAt || null, closureType: loan.closureType || null, colending: !!loan.colending?.partnerId,
      stage: loan.collectionStage || null, assignedTo: loan.assignedTo || null,
    },
    customer: user ? { id: String(user._id), name: `${user.firstName} ${user.lastName}`, phone: user.phone, email: user.email } : null,
    figures, closeQuote, canPrepay,
    schedule: scheduleView(emis, now),
    receipts: receipts.map(receiptView),
    transactions: statementLines(loan, emis, receipts, now),
    timeline: (await timelineFor(loan).catch(() => ({ steps: [] }))).steps,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------------------------------------------------

function checkPayment(loan, input, now) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT || Math.round(amount * 100) !== amount * 100) return 'Enter the amount received, in rupees (up to 2 decimals)';
  if (!MODES.includes(input.mode)) return 'Choose how the money came in: cash, UPI, bank transfer, cheque, card or other';
  const reference = String(input.reference ?? '').trim();
  if (input.mode !== 'CASH' && reference.length < 4) return 'Enter the reference for this payment (UTR, cheque number or transaction id)';
  const valueDate = input.valueDate ? new Date(input.valueDate) : now;
  if (Number.isNaN(valueDate.getTime())) return 'The payment date is not a valid date';
  if (valueDate.getTime() > now.getTime() + DAY) return 'The payment date cannot be in the future';
  if (loan.disbursementDate && valueDate.getTime() < new Date(loan.disbursementDate).getTime() - DAY) return 'The payment date is before the loan was paid out';
  return null;
}

// Works out which instalments a payment would clear, without changing anything
function allocate(emis, available, now, payAhead) {
  const allocations = [];
  let left = available;
  for (const e of emis.filter(x => UNPAID.includes(x.status)).sort((a, b) => a.emiNumber - b.emiNumber)) {
    const isDue = e.dueDate.getTime() <= now.getTime() + DAY; // due today or earlier counts as due
    if (!isDue && !payAhead) break;
    const penalty = e.dueDate < now ? e.penaltyApplied || 0 : 0;
    const need = e.amount + penalty;
    if (left + 0.001 < need) break;
    allocations.push({ emiNumber: e.emiNumber, amount: e.amount, penalty, total: need, ahead: !isDue });
    left = Math.round((left - need) * 100) / 100;
  }
  return { allocations, left };
}

async function withLock(loanId, work) {
  const stale = new Date(Date.now() - 60000);
  const got = await Loan.findOneAndUpdate({ _id: loanId, $or: [{ postingLock: null }, { postingLock: { $lt: stale } }] }, { postingLock: new Date() }, { new: true });
  if (!got) return fail(409, 'Someone else is posting to this loan right now. Try again in a moment.');
  try { return await work(got); } finally { await Loan.updateOne({ _id: loanId }, { $unset: { postingLock: 1 } }); }
}

export async function postPayment(loanId, input, by, { dryRun = false, now = new Date(), req = null } = {}) {
  const loan0 = await Loan.findById(loanId);
  if (!loan0) return fail(404, 'Loan not found');
  if (!ACTIVE.includes(loan0.status)) return fail(409, 'Payments can only be recorded on a live loan');
  const problem = checkPayment(loan0, input, now);
  if (problem) return fail(400, problem);

  const run = async loan => {
    const amount = Number(input.amount);
    const reference = String(input.reference ?? '').trim();
    if (reference && await LoanReceipt.exists({ loanId, reference, status: 'posted' })) return fail(409, `Reference ${reference} was already recorded on this loan`);
    const emis = await EMIPayment.find({ loanId }).sort({ emiNumber: 1 });
    const advanceBefore = loan.advanceBalance || 0;
    const { allocations, left } = allocate(emis, amount + advanceBefore, now, input.payAhead === true);
    const advanceAfter = Math.round(left * 100) / 100;
    const summary = {
      amount, advanceBefore, advanceAfter, instalmentsCleared: allocations.length, allocations,
      closesLoan: allocations.length > 0 && emis.filter(e => UNPAID.includes(e.status)).length === allocations.length,
      toAdvance: advanceAfter,
    };
    if (dryRun) return { ok: true, preview: summary };
    if (!allocations.length && advanceAfter - advanceBefore < 0.01) return fail(409, 'This amount is not enough to clear an instalment, and there is nothing to keep in advance');

    const rec = await LoanReceipt.create({
      receiptNo: receiptNo(), loanId, userId: loan.userId, type: 'payment', amount, mode: input.mode, reference, valueDate: input.valueDate ? new Date(input.valueDate) : now,
      note: String(input.note ?? '').slice(0, 300), allocations, advanceBefore, advanceAfter, postedBy: by,
    });
    for (const a of allocations) {
      const emi = emis.find(e => e.emiNumber === a.emiNumber);
      await markEMIPaid(emi, rec.receiptNo, a.total);
      await EMIPayment.updateOne({ _id: emi._id }, { paymentMethod: input.mode, paymentGateway: 'MANUAL', transactionId: reference || rec.receiptNo, paidDate: rec.valueDate, notes: `Recorded by ${by}, receipt ${rec.receiptNo}` });
    }
    await Loan.updateOne({ _id: loanId }, { advanceBalance: advanceAfter });
    await Transaction.create({ loanId, userId: loan.userId, type: 'EMI_PAYMENT', amount, status: 'COMPLETED', paymentGateway: 'MANUAL', referenceId: reference || rec.receiptNo, metadata: { receiptNo: rec.receiptNo, mode: input.mode, postedBy: by } }).catch(() => {});
    await audit({ email: by, role: 'staff' }, 'LMS_PAYMENT_POSTED', { type: 'Loan', id: loanId }, { receiptNo: rec.receiptNo, amount, mode: input.mode, instalments: allocations.map(a => a.emiNumber), advanceAfter }, req);
    const closed = (await Loan.findById(loanId)).status === 'closed';
    return { ok: true, receipt: receiptView(rec), summary, closed };
  };
  if (dryRun) return run(loan0);
  return withLock(loanId, run);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reversing the most recent payment (a bounced cheque, a wrong amount, a wrong loan)
// ---------------------------------------------------------------------------------------------------------------------

export async function reversePayment(receiptId, reason, by, { now = new Date(), req = null } = {}) {
  const rec = await LoanReceipt.findById(receiptId);
  if (!rec) return fail(404, 'Receipt not found');
  if (rec.type !== 'payment') return fail(409, 'Only recorded payments can be reversed here. A part-prepayment or an early closure is changed by finance.');
  if (rec.status !== 'posted') return fail(409, 'This payment was already reversed');
  const why = String(reason ?? '').trim();
  if (why.length < 5) return fail(400, 'Write why it is being reversed (at least a few words)');
  const loan0 = await Loan.findById(rec.loanId);
  if (!loan0) return fail(404, 'Loan not found');
  if (loan0.colending?.partnerId) return fail(409, 'This loan is co-lent. Reversing a payment on it changes the partner bank\'s share, so ask finance to do it.');

  return withLock(rec.loanId, async loan => {
    const newer = await LoanReceipt.exists({ loanId: rec.loanId, status: 'posted', createdAt: { $gt: rec.createdAt } });
    if (newer) return fail(409, 'A later payment was recorded on this loan. Reverse the later one first, so the account unwinds in order.');
    const advance = Math.round(((loan.advanceBalance || 0) + rec.advanceBefore - rec.advanceAfter) * 100) / 100;
    if (advance < -0.01) return fail(409, 'The money from this payment has already been used. Ask finance.');
    for (const a of rec.allocations || []) {
      const emi = await EMIPayment.findOne({ loanId: rec.loanId, emiNumber: a.emiNumber });
      if (!emi) continue;
      const over = emi.dueDate < now;
      await EMIPayment.updateOne({ _id: emi._id }, {
        status: over ? 'OVERDUE' : 'PENDING', daysOverdue: over ? Math.floor((now - emi.dueDate) / DAY) : 0,
        $unset: { paidDate: 1, paidAmount: 1, paymentId: 1, transactionId: 1 }, notes: `Payment ${rec.receiptNo} reversed by ${by}: ${why}`.slice(0, 300),
      });
    }
    const update = { advanceBalance: Math.max(0, advance) };
    const reopen = loan.status === 'closed' && loan.closureType === 'repaid';
    const set = { ...update, ...(reopen ? { status: 'disbursed' } : {}) };
    await Loan.updateOne({ _id: rec.loanId }, { $set: set, ...(reopen ? { $unset: { closedAt: 1, closureType: 1, postingLock: 1 } } : {}) });
    rec.status = 'reversed';
    rec.reversal = { at: now, by, reason: why };
    await rec.save();
    await Transaction.updateMany({ loanId: rec.loanId, 'metadata.receiptNo': rec.receiptNo }, { status: 'REVERSED' }).catch(() => {});
    await audit({ email: by, role: 'staff' }, 'LMS_PAYMENT_REVERSED', { type: 'Loan', id: rec.loanId }, { receiptNo: rec.receiptNo, amount: rec.amount, reason: why, reopened: reopen }, req);
    return { ok: true, receipt: receiptView(rec), reopened: reopen };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Part-prepayment (reducing-balance loans only)
// ---------------------------------------------------------------------------------------------------------------------

export const prepayFeePercent = () => Number(process.env.LMS_PREPAY_FEE_PERCENT ?? getPolicy().foreclosureFeePercent ?? 0) || 0;

// Builds the new rows for the unpaid instalments. 'reduce_emi' keeps the number of instalments and lowers each one;
// 'reduce_tenure' keeps the instalment and ends the loan sooner.
export function rebuild(principal, ratePerYear, count, currentEmi, mode) {
  const r = ratePerYear / 12 / 100;
  const rows = [];
  let bal = principal;
  if (mode === 'reduce_emi') {
    const emi = r > 0 ? Math.ceil((bal * r) / (1 - Math.pow(1 + r, -count))) : Math.ceil(bal / count);
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      const interest = round(bal * r);
      const p = last ? bal : Math.min(bal, emi - interest);
      rows.push({ principal: p, interest: last ? Math.max(0, emi - p) : interest });
      bal -= p;
    }
  } else {
    if (currentEmi - round(bal * r) <= 0) return null;
    let guard = 0;
    while (bal > 0 && guard++ < 600) {
      const interest = round(bal * r);
      const p = Math.min(bal, currentEmi - interest);
      if (p <= 0) return null;
      rows.push({ principal: p, interest });
      bal -= p;
    }
  }
  return rows.map(x => ({ ...x, amount: x.principal + x.interest }));
}

export async function prepay(loanId, input, by, { dryRun = false, now = new Date(), req = null } = {}) {
  const loan0 = await Loan.findById(loanId);
  if (!loan0) return fail(404, 'Loan not found');
  if (loan0.status !== 'disbursed') return fail(409, 'Only a live loan that is not in default can be part-prepaid');
  if (isFlatInterest(loan0, loan0.monthlyEMI || 0) || loan0.productKey === 'payday') return fail(409, 'This loan has a flat rate, so its interest is fixed. Record the money as a payment (pay ahead), or close the loan early.');
  const mode = input.mode === 'reduce_emi' ? 'reduce_emi' : input.mode === 'reduce_tenure' ? 'reduce_tenure' : null;
  if (!mode) return fail(400, 'Choose whether the instalment or the number of instalments should come down');
  const problem = checkPayment(loan0, { ...input, mode: input.payMode }, now);
  if (problem) return fail(400, problem.replace('how the money came in', 'how the money came in (payment mode)'));

  const run = async loan => {
    const emis = await EMIPayment.find({ loanId }).sort({ emiNumber: 1 });
    const unpaid = emis.filter(e => UNPAID.includes(e.status));
    if (unpaid.some(e => e.dueDate < now)) return fail(409, 'Clear the overdue instalments first');
    if (unpaid.length < 2) return fail(409, 'Only one instalment is left. Take a payment or close the loan.');
    const amount = Number(input.amount);
    const feePct = prepayFeePercent();
    const principalCut = round(amount / (1 + feePct / 100));
    const fee = round(amount - principalCut);
    const principal = unpaid.reduce((a, e) => a + (e.principalAmount || 0), 0);
    const minimum = Number(process.env.LMS_MIN_PREPAY ?? 1000);
    if (amount < minimum) return fail(400, `The smallest part-prepayment is Rs ${minimum}`);
    if (principalCut >= principal) return fail(409, 'This is as much as is owed. Close the loan instead.');
    const newPrincipal = principal - principalCut;
    const currentEmi = unpaid[0].amount;
    const rows = rebuild(newPrincipal, loan.interestRate, unpaid.length, currentEmi, mode);
    if (!rows || !rows.length) return fail(409, 'The instalment is too small to cover the interest, so the tenure cannot be reduced this way. Choose to lower the instalment instead.');
    const preview = {
      amount, feePercent: feePct, fee, principalReduced: principalCut, principalBefore: principal, principalAfter: newPrincipal, mode,
      instalmentsBefore: unpaid.length, instalmentsAfter: rows.length, emiBefore: currentEmi, emiAfter: rows[0].amount,
      newLastDue: unpaid[Math.min(rows.length, unpaid.length) - 1].dueDate,
      interestBefore: unpaid.reduce((a, e) => a + (e.interestAmount || 0), 0), interestAfter: rows.reduce((a, x) => a + x.interest, 0),
    };
    if (dryRun) return { ok: true, preview };
    const reference = String(input.reference ?? '').trim();
    if (reference && await LoanReceipt.exists({ loanId, reference, status: 'posted' })) return fail(409, `Reference ${reference} was already recorded on this loan`);

    const rec = await LoanReceipt.create({ receiptNo: receiptNo(), loanId, userId: loan.userId, type: 'prepayment', amount, mode: input.payMode, reference, valueDate: input.valueDate ? new Date(input.valueDate) : now, note: String(input.note ?? '').slice(0, 300), prepayment: preview, advanceBefore: loan.advanceBalance || 0, advanceAfter: loan.advanceBalance || 0, postedBy: by });
    for (let i = 0; i < unpaid.length; i++) {
      if (i < rows.length) await EMIPayment.updateOne({ _id: unpaid[i]._id }, { amount: rows[i].amount, principalAmount: rows[i].principal, interestAmount: rows[i].interest, notes: `Re-worked after part-prepayment ${rec.receiptNo}` });
      else await EMIPayment.deleteOne({ _id: unpaid[i]._id });
    }
    await Loan.updateOne({ _id: loanId }, { monthlyEMI: rows[0].amount, tenure: emis.filter(e => e.status === 'PAID').length + rows.length });
    await Transaction.create({ loanId, userId: loan.userId, type: 'EMI_PAYMENT', amount, status: 'COMPLETED', paymentGateway: 'MANUAL', referenceId: reference || rec.receiptNo, metadata: { receiptNo: rec.receiptNo, kind: 'prepayment', postedBy: by } }).catch(() => {});
    await audit({ email: by, role: 'staff' }, 'LMS_PREPAYMENT', { type: 'Loan', id: loanId }, { receiptNo: rec.receiptNo, ...preview }, req);
    return { ok: true, receipt: receiptView(rec), preview };
  };
  if (dryRun) return run(loan0);
  return withLock(loanId, run);
}

// ---------------------------------------------------------------------------------------------------------------------
// Closing a loan early, recorded by staff
// ---------------------------------------------------------------------------------------------------------------------

export async function closeEarly(loanId, input, by, { dryRun = false, now = new Date(), req = null } = {}) {
  const loan0 = await Loan.findById(loanId);
  if (!loan0) return fail(404, 'Loan not found');
  if (loan0.status !== 'disbursed') return fail(409, 'Only a live loan that is not in default can be closed early here');
  let quoted;
  try { quoted = await getForeclosureQuote(loanId, now); } catch (e) { return fail(e.status || 400, e.message); }
  const quote = quoted.quote;
  const advance = loan0.advanceBalance || 0;
  const toCollect = Math.max(0, quote.total - advance);
  const received = Number(input.amount ?? 0);
  const info = { quote, advanceUsed: Math.min(advance, quote.total), toCollect, received, refundAfter: Math.max(0, Math.round((advance + received - quote.total) * 100) / 100) };
  if (dryRun) return { ok: true, preview: info };

  if (!Number.isFinite(received) || received < 0 || received > MAX_AMOUNT) return fail(400, 'Enter the amount received');
  if (received + 0.5 < toCollect) return fail(409, `The settlement is Rs ${quote.total}${advance ? ` and Rs ${advance} was paid in advance` : ''}, so Rs ${toCollect} must be received. ${received ? `Only Rs ${received} was entered.` : ''}`.trim(), { preview: info });
  if (toCollect > 0) {
    if (!MODES.includes(input.mode)) return fail(400, 'Choose how the money came in');
    const reference = String(input.reference ?? '').trim();
    if (input.mode !== 'CASH' && reference.length < 4) return fail(400, 'Enter the reference for this payment (UTR, cheque number or transaction id)');
  }
  return withLock(loanId, async loan => {
    const reference = String(input.reference ?? '').trim() || `STAFF-${Date.now()}`;
    const rec = await LoanReceipt.create({ receiptNo: receiptNo(), loanId, userId: loan.userId, type: 'foreclosure', amount: received, mode: MODES.includes(input.mode) ? input.mode : 'OTHER', reference, valueDate: input.valueDate ? new Date(input.valueDate) : now, note: String(input.note ?? '').slice(0, 300), prepayment: { settlement: quote.total, feePercent: quote.feePercent, fee: quote.fee, principal: quote.principal, advanceUsed: info.advanceUsed }, advanceBefore: advance, advanceAfter: info.refundAfter, postedBy: by });
    try {
      await executeForeclosure(loanId, quote.total, by, { gatewayPaid: true, paymentId: rec.receiptNo });
    } catch (e) {
      await LoanReceipt.deleteOne({ _id: rec._id });
      return fail(e.status || 500, e.message, e.quote ? { quote: e.quote } : {});
    }
    await Transaction.updateMany({ loanId, referenceId: rec.receiptNo }, { paymentGateway: 'MANUAL', 'metadata.initiatedBy': by, 'metadata.receiptNo': rec.receiptNo }).catch(() => {});
    await Loan.updateOne({ _id: loanId }, { advanceBalance: info.refundAfter });
    await audit({ email: by, role: 'staff' }, 'LMS_LOAN_CLOSED_EARLY', { type: 'Loan', id: loanId }, { receiptNo: rec.receiptNo, settlement: quote.total, received, refundAfter: info.refundAfter }, req);
    return { ok: true, receipt: receiptView(rec), refundDue: info.refundAfter };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The list of live loans, for the staff screen
// ---------------------------------------------------------------------------------------------------------------------

export const BUCKETS = { current: [0, 0], '1-30': [1, 30], '31-60': [31, 60], '61-90': [61, 90], '90+': [91, 100000] };
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function activeList({ q = '', bucket = '', status = '', page = 1, limit = 50, now = new Date() } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const pg = Math.max(1, Number(page) || 1);
  const where = { status: status && ACTIVE.includes(status) ? status : { $in: ACTIVE } };
  const term = String(q || '').trim();
  if (term) {
    if (/^[a-f0-9]{24}$/i.test(term)) where._id = term;
    else {
      const lead = new RegExp('^' + escRe(term), 'i');
      const users = await User.find(/^\d{3,}$/.test(term) ? { phone: new RegExp('^' + escRe(term)) } : term.includes('@') ? { email: new RegExp('^' + escRe(term.toLowerCase())) } : { $or: [{ firstName: lead }, { lastName: lead }] }).select('_id').limit(200).maxTimeMS(5000);
      where.userId = { $in: users.map(u => u._id) };
    }
  }
  // Days past due for every live loan with something overdue, so the bucket filter and the sort can use it
  const overdueRows = await EMIPayment.aggregate([{ $match: { status: { $in: ['OVERDUE', 'PENDING'] }, dueDate: { $lt: now } } }, { $group: { _id: '$loanId', oldest: { $min: '$dueDate' }, amount: { $sum: { $add: ['$amount', { $ifNull: ['$penaltyApplied', 0] }] } }, n: { $sum: 1 } } }]);
  const dpdOf = new Map(overdueRows.map(r => [String(r._id), { dpd: Math.floor((now - r.oldest) / DAY), amount: r.amount, n: r.n }]));
  if (bucket && BUCKETS[bucket]) {
    const [lo, hi] = BUCKETS[bucket];
    if (bucket === 'current') where._id = where._id || { $nin: [...dpdOf.keys()] };
    else { const ids = [...dpdOf.entries()].filter(([, v]) => v.dpd >= lo && v.dpd <= hi).map(([k]) => k); where._id = where._id ? { $in: ids.filter(i => i === String(where._id)) } : { $in: ids }; }
  }
  const [total, loans] = await Promise.all([
    Loan.countDocuments(where),
    Loan.find(where).sort({ disbursementDate: -1 }).skip((pg - 1) * lim).limit(lim).select('userId loanAmount tenure monthlyEMI status productKey disbursementDate nextEmiDate advanceBalance assignedTo').populate('userId', 'firstName lastName phone'),
  ]);
  const ids = loans.map(l => l._id);
  const open = await EMIPayment.aggregate([{ $match: { loanId: { $in: ids }, status: { $in: UNPAID } } }, { $group: { _id: '$loanId', principal: { $sum: '$principalAmount' }, n: { $sum: 1 }, next: { $min: '$dueDate' } } }]);
  const openOf = new Map(open.map(r => [String(r._id), r]));
  return {
    total, page: pg, pages: Math.ceil(total / lim),
    loans: loans.map(l => {
      const o = openOf.get(String(l._id)) || {}, d = dpdOf.get(String(l._id)) || { dpd: 0, amount: 0, n: 0 };
      return { id: String(l._id), customer: l.userId ? `${l.userId.firstName} ${l.userId.lastName}` : '', phone: l.userId?.phone || '', product: l.productKey, amount: l.loanAmount, emi: l.monthlyEMI, status: l.status, disbursedAt: l.disbursementDate, principalOutstanding: o.principal || 0, unpaidEmis: o.n || 0, nextDue: o.next || null, dpd: d.dpd, overdueAmount: d.amount, overdueEmis: d.n, advance: l.advanceBalance || 0, assignedTo: l.assignedTo || null };
    }),
  };
}

export default { accountView, postPayment, reversePayment, prepay, closeEarly, activeList, figuresFor, receiptView, rebuild, MODES, ACTIVE, BUCKETS };
