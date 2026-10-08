import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { dashboard, saveTargets, getTargets } from '../services/dashboardService.js';

// The leadership dashboard: figures for a chosen period, compared with the period before.
const router = express.Router();
router.use(adminMiddleware);

router.get('/', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...(await dashboard(Number(req.query.days) || 30)), canEditTargets: can(req.user.role, 'controls.edit') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/targets', async (req, res) => {
  try {
    if (!can(req.user.role, 'controls.edit')) return res.status(403).json({ error: 'Your role cannot change targets.', code: 'NOT_PERMITTED', needs: 'controls.edit' });
    const before = getTargets();
    const r = await saveTargets(req.body, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.error });
    await audit(req.user, 'DASHBOARD_TARGETS_UPDATED', { type: 'Config', id: 'LEADERSHIP_TARGETS' }, { before, after: r.targets }, req);
    res.json({ targets: r.targets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const cell = v => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

// The same figures as a spreadsheet, for board packs
router.get('/export', async (req, res) => {
  try {
    const d = await dashboard(Number(req.query.days) || 30);
    const rows = [['Section', 'Item', 'This period', 'Previous period', 'Change %']];
    d.kpis.forEach(k => rows.push(['Headline', k.label, k.value, k.previous, k.change]));
    d.funnel.forEach(f => rows.push(['Sign-up funnel', f.label, f.count, '', `${f.ofRegistered}% of registered`]));
    d.book.buckets.forEach(b => rows.push(['Book health', b.label, b.loans, '', `principal ${b.principal}; overdue ${b.overdueAmount}`]));
    rows.push(['Book health', 'Outstanding principal', d.book.outstandingPrincipal, '', ''], ['Book health', 'More than 30 days late (% of principal)', d.book.par30, '', ''], ['Book health', 'More than 90 days late (% of principal)', d.book.par90, '', '']);
    await audit(req.user, 'DASHBOARD_EXPORTED', { type: 'Report', id: 'dashboard' }, { days: d.days }, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leadership-dashboard-${d.days}d.csv"`);
    res.send(rows.map(r => r.map(cell).join(',')).join('\r\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
