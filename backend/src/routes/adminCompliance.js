import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import AuditLog from '../models/AuditLog.js';
import AmlAlert from '../models/AmlAlert.js';
import WatchlistEntry from '../models/WatchlistEntry.js';
import DataRequest from '../models/DataRequest.js';
import Notification from '../models/Notification.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit, verifyChain } from '../services/auditService.js';
import { raiseWatchlistAlerts } from '../services/amlService.js';
import { notify } from '../services/notificationService.js';
import { issueResetToken } from '../services/passwordReset.js';

const router = express.Router();
router.use(adminMiddleware);

const bad = (res, status, error) => res.status(status).json({ error });
const isId = id => mongoose.isValidObjectId(id);
const trunc = (s, n) => String(s ?? '').trim().slice(0, n);

// ── Audit log ───────────────────────────────────────────────────────
function auditFilter(q) {
  const f = {};
  for (const k of ['action', 'actor', 'entityType', 'entityId']) if (q[k]) f[k] = String(q[k]);
  if (q.from || q.to) {
    f.at = {};
    if (q.from) f.at.$gte = new Date(q.from).toISOString();
    if (q.to) f.at.$lte = new Date(new Date(q.to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
  }
  return f;
}

router.get('/audit', async (req, res) => {
  try {
    if ((req.query.from && isNaN(new Date(req.query.from))) || (req.query.to && isNaN(new Date(req.query.to)))) return bad(res, 400, 'Invalid date');
    const filter = auditFilter(req.query);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const [total, entries, actions] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ seq: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.distinct('action'),
    ]);
    res.json({ total, page, limit, actions: actions.sort(), entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const cell = v => {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

router.get('/audit/export', async (req, res) => {
  try {
    if ((req.query.from && isNaN(new Date(req.query.from))) || (req.query.to && isNaN(new Date(req.query.to)))) return bad(res, 400, 'Invalid date');
    const rows = await AuditLog.find(auditFilter(req.query)).sort({ seq: 1 }).limit(10000).lean();
    const header = ['Seq', 'Time (UTC)', 'Actor', 'Role', 'Action', 'Entity type', 'Entity id', 'Details', 'IP', 'Hash'];
    const csv = [header, ...rows.map(r => [r.seq, r.at, r.actor, r.role, r.action, r.entityType, r.entityId, r.details, r.ip, r.hash])]
      .map(r => r.map(cell).join(',')).join('\r\n');
    await audit(req.user, 'AUDIT_EXPORTED', {}, { rows: rows.length }, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/audit/verify', async (req, res) => {
  try {
    res.json(await verifyChain());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── KYC review ──────────────────────────────────────────────────────
router.get('/kyc', async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const users = await User.find({ kycStatus: status, panNumber: { $exists: true, $ne: null } })
      .select('firstName lastName email phone panNumber dateOfBirth kycStatus phoneVerified bankAccount createdAt')
      .sort({ createdAt: 1 })
      .limit(200);
    res.json({
      status,
      total: users.length,
      items: users.map(u => ({
        userId: String(u._id),
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        phone: u.phone,
        phoneVerified: !!u.phoneVerified,
        pan: u.panNumber,
        dateOfBirth: u.dateOfBirth,
        bank: u.bankAccount?.accountNumber
          ? { holder: u.bankAccount.accountHolder, ifsc: u.bankAccount.ifscCode, account: `XXXX${String(u.bankAccount.accountNumber).slice(-4)}` }
          : null,
        registered: u.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/kyc/:userId/decision', async (req, res) => {
  try {
    if (!isId(req.params.userId)) return bad(res, 400, 'Invalid user id');
    const { decision } = req.body || {};
    const reason = trunc(req.body?.reason, 500);
    if (!['approve', 'reject'].includes(decision)) return bad(res, 400, 'decision must be approve or reject');
    if (decision === 'reject' && !reason) return bad(res, 400, 'A reason is required to reject KYC');

    const user = await User.findById(req.params.userId);
    if (!user) return bad(res, 404, 'User not found');
    if (!user.panNumber) return bad(res, 400, 'This customer has not submitted a PAN yet');

    const status = decision === 'approve' ? 'approved' : 'rejected';
    const previous = user.kycStatus;
    user.kycStatus = status;
    await user.save();
    await audit(req.user, 'KYC_DECISION', { type: 'User', id: user._id }, { decision, previous, reason }, req);
    await notify(user._id, {
      type: 'KYC_UPDATE',
      title: status === 'approved' ? 'KYC approved' : 'KYC needs attention',
      message: status === 'approved' ? 'Your KYC has been verified.' : `We could not verify your KYC. ${reason}`,
    }, { sms: true });
    res.json({ message: `KYC ${status}`, kycStatus: status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AML alerts and watchlist ────────────────────────────────────────
router.get('/aml/alerts', async (req, res) => {
  try {
    const status = ['OPEN', 'CLEARED', 'ESCALATED'].includes(req.query.status) ? req.query.status : 'OPEN';
    const alerts = await AmlAlert.find({ status }).sort({ severity: 1, createdAt: -1 }).limit(200).populate('userId', 'firstName lastName phone');
    const counts = Object.fromEntries((await AmlAlert.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map(c => [c._id, c.n]));
    res.json({
      status,
      counts: { OPEN: counts.OPEN || 0, ESCALATED: counts.ESCALATED || 0, CLEARED: counts.CLEARED || 0 },
      items: alerts.map(a => ({
        id: String(a._id),
        rule: a.rule,
        severity: a.severity,
        detail: a.detail,
        status: a.status,
        customer: a.userId ? `${a.userId.firstName} ${a.userId.lastName}` : 'Unknown',
        phone: a.userId?.phone,
        loanId: a.loanId ? String(a.loanId) : null,
        createdAt: a.createdAt,
        reviewedBy: a.reviewedBy,
        reviewNote: a.reviewNote,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/aml/alerts/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return bad(res, 400, 'Invalid alert id');
    const { status } = req.body || {};
    const note = trunc(req.body?.note, 1000);
    if (!['CLEARED', 'ESCALATED'].includes(status)) return bad(res, 400, 'status must be CLEARED or ESCALATED');
    if (!note) return bad(res, 400, 'A note explaining the decision is required');

    const alert = await AmlAlert.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['OPEN', 'ESCALATED'] }, ...(status === 'ESCALATED' ? { status: 'OPEN' } : {}) },
      { status, reviewedBy: req.user.email, reviewNote: note, reviewedAt: new Date() },
      { new: true }
    );
    if (!alert) return bad(res, 409, 'Alert not found or already in that state');
    await audit(req.user, 'AML_ALERT_REVIEWED', { type: 'AmlAlert', id: alert._id }, { status, rule: alert.rule, note }, req);
    res.json({ message: `Alert ${status.toLowerCase()}`, alert });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/aml/watchlist', async (req, res) => {
  try {
    res.json({ items: await WatchlistEntry.find({ active: true }).sort({ createdAt: -1 }).limit(500) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/aml/watchlist', async (req, res) => {
  try {
    const b = req.body || {};
    const entry = {
      name: trunc(b.name, 120) || undefined,
      pan: trunc(b.pan, 10).toUpperCase() || undefined,
      phone: trunc(b.phone, 15) || undefined,
      accountNumber: trunc(b.accountNumber, 30) || undefined,
      source: trunc(b.source, 80) || 'Internal',
      reason: trunc(b.reason, 300),
    };
    if (!entry.name && !entry.pan && !entry.phone && !entry.accountNumber) return bad(res, 400, 'Give at least a name, PAN, phone or account number');
    if (entry.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(entry.pan)) return bad(res, 400, 'Invalid PAN format');

    const doc = await WatchlistEntry.create({ ...entry, addedBy: req.user.email });
    await audit(req.user, 'WATCHLIST_ADDED', { type: 'WatchlistEntry', id: doc._id }, { source: entry.source, fields: Object.keys(entry).filter(k => entry[k] && !['source', 'reason'].includes(k)) }, req);

    // Re-screen existing customers against the new entry.
    const matched = await raiseWatchlistAlerts(doc);
    res.status(201).json({ message: 'Added to watchlist', entry: doc, existingCustomersMatched: matched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/aml/watchlist/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return bad(res, 400, 'Invalid id');
    const doc = await WatchlistEntry.findOneAndUpdate({ _id: req.params.id, active: true }, { active: false }, { new: true });
    if (!doc) return bad(res, 404, 'Entry not found');
    await audit(req.user, 'WATCHLIST_REMOVED', { type: 'WatchlistEntry', id: doc._id }, {}, req);
    res.json({ message: 'Removed from watchlist' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Customer password reset (when self-service email is not available) ──
router.post('/customers/reset-link', async (req, res) => {
  try {
    const identifier = trunc(req.body?.identifier, 120).toLowerCase();
    if (!identifier) return bad(res, 400, "Enter the customer's email or phone number");
    const user = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (!user) return bad(res, 404, 'No customer found with that email or phone');
    if (user.email === (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase()) {
      return bad(res, 403, 'Admin passwords are reset from the server settings, not from here');
    }
    const { link, expires } = await issueResetToken(user._id, 120);
    await audit(req.user, 'ADMIN_RESET_LINK_CREATED', { type: 'User', id: user._id }, { expires: expires.toISOString() }, req);
    res.json({ customer: { name: `${user.firstName} ${user.lastName}`, email: user.email, phone: user.phone }, link, expires });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Data requests ───────────────────────────────────────────────────
const ACTIVE_LOAN_STATUSES = ['submitted', 'under_review', 'approved', 'disbursed', 'defaulted', 'written_off'];

router.get('/requests', async (req, res) => {
  try {
    const status = ['OPEN', 'COMPLETED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'OPEN';
    const items = await DataRequest.find({ status }).sort({ createdAt: 1 }).limit(200).populate('userId', 'firstName lastName email phone');
    const withBlockers = await Promise.all(items.map(async r => ({
      id: String(r._id),
      type: r.type,
      status: r.status,
      reason: r.reason,
      requestedAt: r.createdAt,
      customer: r.userId ? `${r.userId.firstName} ${r.userId.lastName}` : 'Unknown',
      email: r.userId?.email,
      activeLoans: r.userId ? await Loan.countDocuments({ userId: r.userId._id, status: { $in: ACTIVE_LOAN_STATUSES } }) : 0,
      note: r.note,
    })));
    res.json({ status, items: withBlockers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function anonymizeUser(user) {
  const id = String(user._id);
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        firstName: 'Deleted',
        lastName: 'User',
        email: `deleted-${id}@deleted.invalid`,
        phone: `del-${id}`,
        password: crypto.randomBytes(32).toString('hex'),
        status: 'inactive',
        kycStatus: 'pending',
        phoneVerified: false,
      },
      $unset: { dateOfBirth: '', gender: '', nationality: '', address: '', panNumber: '', aadharNumber: '', documents: '', employment: '', bankAccount: '', creditScore: '' },
    }
  );
  await Loan.updateMany({ userId: user._id }, { $unset: { 'disbursalDetails.accountNumber': '' } });
  await Notification.deleteMany({ userId: user._id });
}

router.post('/requests/:id/process', async (req, res) => {
  try {
    if (!isId(req.params.id)) return bad(res, 400, 'Invalid request id');
    const { action } = req.body || {};
    const note = trunc(req.body?.note, 1000);
    if (!['complete', 'reject'].includes(action)) return bad(res, 400, 'action must be complete or reject');
    if (action === 'reject' && !note) return bad(res, 400, 'A reason is required to reject a request');

    const request = await DataRequest.findOne({ _id: req.params.id, status: 'OPEN' });
    if (!request) return bad(res, 404, 'Open request not found');

    if (action === 'complete') {
      const user = await User.findById(request.userId);
      if (!user) return bad(res, 404, 'User not found');
      const active = await Loan.countDocuments({ userId: user._id, status: { $in: ACTIVE_LOAN_STATUSES } });
      if (active) return bad(res, 409, `This customer has ${active} loan(s) that are not settled. Personal data cannot be removed until they are.`);
      await anonymizeUser(user);
      await audit(req.user, 'USER_ANONYMIZED', { type: 'User', id: user._id }, { requestId: String(request._id) }, req);
    }

    request.status = action === 'complete' ? 'COMPLETED' : 'REJECTED';
    request.processedBy = req.user.email;
    request.processedAt = new Date();
    request.note = note;
    await request.save();
    await audit(req.user, 'DATA_REQUEST_PROCESSED', { type: 'DataRequest', id: request._id }, { action, note }, req);
    res.json({
      message: action === 'complete' ? 'Personal data removed. Loan, payment and audit records are kept as required by law.' : 'Request rejected',
      status: request.status,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
