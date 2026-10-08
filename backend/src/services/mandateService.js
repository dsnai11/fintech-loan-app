import Mandate from '../models/Mandate.js';
import MandateDebit from '../models/MandateDebit.js';
import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { getConfig } from './configService.js';
import { baseUrl } from './passwordReset.js';
import { notify } from './notificationService.js';
import { markEMIPaid } from './emiService.js';
import { audit } from './auditService.js';

// Automatic collection of EMIs (UPI AutoPay or a bank mandate).
//
// The customer gives their permission once, for one loan. Before each instalment is collected we tell them (at least a
// day ahead, as the rules for recurring payments expect). On the due date the money is collected and the instalment is
// marked paid. If a collection fails we tell the customer and try again, then leave it for the collections team.
//
// Providers:
//   - razorpay: Razorpay Subscriptions. Razorpay collects the fixed monthly amount itself and tells us by webhook.
//   - sandbox (test mode, outside production, when no provider is set): a stand-in approval page and simulated
//     collections, so the whole journey can be tried without any account or real money.
// In production with no provider the feature says it is not available.

const DAY = 864e5;
const NOTICE_HOURS = 24; // how long before a collection the customer must have been told
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_HOURS = 24;
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
const LIVE_STATES = ['pending_auth', 'active', 'paused'];

const rupees = n => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
const dateText = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const production = () => process.env.PAYMENT_MODE === 'PRODUCTION';

// ── Providers ────────────────────────────────────────────────────────────────────────────────
const rzpBase = () => getConfig('RAZORPAY_API_BASE') || 'https://api.razorpay.com/v1';
const rzpAuth = () => 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
async function rzp(path, body) {
  const res = await fetch(`${rzpBase()}${path}`, { method: 'POST', headers: { Authorization: rzpAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.description || `Razorpay answered ${res.status}`);
  return j;
}

export const PROVIDERS = {
  razorpay: {
    name: 'razorpay',
    autoCharges: true, // Razorpay collects each month by itself and tells us
    ready: () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    // One fixed amount each month, for as many equal instalments as there are in a row
    async create({ loan, mandate, emis }) {
      const unpaid = emis.filter(e => e.status !== 'PAID').sort((a, b) => a.emiNumber - b.emiNumber);
      if (!unpaid.length) throw new Error('This loan has nothing left to collect');
      const amount = unpaid[0].amount;
      let covers = 0;
      for (const e of unpaid) { if (Math.abs(e.amount - amount) < 1) covers++; else break; }
      const plan = await rzp('/plans', { period: 'monthly', interval: 1, item: { name: `LIFC EMI ${String(loan._id).slice(-6)}`, amount: Math.round(amount * 100), currency: 'INR' } });
      const startAt = Math.floor(new Date(unpaid[0].dueDate).getTime() / 1000);
      const sub = await rzp('/subscriptions', {
        plan_id: plan.id, total_count: covers, quantity: 1, customer_notify: 1,
        ...(startAt > Date.now() / 1000 + 600 ? { start_at: startAt } : {}),
        notes: { loanId: String(loan._id), mandateId: String(mandate._id) },
      });
      return { providerRef: sub.id, authUrl: sub.short_url, maxAmount: amount, covers };
    },
    async cancel({ mandate }) { if (mandate.providerRef) await rzp(`/subscriptions/${mandate.providerRef}/cancel`, { cancel_at_cycle_end: 0 }); },
  },

  sandbox: {
    name: 'sandbox',
    autoCharges: false,
    ready: () => true,
    async create({ mandate, emis }) {
      const top = Math.max(...emis.filter(e => e.status !== 'PAID').map(e => e.amount + (e.penaltyApplied || 0)), 0);
      return { providerRef: `sbx_${mandate._id}`, authUrl: `${baseUrl()}/api/mandates/sandbox/${mandate._id}`, maxAmount: Math.ceil(top * 1.25) };
    },
    async debit() {
      if (getConfig('MANDATE_SANDBOX_RESULT') === 'fail') return { status: 'failed', reason: 'The bank account did not have enough balance (test mode)' };
      return { status: 'success', providerRef: `sbx_pay_${Date.now()}_${Math.floor(Math.random() * 1e6)}` };
    },
    async cancel() {},
  },
};

export const providerName = () => getConfig('MANDATE_PROVIDER') || '';

// Which provider is in use right now, and how to describe it
export function availability() {
  const name = providerName();
  if (name && name !== 'razorpay') return { mode: 'misconfigured', provider: null, note: `"${name}" is not an auto-debit provider here. Choose razorpay.` };
  if (name === 'razorpay') return PROVIDERS.razorpay.ready() ? { mode: 'live', provider: PROVIDERS.razorpay } : { mode: 'misconfigured', provider: null, note: 'Razorpay is chosen but RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set in Railway.' };
  return production() ? { mode: 'unavailable', provider: null, note: 'No provider is set up, so customers cannot set up auto-debit.' } : { mode: 'test', provider: PROVIDERS.sandbox, note: 'Test mode: approval and collections are simulated. No real money moves.' };
}

// ── Setting one up ───────────────────────────────────────────────────────────────────────────
const fail = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) });

