import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import QRCode from 'qrcode';
import User from '../models/User.js';
import { authMiddleware, generateToken } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { lockedSeconds, recordFailure, recordSuccess, lockMessage } from '../services/loginGuard.js';
import { generateSecret, verifyTotp, otpauthUrl, encryptSecret, decryptSecret } from '../services/otp.js';

// Two-factor sign-in with an authenticator app. For now it is for the admin account only: the mobile
// app has no screen for the extra step, so enabling it for customers would lock them out.
const router = express.Router();

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const adminEmail = () => (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
const isAdminUser = u => String(u.email).toLowerCase() === adminEmail();
const bad = (res, status, error) => res.status(status).json({ error });

function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const h = crypto.randomBytes(4).toString('hex');
    return `${h.slice(0, 4)}-${h.slice(4)}`;
  });
  return { codes, hashes: codes.map(sha) };
}

// Checks an authenticator code or a recovery code. Each code works once: a code is refused if its time
// step is not newer than the last one used, and a recovery code is removed as it is spent.
async function checkSecondFactor(userId, code) {
  const user = await User.findById(userId).select('+twoFactorSecret +twoFactorRecovery +twoFactorLastStep');
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) return { ok: false };
  const clean = String(code || '').trim().toLowerCase();

  if (/^\d{3}\s?\d{3}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(user.twoFactorSecret), clean);
    if (step === null) return { ok: false };
    const claimed = await User.updateOne(
      { _id: userId, $or: [{ twoFactorLastStep: { $lt: step } }, { twoFactorLastStep: { $exists: false } }] },
      { $set: { twoFactorLastStep: step } }
    );
    return claimed.modifiedCount === 1 ? { ok: true, method: '2fa' } : { ok: false };
  }

  if (/^[a-f0-9]{4}-[a-f0-9]{4}$/.test(clean)) {
    const spent = await User.updateOne({ _id: userId, twoFactorRecovery: sha(clean) }, { $pull: { twoFactorRecovery: sha(clean) } });
    return spent.modifiedCount === 1 ? { ok: true, method: 'recovery' } : { ok: false };
  }
  return { ok: false };
}

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('+twoFactorRecovery');
    res.json({ available: isAdminUser(user), enabled: !!user.twoFactorEnabled, recoveryCodesRemaining: user.twoFactorEnabled ? (user.twoFactorRecovery || []).length : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/setup', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!isAdminUser(user)) return bad(res, 403, 'Two-factor sign-in is available for the admin account only');
    if (user.twoFactorEnabled) return bad(res, 409, 'Two-factor sign-in is already on');
    const secret = generateSecret();
    await User.updateOne({ _id: user._id }, { twoFactorPendingSecret: encryptSecret(secret) });
    const url = otpauthUrl(user.email, secret);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 200 });
    res.json({ secret, otpauthUrl: url, qrSvg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/enable', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('+twoFactorPendingSecret');
    if (!isAdminUser(user)) return bad(res, 403, 'Two-factor sign-in is available for the admin account only');
    if (user.twoFactorEnabled) return bad(res, 409, 'Two-factor sign-in is already on');
    if (!user.twoFactorPendingSecret) return bad(res, 400, 'Start the setup first');

    const step = verifyTotp(decryptSecret(user.twoFactorPendingSecret), req.body?.code);
    if (step === null) return bad(res, 400, 'That code is not right. Check the time on your phone and try the next code.');

    const { codes, hashes } = newRecoveryCodes();
    await User.updateOne(
      { _id: user._id },
      { $set: { twoFactorEnabled: true, twoFactorSecret: user.twoFactorPendingSecret, twoFactorRecovery: hashes, twoFactorLastStep: step }, $unset: { twoFactorPendingSecret: '' } }
    );
    await audit(req.user, 'TWO_FACTOR_ENABLED', { type: 'User', id: user._id }, {}, req);
    res.json({ message: 'Two-factor sign-in is on', recoveryCodes: codes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/disable', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user.twoFactorEnabled) return bad(res, 400, 'Two-factor sign-in is not on');
    if (!(await user.comparePassword(String(req.body?.password || '')))) return bad(res, 400, 'Incorrect password');
    const locked = await lockedSeconds(user.email);
    if (locked) return bad(res, 429, lockMessage(locked));
    const second = await checkSecondFactor(user._id, req.body?.code);
    if (!second.ok) {
      await recordFailure(user.email);
      return bad(res, 400, 'That code is not right');
    }
    await User.updateOne({ _id: user._id }, { $set: { twoFactorEnabled: false }, $unset: { twoFactorSecret: '', twoFactorPendingSecret: '', twoFactorRecovery: '', twoFactorLastStep: '' } });
    await audit(req.user, 'TWO_FACTOR_DISABLED', { type: 'User', id: user._id }, { method: second.method }, req);
    res.json({ message: 'Two-factor sign-in is off' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Second step of signing in, after the password was accepted and a short-lived challenge was issued.
router.post('/verify', async (req, res) => {
  try {
    let challenge;
    try {
      challenge = jwt.verify(String(req.body?.challengeToken || ''), process.env.JWT_SECRET);
    } catch (e) {
      return bad(res, 401, 'Your sign-in expired. Please start again.');
    }
    if (challenge.purpose !== '2fa') return bad(res, 401, 'Your sign-in expired. Please start again.');

    const user = await User.findById(challenge.userId);
    if (!user || (user.status && user.status !== 'active')) return bad(res, 401, 'Your sign-in expired. Please start again.');

    const locked = await lockedSeconds(user.email);
    if (locked) return bad(res, 429, lockMessage(locked));

    const second = await checkSecondFactor(user._id, req.body?.code);
    if (!second.ok) {
      const nowLocked = await recordFailure(user.email);
      if (nowLocked) await audit({ email: user.email, role: 'admin' }, 'ACCOUNT_LOCKED', { type: 'User', id: user._id }, { at: 'two-factor step' }, req);
      return bad(res, 400, 'That code is not right');
    }

    await recordSuccess(user.email);
    const token = generateToken(user._id, user.email, isAdminUser(user));
    await audit({ email: user.email, role: 'admin' }, 'ADMIN_LOGIN', { type: 'User', id: user._id }, { method: second.method }, req);
    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone },
    });
  } catch (e) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
