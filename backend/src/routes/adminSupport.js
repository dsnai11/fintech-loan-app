import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import SupportThread from '../models/SupportThread.js';
import { adminMiddleware } from '../middleware/auth.js';
import { notify } from '../services/notificationService.js';
import { audit } from '../services/auditService.js';

// The staff inbox: read what customers wrote, reply, hand over, close.
const router = express.Router();
router.use(adminMiddleware);

const bad = (res, status, error) => res.status(status).json({ error });
const isId = id => mongoose.isValidObjectId(id);
const person = u => (u ? { id: String(u._id), name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, phone: u.phone } : null);

const row = t => ({
  id: String(t._id),
  customer: person(t.userId),
  subject: t.subject,
  status: t.status,
  assignedTo: t.assignedTo || null,
  lastFrom: t.lastFrom,
  lastMessageAt: t.lastMessageAt,
  unread: t.unreadForStaff,
  preview: (t.messages[t.messages.length - 1]?.text || '').slice(0, 120),
  botActive: t.bot?.active !== false,
  handoverReason: t.bot?.handoverReason || null,
  botTurns: t.bot?.turns || 0,
});

router.get('/', async (req, res) => {
  try {
    const filter = {};
    const view = String(req.query.view || 'open');
    if (view === 'open') filter.status = 'open';
    if (view === 'closed') filter.status = 'closed';
    if (view === 'unassigned') Object.assign(filter, { status: 'open', assignedTo: '' });
    if (view === 'mine') Object.assign(filter, { status: 'open', assignedTo: req.user.email });
    if (view === 'waiting') Object.assign(filter, { status: 'open', lastFrom: 'customer' });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const [threads, total, open, waiting] = await Promise.all([
      SupportThread.find(filter).sort({ lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).populate('userId', 'firstName lastName email phone').select('-messages.senderEmail'),
      SupportThread.countDocuments(filter),
      SupportThread.countDocuments({ status: 'open' }),
      SupportThread.countDocuments({ status: 'open', lastFrom: 'customer' }),
    ]);
    res.json({ threads: threads.map(row), total, page, pages: Math.ceil(total / limit), counts: { open, waiting } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function load(req, res) {
  if (!isId(req.params.id)) { bad(res, 400, 'Invalid conversation id'); return null; }
  const t = await SupportThread.findById(req.params.id).populate('userId', 'firstName lastName email phone');
  if (!t) { bad(res, 404, 'Conversation not found'); return null; }
  return t;
}

router.get('/:id', async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    if (t.unreadForStaff) { t.unreadForStaff = 0; await t.save(); }
    res.json({ ...row(t), unread: 0, messages: t.messages.map(m => ({ id: String(m._id), from: m.from, name: m.from === 'bot' ? `${m.senderName || 'Assistant'} (AI)` : m.senderName, feedback: m.feedback || null, text: m.text, at: m.createdAt })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function staffName(req) {
  const u = await User.findById(req.user.userId).select('firstName lastName');
  return u ? `${u.firstName} ${u.lastName}`.trim() : req.user.email;
}

async function addStaffMessage(t, req, text) {
  t.messages.push({ from: 'staff', senderName: await staffName(req), senderEmail: req.user.email, text });
  t.lastFrom = 'staff';
  t.lastMessageAt = new Date();
  t.unreadForCustomer += 1;
  t.bot.active = false; // once a person has joined in, the assistant stays out of it
  if (!t.assignedTo) t.assignedTo = req.user.email;
  await t.save();
  await notify(t.userId._id || t.userId, { type: 'SUPPORT_REPLY', title: 'Message from LIFC support', message: text.slice(0, 200) }, { email: true });
}

const cleanText = (res, v) => {
  const text = String(v ?? '').trim();
  if (!text) { bad(res, 400, 'Write a message first'); return null; }
  if (text.length > 2000) { bad(res, 400, 'Messages can be up to 2000 characters'); return null; }
  return text;
};

router.post('/:id/reply', async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    const text = cleanText(res, req.body?.text);
    if (!text) return;
    if (t.messages.length >= 500) return bad(res, 409, 'This conversation is full. Close it and start a new one.');
    if (t.status === 'closed') t.status = 'open';
    await addStaffMessage(t, req, text);
    await audit(req.user, 'SUPPORT_REPLY', { type: 'SupportThread', id: t._id }, { customer: String(t.userId._id || t.userId) }, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff start a conversation with a customer (for example from the customer page)
router.post('/start', async (req, res) => {
  try {
    if (!isId(req.body?.userId)) return bad(res, 400, 'Choose a customer');
    const user = await User.findById(req.body.userId).select('firstName lastName email phone status role');
    if (!user || (user.role && user.role !== 'customer')) return bad(res, 404, 'Customer not found');
    const text = cleanText(res, req.body?.text);
    if (!text) return;
    let t = await SupportThread.findOne({ userId: user._id, status: 'open' }).sort({ lastMessageAt: -1 });
    if (!t) t = new SupportThread({ userId: user._id, subject: String(req.body?.subject || text).trim().slice(0, 80) });
    t.userId = user;
    await addStaffMessage(t, req, text);
    await audit(req.user, 'SUPPORT_STARTED', { type: 'SupportThread', id: t._id }, { customer: String(user._id) }, req);
    res.status(201).json({ id: String(t._id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/close', async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    t.status = 'closed';
    await t.save();
    await audit(req.user, 'SUPPORT_CLOSED', { type: 'SupportThread', id: t._id }, {}, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/reopen', async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    t.status = 'open';
    await t.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hand the conversation to a named staff member, or clear it with `to: null`
router.post('/:id/assign', async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    const to = req.body?.to ? String(req.body.to).trim().toLowerCase() : '';
    if (to && !(await User.exists({ email: to, status: 'active', role: { $nin: [null, 'customer'] } }))) return bad(res, 400, 'That person is not an active staff member');
    t.assignedTo = to;
    await t.save();
    await audit(req.user, 'SUPPORT_ASSIGNED', { type: 'SupportThread', id: t._id }, { to: to || null }, req);
    res.json({ assignedTo: to || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
