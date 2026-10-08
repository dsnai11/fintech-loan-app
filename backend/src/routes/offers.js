import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Offer from '../models/Offer.js';
import { authMiddleware } from '../middleware/auth.js';
import { offersFor } from '../services/promoOffers.js';
import { isLanguage } from '../services/i18n.js';

// The Offers tab of the customer app.
const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('language');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const lang = isLanguage(req.query.lang) ? req.query.lang : user.language || 'en';
    res.setHeader('Cache-Control', 'no-store');
    res.json({ offers: await offersFor(user, lang) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The app reports an offer being opened or its button tapped
router.post('/:id/event', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !['view', 'click'].includes(req.body?.type)) return res.status(400).json({ error: 'Not an offer event' });
    await Offer.updateOne({ _id: req.params.id, status: 'published' }, { $inc: req.body.type === 'view' ? { views: 1 } : { clicks: 1 } });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
