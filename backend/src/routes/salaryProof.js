import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { statusFor, submit } from '../services/salaryProofService.js';

// The customer's salary slip: see where it stands, and send a new one.
const router = express.Router();
router.use(authMiddleware);

router.get('/status', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(await statusFor(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await submit(user, req.body || {}, req);
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
    res.status(201).json({ message: 'We have your salary slip and will check it soon. We will tell you the moment it is done.', id: r.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
