import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { summary, refresh } from '../services/creditScoreService.js';

// The customer's free credit score and tips.
const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(await summary(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await refresh(user, req.body || {}, req);
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
    res.json(r.summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
