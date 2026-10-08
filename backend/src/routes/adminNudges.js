import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getSettings, saveSettings, runNudges, overview } from '../services/nudgeService.js';

// Staff side of nudges for customers who dropped out part-way.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', async (req, res) => {
  try {
    res.json(await overview());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const before = getSettings();
    const r = await saveSettings(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'NUDGES_UPDATED', { type: 'Config', id: 'NUDGE_SETTINGS' }, { enabledBefore: before.enabled, enabledAfter: r.settings.enabled, on: Object.entries(r.settings.segments).filter(([, v]) => v.enabled).map(([k]) => k) }, req);
    res.json({ message: r.settings.enabled ? 'Saved. Nudges are on.' : 'Saved. Nudges are off.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const r = await runNudges();
    await audit(req.user, 'NUDGES_RUN', { type: 'Config', id: 'NUDGE_SETTINGS' }, r, req);
    res.json({ ...r, message: r.off ? 'Nudges are switched off.' : r.quiet ? 'It is quiet hours, so nothing was sent.' : `${r.sent} nudges sent.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
