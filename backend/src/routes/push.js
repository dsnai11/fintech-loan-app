import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { CATEGORIES, pushConfigured, registerDevice, unregisterDevice, testToUser } from '../services/pushService.js';

// The customer's phone registering for push notifications, and their choices about which kinds to get.
const router = express.Router();
router.use(authMiddleware);

const view = async userId => {
  const user = await User.findById(userId).select('pushPrefs');
  return {
    available: pushConfigured(), // false until the company sets up Firebase
    categories: CATEGORIES.map(c => ({ key: c.key, label: c.label, note: c.note, locked: !!c.locked, on: c.locked ? true : user?.pushPrefs?.[c.key] !== false })),
  };
};

router.get('/preferences', async (req, res) => {
  try {
    res.json(await view(req.user.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/preferences', async (req, res) => {
  try {
    const set = {};
    for (const c of CATEGORIES) {
      if (c.locked || typeof req.body?.[c.key] !== 'boolean') continue;
      set[`pushPrefs.${c.key}`] = req.body[c.key];
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Choose which notifications you want' });
    await User.updateOne({ _id: req.user.userId }, { $set: set });
    res.json(await view(req.user.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A test notification to the customer's own phone, with the result in plain words
const lastTest = new Map();
router.post('/test', async (req, res) => {
  try {
    const key = String(req.user.userId);
    if (Date.now() - (lastTest.get(key) || 0) < 8000) return res.status(429).json({ error: 'Please wait a few seconds before trying again.' });
    lastTest.set(key, Date.now());
    res.json(await testToUser(req.user.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const token = String(req.body?.token ?? '');
    const platform = String(req.body?.platform ?? '');
    if (token.length < 20 || token.length > 4096 || /\s/.test(token)) return res.status(400).json({ error: 'That is not a device token' });
    if (!['android', 'ios'].includes(platform)) return res.status(400).json({ error: 'Platform must be android or ios' });
    await registerDevice(req.user.userId, { token, platform, appVersion: String(req.body?.appVersion ?? '').slice(0, 20) });
    res.json({ registered: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/register', async (req, res) => {
  try {
    await unregisterDevice(req.user.userId, String(req.body?.token ?? ''));
    res.json({ registered: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
