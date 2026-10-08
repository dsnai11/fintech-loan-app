import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import { offersFor, customerRespond, viewOffer } from '../services/collectionsAutomation.js';

// The customer's side of a settlement offer: see it, accept it or say no. The payment itself is made outside the app and
// recorded by the collections team.
const router = express.Router();

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    res.json({ offers: await offersFor(req.user.userId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const respond = accept => async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid offer' });
    const r = await customerRespond(req.params.id, req.user.userId, accept);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ offer: viewOffer(r.offer) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.post('/:id/accept', authMiddleware, respond(true));
router.post('/:id/decline', authMiddleware, respond(false));

export default router;
