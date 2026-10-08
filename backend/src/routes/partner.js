import express from 'express';
import Partner from '../models/Partner.js';
import { partnerAuth, login, summaryOf } from '../services/partnerService.js';
import { audit } from '../services/auditService.js';

// What a partner sees when they sign in: their customers' progress and their commissions. Customers' names are shortened
// and phone numbers hidden; a partner never sees a loan's details beyond the amount paid out.
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const r = await login(req.body?.email, req.body?.password);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ token: r.token, mustChangePassword: r.partner.mustChangePassword, name: r.partner.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', partnerAuth, async (req, res) => {
  try {
    res.json(await summaryOf(req.partner));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/change-password', partnerAuth, async (req, res) => {
  try {
    const { current, next } = req.body || {};
    const p = await Partner.findById(req.partner._id).select('+passwordHash');
    if (!(await p.checkPassword(current))) return res.status(400).json({ error: 'Your current password is not right.' });
    if (typeof next !== 'string' || next.length < 10 || next.length > 128) return res.status(400).json({ error: 'Choose a new password of at least 10 characters.' });
    await p.setPassword(next);
    p.mustChangePassword = false;
    await p.save();
    await audit({ email: p.email, role: 'partner' }, 'PARTNER_PASSWORD_CHANGED', { type: 'Partner', id: p._id }, {}, req);
    res.json({ changed: true, message: 'Password changed. Please sign in again.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
