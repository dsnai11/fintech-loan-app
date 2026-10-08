import Loan from '../models/Loan.js';
import User from '../models/User.js';
import EMIPayment from '../models/EMIPayment.js';
import Mandate from '../models/Mandate.js';
import CollectionNote from '../models/CollectionNote.js';
import ReminderLog from '../models/ReminderLog.js';
import Settlement from '../models/Settlement.js';
import Transaction from '../models/Transaction.js';
import { getConfig, setConfig } from './configService.js';
import { notify } from './notificationService.js';
import { sendWhatsapp } from './whatsappService.js';
import { penaltyFor } from './foreclosureService.js';
import { audit } from './auditService.js';

// Automatic reminders around each due date, and one-time settlement offers.
//
// Reminders: for each customer's oldest unpaid instalment, the latest step whose day has come is sent once (in the app and
// as a push, and by SMS or WhatsApp where the step says so). Quiet hours, a daily limit per customer, a hold while a
// promise to pay is still running, and skipping the days-before reminders for customers on auto-debit all keep it polite.
// Message wording and whether WhatsApp may be used (it needs approved templates) are for the compliance team to confirm.

const DAY = 864e5;
const IST = 5.5 * 36e5;
const istDay = d => Math.floor((+new Date(d) + IST) / DAY); // calendar day in India
const istHour = d => new Date(+new Date(d) + IST).getUTCHours();
const inr = n => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
const dateText = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export const DEFAULTS = {
  enabled: false,
  quietStart: 21, quietEnd: 8, // no messages from 9 pm to 8 am, India time
  dailyCap: 2, // most reminders one customer gets in a day
  holdOnPromise: true, // stay quiet while a promise to pay is still running
  skipBeforeDueOnAutoDebit: true, // customers on auto-debit already get their own notice
  steps: [
    { id: 'before3', offset: -3, title: 'EMI due in 3 days', message: 'Hi {name}, your EMI of {amount} is due on {date}. Keep your account topped up or pay in the app.', sms: false, whatsapp: false },
    { id: 'before1', offset: -1, title: 'EMI due tomorrow', message: 'Hi {name}, your EMI of {amount} is due tomorrow ({date}). Pay in the app to stay on track.', sms: true, whatsapp: false },
    { id: 'after1', offset: 1, title: 'EMI missed', message: 'Hi {name}, your EMI of {amount} was due on {date} and has not been received. Please pay now to avoid late fees.', sms: true, whatsapp: false },
    { id: 'after3', offset: 3, title: 'EMI overdue', message: 'Hi {name}, your EMI of {amount} is {days} days overdue. Please pay in the app today. If something is wrong, tell us in Messages.', sms: true, whatsapp: false },
    { id: 'after7', offset: 7, title: 'EMI overdue for a week', message: 'Hi {name}, {amount} is now {days} days overdue and late fees are building up. Please pay today, or tell us in the app if you need help.', sms: true, whatsapp: false },
    { id: 'after15', offset: 15, title: 'Please contact us', message: 'Hi {name}, {amount} is {days} days overdue. Please pay or talk to us today so we can help find a way to sort it out.', sms: true, whatsapp: false },
  ],
  settlement: { enabled: false, minDaysOverdue: 60, maxWaiverPercent: 25, validDays: 7 },
};

const clone = o => JSON.parse(JSON.stringify(o));
export function getSettings() {
  try {
    const saved = JSON.parse(getConfig('COLLECTIONS_AUTOMATION', '') || '{}');
    return { ...clone(DEFAULTS), ...saved, steps: Array.isArray(saved.steps) ? saved.steps : clone(DEFAULTS.steps), settlement: { ...DEFAULTS.settlement, ...(saved.settlement || {}) } };
  } catch (e) {
    return clone(DEFAULTS);
  }
}

