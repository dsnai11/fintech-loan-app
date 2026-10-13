import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { fromApp, fromWeb, CONSENT_TEXT } from '../services/leadService.js';

// "Call me about this loan": from the signed-in app (for products partners provide) and from the company's website pages.
export const customerRouter = express.Router();

customerRouter.get('/consent', (req, res) => res.json({ text: CONSENT_TEXT }));

customerRouter.post('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await fromApp(user, req.body || {}, req);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.status(r.status).json({ message: r.duplicate ? 'We already have your request from today. We will call you soon.' : 'Thank you. We will call you soon.', id: r.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// No sign-in: the website pages post here
export const publicRouter = express.Router();
publicRouter.post('/', async (req, res) => {
  try {
    const r = await fromWeb(req.body || {}, req);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.status(r.status).json({ message: 'Thank you. We will call you soon.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
