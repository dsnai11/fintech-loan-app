import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { myReferral } from '../services/referralService.js';

// The customer's Refer and earn screen.
const router = express.Router();

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('referredBy');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await myReferral(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
