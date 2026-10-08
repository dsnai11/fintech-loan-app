import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import SupportThread from '../models/SupportThread.js';
import { authMiddleware } from '../middleware/auth.js';
import { getSettings } from '../services/appSettings.js';
import { getSettings as assistantSettings, runAssistant, handOver } from '../services/assistantService.js';

// The customer's side of the conversation with the company.
const router = express.Router();
router.use(authMiddleware);

const MAX_MESSAGES_PER_THREAD = 500;
const MAX_PER_HOUR = 20;

const viewMessage = m => ({ id: String(m._id), from: m.from, name: m.from === 'staff' ? m.senderName || 'LIFC support' : m.from === 'bot' ? m.senderName || 'LIFC Assistant' : 'You', ai: m.from === 'bot', feedback: m.feedback || null, text: m.text, at: m.createdAt });
const viewThread = t => ({ id: String(t._id), subject: t.subject, status: t.status, lastMessageAt: t.lastMessageAt, botActive: t.bot?.active !== false, messages: t.messages.map(viewMessage) });

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

// Whether the assistant is on, and what it says first
router.get('/assistant', (req, res) => {
  const s = assistantSettings();
  // The questions customers can tap. Only the questions are sent; the answers come back in the conversation.
  res.json({ enabled: s.enabled, name: s.name, greeting: s.greeting, faqs: s.enabled ? s.kb.map(e => ({ id: e.id, question: e.question })) : [] });
});

// "Talk to a person": the assistant steps back and the conversation shows up in the staff inbox as waiting
router.post('/handover', async (req, res) => {
  try {
    if (!getSettings().features.support) return res.status(403).json({ error: 'Messaging is switched off for now. Please use the support email or phone number instead.' });
    const user = await User.findById(req.user.userId).select('firstName lastName email');
    if (!user) return res.status(404).json({ error: 'User not found' });
    let thread = await SupportThread.findOne({ userId: user._id, status: 'open' }).sort({ lastMessageAt: -1 });
    if (!thread) thread = new SupportThread({ userId: user._id, subject: 'Asked to talk to a person' });
    if (thread.bot?.active === false && thread.lastFrom === 'customer') return res.json({ thread: viewThread(thread) }); // already waiting for staff
    if (thread.messages.length >= MAX_MESSAGES_PER_THREAD) return res.status(409).json({ error: 'This conversation is full. Please wait for support to close it.' });
    thread.messages.push({ from: 'customer', senderName: `${user.firstName} ${user.lastName}`.trim(), senderEmail: user.email, text: 'Please connect me to a person.' });
    await handOver(thread);
    res.status(201).json({ thread: viewThread(thread) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Back to the assistant, when the customer pressed "Talk to a person" but nobody from the team has replied yet
router.post('/resume', async (req, res) => {
  try {
    const thread = await SupportThread.findOne({ userId: req.user.userId, status: 'open' }).sort({ lastMessageAt: -1 });
    if (!thread || thread.bot?.active !== false) return res.json({ thread: thread ? viewThread(thread) : null });
    if (thread.messages.some(m => m.from === 'staff')) return res.status(409).json({ error: 'A member of our team is already helping you here. They will reply soon.' });
    const s = assistantSettings();
    if (!s.enabled) return res.status(409).json({ error: 'The assistant is not available right now. Our team will reply here.' });
    thread.bot.active = true;
    thread.bot.turns = 0;
    const last = thread.messages[thread.messages.length - 1];
    if (!last || last.from !== 'customer') {
      thread.messages.push({ from: 'bot', senderName: s.name, text: 'I am back. What would you like to know?', meta: { mode: 'rules', handover: false } });
      thread.lastFrom = 'bot';
      thread.lastMessageAt = new Date();
      thread.unreadForCustomer += 1;
    }
    await thread.save();
    runAssistant(thread._id).catch(() => {}); // answers the customer's latest message, if it is still waiting
    res.json({ thread: viewThread(thread) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Thumbs up or down on an assistant answer
router.post('/messages/:id/feedback', async (req, res) => {
  try {
    const value = req.body?.value;
    if (!['up', 'down'].includes(value) || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Choose thumbs up or thumbs down' });
    const thread = await SupportThread.findOne({ userId: req.user.userId, 'messages._id': req.params.id });
    const m = thread?.messages.id(req.params.id);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (m.from !== 'bot') return res.status(400).json({ error: 'You can only rate the assistant\'s answers' });
    m.feedback = value;
    await thread.save();
    res.json({ feedback: value });
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

    const faqId = typeof req.body?.faqId === 'string' && assistantSettings().kb.some(e => e.id === req.body.faqId) ? req.body.faqId : null;
    thread.messages.push({ from: 'customer', senderName: `${user.firstName} ${user.lastName}`.trim(), senderEmail: user.email, text, ...(faqId ? { meta: { faqId } } : {}) });
    thread.lastFrom = 'customer';
    thread.lastMessageAt = new Date();
    thread.unreadForStaff += 1;
    await thread.save();
    res.status(201).json({ thread: viewThread(thread) });
    // The assistant answers in the background; the app picks the answer up when it next checks
    if (thread.bot?.active !== false) runAssistant(thread._id).catch(() => {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
