import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { getConfigObj, save, example, PRODUCTS } from '../services/landingPages.js';

// The company's public loan pages: switch them on, set the app links, and edit the pages.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', (req, res) => {
  const config = getConfigObj();
  res.json({ config, products: PRODUCTS, previews: Object.fromEntries(config.pages.map(p => [p.slug, example(p) ? 'worked example shown' : 'no example: the amount is outside what this product lends'])), canEdit: can(req.user.role, 'banners.edit') });
});

router.put('/', async (req, res) => {
  try {
    if (!can(req.user.role, 'banners.edit')) return res.status(403).json({ error: 'Your role cannot change the website pages.', code: 'NOT_PERMITTED', needs: 'banners.edit' });
    const before = getConfigObj();
    const r = await save(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'WEBSITE_PAGES_UPDATED', { type: 'Config', id: 'LANDING_PAGES' }, { enabled: { before: before.enabled, after: r.config.enabled }, pages: r.config.pages.length }, req);
    res.json({ message: r.config.enabled ? 'Saved. The pages are live.' : 'Saved. The pages are off, so nobody can see them.', config: r.config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
