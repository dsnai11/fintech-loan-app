import PaymentIntent from '../models/PaymentIntent.js';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import Settlement from '../models/Settlement.js';
import { getConfig } from './configService.js';
import { baseUrl } from './passwordReset.js';
import { audit } from './auditService.js';
import { markEMIPaid } from './emiService.js';
import { getForeclosureQuote, executeForeclosure } from './foreclosureService.js';
import { recordPayment as recordSettlement } from './collectionsAutomation.js';
import { notify } from './notificationService.js';

// Paying online for things other than a single EMI: several instalments at once, closing the loan early, a settlement.
//
// The amount is always worked out here, never taken from the app. The customer is sent to a payment page (a Razorpay
// Payment Link in production; a stand-in page in test mode). The money is applied to the loan only when the provider says it
// has been paid (a signed webhook in production), exactly once. If the money has arrived but cannot be applied (for example
// the instalment was paid by auto-debit in between) the payment is put aside for staff to look at, never lost.

const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
const LINK_MINUTES = 30;
const production = () => process.env.PAYMENT_MODE === 'PRODUCTION';
const rupees = n => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

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
    async create({ intent, user, loan, description }) {
      const link = await rzp('/payment_links', {
        amount: Math.round(intent.amount * 100), currency: 'INR', accept_partial: false,
        reference_id: String(intent._id), description,
        customer: { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, contact: user.phone },
        notify: { sms: false, email: false }, reminder_enable: false,
        expire_by: Math.floor(intent.expiresAt.getTime() / 1000),
        notes: { intentId: String(intent._id), loanId: String(loan._id), purpose: intent.purpose },
        callback_url: `${baseUrl()}/api/pay/callback?intent=${intent._id}`, callback_method: 'get',
      });
      return { providerRef: link.id, url: link.short_url };
    },
  },
  sandbox: {
    name: 'sandbox',
    async create({ intent }) { return { providerRef: `sbx_${intent._id}`, url: `${baseUrl()}/api/pay/sandbox/${intent._id}` }; },
  },
};

export function availability() {
  if (production()) {
    return process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
      ? { mode: 'live', provider: PROVIDERS.razorpay }
      : { mode: 'unavailable', provider: null, note: 'Razorpay keys are not set in Railway, so customers cannot pay online.' };
  }
  return { mode: 'test', provider: PROVIDERS.sandbox, note: 'Test mode: payments are simulated.' };
}

const fail = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) });

