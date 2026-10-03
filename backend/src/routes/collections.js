import express from 'express';
import mongoose from 'mongoose';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import CollectionNote from '../models/CollectionNote.js';
import { adminMiddleware } from '../middleware/auth.js';
import { buildQueue, renderLetter, runEscalations, STAGES, STAGE_LABEL } from '../services/collectionsService.js';
import { notify } from '../services/notificationService.js';
import { audit } from '../services/auditService.js';

const router = express.Router();
router.use(adminMiddleware);

const publicItem = ({ loan, rows, ...rest }) => rest;
const isId = id => mongoose.isValidObjectId(id);
const bad = (res, status, error) => res.status(status).json({ error });

async function addNote(loan, fields, admin) {
  return CollectionNote.create({ loanId: loan._id, userId: loan.userId._id || loan.userId, createdBy: admin.email, ...fields });
}

// The case for one loan. Loans with nothing overdue have no case.
async function getCase(loanId) {
  const [item] = await buildQueue({ loanId });
  return item || null;
}

router.get('/queue', async (req, res) => {
  try {
    const { stage } = req.query;
    if (stage && ![...STAGES, 'DEFAULTED'].includes(stage)) return bad(res, 400, 'Unknown stage');
    const all = await buildQueue();
    const stats = {};
    for (const s of [...STAGES, 'DEFAULTED']) stats[s] = { label: STAGE_LABEL[s], cases: 0, amount: 0 };
    for (const i of all) {
      stats[i.stage].cases++;
      stats[i.stage].amount += i.amountDue;
    }
    const items = (stage ? all.filter(i => i.stage === stage) : all).map(publicItem);
    res.json({ total: all.length, totalAmount: all.reduce((a, i) => a + i.amountDue, 0), stats, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/written-off', async (req, res) => {
  try {
    const loans = await Loan.find({ status: 'written_off' }).sort({ writtenOffAt: -1 }).populate('userId', 'firstName lastName phone');
    res.json({
      total: loans.length,
      items: loans.map(l => ({
        loanId: String(l._id),
        customer: l.userId ? `${l.userId.firstName} ${l.userId.lastName}` : 'Unknown',
        phone: l.userId?.phone,
        loanAmount: l.loanAmount,
        writtenOffAt: l.writtenOffAt,
        writtenOffAmount: l.writtenOffAmount || 0,
        recoveredAmount: l.recoveredAmount || 0,
        reason: l.writeOffReason,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:loanId', async (req, res) => {
  try {
    if (!isId(req.params.loanId)) return bad(res, 400, 'Invalid loan id');
    const item = await getCase(req.params.loanId);
    if (!item) return bad(res, 404, 'This loan has no overdue EMIs');
    const notes = await CollectionNote.find({ loanId: req.params.loanId }).sort({ createdAt: -1 }).limit(100);
    res.json({
      ...publicItem(item),
      overdue: item.rows.map(r => ({ emiNumber: r.emi.emiNumber, dueDate: r.emi.dueDate, amount: r.emi.amount, penalty: r.penalty })),
      recoveredAmount: item.loan.recoveredAmount || 0,
      canMarkDefaulted: item.status === 'disbursed' && item.daysOverdue >= 90,
      canWriteOff: item.status === 'defaulted',
      notes,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/notes', async (req, res) => {
  try {
    if (!isId(req.params.loanId)) return bad(res, 400, 'Invalid loan id');
    const { type = 'NOTE', text = '', promiseDate, promiseAmount } = req.body || {};
    if (!['NOTE', 'CALL', 'PROMISE_TO_PAY'].includes(type)) return bad(res, 400, 'type must be NOTE, CALL or PROMISE_TO_PAY');
    if (type !== 'PROMISE_TO_PAY' && !String(text).trim()) return bad(res, 400, 'Add a note');
    if (String(text).length > 2000) return bad(res, 400, 'Note is too long');

    const fields = { type, text: String(text).trim() };
    if (type === 'PROMISE_TO_PAY') {
      const d = new Date(promiseDate);
      if (!promiseDate || Number.isNaN(d.getTime())) return bad(res, 400, 'Promise date is required');
      const amt = Number(promiseAmount);
      if (promiseAmount != null && promiseAmount !== '' && (!Number.isFinite(amt) || amt <= 0)) return bad(res, 400, 'Promise amount must be positive');
      fields.promiseDate = d;
      if (promiseAmount != null && promiseAmount !== '') fields.promiseAmount = amt;
    }

    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return bad(res, 404, 'Loan not found');
    const note = await addNote(loan, fields, req.user);
    res.json({ note });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:loanId/letter', async (req, res) => {
  try {
    if (!isId(req.params.loanId)) return bad(res, 400, 'Invalid loan id');
    const item = await getCase(req.params.loanId);
    if (!item) return bad(res, 404, 'This loan has no overdue EMIs');
    await addNote(item.loan, { type: 'LETTER', stage: item.stage, text: `Generated "${STAGE_LABEL[item.stage]}" letter` }, req.user);
    await audit(req.user, 'COLLECTION_LETTER_GENERATED', { type: 'Loan', id: item.loan._id }, { stage: item.stage }, req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderLetter(item));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/default', async (req, res) => {
  try {
    if (!isId(req.params.loanId)) return bad(res, 400, 'Invalid loan id');
    const item = await getCase(req.params.loanId);
    if (!item) return bad(res, 404, 'This loan has no overdue EMIs');
    if (item.status !== 'disbursed') return bad(res, 400, `Loan is already ${item.status}`);
    if (item.daysOverdue < 90) return bad(res, 400, `Only loans 90+ days overdue can be marked defaulted (this one is ${item.daysOverdue})`);

    const claimed = await Loan.findOneAndUpdate(
      { _id: item.loan._id, status: 'disbursed' },
      { status: 'defaulted', defaultedAt: new Date(), collectionStage: 'DEFAULTED', collectionStageSince: new Date() },
      { new: true }
    );
    if (!claimed) return bad(res, 409, 'Loan status changed. Refresh and try again.');
    await addNote(item.loan, { type: 'DEFAULTED', stage: 'DEFAULTED', text: String(req.body?.reason || `Marked defaulted at ${item.daysOverdue} days overdue`).slice(0, 2000) }, req.user);
    await notify(item.loan.userId._id, {
      type: 'COLLECTION_NOTICE',
      title: 'Loan classified as defaulted',
      message: 'Your loan has been classified as defaulted because of unpaid EMIs. Please contact us to settle the outstanding amount.',
      loanId: item.loan._id,
    }, { email: true, sms: true });
    await audit(req.user, 'LOAN_DEFAULTED', { type: 'Loan', id: item.loan._id }, { daysOverdue: item.daysOverdue }, req);
    res.json({ message: 'Loan marked as defaulted', status: 'defaulted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:loanId/write-off', async (req, res) => {
  try {
    if (!isId(req.params.loanId)) return bad(res, 400, 'Invalid loan id');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return bad(res, 400, 'A reason is required to write off a loan');
    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return bad(res, 404, 'Loan not found');
    if (loan.status !== 'defaulted') return bad(res, 400, 'Only defaulted loans can be written off');

    const unpaid = await EMIPayment.find({ loanId: loan._id, status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] } }).select('principalAmount');
    const outstanding = unpaid.reduce((a, e) => a + (e.principalAmount || 0), 0);

    const claimed = await Loan.findOneAndUpdate(
      { _id: loan._id, status: 'defaulted' },
      { status: 'written_off', writtenOffAt: new Date(), writtenOffAmount: outstanding, writeOffReason: reason.slice(0, 2000) },
      { new: true }
    );
    if (!claimed) return bad(res, 409, 'Loan status changed. Refresh and try again.');
    await addNote(loan, { type: 'WRITE_OFF', amount: outstanding, text: reason.slice(0, 2000) }, req.user);
    await audit(req.user, 'LOAN_WRITTEN_OFF', { type: 'Loan', id: loan._id }, { amount: outstanding, reason: reason.slice(0, 500) }, req);
    res.json({ message: 'Loan written off', writtenOffAmount: outstanding });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Money received after a write-off, recorded by hand. It is a ledger entry; it does not touch the EMI schedule.
router.post('/:loanId/recovery', async (req, res) => {
  try {
    if (!isId(req.params.loanId)) return bad(res, 400, 'Invalid loan id');
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return bad(res, 400, 'Amount must be a positive number');
    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return bad(res, 404, 'Loan not found');
    if (loan.status !== 'written_off') return bad(res, 400, 'Recoveries can only be recorded on written-off loans');

    const updated = await Loan.findByIdAndUpdate(loan._id, { $inc: { recoveredAmount: amount } }, { new: true });
    await addNote(loan, { type: 'RECOVERY', amount, text: String(req.body?.note || '').slice(0, 2000) }, req.user);
    await audit(req.user, 'RECOVERY_RECORDED', { type: 'Loan', id: loan._id }, { amount }, req);
    res.json({ message: 'Recovery recorded', recoveredAmount: updated.recoveredAmount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run-escalations', async (req, res) => {
  try {
    res.json(await runEscalations());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
