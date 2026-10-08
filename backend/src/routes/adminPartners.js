import express from 'express';
import mongoose from 'mongoose';
import Partner from '../models/Partner.js';
import PartnerCommission from '../models/PartnerCommission.js';
import User from '../models/User.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { createPartner, resetPassword, overview, markPaid, voidCommission } from '../services/partnerService.js';

// Staff side of partners: who they are, what they have earned, and paying them.
const router = express.Router();
router.use(adminMiddleware);

const need = (req, res) => {
  if (can(req.user.role, 'referrals.manage')) return true;
  res.status(403).json({ error: 'Your role cannot change partners.', code: 'NOT_PERMITTED', needs: 'referrals.manage' });
  return false;
};
const isId = id => mongoose.isValidObjectId(id);

router.get('/', async (req, res) => {
  try {
    res.json({ canManage: can(req.user.role, 'referrals.manage'), partners: await overview() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/commissions', async (req, res) => {
  try {
    const status = ['due', 'paid', 'void'].includes(req.query.status) ? { status: req.query.status } : {};
    const rows = await PartnerCommission.find(status).sort({ createdAt: -1 }).limit(300).lean();
    const partners = Object.fromEntries((await Partner.find({ _id: { $in: rows.map(r => r.partnerId) } }).lean()).map(p => [String(p._id), p]));
    const users = Object.fromEntries((await User.find({ _id: { $in: rows.map(r => r.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
    res.json({
      commissions: rows.map(r => {
        const p = partners[String(r.partnerId)] || {};
        return {
          id: String(r._id), partner: p.name || '', pan: p.panNumber || '',
          account: p.bank?.accountNumber ? `ending ${String(p.bank.accountNumber).slice(-4)}${p.bank.ifscCode ? ', ' + p.bank.ifscCode : ''}` : '',
          customer: users[String(r.userId)] || '', loanAmount: r.loanAmount, percent: r.percent, gross: r.gross, tds: r.tds, net: r.net,
          status: r.status, voidReason: r.voidReason || null, reference: r.reference || null, at: r.createdAt, paidAt: r.paidAt || null,
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!need(req, res)) return;
    const r = await createPartner(req.body, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.errors[0], errors: r.errors });
    // The first password is shown once, here, and never again
    res.status(201).json({ partner: { id: String(r.partner._id), name: r.partner.name, email: r.partner.email, code: r.partner.code }, temporaryPassword: r.password });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const p = await Partner.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const before = { commissionPercent: p.commissionPercent, status: p.status };
    if (b.commissionPercent !== undefined) {
      const n = Number(b.commissionPercent);
      if (!Number.isFinite(n) || n < 0 || n > 10) return res.status(400).json({ error: 'The commission must be between 0 and 10 percent' });
      p.commissionPercent = n;
    }
    if (b.status !== undefined) {
      if (!['active', 'blocked'].includes(b.status)) return res.status(400).json({ error: 'Status must be active or blocked' });
      p.status = b.status;
    }
    if (b.name !== undefined) p.name = String(b.name).trim().slice(0, 80) || p.name;
    if (b.phone !== undefined) p.phone = String(b.phone).slice(0, 15);
    if (b.panNumber !== undefined) p.panNumber = String(b.panNumber).toUpperCase().slice(0, 10);
    if (b.bank && typeof b.bank === 'object') p.bank = { accountHolder: String(b.bank.accountHolder || '').slice(0, 80), accountNumber: String(b.bank.accountNumber || '').slice(0, 20), ifscCode: String(b.bank.ifscCode || '').toUpperCase().slice(0, 11) };
    await p.save();
    await audit(req.user, 'PARTNER_UPDATED', { type: 'Partner', id: p._id }, { before, after: { commissionPercent: p.commissionPercent, status: p.status } }, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const p = await Partner.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ temporaryPassword: await resetPassword(p, req.user.email) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/commissions/:id/paid', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await markPaid(req.params.id, req.body?.reference, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ status: r.commission.status, gross: r.commission.gross, tds: r.commission.tds, net: r.commission.net });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/commissions/:id/void', async (req, res) => {
  try {
    if (!need(req, res)) return;
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await voidCommission(req.params.id, req.body?.reason, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ status: r.commission.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