// ── Working out the amount ───────────────────────────────────────────────────────────────────
export async function payAheadQuote(loan, count) {
  const unpaid = await EMIPayment.find({ loanId: loan._id, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
  const picked = unpaid.slice(0, count);
  if (!picked.length || picked.length < count) return null;
  return { emiNumbers: picked.map(e => e.emiNumber), amount: picked.reduce((a, e) => a + e.amount + (e.penaltyApplied || 0), 0), remaining: unpaid.length };
}

// What the customer can do about paying early, with the numbers
export async function options(loan) {
  const out = { payAhead: [], closeNow: null, settlement: null };
  if (!['disbursed'].includes(loan.status)) return out;
  const unpaid = await EMIPayment.find({ loanId: loan._id, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
  for (let k = 1; k <= Math.min(unpaid.length, 6); k++) {
    const picked = unpaid.slice(0, k);
    out.payAhead.push({ count: k, emiNumbers: picked.map(e => e.emiNumber), amount: picked.reduce((a, e) => a + e.amount + (e.penaltyApplied || 0), 0) });
  }
  if (unpaid.length) {
    try {
      const { quote } = await getForeclosureQuote(loan._id);
      const ifPaidNormally = unpaid.reduce((a, e) => a + e.amount + (e.penaltyApplied || 0), 0);
      out.closeNow = { total: quote.total, ifPaidNormally, saves: Math.max(0, Math.round(ifPaidNormally - quote.total)), costsExtra: Math.max(0, Math.round(quote.total - ifPaidNormally)), fee: quote.fee, feePercent: quote.feePercent, remainingEmis: quote.remainingEmis };
    } catch (e) { /* not available for this loan */ }
  }
  const offer = await Settlement.findOne({ loanId: loan._id, status: 'accepted', validUntil: { $gt: new Date() } }).lean();
  if (offer) out.settlement = { offerId: String(offer._id), amount: offer.amount, validUntil: offer.validUntil };
  return out;
}

// ── Starting a payment ───────────────────────────────────────────────────────────────────────
export async function startIntent(user, { loanId, purpose, count }) {
  const a = availability();
  if (!a.provider) return fail(503, 'Paying online is not available right now.', 'UNAVAILABLE');
  const loan = await Loan.findOne({ _id: loanId, userId: user._id });
  if (!loan) return fail(404, 'Loan not found');
  if (loan.status === 'written_off') return fail(409, 'This loan has been written off. Please contact support.');
  if (!['disbursed', 'defaulted'].includes(loan.status)) return fail(409, 'This loan is not active.');

  let amount, meta, description;
  if (purpose === 'pay_ahead') {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 12) return fail(400, 'Choose how many instalments to pay.');
    const q = await payAheadQuote(loan, n);
    if (!q) return fail(409, 'There are not that many instalments left to pay.');
    amount = q.amount; meta = { emiNumbers: q.emiNumbers }; description = `${n === 1 ? 'EMI' : `${n} EMIs`} (#${q.emiNumbers.join(', #')}) - loan ${String(loan._id).slice(-6)}`;
  } else if (purpose === 'foreclosure') {
    if (loan.status !== 'disbursed') return fail(409, 'Only an active loan can be closed early.');
    let q;
    try { q = (await getForeclosureQuote(loan._id)).quote; } catch (e) { return fail(e.status || 409, e.message); }
    amount = q.total; meta = { quoteTotal: q.total }; description = `Early closure - loan ${String(loan._id).slice(-6)}`;
  } else if (purpose === 'settlement') {
    const offer = await Settlement.findOne({ loanId: loan._id, userId: user._id, status: 'accepted', validUntil: { $gt: new Date() } });
    if (!offer) return fail(409, 'There is no accepted settlement offer for this loan.');
    amount = offer.amount; meta = { offerId: String(offer._id) }; description = `Settlement - loan ${String(loan._id).slice(-6)}`;
  } else {
    return fail(400, 'Unknown payment');
  }
  if (!(amount > 0)) return fail(409, 'Nothing to pay.');

  // One open payment per loan and purpose: the old one is replaced
  await PaymentIntent.updateMany({ loanId: loan._id, purpose, status: 'created' }, { status: 'cancelled' });
  const intent = await PaymentIntent.create({ userId: user._id, loanId: loan._id, purpose, amount, provider: a.provider.name, meta, expiresAt: new Date(Date.now() + LINK_MINUTES * 60000) });
  try {
    const made = await a.provider.create({ intent, user, loan, description });
    intent.providerRef = made.providerRef;
    intent.url = made.url;
    await intent.save();
  } catch (e) {
    intent.status = 'cancelled';
    await intent.save();
    return fail(502, `Could not start the payment: ${e.message}`);
  }
  await audit({ email: user.email, role: 'customer' }, 'PAYMENT_STARTED', { type: 'Loan', id: loan._id }, { purpose, amount, provider: intent.provider }, null);
  return { ok: true, intent, mode: a.mode };
}

// ── Applying a confirmed payment ─────────────────────────────────────────────────────────────
async function toReview(intent, reason, paymentId) {
  intent.status = 'review';
  intent.reviewReason = reason;
  intent.paymentId = paymentId || intent.paymentId;
  intent.paidAt = new Date();
  await intent.save();
  await audit({ email: 'system', role: 'system' }, 'PAYMENT_NEEDS_REVIEW', { type: 'Loan', id: intent.loanId }, { purpose: intent.purpose, amount: intent.amount, reason, paymentId }, null);
  await notify(intent.userId, { type: 'EMI_REMINDER', title: 'We received your payment', message: `We received ${rupees(intent.amount)} and our team is checking how to apply it. You do not need to pay again.`, loanId: intent.loanId }, { sms: true });
  return { ok: false, review: true, reason };
}

// Called when the provider confirms the payment. Safe to call more than once for the same payment.
export async function applyIntent(intentId, { paymentId, amountPaid } = {}) {
  const claimed = await PaymentIntent.findOneAndUpdate({ _id: intentId, status: { $in: ['created', 'expired'] } }, { status: 'processing' }, { new: true });
  if (!claimed) return { ok: true, duplicate: true };
  const intent = claimed;
  if (typeof amountPaid === 'number' && amountPaid + 0.5 < intent.amount) return toReview(intent, `Paid ${rupees(amountPaid)} against ${rupees(intent.amount)}`, paymentId);
  const pid = paymentId || `online_${Date.now()}`;
  const loan = await Loan.findById(intent.loanId);
  if (!loan) return toReview(intent, 'Loan not found', pid);

  try {
    if (intent.purpose === 'pay_ahead') {
      const emis = await EMIPayment.find({ loanId: loan._id, emiNumber: { $in: intent.meta.emiNumbers }, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
      if (emis.length !== intent.meta.emiNumbers.length) return toReview(intent, 'One of the instalments was already paid', pid);
      for (const e of emis) await markEMIPaid(e, pid, e.amount + (e.penaltyApplied || 0));
    } else if (intent.purpose === 'foreclosure') {
      if (loan.status !== 'disbursed') return toReview(intent, 'The loan is no longer active', pid);
      await executeForeclosure(loan._id, intent.amount, 'online', { gatewayPaid: true, paymentId: pid });
    } else if (intent.purpose === 'settlement') {
      const r = await recordSettlement(intent.meta.offerId, { amount: intent.amount, reference: pid }, 'online');
      if (!r.ok) return toReview(intent, r.error, pid);
    }
  } catch (e) {
    return toReview(intent, e.message, pid);
  }
  intent.status = 'paid';
  intent.paymentId = pid;
  intent.paidAt = new Date();
  await intent.save();
  await audit({ email: 'system', role: 'system' }, 'PAYMENT_APPLIED', { type: 'Loan', id: intent.loanId }, { purpose: intent.purpose, amount: intent.amount, paymentId: pid }, null);
  return { ok: true, intent };
}

// Razorpay tells us a payment link was paid
export async function handlePaymentLinkEvent(event, payload) {
  const link = payload?.payment_link?.entity;
  if (!link) return { ignored: true, reason: 'no payment link' };
  const ref = String(link.reference_id || '');
  const ors = [{ providerRef: link.id }];
  if (/^[a-f0-9]{24}$/.test(ref)) ors.push({ _id: ref });
  const intent = await PaymentIntent.findOne({ $or: ors });
  if (!intent) return { ignored: true, reason: 'unknown payment link' };
  if (event === 'payment_link.paid') {
    const paid = typeof link.amount_paid === 'number' ? link.amount_paid / 100 : undefined;
    return applyIntent(intent._id, { paymentId: payload?.payment?.entity?.id, amountPaid: paid });
  }
  if (event === 'payment_link.expired' || event === 'payment_link.cancelled') {
    await PaymentIntent.updateOne({ _id: intent._id, status: 'created' }, { status: event === 'payment_link.expired' ? 'expired' : 'cancelled' });
    return { status: 'closed' };
  }
  return { ignored: true, reason: 'event not used' };
}

export const viewIntent = i => ({ id: String(i._id), loanId: String(i.loanId), purpose: i.purpose, amount: i.amount, status: i.status, url: i.status === 'created' ? i.url : undefined, expiresAt: i.expiresAt, paidAt: i.paidAt || null });

export async function listForStaff(status) {
  const rows = await PaymentIntent.find(status ? { status } : { status: { $in: ['paid', 'review', 'processing'] } }).sort({ updatedAt: -1 }).limit(200).populate('userId', 'firstName lastName phone').lean();
  return rows.map(r => ({ ...viewIntent(r), customer: r.userId ? `${r.userId.firstName} ${r.userId.lastName}` : '', phone: r.userId?.phone || '', paymentId: r.paymentId || null, reviewReason: r.reviewReason || null, at: r.updatedAt }));
}

export default { availability, options, startIntent, applyIntent, handlePaymentLinkEvent, viewIntent, listForStaff, payAheadQuote, PROVIDERS };
