import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import AmlAlert from '../models/AmlAlert.js';
import CollectionNote from '../models/CollectionNote.js';
import DataRequest from '../models/DataRequest.js';
import { adminMiddleware } from '../middleware/auth.js';

// One place to see everything about a customer: profile, KYC, loans, alerts and collection history.
const router = express.Router();
router.use(adminMiddleware);

const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mask = (s, keep = 4) => (s ? `${'*'.repeat(Math.max(String(s).length - keep, 0))}${String(s).slice(-keep)}` : '');

const card = u => ({
  id: String(u._id),
  name: `${u.firstName} ${u.lastName}`.trim(),
  email: u.email,
  phone: u.phone,
  kycStatus: u.kycStatus,
  status: u.status,
  joined: u.createdAt,
});

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.status(400).json({ error: 'Type at least 2 characters of a name, email, phone or PAN' });
    const re = new RegExp(escRe(q), 'i');
    const users = await User.find({ $or: [{ firstName: re }, { lastName: re }, { email: re }, { phone: re }, { panNumber: re }] })
      .select('firstName lastName email phone kycStatus status createdAt').sort({ createdAt: -1 }).limit(25);
    res.json({ customers: users.map(card) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid customer id' });
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Customer not found' });
    const [loans, alerts, notes, requests] = await Promise.all([
      Loan.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50),
      AmlAlert.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30),
      CollectionNote.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30),
      DataRequest.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10),
    ]);
    const live = ['submitted', 'under_review', 'approved', 'disbursed', 'defaulted'];
    res.json({
      customer: {
        ...card(user),
        pan: mask(user.panNumber),
        bankAccount: user.bankAccount?.accountNumber ? { holder: user.bankAccount.accountHolder, number: mask(user.bankAccount.accountNumber), ifsc: user.bankAccount.ifscCode } : null,
        twoFactorEnabled: !!user.twoFactorEnabled,
      },
      summary: {
        totalLoans: loans.length,
        activeLoans: loans.filter(l => live.includes(l.status)).length,
        totalBorrowed: loans.filter(l => ['disbursed', 'closed', 'defaulted', 'written_off'].includes(l.status)).reduce((t, l) => t + l.loanAmount, 0),
        openAlerts: alerts.filter(a => a.status === 'OPEN').length,
      },
      loans: loans.map(l => ({ id: String(l._id), amount: l.loanAmount, tenure: l.tenure, emi: l.monthlyEMI, status: l.status, appliedAt: l.createdAt, disbursedAt: l.disbursementDate, closedAt: l.closedAt })),
      alerts: alerts.map(a => ({ id: String(a._id), rule: a.rule, severity: a.severity, status: a.status, detail: a.detail, at: a.createdAt })),
      collectionHistory: notes.map(n => ({ type: n.type, text: n.text, promiseDate: n.promiseDate, promiseAmount: n.promiseAmount, by: n.createdBy, at: n.createdAt, loanId: String(n.loanId) })),
      dataRequests: requests.map(r => ({ type: r.type, status: r.status, at: r.createdAt })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
