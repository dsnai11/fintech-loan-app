import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import SupportThread from '../models/SupportThread.js';
import { authMiddleware } from '../middleware/auth.js';
import { getSettings } from '../services/appSettings.js';

// The customer's side of the conversation with the company.
const router = express.Router();
router.use(authMiddleware);

const MAX_MESSAGES_PER_THREAD = 500;
const MAX_PER_HOUR = 20;

const viewMessage = m => ({ id: String(m._id), from: m.from, name: m.from === 'staff' ? m.senderName || 'LIFC support' : 'You', text: m.text, at: m.createdAt });
const viewThread = t => ({ id: String(t._id), subject: t.subject, status: t.status, lastMessageAt: t.lastMessageAt, messages: t.messages.map(viewMessage) });

router.get('/thread', async (req, res) => {
  try {
    const thread = await SupportThread.findOne({ userId: req.user.userId }).sort({ lastMessageAt: -1 });
    if (!thread) return res.json({ thread: null });
    if (thread.unreadForCustomer) { thread.unreadForCustomer = 0; await thread.save(); }
    res.json({ thread: viewThread(thread) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/unread', async (req, res) => {
  try {
    const rows = await SupportThread.find({ userId: req.user.userId, unreadForCustomer: { $gt: 0 } }).select('unreadForCustomer');
    res.json({ count: rows.reduce((n, t) => n + t.unreadForCustomer, 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/messages', async (req, res) => {
  try {
    if (!getSettings().features.support) return res.status(403).json({ error: 'Messaging is switched off for now. Please use the support email or phone number instead.' });
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Write a message first' });
    if (text.length > 2000) return res.status(400).json({ error: 'Messages can be up to 2000 characters' });

    const hourAgo = new Date(Date.now() - 3600 * 1000);
    const recent = await SupportThread.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.user.userId) } },
      { $unwind: '$messages' },
      { $match: { 'messages.from': 'customer', 'messages.createdAt': { $gte: hourAgo } } },
      { $count: 'n' },
    ]);
    if ((recent[0]?.n || 0) >= MAX_PER_HOUR) return res.status(429).json({ error: 'You have sent a lot of messages in the last hour. Please wait a little and we will reply.' });

    const user = await User.findById(req.user.userId).select('firstName lastName email');
    if (!user) return res.status(404).json({ error: 'User not found' });
    let thread = await SupportThread.findOne({ userId: user._id, status: 'open' }).sort({ lastMessageAt: -1 });
    if (!thread) thread = new SupportThread({ userId: user._id, subject: text.slice(0, 80) });
    if (thread.messages.length >= MAX_MESSAGES_PER_THREAD) return res.status(409).json({ error: 'This conversation is full. Please wait for support to close it.' });

    thread.messages.push({ from: 'customer', senderName: `${user.firstName} ${user.lastName}`.trim(), senderEmail: user.email, text });
    thread.lastFrom = 'customer';
    thread.lastMessageAt = new Date();
    thread.unreadForStaff += 1;
    await thread.save();
    res.status(201).json({ thread: viewThread(thread) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
