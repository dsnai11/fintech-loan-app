import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import CallbackRequest from '../models/CallbackRequest.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { notify } from '../services/notificationService.js';

// "Call me back": the customer picks a topic and a time; the support team sees the list and records what happened.
export const customerRouter = express.Router();
const SLOTS = { morning: '10 am to 1 pm', afternoon: '1 pm to 4 pm', evening: '4 pm to 7 pm' };
const view = r => ({ id: String(r._id), topic: r.topic, day: r.day, slot: r.slot, slotText: SLOTS[r.slot], note: r.note, status: r.status, at: r.createdAt, doneAt: r.doneAt || null });

customerRouter.get('/mine', authMiddleware, async (req, res) => {
  try {
    const rows = await CallbackRequest.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(10);
    res.json({ requests: rows.map(view), slots: SLOTS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

customerRouter.post('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (await CallbackRequest.exists({ userId: user._id, status: 'open' })) return res.status(409).json({ error: 'You already asked for a call. We will phone you soon.', code: 'ALREADY_OPEN' });
    const b = req.body || {};
    const topic = ['loan', 'payment', 'kyc', 'other'].includes(b.topic) ? b.topic : 'other';
    const slot = Object.keys(SLOTS).includes(b.slot) ? b.slot : null;
    const day = ['today', 'tomorrow'].includes(b.day) ? b.day : null;
    if (!slot || !day) return res.status(400).json({ error: 'Choose when you would like the call.' });
    const loanId = mongoose.isValidObjectId(b.loanId) && (await Loan.exists({ _id: b.loanId, userId: user._id })) ? b.loanId : undefined;
    const r = await CallbackRequest.create({ userId: user._id, loanId, phone: user.phone, topic, day, slot, note: String(b.note || '').trim().slice(0, 300) });
    await audit({ email: user.email, role: 'customer' }, 'CALLBACK_REQUESTED', { type: 'User', id: user._id }, { topic, day, slot }, req);
    res.status(201).json({ request: view(r) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

customerRouter.post('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const r = mongoose.isValidObjectId(req.params.id) ? await CallbackRequest.findOneAndUpdate({ _id: req.params.id, userId: req.user.userId, status: 'open' }, { status: 'cancelled' }, { new: true }) : null;
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ request: view(r) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Staff ─────────────────────────────────────────────────────────────────────────────────────
export const adminRouter = express.Router();
adminRouter.use(adminMiddleware);

adminRouter.get('/', async (req, res) => {
  try {
    const status = ['open', 'done', 'cancelled'].includes(req.query.status) ? req.query.status : 'open';
    const rows = await CallbackRequest.find({ status }).sort(status === 'open' ? { day: 1, createdAt: 1 } : { updatedAt: -1 }).limit(200).lean();
    const users = await User.find({ _id: { $in: rows.map(r => r.userId) } }).select('firstName lastName').lean();
    const name = Object.fromEntries(users.map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
    res.json({
      canReply: can(req.user.role, 'support.reply'),
      open: await CallbackRequest.countDocuments({ status: 'open' }),
      requests: rows.map(r => ({ ...view(r), customer: name[String(r.userId)] || '', phone: r.phone, assignedTo: r.assignedTo, outcome: r.outcome, doneBy: r.doneBy || null, userId: String(r.userId) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

adminRouter.post('/:id/done', async (req, res) => {
  try {
    if (!can(req.user.role, 'support.reply')) return res.status(403).json({ error: 'Your role cannot handle call requests.', code: 'NOT_PERMITTED', needs: 'support.reply' });
    const outcome = String(req.body?.outcome || '').trim().slice(0, 300);
    if (!outcome) return res.status(400).json({ error: 'Write what happened on the call.' });
    const r = mongoose.isValidObjectId(req.params.id) ? await CallbackRequest.findOneAndUpdate({ _id: req.params.id, status: 'open' }, { status: 'done', outcome, doneBy: req.user.email, doneAt: new Date() }, { new: true }) : null;
    if (!r) return res.status(409).json({ error: 'That request is not open.' });
    await audit(req.user, 'CALLBACK_DONE', { type: 'User', id: r.userId }, { outcome }, req);
    res.json({ status: r.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

adminRouter.post('/:id/claim', async (req, res) => {
  try {
    if (!can(req.user.role, 'support.reply')) return res.status(403).json({ error: 'Your role cannot handle call requests.', code: 'NOT_PERMITTED', needs: 'support.reply' });
    const r = mongoose.isValidObjectId(req.params.id) ? await CallbackRequest.findOneAndUpdate({ _id: req.params.id, status: 'open', assignedTo: '' }, { assignedTo: req.user.email }, { new: true }) : null;
    if (!r) return res.status(409).json({ error: 'Someone has already taken this one.' });
    res.json({ assignedTo: r.assignedTo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff could not reach the customer: tell them in the app
adminRouter.post('/:id/missed', async (req, res) => {
  try {
    if (!can(req.user.role, 'support.reply')) return res.status(403).json({ error: 'Your role cannot handle call requests.', code: 'NOT_PERMITTED', needs: 'support.reply' });
    const r = mongoose.isValidObjectId(req.params.id) ? await CallbackRequest.findOneAndUpdate({ _id: req.params.id, status: 'open' }, { status: 'done', outcome: 'Could not reach the customer', doneBy: req.user.email, doneAt: new Date() }, { new: true }) : null;
    if (!r) return res.status(409).json({ error: 'That request is not open.' });
    await notify(r.userId, { type: 'SUPPORT_REPLY', title: 'We tried to call you', message: 'We could not reach you on your call-back request. You can ask for another call in the app, or send us a message.' }, { email: false, sms: true });
    await audit(req.user, 'CALLBACK_MISSED', { type: 'User', id: r.userId }, {}, req);
    res.json({ status: r.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
