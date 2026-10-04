import express from 'express';
import { getPolicy, publicPolicy, computeQuote, checkRequest } from '../services/pricingPolicy.js';

// Public: the app and portal read the current terms from here instead of carrying their own numbers.
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ policy: publicPolicy(getPolicy()) });
});

function parse(query, policy) {
  const amount = Number(query.amount ?? policy.offerAmount);
  const tenureMonths = query.tenure === undefined ? undefined : Number(query.tenure);
  return { amount, tenureMonths, planType: query.plan ? String(query.plan) : undefined };
}

// One quote: ?amount=30000&plan=3_emi   or   ?amount=100000&tenure=12 for a standard loan
router.get('/quote', (req, res) => {
  const policy = getPolicy();
  const input = parse(req.query, policy);
  const problem = checkRequest(policy, input);
  if (problem) return res.status(400).json({ error: problem });
  res.json({ quote: computeQuote(policy, input) });
});

// All enabled plans for one amount, for the plan-picker screen.
router.get('/quotes', (req, res) => {
  const policy = getPolicy();
  const { amount } = parse(req.query, policy);
  const quotes = [];
  for (const [key, plan] of Object.entries(policy.plans)) {
    if (!plan.enabled) continue;
    const problem = checkRequest(policy, { amount, planType: key });
    if (problem) return res.status(400).json({ error: problem });
    quotes.push(computeQuote(policy, { amount, planType: key }));
  }
  res.json({ amount, quotes });
});

export default router;
