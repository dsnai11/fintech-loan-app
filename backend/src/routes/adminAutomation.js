import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { getSettings, saveSettings, runAutoPayouts, overview } from '../services/payoutService.js';

// Which money-out tasks are done by the system and which by people, and what the system has done.
const router = express.Router();
router.use(adminMiddleware);

const deny = res => res.status(403).json({ error: 'Your role cannot change automatic payments.', code: 'NOT_PERMITTED', needs: 'config.manage' });

router.get('/', async (req, res) => {
  try {
    res.json({ ...(await overview()), canEdit: can(req.user.role, 'config.manage') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return deny(res);
    const before = getSettings();
    const r = await saveSettings(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'AUTOMATION_UPDATED', { type: 'Config', id: 'AUTOMATION_SETTINGS' }, { before: before.modes, after: r.settings.modes, limits: r.settings.limits }, req);
    res.json({ message: 'Saved.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return deny(res);
    const r = await runAutoPayouts();
    await audit(req.user, 'AUTOMATION_RUN', { type: 'Config', id: 'AUTOMATION_SETTINGS' }, r, req);
    res.json({ ...r, message: r.off ? 'Nothing is set to automatic.' : `${r.sent} sent, ${r.held} held back, ${r.failed} failed, ${r.limit} waiting for tomorrow's limit.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
