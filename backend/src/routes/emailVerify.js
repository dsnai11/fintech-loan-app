import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendEmailCode, verifyEmailCode, mode } from '../services/emailVerification.js';

// The signed-in customer proves they own the email address on their account.
const router = express.Router();
router.use(authMiddleware);

router.get('/status', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('email emailVerified emailVerifiedFor');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ verified: !!user.emailVerified && user.emailVerifiedFor === String(user.email || '').toLowerCase(), available: mode() !== 'unavailable', mode: mode() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await sendEmailCode(user);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await verifyEmailCode(user, req.body?.code, req);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
