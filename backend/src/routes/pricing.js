import express from 'express';
import jwt from 'jsonwebtoken';
import { maxAmountFor } from '../services/repeatLoan.js';
import { policyFor } from '../services/appSettings.js';
import { getPolicy, publicPolicy, computeQuote, checkRequest } from '../services/pricingPolicy.js';

// Public: the app and portal read the current terms from here instead of carrying their own numbers.
const router = express.Router();

const forProduct = (req, res) => {
  const policy = policyFor(req.query.product ? String(req.query.product) : undefined);
  if (!policy) { res.status(404).json({ error: 'That loan product is not available' }); return null; }
  return policy;
};

router.get('/', (req, res) => {
  const policy = forProduct(req, res);
  if (policy) res.json({ policy: publicPolicy(policy) });
});

// Public, but a signed-in customer is quoted against their own limit (repeat customers may borrow more).
async function limitFor(req, policy) {
  try {
    const t = req.headers.authorization?.split(' ')[1];
    if (!t) return policy.maxAmount;
    const d = jwt.verify(t, process.env.JWT_SECRET);
    return d.purpose || !d.userId ? policy.maxAmount : await maxAmountFor(d.userId, policy);
  } catch { return policy.maxAmount; }
}

function parse(query, policy) {
  const amount = Number(query.amount ?? policy.offerAmount);
  const tenureMonths = query.tenure === undefined ? undefined : Number(query.tenure);
  return { amount, tenureMonths, planType: query.plan ? String(query.plan) : undefined };
}

// One quote: ?amount=30000&plan=3_emi   or   ?amount=100000&tenure=12 for a standard loan
router.get('/quote', async (req, res) => {
  const policy = forProduct(req, res);
  if (!policy) return;
  const input = parse(req.query, policy);
  const problem = checkRequest(policy, input, await limitFor(req, policy));
  if (problem) return res.status(400).json({ error: problem });
  res.json({ quote: computeQuote(policy, input) });
});

// All enabled plans for one amount, for the plan-picker screen.
router.get('/quotes', async (req, res) => {
  const policy = forProduct(req, res);
  if (!policy) return;
  const { amount } = parse(req.query, policy);
  const limit = await limitFor(req, policy);
  const quotes = [];
  for (const [key, plan] of Object.entries(policy.plans)) {
    if (!plan.enabled) continue;
    const problem = checkRequest(policy, { amount, planType: key }, limit);
    if (problem) return res.status(400).json({ error: problem });
    quotes.push(computeQuote(policy, { amount, planType: key }));
  }
  res.json({ amount, quotes });
});

export default router;
