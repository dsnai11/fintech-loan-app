import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { vintage, rollRate, acquisition } from '../services/portfolioReports.js';

// Vintage, roll-rate and customer-source reports for the credit and growth teams.
const router = express.Router();
router.use(adminMiddleware);

const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : undefined);
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req.query)); } catch (e) { res.status(500).json({ error: e.message }); }
};

router.get('/vintage', wrap(q => vintage({ months: Math.min(24, Math.max(3, Number(q.months) || 12)), threshold: Number(q.dpd) || 30 })));
router.get('/roll-rate', wrap(q => rollRate({ from: date(q.from), to: date(q.to) })));
router.get('/acquisition', wrap(q => acquisition({ from: date(q.from), to: date(q.to) })));

export default router;
