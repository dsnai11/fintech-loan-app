import express from 'express';
import jwt from 'jsonwebtoken';
import { maxAmountFor } from '../services/repeatLoan.js';
import { policyFor } from '../services/appSettings.js';
import { getPolicy, publicPolicy, computeQuote, checkRequest, quoteProblem } from '../services/pricingPolicy.js';
import { contextFor } from '../services/chargeContext.js';
import { activeOffer, offerLimitOn } from '../services/offerService.js';
import User from '../models/User.js';

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
function userIdOf(req) {
  try {
    const t = req.headers.authorization?.split(' ')[1];
    if (!t) return null;
    const d = jwt.verify(t, process.env.JWT_SECRET);
    return d.purpose || !d.userId ? null : d.userId;
  } catch { return null; }
}
async function limitFor(req, policy) {
  const id = userIdOf(req);
  if (!id) return policy.maxAmount;
  const limit = await maxAmountFor(id, policy);
  // A customer with a valid offer cannot be quoted more than it.
  const offer = offerLimitOn() ? activeOffer(await User.findById(id).select('offer')) : null;
  return offer ? Math.min(limit, offer.status === 'DECLINED' ? 0 : offer.amount) : limit;
}
// The customer's state (from their saved address) and the add-ons they have ticked, for the charges engine.
async function chargeCtx(req) {
  const id = userIdOf(req);
  const user = id ? await User.findById(id).select('address') : null;
  return contextFor(user, { state: req.query.state, pincode: req.query.pincode, optional: req.query.optional });
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
  const quote = computeQuote(policy, input, await chargeCtx(req));
  const bad = quoteProblem(quote);
  if (bad) return res.status(400).json({ error: bad });
  res.json({ quote });
});

// All enabled plans for one amount, for the plan-picker screen.
router.get('/quotes', async (req, res) => {
  const policy = forProduct(req, res);
  if (!policy) return;
  const { amount } = parse(req.query, policy);
  const limit = await limitFor(req, policy);
  const quotes = [];
  const ctx = await chargeCtx(req);
  for (const [key, plan] of Object.entries(policy.plans)) {
    if (!plan.enabled) continue;
    const problem = checkRequest(policy, { amount, planType: key }, limit);
    if (problem) return res.status(400).json({ error: problem });
    const quote = computeQuote(policy, { amount, planType: key }, ctx);
    const bad = quoteProblem(quote);
    if (bad) return res.status(400).json({ error: bad });
    quotes.push(quote);
  }
  res.json({ amount, quotes });
});

export default router;
