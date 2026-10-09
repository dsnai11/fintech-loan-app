import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { getSettings, saveSettings, overview } from '../services/paydayService.js';

// Payday advances for staff: who is due when, who is late, and the rules that switch the product on.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', async (req, res) => {
  try {
    res.json({ ...(await overview()), canEdit: can(req.user.role, 'config.manage') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return res.status(403).json({ error: 'Your role cannot change the payday advance rules.', code: 'NOT_PERMITTED', needs: 'config.manage' });
    const before = getSettings();
    const r = await saveSettings(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'PAYDAY_SETTINGS_UPDATED', { type: 'Config', id: 'PAYDAY_SETTINGS' }, { before, after: r.settings }, req);
    res.json({ message: 'Saved.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
