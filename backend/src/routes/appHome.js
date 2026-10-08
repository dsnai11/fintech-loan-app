import express from 'express';
import User from '../models/User.js';
import BannerStat from '../models/BannerStat.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { approvalRequired, propose } from '../services/changeApprovals.js';
import { getHome, saveHome, validateHome, homeFor } from '../services/homeContent.js';

// The home-screen branding and offer banners: what the app reads, and where staff change it.
const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('firstName offer');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await homeFor(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The app reports a banner being shown or tapped.
router.post('/event', authMiddleware, async (req, res) => {
  try {
    const { id, type } = req.body || {};
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(id) || !['view', 'click'].includes(type)) return res.status(400).json({ error: 'Not a banner event' });
    if (!getHome().banners.some(b => b.id === id)) return res.status(204).end();
    await BannerStat.updateOne({ bannerId: id, day: new Date().toISOString().slice(0, 10) }, { $inc: type === 'view' ? { views: 1 } : { clicks: 1 } }, { upsert: true });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function statsFor(days = 30) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = await BannerStat.aggregate([{ $match: { day: { $gte: since } } }, { $group: { _id: '$bannerId', views: { $sum: '$views' }, clicks: { $sum: '$clicks' } } }]);
  return Object.fromEntries(rows.map(r => [r._id, { views: r.views, clicks: r.clicks }]));
}

router.get('/admin', adminMiddleware, async (req, res) => {
  try {
    res.json({ home: getHome(), stats: await statsFor(), statsDays: 30 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin', adminMiddleware, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Send the content as a JSON object' });
    const before = getHome();
    if (approvalRequired('APP_HOME')) {
      const check = validateHome({ ...before, ...req.body });
      if (check.errors.length) return res.status(400).json({ error: check.errors[0], errors: check.errors });
      const doc = await propose('APP_HOME', check.home, req.user, req);
      return res.status(202).json({ pending: true, requestId: String(doc._id), message: 'Sent for approval. It goes live once someone else approves it.', home: before });
    }
    const result = await saveHome({ ...before, ...req.body }, req.user.email);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });
    await audit(req.user, 'APP_HOME_UPDATED', { type: 'Config', id: 'APP_HOME' }, { before, after: result.home }, req);
    res.json({ message: 'Saved. Customers see the change the next time the home screen loads.', home: result.home });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
