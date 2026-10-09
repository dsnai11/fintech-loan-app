import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { screenLoan } from '../services/amlService.js';
import { decideLoan } from '../services/decisionEngine.js';
import { recordDevice } from '../services/deviceService.js';
import { eligibility, quoteFor, apply, saveSalaryDay } from '../services/paydayService.js';

// The customer's payday advance: what they can borrow, their salary day, the cost, and applying.
const router = express.Router();
router.use(authMiddleware);

const me = async req => User.findById(req.user.userId);

router.get('/status', async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(await eligibility(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/salary-day', async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await saveSalaryDay(user, req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    await audit(req.user, 'SALARY_DAY_SET', { type: 'User', id: user._id }, { salaryDay: user.employment.salaryDay }, req);
    res.json(await eligibility(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/quote', async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const e = await eligibility(user);
    if (!e.enabled || !e.salaryDay) return res.status(400).json({ error: e.enabled ? 'Add your salary day first.' : 'The payday advance is not available right now.' });
    const amount = Number(req.query.amount);
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Choose an amount.' });
    const quote = quoteFor(amount, e.salaryDay);
    if (!quote) return res.status(400).json({ error: 'We could not work out your payday date.' });
    res.json({ quote, withinLimit: amount >= e.minAmount && amount <= e.maxAmount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/apply', async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await apply(user, Number(req.body?.amount), req, { audit, recordDevice, screenLoan, decideLoan });
    if (r.status !== 201) return res.status(r.status).json({ error: r.error, code: r.code });
    res.status(201).json({
      message: 'Your payday advance request has been received.',
      loan: { id: r.loan._id, loanAmount: r.loan.loanAmount, status: r.loan.status, disbursedAmount: r.quote.netDisbursed, repay: r.quote.totalRepayable, dueDate: r.quote.payday.dueDate, days: r.quote.payday.days, aprPercent: r.quote.aprPercent, kfs: r.quote },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
