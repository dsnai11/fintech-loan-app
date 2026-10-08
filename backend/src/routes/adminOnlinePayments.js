import express from 'express';
import mongoose from 'mongoose';
import PaymentIntent from '../models/PaymentIntent.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { listForStaff, availability } from '../services/onlinePayments.js';

// Staff side of online payments: what came in, and the ones that arrived but could not be applied by themselves.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', async (req, res) => {
  try {
    const status = ['paid', 'review', 'processing', 'resolved', 'created', 'expired', 'cancelled'].includes(req.query.status) ? req.query.status : '';
    const a = availability();
    res.json({ mode: a.mode, note: a.note || null, canManage: can(req.user.role, 'collections.manage'), payments: await listForStaff(status) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff handled a payment that could not be applied by hand (for example refunded it, or applied it in the loan screen)
router.post('/:id/resolve', async (req, res) => {
  try {
    if (!can(req.user.role, 'collections.manage')) return res.status(403).json({ error: 'Your role cannot resolve payments.', code: 'NOT_PERMITTED', needs: 'collections.manage' });
    const note = String(req.body?.note || '').trim().slice(0, 300);
    if (!note) return res.status(400).json({ error: 'Write what you did with this payment.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const i = await PaymentIntent.findOneAndUpdate({ _id: req.params.id, status: 'review' }, { status: 'resolved', resolvedBy: req.user.email, resolvedNote: note }, { new: true });
    if (!i) return res.status(409).json({ error: 'That payment is not waiting for review.' });
    await audit(req.user, 'PAYMENT_RESOLVED', { type: 'Loan', id: i.loanId }, { purpose: i.purpose, amount: i.amount, note }, req);
    res.json({ status: i.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
