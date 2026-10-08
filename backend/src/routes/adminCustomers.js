import { view as incomeView } from '../services/aaService.js';
import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import AmlAlert from '../models/AmlAlert.js';
import CollectionNote from '../models/CollectionNote.js';
import DataRequest from '../models/DataRequest.js';
import KycMedia from '../models/KycMedia.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { setupStatus } from '../services/onboardingService.js';

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
        gender: user.gender || '',
        dateOfBirth: user.dateOfBirth || null,
        address: user.address ? { street: user.address.street, city: user.address.city, state: user.address.state, zipCode: user.address.zipCode } : null,
        employment: user.employment ? { status: user.employment.status, company: user.employment.company, monthlyIncome: user.employment.monthlyIncome } : null,
        setup: setupStatus(user),
        digilocker: user.kycDigilocker ? { status: user.kycDigilocker.status, mode: user.kycDigilocker.mode, at: user.kycDigilocker.at, nameMatch: user.kycDigilocker.nameMatch, dobMatch: user.kycDigilocker.dobMatch, aadhaarLast4: user.kycDigilocker.aadhaarLast4, panFound: user.kycDigilocker.panFound, flags: user.kycDigilocker.flags || [] } : null,
        incomeCheck: incomeView(user.incomeCheck),
        selfie: user.selfie ? { status: user.selfie.status, capturedAt: user.selfie.capturedAt, blinks: user.selfie.blinks, method: user.selfie.method, flag: user.selfie.flag || null, reviewedBy: user.selfie.reviewedBy || null, reviewNote: user.selfie.reviewNote || null } : null,
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

// The customer's selfie, for the KYC review. Viewing it is logged.
router.get('/:id/selfie', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid customer id' });
    const m = await KycMedia.findOne({ userId: req.params.id, kind: req.query.frame === 'after' ? 'selfie_after' : 'selfie_before' }).select('+data mime');
    if (!m) return res.status(404).json({ error: 'This customer has no photo yet' });
    await audit(req.user, 'SELFIE_VIEWED', { type: 'User', id: req.params.id }, { frame: req.query.frame === 'after' ? 'after' : 'before' }, req);
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(m.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A reviewer accepts the photo, or sends the customer back to take it again.
router.post('/:id/selfie-decision', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid customer id' });
    const decision = req.body?.decision;
    if (!['accept', 'reject'].includes(decision)) return res.status(400).json({ error: 'Choose accept or reject' });
    const user = await User.findById(req.params.id);
    if (!user?.selfie) return res.status(404).json({ error: 'This customer has no photo to review' });
    const note = String(req.body?.note ?? '').trim().slice(0, 300);
    if (decision === 'reject' && !note) return res.status(400).json({ error: 'Say why, so the customer knows what to fix' });
    const selfie = { ...user.selfie, status: decision === 'accept' ? 'passed' : 'rejected', reviewedBy: req.user.email, reviewedAt: new Date(), reviewNote: note };
    await User.updateOne({ _id: user._id }, { selfie });
    await audit(req.user, decision === 'accept' ? 'SELFIE_ACCEPTED' : 'SELFIE_REJECTED_BY_STAFF', { type: 'User', id: user._id }, { note }, req);
    res.json({ selfie: { status: selfie.status } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
