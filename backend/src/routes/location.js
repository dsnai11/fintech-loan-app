import express from 'express';
import User from '../models/User.js';
import LocationEvent from '../models/LocationEvent.js';
import { authMiddleware } from '../middleware/auth.js';

// The app sends the phone's location at key moments (applying for a loan, verifying identity), with the customer's permission.
// It is used by the loan rules (one place with many customers, a faked location) and shown to staff on the customer page.
const router = express.Router();
router.use(authMiddleware);

const PURPOSES = ['apply', 'kyc', 'login', 'other'];
const PER_HOUR = 30;

router.post('/', async (req, res) => {
  try {
    const { lat, lon, accuracy, mocked, purpose } = req.body || {};
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180 || (la === 0 && lo === 0)) return res.status(400).json({ error: 'That location is not valid' });
    const acc = accuracy === undefined || accuracy === null ? undefined : Number(accuracy);
    if (acc !== undefined && (!Number.isFinite(acc) || acc < 0 || acc > 1e6)) return res.status(400).json({ error: 'That location is not valid' });
    const recent = await LocationEvent.countDocuments({ userId: req.user.userId, at: { $gte: new Date(Date.now() - 3600 * 1000) } });
    if (recent >= PER_HOUR) return res.status(429).json({ error: 'Too many location updates. Please try again later.' });
    const ev = await LocationEvent.create({
      userId: req.user.userId,
      purpose: PURPOSES.includes(purpose) ? purpose : 'other',
      lat: Math.round(la * 1e5) / 1e5,
      lon: Math.round(lo * 1e5) / 1e5,
      accuracy: acc,
      mocked: mocked === true,
      ip: req.ip || '',
      platform: String(req.get('x-platform') || '').slice(0, 20),
    });
    await User.updateOne({ _id: req.user.userId }, { lastLocation: { lat: ev.lat, lon: ev.lon, accuracy: ev.accuracy, mocked: ev.mocked, purpose: ev.purpose, at: ev.at } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
