import express from 'express';
import mongoose from 'mongoose';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import EMIPayment from '../models/EMIPayment.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import DataRequest from '../models/DataRequest.js';
import { authMiddleware } from '../middleware/auth.js';
import { audit, clientIp } from '../services/auditService.js';
import { buildAgreement } from '../services/agreementService.js';

const router = express.Router();
router.use(authMiddleware);

const bad = (res, status, error) => res.status(status).json({ error, });

async function ownedLoan(req, res) {
  if (!mongoose.isValidObjectId(req.params.loanId)) { bad(res, 400, 'Invalid loan id'); return null; }
  const loan = await Loan.findById(req.params.loanId);
  if (!loan || String(loan.userId) !== String(req.user.userId)) { bad(res, 404, 'Loan not found'); return null; }
  return loan;
}

router.get('/agreement/:loanId', async (req, res) => {
  try {
    const loan = await ownedLoan(req, res);
    if (!loan) return;
    if (['submitted', 'under_review', 'rejected'].includes(loan.status)) {
      return bad(res, 400, 'The agreement is available once your loan is approved');
    }
    const user = await User.findById(req.user.userId);
    const agreement = buildAgreement(loan, user);
    const accepted = await AgreementAcceptance.findOne({ loanId: loan._id });
    res.json({
      loanId: String(loan._id),
      loanStatus: loan.status,
      version: agreement.version,
      text: accepted ? accepted.text : agreement.text,
      hash: accepted ? accepted.hash : agreement.hash,
      accepted: accepted ? { at: accepted.acceptedAt } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agreement/:loanId/accept', async (req, res) => {
  try {
    const loan = await ownedLoan(req, res);
    if (!loan) return;

    const existing = await AgreementAcceptance.findOne({ loanId: loan._id });
    if (existing) return res.json({ message: 'Agreement already accepted', alreadyAccepted: true, acceptedAt: existing.acceptedAt });

    if (loan.status !== 'approved') return bad(res, 400, 'Only an approved loan can be accepted');
    if (req.body?.confirmed !== true) return bad(res, 400, 'Please confirm that you have read and agree');

    const user = await User.findById(req.user.userId);
    const agreement = buildAgreement(loan, user);
    if (req.body?.hash !== agreement.hash) return bad(res, 409, 'The agreement has changed. Please read it again.');

    let doc;
    try {
      doc = await AgreementAcceptance.create({
        loanId: loan._id,
        userId: user._id,
        version: agreement.version,
        hash: agreement.hash,
        text: agreement.text,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      });
    } catch (e) {
      if (e.code === 11000) return res.json({ message: 'Agreement already accepted', alreadyAccepted: true });
      throw e;
    }
    await audit(req.user, 'AGREEMENT_ACCEPTED', { type: 'Loan', id: loan._id }, { version: agreement.version, hash: agreement.hash }, req);
    res.json({ message: 'Agreement accepted', acceptedAt: doc.acceptedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/my-data', async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('-password').lean();
    if (!user) return bad(res, 404, 'User not found');
    const loans = await Loan.find({ userId }).lean();
    const loanIds = loans.map(l => l._id);
    const [emis, transactions, notifications, agreements, requests] = await Promise.all([
      EMIPayment.find({ loanId: { $in: loanIds } }).select('-metadata').lean(),
      Transaction.find({ userId }).select('-metadata').lean(),
      Notification.find({ userId }).select('-channels').lean(),
      AgreementAcceptance.find({ userId }).select('loanId version hash acceptedAt').lean(),
      DataRequest.find({ userId }).lean(),
    ]);
    await audit(req.user, 'DATA_EXPORTED', { type: 'User', id: userId }, { loans: loans.length }, req);
    res.json({ exportedAt: new Date(), profile: user, loans, emis, transactions, notifications, agreements, requests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/deletion-request', async (req, res) => {
  try {
    const open = await DataRequest.findOne({ userId: req.user.userId, type: 'DELETE', status: 'OPEN' });
    if (open) return bad(res, 409, 'You already have a deletion request in progress');
    const reason = String(req.body?.reason || '').slice(0, 1000);
    const request = await DataRequest.create({ userId: req.user.userId, type: 'DELETE', reason });
    await audit(req.user, 'DELETION_REQUESTED', { type: 'DataRequest', id: request._id }, {}, req);
    res.status(201).json({
      message: 'Request received. We will review it. Records we are legally required to keep, such as loan and payment records, are kept in a restricted form.',
      request,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/requests', async (req, res) => {
  try {
    res.json({ requests: await DataRequest.find({ userId: req.user.userId }).sort({ createdAt: -1 }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