export async function startMandate(user, loanId, method = 'upi') {
  const a = availability();
  if (!a.provider) return fail(503, 'Auto-debit is not available right now.', 'UNAVAILABLE');
  if (!['upi', 'enach'].includes(method)) return fail(400, 'Choose UPI AutoPay or a bank mandate');
  const loan = await Loan.findOne({ _id: loanId, userId: user._id });
  if (!loan) return fail(404, 'Loan not found');
  if (!['disbursed', 'defaulted'].includes(loan.status)) return fail(409, 'Auto-debit can be set up once the loan has been paid out.');
  const emis = await EMIPayment.find({ loanId: loan._id }).lean();
  if (!emis.some(e => UNPAID.includes(e.status))) return fail(409, 'This loan has nothing left to collect.');
  const existing = await Mandate.findOne({ loanId: loan._id, status: { $in: LIVE_STATES } });
  if (existing) return fail(409, existing.status === 'pending_auth' ? 'You already started auto-debit for this loan. Finish approving it, or cancel it and start again.' : 'Auto-debit is already set up for this loan.', 'ALREADY');

  const mandate = new Mandate({ userId: user._id, loanId: loan._id, provider: a.provider.name, method, maxAmount: 1 });
  try {
    const made = await a.provider.create({ user, loan, mandate, emis });
    mandate.providerRef = made.providerRef;
    mandate.authUrl = made.authUrl;
    mandate.maxAmount = made.maxAmount;
    mandate.covers = made.covers;
  } catch (e) {
    return fail(502, `Could not start auto-debit: ${e.message}`);
  }
  await mandate.save();
  await audit({ email: user.email, role: 'customer' }, 'MANDATE_STARTED', { type: 'Mandate', id: mandate._id }, { loanId: String(loan._id), provider: mandate.provider, method }, null);
  return { ok: true, mandate, mode: a.mode };
}

export async function activate(mandate) {
  if (mandate.status === 'active') return mandate;
  mandate.status = 'active';
  mandate.activatedAt = new Date();
  await mandate.save();
  await notify(mandate.userId, { type: 'AUTOPAY', title: 'Auto-debit is on', message: 'Your EMIs for this loan will be collected automatically. We will tell you a day before each one.', loanId: mandate.loanId }, { sms: false });
  return mandate;
}

export async function cancelMandate(mandate, by, reason = '') {
  if (!LIVE_STATES.includes(mandate.status)) return mandate;
  try { await (PROVIDERS[mandate.provider] || PROVIDERS.sandbox).cancel({ mandate }); } catch (e) { console.error('Mandate cancel at provider failed:', e.message); }
  mandate.status = 'cancelled';
  mandate.cancelledAt = new Date();
  mandate.cancelledBy = by;
  if (reason) mandate.failedReason = reason;
  await mandate.save();
  return mandate;
}

