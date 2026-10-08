import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { mine, overview, getProgram, saveProgram, markPaid } from '../services/rewardsService.js';

// Rewards for paying on time: the customer's streak and badges, and the staff side (rules and cash rewards to pay).
export const customerRouter = express.Router();
customerRouter.get('/me', authMiddleware, async (req, res) => {
  try {
    res.json(await mine(req.user.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export const adminRouter = express.Router();
adminRouter.use(adminMiddleware);
const need = (req, res) => {
  if (can(req.user.role, 'referrals.manage')) return true;
  res.status(403).json({ error: 'Your role cannot change rewards.', code: 'NOT_PERMITTED', needs: 'referrals.manage' });
  return false;
};

adminRouter.get('/', async (req, res) => {
  try {
    res.json({ ...(await overview()), canManage: can(req.user.role, 'referrals.manage') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

adminRouter.put('/settings', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const before = getProgram();
    const r = await saveProgram(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'REWARDS_UPDATED', { type: 'Config', id: 'REWARDS_PROGRAM' }, { enabledBefore: before.enabled, enabledAfter: r.program.enabled, milestones: r.program.milestones }, req);
    res.json({ message: r.program.enabled ? 'Saved. Rewards for paying on time are on.' : 'Saved. Rewards are off.', program: r.program });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

adminRouter.post('/awards/:id/paid', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await markPaid(req.params.id, req.body?.reference, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ status: r.award.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
