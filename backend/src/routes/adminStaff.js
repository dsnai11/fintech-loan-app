import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { adminMiddleware } from '../middleware/auth.js';
import { ROLES, STAFF_ROLES, isStaffRole } from '../services/permissions.js';
import { issueResetToken } from '../services/passwordReset.js';
import { audit } from '../services/auditService.js';

// The staff directory. Super admin only (see services/permissions.js).
const router = express.Router();
router.use(adminMiddleware);

const adminEmail = () => (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
const bad = (res, status, error) => res.status(status).json({ error });
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

const view = u => ({
  id: String(u._id),
  name: `${u.firstName} ${u.lastName}`.trim(),
  email: u.email,
  phone: u.phone,
  role: String(u.email).toLowerCase() === adminEmail() ? 'super_admin' : u.role,
  roleLabel: ROLES[String(u.email).toLowerCase() === adminEmail() ? 'super_admin' : u.role]?.label || u.role,
  branch: u.branch || '',
  status: u.status,
  twoFactorEnabled: !!u.twoFactorEnabled,
  created: u.createdAt,
});

// The roles and what each can do, for the "add staff" form.
router.get('/roles', (req, res) => {
  res.json({ roles: STAFF_ROLES.filter(r => r !== 'super_admin').map(r => ({ key: r, label: ROLES[r].label, can: ROLES[r].can })) });
});

router.get('/', async (req, res) => {
  try {
    const staff = await User.find({ $or: [{ role: { $in: STAFF_ROLES } }, { email: adminEmail() }] }).select('-password').sort({ createdAt: 1 }).limit(2000);
    res.json({ staff: staff.map(view) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Creating a person sends nobody an email by itself: the response carries a one-time link (valid 24 hours)
// for the new staff member to choose their own password. The admin never sees or sets a password.
router.post('/', async (req, res) => {
  try {
    const firstName = clean(req.body?.firstName, 60);
    const lastName = clean(req.body?.lastName, 60);
    const email = clean(req.body?.email, 120).toLowerCase();
    const phone = clean(req.body?.phone, 20);
    const role = clean(req.body?.role, 40);
    const branch = clean(req.body?.branch, 80);
    if (!firstName || !lastName) return bad(res, 400, 'Enter first and last name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Enter a valid email address');
    if (!/^[0-9+()\-\s]{5,20}$/.test(phone)) return bad(res, 400, 'Enter a valid phone number');
    if (!isStaffRole(role) || role === 'super_admin') return bad(res, 400, 'Choose a role from the list');
    if (await User.exists({ $or: [{ email }, { phone }] })) return bad(res, 409, 'Someone already has that email or phone number');

    const user = await User.create({ firstName, lastName, email, phone, role, branch, password: crypto.randomBytes(24).toString('hex'), kycStatus: 'approved' });
    const { link, expires } = await issueResetToken(user._id, 24 * 60);
    await audit(req.user, 'STAFF_CREATED', { type: 'User', id: user._id }, { email, role, branch }, req);
    res.status(201).json({ staff: view(user), link, expires });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function target(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { bad(res, 400, 'Invalid staff id'); return null; }
  const u = await User.findById(req.params.id);
  if (!u || !(isStaffRole(u.role) || String(u.email).toLowerCase() === adminEmail())) { bad(res, 404, 'Staff member not found'); return null; }
  if (String(u.email).toLowerCase() === adminEmail()) { bad(res, 403, 'The main admin account is managed from the server settings'); return null; }
  if (String(u._id) === String(req.user.userId)) { bad(res, 403, 'You cannot change your own access'); return null; }
  return u;
}

// Signs the person out everywhere: tokens issued before this moment stop working.
const revoke = u => User.updateOne({ _id: u._id }, { passwordChangedAt: new Date() });

router.put('/:id', async (req, res) => {
  try {
    const u = await target(req, res);
    if (!u) return;
    const changes = {};
    if (req.body?.role !== undefined) {
      const role = clean(req.body.role, 40);
      if (!isStaffRole(role) || role === 'super_admin') return bad(res, 400, 'Choose a role from the list');
      changes.role = role;
    }
    if (req.body?.status !== undefined) {
      if (!['active', 'inactive'].includes(req.body.status)) return bad(res, 400, 'Status must be active or inactive');
      changes.status = req.body.status;
    }
    if (req.body?.branch !== undefined) changes.branch = clean(req.body.branch, 80);
    if (!Object.keys(changes).length) return bad(res, 400, 'Nothing to change');

    const before = { role: u.role, status: u.status, branch: u.branch };
    await User.updateOne({ _id: u._id }, changes);
    if (changes.role || changes.status === 'inactive') await revoke(u);
    await audit(req.user, 'STAFF_UPDATED', { type: 'User', id: u._id }, { before, after: changes }, req);
    res.json({ staff: view(await User.findById(u._id)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/revoke-sessions', async (req, res) => {
  try {
    const u = await target(req, res);
    if (!u) return;
    await revoke(u);
    await audit(req.user, 'STAFF_SESSIONS_REVOKED', { type: 'User', id: u._id }, {}, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/reset-2fa', async (req, res) => {
  try {
    const u = await target(req, res);
    if (!u) return;
    await User.updateOne({ _id: u._id }, { twoFactorEnabled: false, $unset: { twoFactorSecret: '', twoFactorPendingSecret: '', twoFactorRecovery: '', twoFactorLastStep: '' } });
    await revoke(u);
    await audit(req.user, 'STAFF_2FA_RESET', { type: 'User', id: u._id }, {}, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/reset-link', async (req, res) => {
  try {
    const u = await target(req, res);
    if (!u) return;
    const { link, expires } = await issueResetToken(u._id, 24 * 60);
    await audit(req.user, 'STAFF_RESET_LINK_CREATED', { type: 'User', id: u._id }, { expires: expires.toISOString() }, req);
    res.json({ link, expires });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
