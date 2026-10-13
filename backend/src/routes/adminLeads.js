import express from 'express';
import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { STATUSES, cell } from '../services/leadService.js';

// The queue of people who asked to be contacted. Reading follows "see support"; changing needs "reply to support".
const router = express.Router();
router.use(adminMiddleware);

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = l => ({ id: String(l._id), kind: l.kind, source: l.source, page: l.page, name: l.name, phone: l.phone, city: l.city, amount: l.amount, propertyValue: l.propertyValue, employment: l.employment, note: l.note, status: l.status, partner: l.partner, assignedTo: l.assignedTo, notes: l.notes, consentAt: l.consentAt, createdAt: l.createdAt, fromCustomer: !!l.userId });

function filterOf(q) {
  const f = {};
  if (STATUSES.includes(q.status)) f.status = q.status;
  if (q.kind) f.kind = String(q.kind).slice(0, 30);
  if (q.q) { const r = new RegExp('^' + esc(String(q.q).trim().slice(0, 40)), 'i'); f.$or = [{ name: r }, { phone: r }, { city: r }]; }
  return f;
}

router.get('/', async (req, res) => {
  try {
    const f = filterOf(req.query);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const [list, byStatus, kinds] = await Promise.all([
      Lead.find(f).sort({ createdAt: -1 }).limit(limit).lean(),
      Lead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Lead.distinct('kind'),
    ]);
    res.json({ leads: list.map(row), counts: Object.fromEntries(byStatus.map(r => [r._id, r.n])), kinds, statuses: STATUSES, canEdit: can(req.user.role, 'support.reply') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!can(req.user.role, 'support.reply')) return res.status(403).json({ error: 'Your role cannot change leads.', code: 'NOT_PERMITTED', needs: 'support.reply' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Lead not found' });
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const b = req.body || {};
    const before = { status: lead.status, partner: lead.partner };
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Choose a status from the list.' });
      lead.status = b.status;
    }
    if (b.partner !== undefined) lead.partner = String(b.partner).trim().slice(0, 80);
    if (b.assignedTo !== undefined) lead.assignedTo = String(b.assignedTo).trim().slice(0, 80);
    const note = String(b.note ?? '').trim().slice(0, 300);
    if (note) lead.notes.push({ at: new Date(), by: req.user.email, text: note });
    if (lead.status === 'with_partner' && !lead.partner) return res.status(400).json({ error: 'Write the partner it was passed to.' });
    await lead.save();
    await audit(req.user, 'LEAD_UPDATED', { type: 'Lead', id: lead._id }, { before, after: { status: lead.status, partner: lead.partner }, noted: !!note }, req);
    res.json({ lead: row(lead) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/export/csv', async (req, res) => {
  try {
    const list = await Lead.find(filterOf(req.query)).sort({ createdAt: -1 }).limit(5000).lean();
    const head = ['When', 'Product', 'From', 'Page', 'Name', 'Phone', 'City', 'Amount', 'Property value', 'Employment', 'Status', 'Partner', 'Agreed to be contacted at', 'Note'];
    const lines = [head.map(cell).join(',')];
    for (const l of list) lines.push([new Date(l.createdAt).toISOString(), l.kind, l.source, l.page, l.name, l.phone, l.city, l.amount, l.propertyValue, l.employment, l.status, l.partner, new Date(l.consentAt).toISOString(), l.note].map(cell).join(','));
    await audit(req.user, 'LEADS_EXPORTED', { type: 'Lead', id: 'all' }, { rows: list.length }, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(lines.join('\r\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
