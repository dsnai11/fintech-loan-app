import express from 'express';
import SupportThread from '../models/SupportThread.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getSettings, saveSettings, respond, aiConfigured, providerName, missingProviderSettings } from '../services/assistantService.js';

// Staff side of the AI assistant: how it behaves, the FAQ it answers from, a way to try it, and how it is doing.
const router = express.Router();
router.use(adminMiddleware);

async function stats(days = 30) {
  const since = new Date(Date.now() - days * 864e5);
  const [answers, threads, handovers, votes] = await Promise.all([
    SupportThread.aggregate([{ $unwind: '$messages' }, { $match: { 'messages.from': 'bot', 'messages.createdAt': { $gte: since } } }, { $group: { _id: '$messages.meta.mode', n: { $sum: 1 } } }]),
    SupportThread.aggregate([{ $unwind: '$messages' }, { $match: { 'messages.from': 'bot', 'messages.createdAt': { $gte: since } } }, { $group: { _id: '$_id' } }, { $count: 'n' }]),
    SupportThread.countDocuments({ 'bot.handedOverAt': { $gte: since } }),
    SupportThread.aggregate([{ $unwind: '$messages' }, { $match: { 'messages.from': 'bot', 'messages.createdAt': { $gte: since }, 'messages.feedback': { $exists: true } } }, { $group: { _id: '$messages.feedback', n: { $sum: 1 } } }]),
  ]);
  const by = list => Object.fromEntries(list.map(x => [x._id || 'other', x.n]));
  const a = by(answers), v = by(votes);
  const conversations = threads[0]?.n || 0;
  return { days, conversations, answers: Object.values(a).reduce((x, y) => x + y, 0), byMode: a, handedOver: handovers, handoverShare: conversations ? Math.round((handovers / conversations) * 100) : 0, thumbsUp: v.up || 0, thumbsDown: v.down || 0 };
}

router.get('/', async (req, res) => {
  try {
    res.json({
      settings: getSettings(),
      status: { mode: aiConfigured() ? 'ai' : 'faq', provider: providerName(), missing: missingProviderSettings() },
      stats: await stats(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Send the settings as a JSON object' });
    const before = getSettings();
    const r = await saveSettings({ ...before, ...req.body }, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'ASSISTANT_UPDATED', { type: 'Config', id: 'ASSISTANT_SETTINGS' }, { enabledBefore: before.enabled, enabledAfter: r.settings.enabled, faqCount: r.settings.kb.length }, req);
    res.json({ message: r.settings.enabled ? 'Saved. The assistant is on and answers customers on the Messages tab.' : 'Saved. The assistant is off. Customers\' messages go straight to your team.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Try a question as a customer would ask it. Nothing is saved and no customer's details are used.
router.post('/test', async (req, res) => {
  try {
    const question = String(req.body?.question ?? '').trim();
    if (!question || question.length > 1000) return res.status(400).json({ error: 'Type a question (up to 1000 characters)' });
    const language = String(req.body?.language ?? 'en');
    const settings = { ...getSettings(), useCustomerFacts: false };
    const r = await respond({ user: { firstName: 'Test', language }, history: [], question, settings });
    res.json({ reply: r.reply, handover: r.handover, mode: r.mode, reason: r.reason || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
