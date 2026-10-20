import express from 'express';
import mongoose from 'mongoose';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import LoanReceipt from '../models/LoanReceipt.js';
import { adminMiddleware } from '../middleware/auth.js';
import { accountView, postPayment, reversePayment, prepay, closeEarly, activeList, MODES, BUCKETS } from '../services/lmsService.js';
import { renderReceipt } from '../services/receiptHtml.js';
import { renderClosureLetter } from '../services/closureLetter.js';
import { audit } from '../services/auditService.js';
import { createRequest, decide, withdraw, listRequests, fourEyes, setFourEyes, TYPES } from '../services/lmsRequests.js';
import { overview, ageing, dcb, agentPerformance, writeOffRegister } from '../services/lmsReports.js';
import { reconcile } from '../services/lmsRecon.js';
import { renderSchedule, renderStatementOfAccount, renderInterestCertificate } from '../services/loanDocuments.js';

// Servicing live loans: the list, one loan's account, recording payments, reversing the last one, part-prepayment, early closure,
// receipts and the closure letter. Who may do what is set in services/permissions.js (lms.post, lms.close).
const router = express.Router();
router.use(adminMiddleware);

const who = req => req.user?.email || 'staff';
const bad = (res, r) => res.status(r.status || 400).json({ error: r.error, ...(r.preview ? { preview: r.preview } : {}), ...(r.quote ? { quote: r.quote } : {}) });
const validId = (req, res, id = req.params.loanId) => { if (mongoose.isValidObjectId(id)) return true; res.status(400).json({ error: 'Invalid id' }); return false; };
const wantsPreview = req => req.query.preview === '1' || req.body?.preview === true;

router.get('/active', async (req, res) => {
  try {
    const { q, bucket, status, page, limit } = req.query;
    if (bucket && !BUCKETS[bucket]) return res.status(400).json({ error: 'Unknown bucket' });
    res.json({ ...(await activeList({ q, bucket, status, page, limit })), modes: MODES });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- the overview, reports and reconciliation ----
router.get('/overview', async (req, res) => {
  try { res.json(await overview()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/reports/ageing', async (req, res) => {
  try { res.json(await ageing()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/reports/dcb', async (req, res) => {
  try { res.json(await dcb({ months: req.query.months })); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/reports/agents', async (req, res) => {
  try {
    const { from, to } = req.query;
    for (const d of [from, to]) if (d && Number.isNaN(new Date(d).getTime())) return res.status(400).json({ error: 'That date is not valid' });
    res.json(await agentPerformance({ from, to }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/reports/writeoffs', async (req, res) => {
  try { res.json(await writeOffRegister()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/reconcile', async (req, res) => {
  try {
    const text = String(req.body?.csv ?? '');
    if (!text.trim()) return res.status(400).json({ error: 'Paste the settlement file or choose it first' });
    if (text.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'The file is too large. Split it by month.' });
    const r = await reconcile(text);
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    await audit(req.user, 'LMS_RECONCILIATION_RUN', { type: 'Reconciliation', id: 'run' }, { lines: r.summary.lines, matched: r.summary.matched, notInBooks: r.summary.notInBooks, amountDiffers: r.summary.amountDiffers }, req);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- changes that a second person approves ----
router.get('/settings', (req, res) => res.json({ fourEyes: fourEyes(), types: TYPES }));
router.put('/settings', async (req, res) => {
  try {
    if (typeof req.body?.fourEyes !== 'boolean') return res.status(400).json({ error: 'Say whether two-person approval is on or off' });
    await setFourEyes(req.body.fourEyes, who(req));
    await audit(req.user, 'LMS_FOUR_EYES_CHANGED', { type: 'Config', id: 'LMS_FOUR_EYES' }, { on: req.body.fourEyes }, req);
    res.json({ fourEyes: fourEyes() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/requests', async (req, res) => {
  try {
    const status = String(req.query.status || '');
    if (status && !['pending', 'approved', 'rejected', 'withdrawn', 'failed'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
    res.json({ requests: await listRequests({ status }), fourEyes: fourEyes() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
const decision = which => async (req, res) => {
  try {
    if (!validId(req, res, req.params.id)) return;
    const r = which === 'withdraw' ? await withdraw(req.params.id, who(req)) : await decide(req.params.id, which, req.body?.note, who(req));
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.post('/requests/:id/approve', decision('approve'));
router.post('/requests/:id/reject', decision('reject'));
router.post('/requests/:id/withdraw', decision('withdraw'));

router.get('/receipts/:id/html', async (req, res) => {
  try {
    if (!validId(req, res, req.params.id)) return;
    const rec = await LoanReceipt.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Receipt not found' });
    const [loan, user] = await Promise.all([Loan.findById(rec.loanId), User.findById(rec.userId).select('firstName lastName')]);
    await audit(req.user, 'LMS_RECEIPT_VIEWED', { type: 'Loan', id: rec.loanId }, { receiptNo: rec.receiptNo }, req);
    res.type('html').send(renderReceipt(rec, loan, user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/receipts/:id/reverse', async (req, res) => {
  try {
    if (!validId(req, res, req.params.id)) return;
    const r = await reversePayment(req.params.id, req.body?.reason, who(req), { req });
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:loanId', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const r = await accountView(req.params.loanId);
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/requests', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const r = await createRequest(req.params.loanId, req.body || {}, who(req), { dryRun: wantsPreview(req) });
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:loanId/documents/:kind', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const kind = req.params.kind;
    if (!['statement', 'schedule', 'interest-certificate'].includes(kind)) return res.status(404).json({ error: 'Unknown document' });
    const v = await accountView(req.params.loanId);
    if (!v.ok) return bad(res, v);
    let html;
    if (kind === 'statement') html = renderStatementOfAccount(v);
    else if (kind === 'schedule') html = renderSchedule(v);
    else {
      const now = new Date();
      const fy = Number(req.query.fy) || (now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
      if (!Number.isInteger(fy) || fy < 2000 || fy > now.getUTCFullYear()) return res.status(400).json({ error: 'Choose a financial year' });
      html = renderInterestCertificate(v, fy);
    }
    await audit(req.user, 'LMS_DOCUMENT_VIEWED', { type: 'Loan', id: req.params.loanId }, { kind }, req);
    res.type('html').send(html);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/payments', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const r = await postPayment(req.params.loanId, req.body || {}, who(req), { dryRun: wantsPreview(req), req });
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/prepay', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const r = await prepay(req.params.loanId, req.body || {}, who(req), { dryRun: wantsPreview(req), req });
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/close', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const r = await closeEarly(req.params.loanId, req.body || {}, who(req), { dryRun: wantsPreview(req), req });
    if (!r.ok) return bad(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:loanId/closure-letter', async (req, res) => {
  try {
    if (!validId(req, res)) return;
    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'closed') return res.status(409).json({ error: 'The loan is not closed yet' });
    const user = await User.findById(loan.userId).select('firstName lastName');
    await audit(req.user, 'LMS_CLOSURE_LETTER_VIEWED', { type: 'Loan', id: loan._id }, {}, req);
    res.type('html').send(renderClosureLetter(loan, user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
