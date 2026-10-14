import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { can } from '../services/permissions.js';
import { queue, image, review } from '../services/salaryProofService.js';

// Staff check salary slips. Looking follows "see KYC"; deciding needs "decide KYC". Every photo viewed is logged.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', async (req, res) => {
  try {
    res.json({ slips: await queue({ status: String(req.query.status || 'pending') }), canDecide: can(req.user.role, 'kyc.decide') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/photo/:n', async (req, res) => {
  try {
    const f = await image(req.params.id, req.params.n, req.user, req);
    if (!f) return res.status(404).json({ error: 'No such photo (it may have been deleted)' });
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!can(req.user.role, 'kyc.decide')) return res.status(403).json({ error: 'Your role cannot decide on salary slips.', code: 'NOT_PERMITTED', needs: 'kyc.decide' });
    const r = await review(req.params.id, req.user, req.body || {}, req);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ message: req.body?.decision === 'approve' ? 'Confirmed. The customer has been told.' : 'Sent back. The customer has been told.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
