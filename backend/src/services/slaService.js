import SupportThread from '../models/SupportThread.js';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import CallbackRequest from '../models/CallbackRequest.js';
import DataRequest from '../models/DataRequest.js';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import SlaEscalation from '../models/SlaEscalation.js';
import { getConfig, setConfig } from './configService.js';
import { sendPlainEmail } from './notificationService.js';

// Service-level timers: how long things have been waiting for the team, against the targets the company sets.
// Each queue lists what is waiting, what is close to its limit and what is late. Late items are reported once to the
// managers' email address if one is set. The clock runs all day and night; the targets are the company's own promises.

const HOUR = 36e5;
const IST = 5.5 * HOUR;
export const QUEUES = {
  support: { label: 'Customer messages waiting for a reply', unit: 'hours', page: 'support.html', hint: 'From the customer\'s last message, once the assistant has handed over or is off.' },
  loanReview: { label: 'Loan applications waiting for a decision', unit: 'hours', page: 'loan-management.html', hint: 'From when the customer applied.' },
  kyc: { label: 'Identity and photo checks waiting', unit: 'hours', page: 'compliance.html', hint: 'From when the customer finished the step.' },
  payout: { label: 'Signed loans waiting for the money to be sent', unit: 'hours', page: 'loan-management.html', hint: 'From when the customer signed the agreement.' },
  callback: { label: 'Call-backs not made', unit: 'slot', page: 'callbacks.html', hint: 'Late once the time slot the customer chose has ended.' },
  requests: { label: 'Data requests not handled', unit: 'hours', page: 'compliance.html', hint: 'From when the customer asked (deleting their data).' },
};
export const DEFAULTS = { enabled: true, hours: { support: 4, loanReview: 24, kyc: 24, payout: 4, requests: 168 }, warnAtPercent: 75, alertEmail: '' };
const clone = o => JSON.parse(JSON.stringify(o));

export function getSettings() {
  try {
    const s = JSON.parse(getConfig('SLA_SETTINGS', '') || '{}');
    return { ...clone(DEFAULTS), ...s, hours: { ...DEFAULTS.hours, ...(s.hours || {}) } };
  } catch (e) {
    return clone(DEFAULTS);
  }
}

export function validateSettings(input) {
  const errors = [];
  const out = { enabled: input?.enabled !== false, hours: {}, warnAtPercent: Number(input?.warnAtPercent ?? DEFAULTS.warnAtPercent), alertEmail: String(input?.alertEmail ?? '').trim() };
  for (const k of Object.keys(DEFAULTS.hours)) {
    const n = Number(input?.hours?.[k] ?? DEFAULTS.hours[k]);
    if (!Number.isFinite(n) || n < 0.25 || n > 720) errors.push(`${QUEUES[k].label}: the target must be between 0.25 and 720 hours`);
    out.hours[k] = n;
  }
  if (!Number.isFinite(out.warnAtPercent) || out.warnAtPercent < 10 || out.warnAtPercent > 99) errors.push('"Close to the limit" must be between 10 and 99 percent');
  if (out.alertEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.alertEmail)) errors.push('The alert email address does not look right');
  return { errors, settings: out };
}

