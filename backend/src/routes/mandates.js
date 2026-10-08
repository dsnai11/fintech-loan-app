import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import Mandate from '../models/Mandate.js';
import EMIPayment from '../models/EMIPayment.js';
import { authMiddleware } from '../middleware/auth.js';
import { availability, startMandate, activate, cancelMandate, mandatesFor, viewMandate } from '../services/mandateService.js';

// Auto-debit for the customer: see what is set up, start it for a loan, stop it. In test mode the approval page the customer
// would normally see at their UPI app or bank is a stand-in page here.
const router = express.Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px 18px;color:#111827;line-height:1.5}h1{font-size:21px}button{padding:12px 18px;border:0;border-radius:10px;font:600 15px system-ui;cursor:pointer}
.go{background:#15803d;color:#fff;width:100%;margin-top:18px}.no{background:#e5e7eb;width:100%;margin-top:8px}.test{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:10px;font-size:13px}.box{background:#f3f4f6;border-radius:10px;padding:12px 14px;margin:14px 0}</style></head><body>${body}</body></html>`;

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const a = availability();
    const mandates = await mandatesFor(req.user.userId);
    const covered = new Set(mandates.filter(m => ['pending_auth', 'active', 'paused'].includes(m.status)).map(m => m.loanId));
    const loans = await Loan.find({ userId: req.user.userId, status: { $in: ['disbursed', 'defaulted'] } }).select('loanAmount tenure monthlyEMI').lean();
    res.json({
      available: !!a.provider,
      mode: a.mode,
      note: a.note || null,
      mandates,
      loansWithoutAutoDebit: loans.filter(l => !covered.has(String(l._id))).map(l => ({ id: String(l._id), amount: l.loanAmount, tenure: l.tenure, emi: l.monthlyEMI })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/start', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!mongoose.isValidObjectId(req.body?.loanId)) return res.status(400).json({ error: 'Choose a loan' });
    const r = await startMandate(user, req.body.loanId, req.body.method || 'upi');
    if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
    res.status(201).json({ mandate: await viewMandate(r.mandate), mode: r.mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const m = mongoose.isValidObjectId(req.params.id) ? await Mandate.findOne({ _id: req.params.id, userId: req.user.userId }) : null;
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json({ mandate: await viewMandate(m) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const m = mongoose.isValidObjectId(req.params.id) ? await Mandate.findOne({ _id: req.params.id, userId: req.user.userId }) : null;
    if (!m) return res.status(404).json({ error: 'Not found' });
    await cancelMandate(m, req.user.email);
    res.json({ mandate: await viewMandate(m) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Test mode: a stand-in for approving the mandate in a UPI app or at the bank ───────────────────
async function sandboxMandate(req, res) {
  const a = availability();
  if (a.mode !== 'test') { res.status(404).send(page('Not found', '<h1>Not found</h1>')); return null; }
  const m = mongoose.isValidObjectId(req.params.id) ? await Mandate.findById(req.params.id) : null;
  if (!m || m.provider !== 'sandbox' || m.status !== 'pending_auth') { res.status(404).send(page('Expired', '<h1>This test page has expired</h1><p>Please go back to the app and start again.</p>')); return null; }
  return m;
}

router.get('/sandbox/:id', async (req, res) => {
  try {
    const m = await sandboxMandate(req, res);
    if (!m) return;
    const first = await EMIPayment.findOne({ loanId: m.loanId, status: { $ne: 'PAID' } }).sort({ emiNumber: 1 }).lean();
    res.send(page('Approve auto-debit (test)', `<div class="test">TEST MODE. This is not a real UPI app or bank page. Nothing is debited from anyone.</div>
<h1>Allow automatic EMI collection?</h1>
<div class="box">Up to <b>Rs ${esc(Math.round(m.maxAmount).toLocaleString('en-IN'))}</b> a month, collected on the instalment due date${first ? ` (next: ${esc(new Date(first.dueDate).toLocaleDateString('en-IN'))})` : ''}, for as long as this loan runs. You can stop it any time in the app.</div>
<form method="post" action="/api/mandates/sandbox/${esc(m._id)}"><button class="go" name="action" value="allow">Approve</button><button class="no" name="action" value="deny">Decline</button></form>`));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

router.post('/sandbox/:id', async (req, res) => {
  try {
    const m = await sandboxMandate(req, res);
    if (!m) return;
    if (req.body?.action === 'allow') {
      await activate(m);
      return res.send(page('Auto-debit approved', '<h1>Auto-debit is on</h1><p>You can close this page and go back to the app.</p>'));
    }
    m.status = 'failed';
    m.failedReason = 'The customer declined';
    await m.save();
    res.send(page('Declined', '<h1>You declined</h1><p>Nothing was set up. You can go back to the app.</p>'));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

export default router;
