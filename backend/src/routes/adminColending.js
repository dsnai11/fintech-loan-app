import express from 'express';
import mongoose from 'mongoose';
import ColendingPartner from '../models/ColendingPartner.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { toCsv } from '../services/regulatoryService.js';
import { overview, entries, settle, validatePartner, MAX_PARTNER_SHARE } from '../services/colendingService.js';

// Staff side of co-lending: the partner banks, how much each has funded, and the money to settle between us.
const router = express.Router();
router.use(adminMiddleware);

const deny = (res, needs, what) => res.status(403).json({ error: `Your role cannot ${what}.`, code: 'NOT_PERMITTED', needs });
const isId = id => mongoose.isValidObjectId(id);

router.get('/', async (req, res) => {
  try {
    res.json({ maxPartnerShare: MAX_PARTNER_SHARE, canManage: can(req.user.role, 'config.manage'), canSettle: can(req.user.role, 'loans.disburse'), partners: await overview() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/entries', async (req, res) => {
  try {
    res.json({ entries: await entries({ status: req.query.status, partnerId: isId(req.query.partnerId) ? req.query.partnerId : undefined }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/export', async (req, res) => {
  try {
    const list = await entries({ status: req.query.status });
    await audit(req.user, 'COLENDING_EXPORT', { type: 'Export', id: 'colending' }, { rows: list.length }, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="colending-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(['Date', 'Partner', 'Loan', 'Kind', 'Source', 'Instalment', 'Principal', 'Interest', 'Total', 'Status', 'Settled on', 'Reference'], list.map(e => [e.at.toISOString().slice(0, 10), e.partner, e.loanId, e.kind === 'funding' ? 'Partner pays in' : 'We pay the partner', e.source, e.emiNumber || '', e.principal, e.interest, e.total, e.status, e.settledAt ? e.settledAt.toISOString().slice(0, 10) : '', e.reference || ''])));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/partners', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return deny(res, 'config.manage', 'change co-lending partners');
    const { errors, value } = validatePartner(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const p = await ColendingPartner.create({ ...value, createdBy: req.user.email });
    await audit(req.user, 'COLENDING_PARTNER_ADDED', { type: 'Config', id: String(p._id) }, { name: p.name, share: p.partnerSharePercent, rate: p.partnerRatePercent }, req);
    res.status(201).json({ id: String(p._id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/partners/:id', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return deny(res, 'config.manage', 'change co-lending partners');
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const p = await ColendingPartner.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const { errors, value } = validatePartner({ ...p.toObject(), ...req.body });
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const before = { share: p.partnerSharePercent, rate: p.partnerRatePercent, active: p.active };
    Object.assign(p, value);
    await p.save();
    await audit(req.user, 'COLENDING_PARTNER_UPDATED', { type: 'Config', id: String(p._id) }, { before, after: { share: p.partnerSharePercent, rate: p.partnerRatePercent, active: p.active }, note: 'Changes apply to loans paid out from now on' }, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/entries/:id/settle', async (req, res) => {
  try {
    if (!can(req.user.role, 'loans.disburse')) return deny(res, 'loans.disburse', 'settle co-lending amounts');
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await settle(req.params.id, req.body?.reference, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ status: r.entry.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
