import express from 'express';
import mongoose from 'mongoose';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { modeNow as whatsappMode } from '../services/whatsappService.js';
import { buildQueue } from '../services/collectionsService.js';
import { getSettings, saveSettings, runReminders, reminderStats, createOffer, listOffers, withdrawOffer, recordPayment } from '../services/collectionsAutomation.js';

// Staff side of automatic reminders and settlement offers.
const router = express.Router();
router.use(adminMiddleware);

const need = (req, res) => {
  if (can(req.user.role, 'collections.manage')) return true;
  res.status(403).json({ error: 'Your role cannot change reminders or settlements.', code: 'NOT_PERMITTED', needs: 'collections.manage' });
  return false;
};
const isId = id => mongoose.isValidObjectId(id);

router.get('/', async (req, res) => {
  try {
    res.json({ settings: getSettings(), stats: await reminderStats(), whatsapp: whatsappMode(), canManage: can(req.user.role, 'collections.manage') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const before = getSettings();
    const r = await saveSettings(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'REMINDERS_UPDATED', { type: 'Config', id: 'COLLECTIONS_AUTOMATION' }, { enabledBefore: before.enabled, enabledAfter: r.settings.enabled, steps: r.settings.steps.map(s => s.offset), settlementEnabled: r.settings.settlement.enabled }, req);
    res.json({ message: r.settings.enabled ? 'Saved. Reminders are on.' : 'Saved. Reminders are off.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const r = await runReminders();
    await audit(req.user, 'REMINDERS_RUN', { type: 'Config', id: 'COLLECTIONS_AUTOMATION' }, r, req);
    res.json({ ...r, message: r.off ? 'Reminders are switched off.' : r.quiet ? 'It is quiet hours, so nothing was sent.' : `${r.sent} sent, ${r.held} held for a promise, ${r.capped} held back by the daily limit.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Loans a settlement can be offered on
router.get('/eligible', async (req, res) => {
  try {
    const s = getSettings();
    const items = (await buildQueue()).filter(i => i.daysOverdue >= s.settlement.minDaysOverdue).slice(0, 200);
    res.json({ enabled: s.settlement.enabled, minDaysOverdue: s.settlement.minDaysOverdue, maxWaiverPercent: s.settlement.maxWaiverPercent, items: items.map(i => ({ loanId: i.loanId, customer: i.customer, phone: i.phone, daysOverdue: i.daysOverdue, amountDue: i.amountDue, stage: i.stage })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/settlements', async (req, res) => {
  try {
    const status = ['offered', 'accepted', 'paid', 'declined', 'expired', 'withdrawn'].includes(req.query.status) ? req.query.status : '';
    res.json({ offers: await listOffers(status) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/settlements', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.body?.loanId)) return res.status(400).json({ error: 'Choose a loan' });
    const r = await createOffer(req.body, req.user.email, { canExceed: can(req.user.role, 'config.manage') });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.status(201).json({ offer: r.offer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/settlements/:id/paid', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await recordPayment(req.params.id, req.body || {}, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ status: r.offer.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/settlements/:id/withdraw', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await withdrawOffer(req.params.id, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ status: r.offer.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
