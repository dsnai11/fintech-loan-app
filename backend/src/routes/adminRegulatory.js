import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { classify, getPolicy, savePolicy, bureauFile, ckycFile, ckycReadiness, classificationFile, toCsv, CLASS_LABEL } from '../services/regulatoryService.js';

// Asset classification (SMA / NPA), provisioning, and the files for credit bureaus and CKYC. For the compliance and finance teams.
const router = express.Router();
router.use(adminMiddleware);

router.get('/classification', async (req, res) => {
  try {
    const c = await classify();
    const only = String(req.query.class || '');
    const loans = (only ? c.loans.filter(l => l.class === only) : c.loans).slice(0, 500).map(l => ({ ...l, classLabel: CLASS_LABEL[l.class] }));
    res.json({ asOf: c.asOf, summary: c.summary, stages: c.stages, totals: c.totals, policy: c.policy, canEditPolicy: can(req.user.role, 'config.manage'), loans, shown: loans.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/policy', (req, res) => res.json({ policy: getPolicy(), canEdit: can(req.user.role, 'config.manage') }));

router.put('/policy', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return res.status(403).json({ error: 'Your role cannot change the classification rules.', code: 'NOT_PERMITTED', needs: 'config.manage' });
    const before = getPolicy();
    const r = await savePolicy(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'ASSET_POLICY_UPDATED', { type: 'Config', id: 'ASSET_POLICY' }, { before: before.rates, after: r.policy.rates, npaFrom: r.policy.npaFrom }, req);
    res.json({ message: 'Saved. The numbers below now use these rules.', policy: r.policy });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/ckyc/readiness', async (req, res) => {
  try {
    res.json(await ckycReadiness());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Files. Each download is written to the audit log.
const FILES = {
  bureau: { build: bureauFile, name: 'credit-bureau-accounts' },
  ckyc: { build: ckycFile, name: 'ckyc-customers' },
  classification: { build: classificationFile, name: 'asset-classification' },
};
router.get('/export/:kind', async (req, res) => {
  try {
    const f = FILES[req.params.kind];
    if (!f) return res.status(404).json({ error: 'Unknown file' });
    const { header, rows } = await f.build();
    await audit(req.user, 'REGULATORY_EXPORT', { type: 'Export', id: req.params.kind }, { rows: rows.length }, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(header, rows));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
