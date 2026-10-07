import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getPolicy, computeQuote, sampleQuotes, PLAN_KEYS } from '../services/pricingPolicy.js';
import { getChargesConfig, validateCharges, saveCharges, STATES, BRE_PRESET } from '../services/chargesEngine.js';
import { parseOptional } from '../services/chargeContext.js';

// The lender's charge rules (file charge, document charge, insurance, stamping...) and a way to see what they
// cost customers before they go live. Same permissions as the Pricing page.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', (req, res) => {
  const policy = getPolicy();
  res.json({ config: getChargesConfig(), states: STATES, plans: Object.fromEntries(Object.entries(policy.plans).map(([k, p]) => [k, p.label])), gstPercent: policy.gstPercent, maxAprPercent: policy.maxAprPercent });
});

// The starter set from the lender's BRE sheet. Loading it does not save anything.
router.get('/preset', (req, res) => res.json({ charges: BRE_PRESET }));

// If the lender set an APR ceiling, no state or add-on combination may go above it.
function ceilingProblems(policy, cfg) {
  if (policy.maxAprPercent == null || !cfg.enabled) return [];
  const states = ['', ...new Set(cfg.charges.flatMap(c => c.conditions.states))];
  const everyAddOn = cfg.charges.filter(c => c.optional).map(c => c.id);
  const problems = new Set();
  for (const state of states) {
    for (const optional of [[], everyAddOn]) {
      for (const q of sampleQuotes(policy, { chargesCfg: cfg, state, optional })) {
        if (q.aprPercent > policy.maxAprPercent) problems.add(`${q.label}${state ? ` in ${state}` : ''}${optional.length ? ' with every add-on' : ''}: APR ${q.aprPercent}% is above your ceiling of ${policy.maxAprPercent}%`);
      }
    }
  }
  return [...problems].slice(0, 6);
}

router.put('/', async (req, res) => {
  try {
    const before = getChargesConfig();
    const { errors, config } = validateCharges(req.body, PLAN_KEYS);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const over = ceilingProblems(getPolicy(), config);
    if (over.length) return res.status(409).json({ error: over[0], errors: over });
    const r = await saveCharges(config, req.user.email, PLAN_KEYS);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'CHARGES_UPDATED', { type: 'Config', id: 'CHARGES_POLICY' }, { before, after: r.config }, req);
    res.json({ message: r.config.enabled ? 'Saved. New applications use these charges.' : 'Saved. The charge rules are switched off, so the single processing fee on the Pricing page still applies.', config: r.config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// What customers would pay. Uses the rules in the request (unsaved) if sent, otherwise the saved ones.
router.post('/preview', (req, res) => {
  try {
    const policy = getPolicy();
    let cfg = getChargesConfig();
    if (req.body?.config) {
      const v = validateCharges(req.body.config, PLAN_KEYS);
      if (v.errors.length) return res.status(400).json({ error: v.errors[0], errors: v.errors });
      cfg = v.config;
    }
    const state = STATES.includes(req.body?.state) ? req.body.state : '';
    const optional = parseOptional(req.body?.optional);
    const amounts = [...new Set([10000, 30000, 100000, 300000].map(a => Math.min(policy.maxAmount, Math.max(policy.minAmount, a))))];
    const rows = [];
    for (const amount of amounts) {
      for (const [key, plan] of Object.entries(policy.plans)) {
        if (!plan.enabled) continue;
        const q = computeQuote(policy, { amount, planType: key }, { chargesCfg: cfg, state, optional });
        rows.push({ amount, plan: plan.label, charges: q.charges, addOns: q.addOns, totalCharges: q.totalCharges, netDisbursed: q.netDisbursed, aprPercent: q.aprPercent });
      }
    }
    res.json({ state, enabled: cfg.enabled, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
