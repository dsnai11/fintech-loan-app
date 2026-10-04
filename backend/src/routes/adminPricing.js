import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getPolicy, savePolicy, sampleQuotes, missingInstitutionDetails, PLAN_KEYS } from '../services/pricingPolicy.js';

const router = express.Router();
router.use(adminMiddleware);

const view = policy => ({ policy, samples: sampleQuotes(policy), missingInstitutionDetails: missingInstitutionDetails(policy) });

router.get('/', (req, res) => res.json(view(getPolicy())));

// Send any subset of the settings; whatever is left out stays as it is.
router.put('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Send the settings as a JSON object' });

    const before = getPolicy();
    const candidate = JSON.parse(JSON.stringify(before));
    const merge = (target, input) => {
      for (const key of Object.keys(target)) {
        if (!(key in input)) continue;
        if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
          if (input[key] && typeof input[key] === 'object') merge(target[key], input[key]);
        } else {
          target[key] = input[key];
        }
      }
    };
    merge(candidate, body);

    const result = await savePolicy(candidate, req.user.email);
    if (!result.ok) return res.status(result.status).json({ error: result.errors[0], errors: result.errors });

    await audit(req.user, 'PRICING_UPDATED', { type: 'Config', id: 'PRICING_POLICY' }, { before, after: result.policy, plans: PLAN_KEYS }, req);
    res.json({ message: 'Saved. New applications use these terms. Existing loans keep the terms they were given.', ...view(result.policy) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