// ── Collecting ───────────────────────────────────────────────────────────────────────────────
// Run often. Tells customers about collections coming up, makes the ones that are due, and retries the ones that failed.
export async function runAutoDebits(now = new Date()) {
  const out = { notified: 0, collected: 0, failed: 0, completed: 0 };
  const mandates = await Mandate.find({ status: 'active' });
  for (const m of mandates) {
    try {
      const emis = await EMIPayment.find({ loanId: m.loanId, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
      if (!emis.length) { m.status = 'completed'; await m.save(); out.completed++; continue; }
      const provider = PROVIDERS[m.provider];
      const emi = emis[0];
      const total = emi.amount + (emi.penaltyApplied || 0);
      let debit = await MandateDebit.findOne({ mandateId: m._id, emiNumber: emi.emiNumber });

      // 1. Tell the customer in advance
      if (!debit && new Date(emi.dueDate) - now <= 2 * DAY) {
        debit = await MandateDebit.create({ mandateId: m._id, loanId: m.loanId, userId: m.userId, emiNumber: emi.emiNumber, amount: total, dueDate: emi.dueDate, notifiedAt: now });
        await notify(m.userId, { type: 'AUTOPAY', title: 'EMI will be collected automatically', message: `${rupees(total)} for instalment ${emi.emiNumber} will be collected from your account on or after ${dateText(emi.dueDate)}. Keep enough balance. You can stop auto-debit in the app.`, loanId: m.loanId }, { sms: true });
        out.notified++;
      }
      if (!debit || provider.autoCharges) continue; // this provider collects by itself and tells us

      // 2. Collect on or after the due date, once the customer has had their notice, and not more than a few times
      const noticeDone = now - new Date(debit.notifiedAt) >= NOTICE_HOURS * 36e5;
      const retryOk = debit.status === 'failed' && debit.attempts < MAX_ATTEMPTS && (!debit.nextAttemptAt || now >= new Date(debit.nextAttemptAt));
      if (!((debit.status === 'notified') || retryOk) || new Date(emi.dueDate) > now || !noticeDone) continue;

      debit.attempts += 1;
      debit.lastAttemptAt = now;
      debit.amount = total;
      let r;
      try { r = await provider.debit({ mandate: m, emi, amount: total }); } catch (e) { r = { status: 'failed', reason: e.message }; }
      if (r.status === 'success') {
        await markEMIPaid(emi, r.providerRef, total);
        debit.status = 'success';
        debit.providerRef = r.providerRef;
        debit.failureReason = undefined;
        m.lastDebitAt = now;
        await debit.save();
        await m.save();
        out.collected++;
      } else {
        debit.status = 'failed';
        debit.failureReason = String(r.reason || 'The collection did not go through').slice(0, 200);
        debit.nextAttemptAt = new Date(now.getTime() + RETRY_AFTER_HOURS * 36e5);
        await debit.save();
        out.failed++;
        const last = debit.attempts >= MAX_ATTEMPTS;
        await notify(m.userId, { type: 'AUTOPAY', title: 'Auto-debit did not go through', message: `We could not collect ${rupees(total)} for instalment ${emi.emiNumber}. ${last ? 'Please pay it in the app now.' : 'We will try again tomorrow. You can also pay it in the app.'}`, loanId: m.loanId }, { sms: true });
      }
    } catch (e) {
      console.error('Auto-debit failed for mandate', String(m._id), e.message);
    }
  }
  return out;
}

// ── Razorpay tells us what happened ──────────────────────────────────────────────────────────
export async function handleSubscriptionEvent(event, payload) {
  const sub = payload?.subscription?.entity;
  if (!sub?.id) return { ignored: true, reason: 'no subscription' };
  const m = await Mandate.findOne({ providerRef: sub.id });
  if (!m) return { ignored: true, reason: 'unknown subscription' };

  if (event === 'subscription.authenticated' || event === 'subscription.activated') { await activate(m); return { status: 'active' }; }

  if (event === 'subscription.charged') {
    const pay = payload?.payment?.entity;
    if (!pay?.id) return { ignored: true, reason: 'no payment' };
    if (await MandateDebit.findOne({ providerRef: pay.id })) return { duplicate: true };
    const emi = await EMIPayment.findOne({ loanId: m.loanId, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
    if (!emi) return { ignored: true, reason: 'nothing to collect' };
    const paid = typeof pay.amount === 'number' ? pay.amount / 100 : emi.amount;
    if (paid + 1 < emi.amount) { console.error(`Mandate ${m._id}: collected ${paid}, expected at least ${emi.amount}. Not marking paid.`); return { success: false, reason: 'underpaid' }; }
    await markEMIPaid(emi, pay.id, paid);
    await MandateDebit.updateOne({ mandateId: m._id, emiNumber: emi.emiNumber }, { $set: { loanId: m.loanId, userId: m.userId, amount: paid, dueDate: emi.dueDate, status: 'success', providerRef: pay.id, lastAttemptAt: new Date() }, $inc: { attempts: 1 } }, { upsert: true });
    m.lastDebitAt = new Date();
    if (m.status === 'pending_auth') m.status = 'active';
    await m.save();
    return { status: 'collected', emiNumber: emi.emiNumber };
  }

  if (event === 'subscription.pending' || event === 'subscription.halted') {
    m.status = 'paused';
    m.failedReason = event === 'subscription.halted' ? 'Razorpay stopped collecting after repeated failures' : 'A collection did not go through';
    await m.save();
    await notify(m.userId, { type: 'AUTOPAY', title: 'Auto-debit did not go through', message: 'We could not collect your EMI automatically. Please pay it in the app, and check that your account has enough balance.', loanId: m.loanId }, { sms: true });
    return { status: 'paused' };
  }
  if (event === 'subscription.cancelled') { m.status = 'cancelled'; m.cancelledAt = new Date(); m.cancelledBy = 'provider'; await m.save(); return { status: 'cancelled' }; }
  if (event === 'subscription.completed') { m.status = 'completed'; await m.save(); return { status: 'completed' }; }
  return { ignored: true, reason: 'event not used' };
}

// ── How it looks ─────────────────────────────────────────────────────────────────────────────
export async function viewMandate(m) {
  const next = await EMIPayment.findOne({ loanId: m.loanId, status: { $in: UNPAID } }).sort({ emiNumber: 1 }).lean();
  return {
    id: String(m._id), loanId: String(m.loanId), status: m.status, method: m.method, provider: m.provider, maxAmount: m.maxAmount, activatedAt: m.activatedAt, lastDebitAt: m.lastDebitAt,
    authUrl: m.status === 'pending_auth' ? m.authUrl : undefined,
    next: next ? { emiNumber: next.emiNumber, amount: next.amount + (next.penaltyApplied || 0), dueDate: next.dueDate } : null,
  };
}

export async function mandatesFor(userId) {
  const rows = await Mandate.find({ userId, status: { $in: [...LIVE_STATES, 'completed'] } }).sort({ createdAt: -1 }).limit(20);
  return Promise.all(rows.map(viewMandate));
}

export default { availability, startMandate, activate, cancelMandate, runAutoDebits, handleSubscriptionEvent, viewMandate, mandatesFor, PROVIDERS };