export function validateSettings(input) {
  const errors = [];
  const out = clone(DEFAULTS);
  const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number between ${min} and ${max}`); return undefined; }
    return n;
  };
  out.enabled = input?.enabled === true;
  out.quietStart = int(input?.quietStart ?? DEFAULTS.quietStart, 0, 23, 'Quiet hours start');
  out.quietEnd = int(input?.quietEnd ?? DEFAULTS.quietEnd, 0, 23, 'Quiet hours end');
  out.dailyCap = int(input?.dailyCap ?? DEFAULTS.dailyCap, 1, 10, 'Most reminders a day');
  out.holdOnPromise = input?.holdOnPromise !== false;
  out.skipBeforeDueOnAutoDebit = input?.skipBeforeDueOnAutoDebit !== false;
  const steps = Array.isArray(input?.steps) ? input.steps : DEFAULTS.steps;
  if (steps.length < 1 || steps.length > 12) errors.push('Have between 1 and 12 reminder steps');
  out.steps = [];
  const seen = new Set();
  steps.slice(0, 12).forEach((s, i) => {
    const offset = int(s?.offset, -30, 365, `Step ${i + 1} day`);
    const title = String(s?.title ?? '').trim();
    const message = String(s?.message ?? '').trim();
    if (!title || title.length > 60) errors.push(`Step ${i + 1} needs a title of up to 60 characters`);
    if (!message || message.length > 300) errors.push(`Step ${i + 1} needs a message of up to 300 characters`);
    if (offset !== undefined && seen.has(offset)) errors.push(`Two steps are on the same day (${offset})`);
    seen.add(offset);
    out.steps.push({ id: `${offset < 0 ? 'before' : 'after'}${Math.abs(offset)}`, offset, title, message, sms: s?.sms === true, whatsapp: s?.whatsapp === true });
  });
  out.steps.sort((a, b) => a.offset - b.offset);
  const st = input?.settlement || {};
  out.settlement = {
    enabled: st.enabled === true,
    minDaysOverdue: int(st.minDaysOverdue ?? DEFAULTS.settlement.minDaysOverdue, 1, 1000, 'Days overdue before a settlement can be offered'),
    maxWaiverPercent: int(st.maxWaiverPercent ?? DEFAULTS.settlement.maxWaiverPercent, 1, 90, 'Largest waiver (percent)'),
    validDays: int(st.validDays ?? DEFAULTS.settlement.validDays, 1, 60, 'Days an offer stays open'),
  };
  return { errors, settings: out };
}

export async function saveSettings(input, by) {
  const { errors, settings } = validateSettings(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('COLLECTIONS_AUTOMATION', JSON.stringify(settings), { group: 'app', updatedBy: by });
  return { ok: true, settings };
}

export const render = (tpl, vars) => String(tpl).replace(/\{(name|amount|date|days)\}/g, (_, k) => vars[k] ?? '');
export const inQuietHours = (now, s) => {
  const h = istHour(now);
  return s.quietStart > s.quietEnd ? h >= s.quietStart || h < s.quietEnd : h >= s.quietStart && h < s.quietEnd;
};

// Sends whatever is due. Run often (every 30 minutes or so); it never sends the same step twice.
export async function runReminders(now = new Date()) {
  const s = getSettings();
  const out = { sent: 0, held: 0, capped: 0, quiet: false, skipped: 0 };
  if (!s.enabled) return { ...out, off: true };
  if (inQuietHours(now, s)) return { ...out, quiet: true };

  const loans = await Loan.find({ status: { $in: ['disbursed', 'defaulted'] } }).select('_id userId').lean();
  if (!loans.length) return out;
  const unpaid = await EMIPayment.find({ loanId: { $in: loans.map(l => l._id) }, status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] } }).sort({ dueDate: 1 });
  const first = new Map();
  for (const e of unpaid) if (!first.has(String(e.loanId))) first.set(String(e.loanId), e);

  const today = istDay(now);
  const startOfToday = new Date(today * DAY - IST);
  const onAutoDebit = new Set((await Mandate.find({ status: 'active' }).select('loanId').lean()).map(m => String(m.loanId)));
  const promises = new Map();
  if (s.holdOnPromise) {
    for (const n of await CollectionNote.find({ type: 'PROMISE_TO_PAY', promiseDate: { $ne: null } }).sort({ createdAt: -1 }).limit(2000).lean()) if (!promises.has(String(n.loanId))) promises.set(String(n.loanId), n);
  }
  const perUser = new Map();
  for (const l of await ReminderLog.aggregate([{ $match: { sentAt: { $gte: startOfToday } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }])) perUser.set(String(l._id), l.n);

  for (const emi of first.values()) {
    const daysFromDue = today - istDay(emi.dueDate);
    const step = [...s.steps].reverse().find(x => x.offset <= daysFromDue);
    if (!step) continue;
    if (await ReminderLog.exists({ emiId: emi._id, stepId: step.id })) continue;
    if (step.offset < 0 && s.skipBeforeDueOnAutoDebit && onAutoDebit.has(String(emi.loanId))) { out.skipped++; continue; }
    const promise = promises.get(String(emi.loanId));
    if (promise && istDay(promise.promiseDate) >= today) { out.held++; continue; }
    if ((perUser.get(String(emi.userId)) || 0) >= s.dailyCap) { out.capped++; continue; }

    const user = await User.findById(emi.userId).select('firstName phone email');
    if (!user) continue;
    const overdueNow = daysFromDue > 0;
    const owed = overdueNow ? emi.amount + penaltyFor(emi, now) : emi.amount;
    const message = render(step.message, { name: user.firstName, amount: inr(owed), date: dateText(emi.dueDate), days: Math.max(0, daysFromDue) });
    // Claim the step first so two overlapping runs cannot both send it
    try {
      await ReminderLog.create({ emiId: emi._id, loanId: emi.loanId, userId: emi.userId, stepId: step.id, offsetDays: step.offset, results: {}, sentAt: now });
    } catch (e) { continue; }
    const results = { app: 'sent', sms: step.sms ? 'requested' : 'off', whatsapp: 'off' };
    await notify(emi.userId, { type: overdueNow ? 'EMI_OVERDUE' : 'EMI_REMINDER', title: step.title, message, loanId: emi.loanId }, { email: false, sms: step.sms });
    if (step.whatsapp) results.whatsapp = await sendWhatsapp(user, message);
    await ReminderLog.updateOne({ emiId: emi._id, stepId: step.id }, { results });
    perUser.set(String(emi.userId), (perUser.get(String(emi.userId)) || 0) + 1);
    out.sent++;
  }
  return out;
}

export async function reminderStats(days = 7) {
  const since = new Date(Date.now() - days * DAY);
  const rows = await ReminderLog.aggregate([{ $match: { sentAt: { $gte: since } } }, { $group: { _id: '$stepId', n: { $sum: 1 }, offset: { $first: '$offsetDays' } } }]);
  const recent = await ReminderLog.find({ sentAt: { $gte: since } }).sort({ sentAt: -1 }).limit(30).lean();
  const users = await User.find({ _id: { $in: recent.map(r => r.userId) } }).select('firstName lastName').lean();
  const name = Object.fromEntries(users.map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  return {
    days, total: rows.reduce((a, r) => a + r.n, 0),
    byStep: rows.sort((a, b) => a.offset - b.offset).map(r => ({ stepId: r._id, offset: r.offset, sent: r.n })),
    recent: recent.map(r => ({ customer: name[String(r.userId)] || '', stepId: r.stepId, offset: r.offsetDays, at: r.sentAt, results: r.results })),
  };
}

// ── Settlement offers ────────────────────────────────────────────────────────────────────────
const fail = (status, error) => ({ ok: false, status, error });

// What the customer would owe in full today: overdue instalments with late fees, plus the principal still to come
export async function fullDue(loan, now = new Date()) {
  const unpaid = await EMIPayment.find({ loanId: loan._id, status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] } }).sort({ emiNumber: 1 });
  const overdue = unpaid.filter(e => e.dueDate < now), future = unpaid.filter(e => e.dueDate >= now);
  const overdueTotal = overdue.reduce((a, e) => a + e.amount + penaltyFor(e, now), 0);
  const principal = future.reduce((a, e) => a + (e.principalAmount ?? e.amount), 0);
  const days = overdue.length ? Math.floor((now - overdue[0].dueDate) / DAY) : 0;
  return { total: Math.round(overdueTotal + principal), daysOverdue: days, unpaidCount: unpaid.length };
}

export async function createOffer({ loanId, waiverPercent, note }, by, { canExceed = false } = {}) {
  const s = getSettings();
  if (!s.settlement.enabled) return fail(409, 'Settlement offers are switched off.');
  const loan = await Loan.findById(loanId);
  if (!loan || !['disbursed', 'defaulted'].includes(loan.status)) return fail(404, 'No active loan found.');
  const w = Number(waiverPercent);
  if (!Number.isFinite(w) || w <= 0 || w > 90) return fail(400, 'The waiver must be between 1 and 90 percent.');
  if (w > s.settlement.maxWaiverPercent && !canExceed) return fail(403, `A waiver above ${s.settlement.maxWaiverPercent}% needs someone with settings access.`);
  const due = await fullDue(loan);
  if (!due.unpaidCount) return fail(409, 'Nothing is left to pay on this loan.');
  if (due.daysOverdue < s.settlement.minDaysOverdue) return fail(409, `A settlement can be offered once the loan is ${s.settlement.minDaysOverdue} days overdue. This one is ${due.daysOverdue}.`);
  if (await Settlement.exists({ loanId, status: { $in: ['offered', 'accepted'] }, validUntil: { $gt: new Date() } })) return fail(409, 'This loan already has an open offer.');
  const amount = Math.round((due.total * (100 - w)) / 100);
  const offer = await Settlement.create({ loanId, userId: loan.userId, originalDue: due.total, waiverPercent: w, amount, validUntil: new Date(Date.now() + s.settlement.validDays * DAY), createdBy: by, note: String(note || '').slice(0, 500) });
  await audit({ email: by, role: 'staff' }, 'SETTLEMENT_OFFERED', { type: 'Loan', id: loanId }, { amount, waiverPercent: w, originalDue: due.total }, null);
  await notify(loan.userId, { type: 'SETTLEMENT', title: 'A settlement offer for your loan', message: `You can close your loan by paying ${inr(amount)} instead of ${inr(due.total)}, if you accept by ${dateText(offer.validUntil)}. Open the app to see the offer.`, loanId }, { email: false, sms: true });
  return { ok: true, offer };
}

const live = o => ['offered', 'accepted'].includes(o.status) && o.validUntil > new Date();
export async function expireOffers() {
  const r = await Settlement.updateMany({ status: { $in: ['offered', 'accepted'] }, validUntil: { $lte: new Date() } }, { status: 'expired' });
  return r.modifiedCount || 0;
}

export async function offersFor(userId) {
  await expireOffers();
  return (await Settlement.find({ userId, status: { $in: ['offered', 'accepted'] } }).sort({ createdAt: -1 }).lean()).map(viewOffer);
}
export const viewOffer = o => ({ id: String(o._id), loanId: String(o.loanId), status: o.status, originalDue: o.originalDue, amount: o.amount, waiverPercent: o.waiverPercent, validUntil: o.validUntil, acceptedAt: o.acceptedAt || null });

export async function customerRespond(offerId, userId, accept) {
  const o = await Settlement.findOne({ _id: offerId, userId });
  if (!o) return fail(404, 'Offer not found.');
  if (!live(o) || o.status !== 'offered') return fail(409, o.status === 'accepted' ? 'You have already accepted this offer.' : 'This offer is no longer open.');
  o.status = accept ? 'accepted' : 'declined';
  if (accept) o.acceptedAt = new Date();
  await o.save();
  await audit({ email: String(userId), role: 'customer' }, accept ? 'SETTLEMENT_ACCEPTED' : 'SETTLEMENT_DECLINED', { type: 'Loan', id: o.loanId }, { amount: o.amount }, null);
  return { ok: true, offer: o };
}

export async function withdrawOffer(offerId, by) {
  const o = await Settlement.findById(offerId);
  if (!o) return fail(404, 'Offer not found.');
  if (!['offered', 'accepted'].includes(o.status)) return fail(409, `This offer is ${o.status}.`);
  o.status = 'withdrawn';
  await o.save();
  await audit({ email: by, role: 'staff' }, 'SETTLEMENT_WITHDRAWN', { type: 'Loan', id: o.loanId }, {}, null);
  return { ok: true, offer: o };
}

// Staff confirm the money has arrived (it is paid outside the app, to the company's account) and the loan is closed as settled
export async function recordPayment(offerId, { amount, reference }, by) {
  const o = await Settlement.findById(offerId);
  if (!o) return fail(404, 'Offer not found.');
  if (o.status !== 'accepted') return fail(409, o.status === 'offered' ? 'The customer has not accepted this offer yet.' : `This offer is ${o.status}.`);
  const ref = String(reference || '').trim();
  if (!ref || ref.length > 80) return fail(400, 'Enter the bank or UPI reference of the payment.');
  const paid = Number(amount);
  if (!Number.isFinite(paid) || paid + 1 < o.amount) return fail(400, `The amount received must be at least ${inr(o.amount)}.`);
  const now = new Date();
  const claimed = await Loan.findOneAndUpdate({ _id: o.loanId, status: { $in: ['disbursed', 'defaulted'] } }, { status: 'closed', closedAt: now, closureType: 'settlement' }, { new: true });
  if (!claimed) return fail(409, 'This loan is already closed.');
  await EMIPayment.updateMany({ loanId: o.loanId, status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] } }, { status: 'WAIVED', notes: `Settled for ${inr(paid)} (${ref})` });
  await Transaction.create({ loanId: o.loanId, userId: o.userId, type: 'EMI_PAYMENT', amount: paid, status: 'COMPLETED', paymentGateway: 'MANUAL', referenceId: `SETTLEMENT-${ref}`, metadata: { settlement: true, offerId: String(o._id), recordedBy: by, completedAt: now } });
  o.status = 'paid'; o.paidAt = now; o.paidReference = ref; o.paidRecordedBy = by;
  await o.save();
  try { await (await import('./colendingService.js')).onSettlement(o.loanId, paid); } catch (e) { console.error('Co-lending entry failed:', e.message); }
  await CollectionNote.create({ loanId: o.loanId, userId: o.userId, type: 'RECOVERY', text: `Settled for ${inr(paid)} against ${inr(o.originalDue)} (${o.waiverPercent}% waived). Reference ${ref}.`, amount: paid, createdBy: by });
  await audit({ email: by, role: 'staff' }, 'SETTLEMENT_PAID', { type: 'Loan', id: o.loanId }, { amount: paid, waiverPercent: o.waiverPercent, reference: ref }, null);
  await notify(o.userId, { type: 'LOAN_CLOSED', title: 'Loan settled', message: `We received ${inr(paid)} and your loan has been closed as settled. Thank you.`, loanId: o.loanId }, { sms: true });
  return { ok: true, offer: o };
}

export async function listOffers(status) {
  await expireOffers();
  const rows = await Settlement.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: rows.map(r => r.userId) } }).select('firstName lastName phone').lean();
  const by = Object.fromEntries(users.map(u => [String(u._id), u]));
  return rows.map(r => ({ ...viewOffer(r), customer: by[String(r.userId)] ? `${by[String(r.userId)].firstName} ${by[String(r.userId)].lastName}`.trim() : '', phone: by[String(r.userId)]?.phone || '', createdBy: r.createdBy, at: r.createdAt, paidReference: r.paidReference || null, note: r.note || '' }));
}

export default { getSettings, saveSettings, validateSettings, runReminders, reminderStats, createOffer, offersFor, customerRespond, withdrawOffer, recordPayment, listOffers, expireOffers, fullDue };
