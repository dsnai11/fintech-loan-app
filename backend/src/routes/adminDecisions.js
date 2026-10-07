import express from 'express';
import Loan from '../models/Loan.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getRules, saveRules, validateRules, evaluate, MODES } from '../services/decisionEngine.js';

// The rules the decision engine follows, a way to try them out, and what it has decided so far.
const router = express.Router();
router.use(adminMiddleware);

const FACT_FIELDS = ['amount', 'age', 'bureauScore', 'openAmlAlerts', 'defaultedLoans', 'openLoans', 'overdueEmis'];

router.get('/rules', (req, res) => res.json({ rules: getRules(), modes: MODES }));

router.put('/rules', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Send the rules as a JSON object' });
    const before = getRules();
    const r = await saveRules({ ...before, ...req.body }, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'DECISION_RULES_UPDATED', { type: 'Config', id: 'DECISION_RULES' }, { before, after: r.rules }, req);
    res.json({ message: r.rules.mode === 'auto' ? 'Saved. Applications that pass every rule are now approved automatically.' : 'Saved.', rules: r.rules });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Try the rules on an imagined applicant. Optionally try unsaved rules too.
router.post('/test', (req, res) => {
  try {
    let rules = getRules();
    if (req.body?.rules) {
      const v = validateRules({ ...rules, ...req.body.rules });
      if (v.errors.length) return res.status(400).json({ error: v.errors[0], errors: v.errors });
      rules = v.rules;
    }
    const f = req.body?.facts || {};
    const facts = { kycApproved: f.kycApproved === true, phoneVerified: f.phoneVerified === true, repeatCustomer: f.repeatCustomer === true };
    for (const k of FACT_FIELDS) {
      const n = Number(f[k] ?? 0);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return res.status(400).json({ error: `${k} is not a valid number` });
      facts[k] = n;
    }
    res.json({ ...evaluate(rules, facts), mode: rules.mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recent decisions, and (while in shadow mode) how often the engine and the people agree.
router.get('/', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400000);
    const match = { 'decision.at': { $gte: since } };
    const [recent, counts, shadow] = await Promise.all([
      Loan.find(match).sort({ 'decision.at': -1 }).limit(50).populate('userId', 'firstName lastName').select('loanAmount status decision userId createdAt'),
      Loan.aggregate([{ $match: match }, { $group: { _id: { outcome: '$decision.outcome', applied: '$decision.applied' }, n: { $sum: 1 } } }]),
      Loan.find({ ...match, 'decision.mode': 'shadow' }).select('status decision.outcome'),
    ]);

    const approvedByPerson = ['approved', 'disbursed', 'closed', 'defaulted', 'written_off'];
    const cal = { wouldApprove: { personApproved: 0, personRejected: 0, waiting: 0 }, wouldReject: { personApproved: 0, personRejected: 0, waiting: 0 }, wouldRefer: 0 };
    for (const l of shadow) {
      const o = l.decision.outcome;
      if (o === 'REFER') { cal.wouldRefer++; continue; }
      const bucket = o === 'APPROVE' ? cal.wouldApprove : cal.wouldReject;
      if (approvedByPerson.includes(l.status)) bucket.personApproved++;
      else if (l.status === 'rejected') bucket.personRejected++;
      else bucket.waiting++;
    }

    res.json({
      days,
      rules: { mode: getRules().mode },
      counts: counts.map(c => ({ outcome: c._id.outcome, applied: !!c._id.applied, n: c.n })),
      calibration: cal,
      recent: recent.map(l => ({
        loanId: String(l._id),
        customer: l.userId ? `${l.userId.firstName} ${l.userId.lastName}` : 'Unknown',
        amount: l.loanAmount,
        status: l.status,
        outcome: l.decision.outcome,
        applied: !!l.decision.applied,
        mode: l.decision.mode,
        referTo: l.decision.referTo || null,
        reasons: (l.decision.checks || []).filter(c => c.result === 'refer' || c.result === 'reject').map(c => `${c.name}: ${c.detail}`),
        at: l.decision.at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
