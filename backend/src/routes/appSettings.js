import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getSettings, saveSettings, publicSettings } from '../services/appSettings.js';

// What the customer apps read on start, and where staff change it.
const router = express.Router();

router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicSettings());
});

router.get('/admin', adminMiddleware, (req, res) => res.json({ settings: getSettings() }));

router.put('/admin', adminMiddleware, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Send the settings as a JSON object' });
    const before = getSettings();
    const result = await saveSettings({ ...before, ...req.body }, req.user.email);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });
    await audit(req.user, 'APP_SETTINGS_UPDATED', { type: 'Config', id: 'APP_SETTINGS' }, { before, after: result.settings }, req);
    res.json({ message: 'Saved. The apps pick this up the next time they open.', settings: result.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
