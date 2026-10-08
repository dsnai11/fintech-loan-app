import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { report, saveSettings } from '../services/slaService.js';

// Service-level timers for the managers.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', async (req, res) => {
  try {
    res.json({ ...(await report()), canEdit: can(req.user.role, 'config.manage') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return res.status(403).json({ error: 'Your role cannot change the service targets.', code: 'NOT_PERMITTED', needs: 'config.manage' });
    const r = await saveSettings(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'SLA_UPDATED', { type: 'Config', id: 'SLA_SETTINGS' }, { hours: r.settings.hours, alertEmail: r.settings.alertEmail ? 'set' : '' }, req);
    res.json({ message: 'Saved.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
