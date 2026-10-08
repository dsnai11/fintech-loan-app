import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { setManyConfig } from '../services/configService.js';
import { integrationsView, editableKeys } from '../services/integrations.js';
import { checkSetup } from '../services/pushService.js';
import Notification from '../models/Notification.js';

// Whether each outside service is live or in test mode, and the settings that switch it over.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', (req, res) => res.json(integrationsView()));

// Tests the push connection without sending anything to customers, and shows what happened to the latest notifications
router.get('/push-check', async (req, res) => {
  try {
    const r = await checkSetup();
    const recent = await Notification.find({}).sort({ createdAt: -1 }).limit(5).select('type channels.push createdAt').lean();
    res.json({ ...r, recent: recent.map(n => ({ type: n.type, push: n.channels?.push || 'skipped', at: n.createdAt })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const allowed = editableKeys();
    const input = req.body?.values;
    if (!input || typeof input !== 'object') return res.status(400).json({ error: 'Send the settings as { values: { KEY: value } }' });
    const toSave = {};
    for (const [k, v] of Object.entries(input)) {
      const meta = allowed.get(k);
      if (!meta) return res.status(400).json({ error: `${k} is not a setting you can change here` });
      const val = String(v ?? '').trim();
      if (meta.secret && val === '') continue; // an empty secret box means "keep what is saved"
      if (val.length > 2000) return res.status(400).json({ error: `${k} is too long` });
      toSave[k] = { value: val, isSecret: meta.secret, group: meta.group };
    }
    if (!Object.keys(toSave).length) return res.json({ message: 'Nothing to change.', ...integrationsView() });
    await setManyConfig(toSave, req.user.email);
    await audit(req.user, 'INTEGRATIONS_UPDATED', { type: 'Config' }, { keys: Object.keys(toSave) }, req); // names only, never values
    res.json({ message: 'Saved. New requests use these settings straight away.', ...integrationsView() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
