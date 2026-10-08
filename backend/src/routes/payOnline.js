import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import PaymentIntent from '../models/PaymentIntent.js';
import { authMiddleware } from '../middleware/auth.js';
import { availability, options, startIntent, applyIntent, viewIntent } from '../services/onlinePayments.js';
import { eligibility, changeDueDay } from '../services/dateChange.js';

// The customer's ways to pay early: several instalments at once, close the loan, a settlement; and moving the due date.
const router = express.Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px 18px;color:#111827;line-height:1.5}h1{font-size:21px}button{padding:12px 18px;border:0;border-radius:10px;font:600 15px system-ui;cursor:pointer}
.go{background:#15803d;color:#fff;width:100%;margin-top:18px}.no{background:#e5e7eb;width:100%;margin-top:8px}.test{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:10px;font-size:13px}.box{background:#f3f4f6;border-radius:10px;padding:12px 14px;margin:14px 0}</style></head><body>${body}</body></html>`;
const WHAT = { pay_ahead: 'your instalments', foreclosure: 'closing your loan', settlement: 'your settlement' };

const ownedLoan = async (req, res) => {
  const loan = mongoose.isValidObjectId(req.params.loanId) ? await Loan.findById(req.params.loanId) : null;
  if (!loan || String(loan.userId) !== String(req.user.userId)) { res.status(404).json({ error: 'Loan not found' }); return null; }
  return loan;
};

router.get('/options/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await ownedLoan(req, res);
    if (!loan) return;
    const a = availability();
    res.json({ available: !!a.provider, mode: a.mode, note: a.mode === 'test' ? a.note : null, ...(await options(loan)), dueDate: await eligibility(loan) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/start', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!mongoose.isValidObjectId(req.body?.loanId)) return res.status(400).json({ error: 'Choose a loan' });
    const r = await startIntent(user, req.body);
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
    res.status(201).json({ payment: { ...viewIntent(r.intent), url: r.intent.url }, mode: r.mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status/:id', authMiddleware, async (req, res) => {
  try {
    const i = mongoose.isValidObjectId(req.params.id) ? await PaymentIntent.findOne({ _id: req.params.id, userId: req.user.userId }) : null;
    if (!i) return res.status(404).json({ error: 'Not found' });
    if (i.status === 'created' && i.expiresAt < new Date()) { i.status = 'expired'; await i.save(); }
    res.json({ payment: viewIntent(i) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/change-date/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await ownedLoan(req, res);
    if (!loan) return;
    const r = await changeDueDay(loan, req.body?.day, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ nextDue: r.nextDue, day: r.day, shiftDays: r.shiftDays, emis: r.emis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Where the payment page sends the customer back to. It only reports; the money is applied when the provider confirms it.
router.get('/callback', async (req, res) => {
  try {
    const i = mongoose.isValidObjectId(String(req.query.intent || '')) ? await PaymentIntent.findById(req.query.intent) : null;
    if (!i) return res.status(404).send(page('Not found', '<h1>This link is not valid</h1>'));
    const done = ['paid'].includes(i.status), review = i.status === 'review';
    res.send(page('Payment', done ? '<h1>Payment received</h1><p>Thank you. You can close this page and go back to the app.</p>'
      : review ? '<h1>Payment received</h1><p>Our team is checking how to apply it. You do not need to pay again.</p>'
      : '<h1>We are confirming your payment</h1><p>This can take a minute. Go back to the app to see the result. If money was taken from your account it will be applied automatically.</p>'));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

// ── Test mode: a stand-in for the payment page ───────────────────────────────────────────────
async function sandboxIntent(req, res) {
  if (process.env.PAYMENT_MODE === 'PRODUCTION') { res.status(404).send(page('Not found', '<h1>Not found</h1>')); return null; }
  const i = mongoose.isValidObjectId(req.params.id) ? await PaymentIntent.findById(req.params.id) : null;
  if (!i || i.provider !== 'sandbox' || i.status !== 'created' || i.expiresAt < new Date()) { res.status(404).send(page('Expired', '<h1>This test page has expired</h1><p>Please go back to the app and start again.</p>')); return null; }
  return i;
}

router.get('/sandbox/:id', async (req, res) => {
  try {
    const i = await sandboxIntent(req, res);
    if (!i) return;
    res.send(page('Pay (test)', `<div class="test">TEST MODE. This is not a real payment page. Nothing is charged.</div>
<h1>Pay Rs ${esc(Math.round(i.amount).toLocaleString('en-IN'))}</h1><div class="box">For ${esc(WHAT[i.purpose])}.</div>
<form method="post" action="/api/pay/sandbox/${esc(i._id)}"><button class="go" name="action" value="pay">Pay</button><button class="no" name="action" value="cancel">Cancel</button></form>`));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

router.post('/sandbox/:id', async (req, res) => {
  try {
    const i = await sandboxIntent(req, res);
    if (!i) return;
    if (req.body?.action === 'pay') await applyIntent(i._id, { paymentId: `sbx_pay_${Date.now()}`, amountPaid: i.amount });
    else await PaymentIntent.updateOne({ _id: i._id, status: 'created' }, { status: 'cancelled' });
    res.redirect(`/api/pay/callback?intent=${i._id}`);
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

export default router;
