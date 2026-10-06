import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { publicTerms, getTermsRaw, saveTerms } from '../services/terms.js';

// Terms and conditions: anyone can read the current version, staff with the right can publish a new one.
const router = express.Router();

router.get('/terms', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicTerms());
});

// The editor sees the text with its {{placeholders}} intact.
router.get('/admin/terms', adminMiddleware, (req, res) => res.json(getTermsRaw()));

router.put('/admin/terms', adminMiddleware, async (req, res) => {
  try {
    const before = getTermsRaw();
    const r = await saveTerms({ title: req.body?.title, text: req.body?.text }, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.error });
    await audit(req.user, 'TERMS_PUBLISHED', { type: 'Config', id: 'TERMS' }, { fromVersion: before.version, toVersion: r.terms.version, characters: r.terms.text.length }, req);
    res.json({ message: `Version ${r.terms.version} is live. Customers will be asked to accept it the next time they open the app.`, ...r.terms });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
