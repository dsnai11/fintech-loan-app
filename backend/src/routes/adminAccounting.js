import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { STATES } from '../services/chargesEngine.js';
import { getSettings, saveSettings, vouchers, vouchersCsv, tallyXml, gstCsv, tdsCsv, gstReport, paymentsToIndividuals, summary, period } from '../services/accountingService.js';

// For the accounts team: books, GST and tax on payments to individuals, for a date range.
const router = express.Router();
router.use(adminMiddleware);

const range = q => {
  const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const from = ok(q.from) ? q.from : undefined, to = ok(q.to) ? q.to : undefined;
  const p = period(from, to);
  return { from: from || p.start.toISOString().slice(0, 10), to: to || p.end.toISOString().slice(0, 10), opts: { from, to } };
};

router.get('/', async (req, res) => {
  try {
    const r = range(req.query);
    res.json({ from: r.from, to: r.to, settings: getSettings(), states: STATES, canEdit: can(req.user.role, 'config.manage'), summary: await summary(r.opts), gst: await gstReport(r.opts), payments: (await paymentsToIndividuals(r.opts)).slice(0, 200) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return res.status(403).json({ error: 'Your role cannot change the accounting settings.', code: 'NOT_PERMITTED', needs: 'config.manage' });
    const r = await saveSettings(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'ACCOUNTING_SETTINGS_UPDATED', { type: 'Config', id: 'ACCOUNTING_SETTINGS' }, { companyState: r.settings.companyState, tds: r.settings.tds }, req);
    res.json({ message: 'Saved.', settings: r.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const FILES = {
  vouchers: { type: 'text/csv; charset=utf-8', ext: 'csv', build: o => vouchers(o).then(vouchersCsv) },
  tally: { type: 'application/xml; charset=utf-8', ext: 'xml', build: o => vouchers(o).then(tallyXml) },
  gst: { type: 'text/csv; charset=utf-8', ext: 'csv', build: gstCsv },
  tds: { type: 'text/csv; charset=utf-8', ext: 'csv', build: tdsCsv },
};
router.get('/export/:kind', async (req, res) => {
  try {
    const f = FILES[req.params.kind];
    if (!f) return res.status(404).json({ error: 'Unknown file' });
    const r = range(req.query);
    const body = await f.build(r.opts);
    await audit(req.user, 'ACCOUNTING_EXPORT', { type: 'Export', id: req.params.kind }, { from: r.from, to: r.to }, req);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}-${r.from}-to-${r.to}.${f.ext}"`);
    res.send(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