export async function saveSettings(input, by) {
  const { errors, settings } = validateSettings(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('SLA_SETTINGS', JSON.stringify(settings), { group: 'app', updatedBy: by });
  return { ok: true, settings };
}

const SLOT_END_HOUR = { morning: 13, afternoon: 16, evening: 19 }; // India time

// What is waiting right now: { kind, id, label, since, dueAt }
async function waiting(s, now) {
  const items = [];
  const add = (kind, id, label, since, dueAt) => items.push({ kind, id: String(id), label, since: new Date(since), dueAt: new Date(dueAt) });

  const threads = await SupportThread.find({ status: 'open', lastFrom: 'customer', 'bot.active': { $ne: true } }).select('subject userId lastMessageAt').lean();
  const names = Object.fromEntries((await User.find({ _id: { $in: threads.map(t => t.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  for (const t of threads) add('support', t._id, `${names[String(t.userId)] || 'Customer'}${t.subject ? ': ' + t.subject : ''}`, t.lastMessageAt, +new Date(t.lastMessageAt) + s.hours.support * HOUR);

  const loans = await Loan.find({ status: { $in: ['submitted', 'under_review'] } }).select('userId loanAmount createdAt').lean();
  const lnames = Object.fromEntries((await User.find({ _id: { $in: loans.map(l => l.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  for (const l of loans) add('loanReview', l._id, `${lnames[String(l.userId)] || 'Customer'}, Rs ${l.loanAmount.toLocaleString('en-IN')}`, l.createdAt, +new Date(l.createdAt) + s.hours.loanReview * HOUR);

  const kyc = await User.find({ role: 'customer', kycStatus: 'pending', $or: [{ 'kycDigilocker.status': 'review' }, { 'selfie.status': 'review' }] }).select('firstName lastName kycDigilocker selfie').lean();
  for (const u of kyc) {
    const since = Math.max(+new Date(u.kycDigilocker?.status === 'review' ? u.kycDigilocker.at : 0) || 0, +new Date(u.selfie?.status === 'review' ? u.selfie.capturedAt : 0) || 0) || now;
    add('kyc', u._id, `${u.firstName} ${u.lastName}`, since, since + s.hours.kyc * HOUR);
  }

  const approved = await Loan.find({ status: 'approved' }).select('userId loanAmount').lean();
  const signed = await AgreementAcceptance.find({ loanId: { $in: approved.map(l => l._id) } }).select('loanId acceptedAt').lean();
  const pn = Object.fromEntries((await User.find({ _id: { $in: approved.map(l => l.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  for (const a of signed) {
    const l = approved.find(x => String(x._id) === String(a.loanId));
    add('payout', l._id, `${pn[String(l.userId)] || 'Customer'}, Rs ${l.loanAmount.toLocaleString('en-IN')}`, a.acceptedAt, +new Date(a.acceptedAt) + s.hours.payout * HOUR);
  }

  const calls = await CallbackRequest.find({ status: 'open' }).select('userId day slot createdAt phone').lean();
  const cn = Object.fromEntries((await User.find({ _id: { $in: calls.map(c => c.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  for (const c of calls) {
    const created = new Date(+new Date(c.createdAt) + IST); // India clock
    const dayStart = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() + (c.day === 'tomorrow' ? 1 : 0));
    add('callback', c._id, `${cn[String(c.userId)] || 'Customer'}, ${c.day}, ${c.slot}`, c.createdAt, dayStart + (SLOT_END_HOUR[c.slot] || 19) * HOUR - IST);
  }

  for (const r of await DataRequest.find({ status: 'OPEN' }).select('userId createdAt').lean()) add('requests', r._id, 'Delete my data', r.createdAt, +new Date(r.createdAt) + s.hours.requests * HOUR);
  return items;
}

export async function report(now = new Date()) {
  const s = getSettings();
  const items = await waiting(s, now);
  const queues = Object.entries(QUEUES).map(([key, q]) => {
    const list = items.filter(i => i.kind === key).map(i => {
      const total = +i.dueAt - +i.since, used = +now - +i.since;
      const state = +now > +i.dueAt ? 'late' : total > 0 && used / total >= s.warnAtPercent / 100 ? 'soon' : 'ok';
      return { id: i.id, label: i.label, since: i.since, dueAt: i.dueAt, state, hoursOver: state === 'late' ? Math.round(((+now - +i.dueAt) / HOUR) * 10) / 10 : 0, waitingHours: Math.round((used / HOUR) * 10) / 10 };
    }).sort((a, b) => (b.state === 'late') - (a.state === 'late') || +new Date(a.dueAt) - +new Date(b.dueAt));
    return { key, label: q.label, hint: q.hint, page: q.page, target: q.unit === 'slot' ? 'end of the chosen slot' : `${s.hours[key]} h`, waiting: list.length, soon: list.filter(i => i.state === 'soon').length, late: list.filter(i => i.state === 'late').length, oldestHours: list.length ? Math.max(...list.map(i => i.waitingHours)) : 0, items: list.slice(0, 25) };
  });
  return { settings: s, asOf: now, queues, totals: { waiting: queues.reduce((a, q) => a + q.waiting, 0), soon: queues.reduce((a, q) => a + q.soon, 0), late: queues.reduce((a, q) => a + q.late, 0) } };
}

// Reports newly late items to the managers, once each. Returns how many were new.
export async function escalate(now = new Date()) {
  const s = getSettings();
  if (!s.enabled) return { newlyLate: 0 };
  const r = await report(now);
  const fresh = [];
  for (const q of r.queues) for (const i of q.items.filter(x => x.state === 'late')) {
    try { await SlaEscalation.create({ kind: q.key, itemId: i.id }); fresh.push({ q, i }); } catch (e) { /* already reported */ }
  }
  if (fresh.length && s.alertEmail) {
    const lines = fresh.map(({ q, i }) => `- ${q.label}: ${i.label} (${i.hoursOver} hours over)`).join('\n');
    const result = await sendPlainEmail(s.alertEmail, `${fresh.length} item(s) are late (LIFC service targets)`, `These items have passed their service target:\n\n${lines}\n\nOpen the SLA page in the portal for the full list.`);
    await SlaEscalation.updateMany({ $or: fresh.map(({ q, i }) => ({ kind: q.key, itemId: i.id })) }, { emailed: result });
  }
  return { newlyLate: fresh.length };
}

export default { report, escalate, getSettings, saveSettings, validateSettings, QUEUES };
