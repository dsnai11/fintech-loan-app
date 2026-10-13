import express from 'express';
import Loan from '../models/Loan.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { getRules, effectiveRules, saveRules, validateRules, evaluate, computeOffer, MODES, CUSTOM_FIELDS, SUGGESTED_START, SUGGESTED_PRODUCTS, OVERRIDABLE, productKeyOf } from '../services/decisionEngine.js';
import { getSettings as appSettings } from '../services/appSettings.js';
import { approvalRequired, propose } from '../services/changeApprovals.js';
import { getPolicy } from '../services/pricingPolicy.js';

// The rules the decision engine follows, a way to try them out, and what it has decided so far.
const router = express.Router();
router.use(adminMiddleware);

const FACT_FIELDS = ['amount', 'age', 'bureauScore', 'openAmlAlerts', 'defaultedLoans', 'openLoans', 'overdueEmis', 'monthlyIncome', 'emi', 'applicationsRecent', 'rejectionsRecent', 'maxDaysLate', 'accountAgeDays', 'bureauEnquiries90', 'bureauMaxDpd', 'bureauActiveLoans', 'declaredIncome', 'verifiedMonthlyIncome', 'bankBounces', 'bankObligations', 'avgBankBalance', 'bankRisk'];

router.get('/rules', (req, res) => res.json({ rules: getRules(), modes: MODES, customFields: CUSTOM_FIELDS, suggested: SUGGESTED_START }));

// Saves the rules, or sends them for a second person's approval when the company requires that for rule changes
async function commit(req, res, candidate, before, okMessage) {
  if (approvalRequired('DECISION_RULES')) {
    const check = validateRules(candidate);
    if (check.errors.length) return res.status(400).json({ error: check.errors[0], errors: check.errors });
    const doc = await propose('DECISION_RULES', check.rules, req.user, req);
    return res.status(202).json({ pending: true, requestId: String(doc._id), message: 'Sent for approval. The rules change once someone else approves it.', rules: before });
  }
  const r = await saveRules(candidate, req.user.email);
  if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
  await audit(req.user, 'DECISION_RULES_UPDATED', { type: 'Config', id: 'DECISION_RULES' }, { before, after: r.rules }, req);
  res.json({ message: okMessage(r.rules), rules: r.rules });
}

