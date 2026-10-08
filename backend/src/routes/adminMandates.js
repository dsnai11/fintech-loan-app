import express from 'express';
import mongoose from 'mongoose';
import Mandate from '../models/Mandate.js';
import MandateDebit from '../models/MandateDebit.js';
import User from '../models/User.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { availability, cancelMandate, runAutoDebits } from '../services/mandateService.js';

// Staff side of auto-debit: who has it, how collections are going, and the controls.
const router = express.Router();
router.use(adminMiddleware);

const need = (req, res) => {
  if (can(req.user.role, 'collections.manage')) return true;
  res.status(403).json({ error: 'Your role cannot change auto-debit.', code: 'NOT_PERMITTED', needs: 'collections.manage' });
  return false;
};
const name = u => (u ? `${u.firstName} ${u.lastName}`.trim() : '');

router.get('/', async (req, res) => {
  try {
    const status = ['pending_auth', 'active', 'paused', 'cancelled', 'failed', 'completed'].includes(req.query.status) ? { status: req.query.status } : {};
    const rows = await Mandate.find(status).sort({ createdAt: -1 }).limit(200).lean();
    const users = await User.find({ _id: { $in: rows.map(r => r.userId) } }).select('firstName lastName phone').lean();
    const byId = Object.fromEntries(users.map(u => [String(u._id), u]));
    const since = new Date(Date.now() - 30 * 864e5);
    const [counts, debits] = await Promise.all([
      Mandate.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      MandateDebit.aggregate([{ $match: { updatedAt: { $exists: false }, createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).catch(() => []),
    ]);
    const recent = await MandateDebit.find({ createdAt: { $gte: since } }).select('status').lean();
    const ok = recent.filter(d => d.status === 'success').length, bad = recent.filter(d => d.status === 'failed').length;
    const a = availability();
    res.json({
      mode: a.mode, note: a.note || null,
      canManage: can(req.user.role, 'collections.manage'),
      counts: Object.fromEntries(counts.map(c => [c._id, c.n])),
      last30: { collected: ok, failed: bad, successRate: ok + bad ? Math.round((ok / (ok + bad)) * 100) : null, waiting: recent.filter(d => d.status === 'notified').length },
      mandates: rows.map(r => ({ id: String(r._id), customer: name(byId[String(r.userId)]), phone: byId[String(r.userId)]?.phone, loanId: String(r.loanId), provider: r.provider, method: r.method, status: r.status, maxAmount: r.maxAmount, activatedAt: r.activatedAt, lastDebitAt: r.lastDebitAt, failedReason: r.failedReason, at: r.createdAt })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/debits', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const rows = await MandateDebit.find({ mandateId: req.params.id }).sort({ emiNumber: 1 }).lean();
    res.json({ debits: rows.map(d => ({ emiNumber: d.emiNumber, amount: d.amount, dueDate: d.dueDate, status: d.status, attempts: d.attempts, notifiedAt: d.notifiedAt, lastAttemptAt: d.lastAttemptAt, nextAttemptAt: d.nextAttemptAt, failureReason: d.failureReason })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const change = (status, action, allowedFrom) => async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const m = await Mandate.findById(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    if (!allowedFrom.includes(m.status)) return res.status(409).json({ error: `That auto-debit is ${m.status}, so this cannot be done.` });
    if (status === 'cancelled') await cancelMandate(m, req.user.email, String(req.body?.reason || '').slice(0, 200));
    else { m.status = status; await m.save(); }
    await audit(req.user, action, { type: 'Mandate', id: m._id }, { loanId: String(m.loanId), to: status }, req);
    res.json({ status: m.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.post('/:id/pause', change('paused', 'MANDATE_PAUSED', ['active']));
router.post('/:id/resume', change('active', 'MANDATE_RESUMED', ['paused']));
router.post('/:id/cancel', change('cancelled', 'MANDATE_CANCELLED_BY_STAFF', ['pending_auth', 'active', 'paused']));

// Runs the collections now instead of waiting for the schedule
router.post('/run', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const r = await runAutoDebits();
    await audit(req.user, 'AUTODEBIT_RUN', { type: 'Mandate' }, r, req);
    res.json({ ...r, message: `${r.notified} customers told, ${r.collected} collected, ${r.failed} failed, ${r.completed} finished.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
