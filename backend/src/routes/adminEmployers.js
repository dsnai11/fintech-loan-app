import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { getList, saveText, toText } from '../services/employerService.js';

// The graded employers behind the salaried products' rules. Reading follows "view decisions"; saving needs "edit decisions".
const router = express.Router();
router.use(adminMiddleware);

router.get('/', (req, res) => {
  const list = getList();
  res.json({ text: toText(list), counts: { A: list.filter(e => e.category === 'A').length, B: list.filter(e => e.category === 'B').length, C: list.filter(e => e.category === 'C').length, total: list.length }, canEdit: can(req.user.role, 'decisions.edit') });
});

router.put('/', async (req, res) => {
  try {
    if (!can(req.user.role, 'decisions.edit')) return res.status(403).json({ error: 'Your role cannot change the employer list.', code: 'NOT_PERMITTED', needs: 'decisions.edit' });
    const before = getList().length;
    const r = await saveText(req.body?.text, req.user.email);
    if (!r.ok) return res.status(400).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'EMPLOYER_LIST_UPDATED', { type: 'Config', id: 'EMPLOYER_LIST' }, { before, after: r.list.length }, req);
    res.json({ message: `Saved ${r.list.length} employers.`, count: r.list.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
