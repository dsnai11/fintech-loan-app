import express from 'express';
import ChangeRequest from '../models/ChangeRequest.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { approvalSettings, saveApprovalSettings, decide, TARGETS } from '../services/changeApprovals.js';

// Changes waiting for a second person, and the switch that turns the two-person rule on.
const router = express.Router();
router.use(adminMiddleware);

const view = d => ({ id: String(d._id), target: d.target, label: TARGETS[d.target].label, summary: d.summary, status: d.status, requestedBy: d.requestedBy, requestedAt: d.requestedAt, decidedBy: d.decidedBy, decidedAt: d.decidedAt, note: d.note });

router.get('/', async (req, res) => {
  try {
    const approver = can(req.user.role, 'changes.approve');
    const q = approver ? {} : { requestedBy: req.user.email };
    const rows = await ChangeRequest.find(q).sort({ requestedAt: -1 }).limit(60).lean();
    res.json({ canApprove: approver, me: req.user.email, settings: approvalSettings(), requests: rows.map(view) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the super admin can turn the two-person rule on or off' });
    const before = approvalSettings();
    const settings = await saveApprovalSettings(req.body, req.user.email);
    await audit(req.user, 'CHANGE_APPROVAL_RULE_SET', { type: 'Config', id: 'CHANGE_APPROVALS' }, { before, after: settings }, req);
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const d = await ChangeRequest.findById(req.params.id).lean();
    if (!d) return res.status(404).json({ error: 'Request not found' });
    if (!can(req.user.role, 'changes.approve') && d.requestedBy !== req.user.email) return res.status(403).json({ error: 'Not yours to see' });
    res.json({ request: view(d), proposed: d.proposed });
  } catch (e) {
    res.status(404).json({ error: 'Request not found' });
  }
});

for (const action of ['approve', 'reject', 'withdraw']) {
  router.post(`/:id/${action}`, async (req, res) => {
    try {
      if (action !== 'withdraw' && !can(req.user.role, 'changes.approve')) return res.status(403).json({ error: 'Your role cannot approve changes.', code: 'NOT_PERMITTED', needs: 'changes.approve' });
      const r = await decide(req.params.id, action, req.body?.note, req.user, req);
      if (r.error) return res.status(r.status).json({ error: r.error, errors: r.errors });
      res.json({ request: view(r.doc), message: action === 'approve' ? 'Approved and now live.' : action === 'reject' ? 'Rejected.' : 'Withdrawn.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

export default router;
