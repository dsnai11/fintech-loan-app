import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Referral from '../models/Referral.js';
import ReferralReward from '../models/ReferralReward.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { notify } from '../services/notificationService.js';
import { getProgram, saveProgram, settleReferrals } from '../services/referralService.js';

// Staff side of the referral programme: the rules, who referred whom, and the rewards waiting to be paid.
const router = express.Router();
router.use(adminMiddleware);

const need = (req, res) => {
  if (can(req.user.role, 'referrals.manage')) return true;
  res.status(403).json({ error: 'Your role cannot change the referral programme.', code: 'NOT_PERMITTED', needs: 'referrals.manage' });
  return false;
};
const name = u => (u ? `${u.firstName} ${u.lastName}`.trim() : '');

router.get('/', async (req, res) => {
  try {
    const status = ['signed_up', 'in_hold', 'rewarded', 'void'].includes(req.query.status) ? { status: req.query.status } : {};
    const [refs, rewards, totals] = await Promise.all([
      Referral.find(status).sort({ createdAt: -1 }).limit(200).lean(),
      ReferralReward.find({}).sort({ createdAt: -1 }).limit(300).lean(),
      Referral.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const ids = new Set([...refs.flatMap(r => [String(r.referrerId), String(r.refereeId)]), ...rewards.map(r => String(r.userId))]);
    const users = await User.find({ _id: { $in: [...ids] } }).select('firstName lastName phone bankAccount').lean();
    const byId = Object.fromEntries(users.map(u => [String(u._id), u]));
    const sum = s => rewards.filter(r => r.status === s).reduce((a, r) => a + r.amount, 0);
    res.json({
      program: getProgram(),
      canManage: can(req.user.role, 'referrals.manage'),
      counts: Object.fromEntries(totals.map(t => [t._id, t.n])),
      money: { due: sum('due'), paid: sum('paid') },
      referrals: refs.map(r => ({ id: String(r._id), referrer: name(byId[String(r.referrerId)]), referee: name(byId[String(r.refereeId)]), code: r.code, status: r.status, eligibleAt: r.eligibleAt, voidReason: r.voidReason, at: r.createdAt })),
      rewards: rewards.map(r => {
        const u = byId[String(r.userId)];
        return { id: String(r._id), customer: name(u), phone: u?.phone, bank: u?.bankAccount?.accountNumber ? { holder: u.bankAccount.accountHolder, last4: String(u.bankAccount.accountNumber).slice(-4), ifsc: u.bankAccount.ifscCode } : null, role: r.role, amount: r.amount, status: r.status, paidAt: r.paidAt, paidBy: r.paidBy, reference: r.reference, voidReason: r.voidReason, at: r.createdAt };
      }),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const before = getProgram();
    const r = await saveProgram({ ...before, ...req.body }, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'REFERRAL_PROGRAM_UPDATED', { type: 'Config', id: 'REFERRAL_PROGRAM' }, { before, after: r.program }, req);
    res.json({ program: r.program, message: r.program.enabled ? 'Saved. The programme is on.' : 'Saved. The programme is off.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/settle', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const r = await settleReferrals();
    await audit(req.user, 'REFERRALS_SETTLED', { type: 'Referral' }, r, req);
    res.json({ ...r, message: `${r.rewarded} rewarded, ${r.voided} cancelled, ${r.waiting} on hold for a check.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/rewards/:id/paid', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid reward' });
    const reference = String(req.body?.reference ?? '').trim();
    if (reference.length < 4 || reference.length > 60) return res.status(400).json({ error: 'Enter the bank reference of the payment (4 to 60 characters)' });
    const r = await ReferralReward.findOneAndUpdate({ _id: req.params.id, status: 'due' }, { status: 'paid', paidAt: new Date(), paidBy: req.user.email, reference }, { new: true });
    if (!r) return res.status(409).json({ error: 'That reward is not waiting for payment' });
    await audit(req.user, 'REFERRAL_REWARD_PAID', { type: 'ReferralReward', id: r._id }, { amount: r.amount, reference, userId: String(r.userId) }, req);
    await notify(r.userId, { type: 'REFERRAL_REWARD', title: 'Referral reward paid', message: `Your referral reward of ₹${r.amount.toLocaleString('en-IN')} has been paid to your bank account. Reference: ${reference}.` }, { sms: false });
    res.json({ message: 'Marked as paid.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/rewards/:id/void', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid reward' });
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 4) return res.status(400).json({ error: 'Say why the reward is being cancelled' });
    const r = await ReferralReward.findOneAndUpdate({ _id: req.params.id, status: 'due' }, { status: 'void', voidReason: reason.slice(0, 300) }, { new: true });
    if (!r) return res.status(409).json({ error: 'Only a reward that is waiting for payment can be cancelled' });
    await audit(req.user, 'REFERRAL_REWARD_VOIDED', { type: 'ReferralReward', id: r._id }, { amount: r.amount, reason, userId: String(r.userId) }, req);
    res.json({ message: 'Cancelled.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