router.put('/rules', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Send the rules as a JSON object' });
    const before = getRules();
    await commit(req, res, { ...before, ...req.body }, before, rules => (rules.mode === 'auto' ? 'Saved. Applications that pass every rule are now approved automatically.' : 'Saved.'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Rules by product ─────────────────────────────────────────────────────────────────────────────

// Every product a customer can apply for: the main loan, the payday advance, and the extra products set up in the portal
function productList() {
  const s = appSettings();
  const list = [{ key: 'personal', name: s.baseProduct?.name || 'Personal Loan' }, { key: 'payday', name: 'Payday Advance' }];
  for (const p of s.products || []) if (!list.some(x => x.key === productKeyOf(p.key))) list.push({ key: productKeyOf(p.key), name: p.name });
  for (const k of Object.keys(getRules().products || {})) if (!list.some(x => x.key === k)) list.push({ key: k, name: k });
  return list;
}

const sectionsOf = rules => Object.fromEntries(OVERRIDABLE.map(k => [k, rules[k]]));

router.get('/products', (req, res) => {
  const rules = getRules();
  res.json({
    sharedMode: rules.mode,
    products: productList().map(p => {
      const e = rules.products?.[p.key];
      const eff = effectiveRules(rules, p.key);
      return { ...p, ownMode: e?.mode || 'inherit', mode: eff.mode, changes: e ? Object.values(e.overrides || {}).reduce((n, o) => n + Object.keys(o).length, 0) : 0, ownRules: (e?.custom || []).length, sharedRulesApplying: eff.custom.length - (e?.custom || []).length };
    }),
  });
});

router.get('/products/:key', (req, res) => {
  const key = productKeyOf(req.params.key);
  const found = productList().find(p => p.key === key);
  if (!found) return res.status(404).json({ error: 'That product is not set up' });
  const rules = getRules();
  const e = rules.products?.[key] || { mode: 'inherit', overrides: {}, custom: [] };
  res.json({
    key,
    name: found.name,
    entry: e,
    shared: sectionsOf(rules),
    sharedMode: rules.mode,
    effective: sectionsOf(effectiveRules(rules, key)),
    effectiveMode: effectiveRules(rules, key).mode,
    sharedCustom: effectiveRules(rules, key).custom.filter(c => !(e.custom || []).some(x => x.id === c.id && x.name === c.name)),
    suggested: SUGGESTED_PRODUCTS[key] || null,
    customFields: CUSTOM_FIELDS,
  });
});

router.put('/products/:key', async (req, res) => {
  try {
    const key = productKeyOf(req.params.key);
    if (!productList().some(p => p.key === key)) return res.status(404).json({ error: 'That product is not set up' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Send the rules as a JSON object' });
    const before = getRules();
    const products = { ...(before.products || {}) };
    const { mode, overrides, custom, reset } = req.body;
    if (reset === true) delete products[key];
    else products[key] = { mode: mode ?? 'inherit', overrides: overrides || {}, custom: custom || [] };
    await commit(req, res, { ...before, products }, before, rules => {
      const m = effectiveRules(rules, key).mode;
      return reset === true ? 'This product now follows the shared rules.' : m === 'auto' ? 'Saved. This product now approves automatically when every rule passes.' : 'Saved.';
    });
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
    // Try it as one product, with that product's own rules
    if (req.body?.productKey) rules = effectiveRules(rules, req.body.productKey);
    const f = req.body?.facts || {};
    const facts = { kycApproved: f.kycApproved === true, phoneVerified: f.phoneVerified === true, repeatCustomer: f.repeatCustomer === true, bureauReportKnown: f.bureauReportKnown === true, incomeVerified: f.incomeVerified === true, selfieStatus: String(f.selfieStatus ?? 'passed').slice(0, 20), state: String(f.state ?? '').slice(0, 40), pincode: String(f.pincode ?? '').slice(0, 6) };
    for (const k of FACT_FIELDS) {
      const n = Number(f[k] ?? 0);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return res.status(400).json({ error: `${k} is not a valid number` });
      facts[k] = n;
    }
    facts.amountToIncomeMonths = facts.monthlyIncome > 0 ? Math.round((facts.amount / facts.monthlyIncome) * 10) / 10 : 0;
    res.json({ ...evaluate(rules, facts), offer: computeOffer(rules, facts, getPolicy()), mode: rules.mode });
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
    if (req.query.product) match.productKey = productKeyOf(req.query.product) === 'personal' ? { $in: ['personal', null] } : productKeyOf(req.query.product);
    const [recent, counts, shadow] = await Promise.all([
      Loan.find(match).sort({ 'decision.at': -1 }).limit(50).populate('userId', 'firstName lastName').select('loanAmount status decision userId createdAt productKey'),
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
      product: req.query.product ? productKeyOf(req.query.product) : null,
      rules: { mode: getRules().mode },
      counts: counts.map(c => ({ outcome: c._id.outcome, applied: !!c._id.applied, n: c.n })),
      calibration: cal,
      recent: recent.map(l => ({
        loanId: String(l._id),
        product: l.productKey || 'personal',
        customer: l.userId ? `${l.userId.firstName} ${l.userId.lastName}` : 'Unknown',
        amount: l.loanAmount,
        status: l.status,
        outcome: l.decision.outcome,
        applied: !!l.decision.applied,
        mode: l.decision.mode,
        reasons: (l.decision.checks || []).filter(c => c.result === 'refer' || c.result === 'reject').map(c => `${c.name}: ${c.detail}`),
        at: l.decision.at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
