import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendCode, verifyCode } from '../services/phoneVerification.js';

// Phone number check for the signed-in customer: ask for a code, then enter it.
const router = express.Router();
router.use(authMiddleware);

router.post('/send', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await sendCode(user);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await verifyCode(user, req.body?.code ?? req.body?.otp, req);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
