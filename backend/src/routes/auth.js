import { passwordProblem, hashPassword, needsRehash, BCRYPT_COST } from '../services/passwordPolicy.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { currentVersion, termsRequiredFor } from '../services/terms.js';
import { setupStatus } from '../services/onboardingService.js';
import { audit, clientIp } from '../services/auditService.js';
import { issueResetToken, consumeResetToken } from '../services/passwordReset.js';
import { sendPlainEmail } from '../services/notificationService.js';
import { lockedSeconds, recordFailure, recordSuccess, lockMessage } from '../services/loginGuard.js';
import { isStaffRole, permissionsOf, ensureRoles } from '../services/permissions.js';
import { checkCode, attach } from '../services/referralService.js';
import { recordDevice, deviceGate, DEVICE_PURPOSE } from '../services/deviceService.js';
import DeviceBinding from '../models/DeviceBinding.js';
import { sendCode, verifyCode } from '../services/phoneVerification.js';
import { isPartnerCode, findByCode, attachLead } from '../services/partnerService.js';

// Checked against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

const router = express.Router();

router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, phone, password, confirmPassword } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    const weak = passwordProblem(password, { email, phone, firstName, lastName });
    if (weak) return res.status(400).json({ error: weak });

    if (!/^[6-9]\d{9}$/.test(String(phone))) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    }

    if (process.env.REQUIRE_TERMS !== 'false') {
      if (req.body.acceptedTerms !== true) return res.status(400).json({ error: 'Please read and accept the terms and conditions to continue', code: 'TERMS_REQUIRED' });
      if (Number(req.body.termsVersion) !== currentVersion()) return res.status(409).json({ error: 'The terms and conditions were just updated. Please read the new version and accept it.', code: 'TERMS_CHANGED' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Email or phone already registered' });
    }

    // An optional referral code from a friend
    // The same box takes a friend's code (LIFC...) or a partner's code (AGT...)
    let partner = null;
    if (isPartnerCode(req.body.referralCode)) {
      partner = await findByCode(req.body.referralCode);
      if (!partner) return res.status(400).json({ error: 'That agent code is not valid. Check it, or leave it empty.', code: 'REFERRAL_INVALID' });
    }
    const referral = partner ? { none: true } : await checkCode(req.body.referralCode, { phone: String(phone), email });
    if (referral.error) return res.status(400).json({ error: referral.error, code: 'REFERRAL_INVALID' });

    const user = new User({
      firstName,
      lastName,
      email,
      phone,
      password,
      ...(process.env.REQUIRE_TERMS !== 'false' ? { termsVersion: currentVersion(), termsAcceptedAt: new Date(), termsAcceptedIp: req.ip } : {}),
    });

    {
      const clean = v => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
      const src = clean(req.body.utmSource), camp = clean(req.body.utmCampaign), med = clean(req.body.utmMedium);
      if (src || camp || med) user.acquisition = { source: src || 'unknown', campaign: camp, medium: med };
      else if (referral.referrer) user.acquisition = { source: 'referral', campaign: '', medium: '' };
      else user.acquisition = { source: 'app', campaign: '', medium: '' };
    }
    await user.save();
    if (partner) await attachLead(partner, user);
    if (referral.referrer) {
      try { await attach(user, referral.referrer, referral.code, req); } catch (e) { console.error('Referral link failed:', e.message); } // the account is still created
    }
    if (process.env.REQUIRE_TERMS !== 'false') await audit({ email: user.email, role: 'customer' }, 'TERMS_ACCEPTED', { type: 'User', id: user._id }, { version: currentVersion(), at: 'signup' }, req);
    const token = generateToken(user._id, user.email);
    await recordDevice(req, user._id, 'signup');

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    // Stored emails are lowercase; phones love to capitalise the first letter or add a trailing space.
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const locked = await lockedSeconds(email);
    if (locked) return res.status(429).json({ error: lockMessage(locked) });

    const user = await User.findOne({ email });
    const passwordOk = user ? await user.comparePassword(String(password)) : (await bcrypt.compare(String(password), DUMMY_HASH), false);
    if (!passwordOk) {
      const nowLocked = await recordFailure(email);
      if (nowLocked && user) await audit({ email, role: 'customer' }, 'ACCOUNT_LOCKED', { type: 'User', id: user._id }, { at: 'password step' }, req);
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: 'Your account is not active. Please contact support.' });
    }
    // A password stored at an older, cheaper work factor is stored again at the current one, now that we have it in hand
    if (needsRehash(user.password)) hashPassword(String(password)).then(h => User.updateOne({ _id: user._id }, { password: h })).catch(() => {});

    // With two-factor on, the failure counter is only cleared once the code is also right. Otherwise someone
    // who knows the password could sign in again after every wrong code and never run out of guesses.
    if (user.twoFactorEnabled) {
      const challengeToken = jwt.sign({ userId: String(user._id), purpose: '2fa' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
      return res.json({ twoFactorRequired: true, challengeToken });
    }
    await recordSuccess(email);

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
    await ensureRoles();
    const isAdmin = user.email === adminEmail || isStaffRole(user.role);
    const role = user.email === adminEmail ? 'super_admin' : isStaffRole(user.role) ? user.role : 'customer';
    const token = generateToken(user._id, user.email, isAdmin);
    if (isAdmin) await audit({ email: user.email, role: user.email === adminEmail ? 'super_admin' : user.role }, 'ADMIN_LOGIN', { type: 'User', id: user._id }, {}, req);
    if (!isAdmin) {
      // A phone this account has not used before may have to prove the phone number first
      const gate = await deviceGate(req, user);
      if (gate) return res.json(gate);
      await recordDevice(req, user._id, 'login');
    }

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isAdmin,
        role,
        permissions: isAdmin ? permissionsOf(role) : [],
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ── The new-phone check ──────────────────────────────────────────────────────────────────────────
// Step 1 of a sign-in from an unfamiliar phone ends with a short-lived device token. These two calls turn it into a sign-in.
const deviceUser = async token => {
  let d;
  try { d = jwt.verify(String(token || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] }); } catch (e) { return null; }
  if (d.purpose !== DEVICE_PURPOSE) return null;
  const user = await User.findById(d.userId);
  return user && (!user.status || user.status === 'active') ? { user, installId: d.installId } : null;
};

router.post('/device/send', async (req, res) => {
  try {
    const who = await deviceUser(req.body?.deviceToken);
    if (!who) return res.status(401).json({ error: 'This step has expired. Please sign in again.' });
    const r = await sendCode(who.user, { force: true, channel: req.body?.channel === 'sms' ? 'sms' : undefined });
    res.status(r.status).json(r.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/device/verify', async (req, res) => {
  try {
    const who = await deviceUser(req.body?.deviceToken);
    if (!who) return res.status(401).json({ error: 'This step has expired. Please sign in again.' });
    const r = await verifyCode(who.user, req.body?.code, req, { force: true });
    if (r.status !== 200) return res.status(r.status).json(r.body);
    const { user, installId } = who;
    await DeviceBinding.updateOne({ installId, userId: user._id }, { $set: { lastSeenAt: new Date(), lastIp: clientIp(req) || '', platform: String(req.headers['x-platform'] || '').slice(0, 20), appVersion: String(req.headers['x-app-version'] || '').slice(0, 20) }, $inc: { events: 1 }, $setOnInsert: { firstSeenAt: new Date() } }, { upsert: true });
    await audit({ email: user.email, role: 'customer' }, 'DEVICE_VERIFIED', { type: 'User', id: user._id }, { installId: installId.slice(0, 8) }, req);
    await recordSuccess(user.email);
    res.json({
      message: 'Login successful',
      token: generateToken(user._id, user.email, false),
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, isAdmin: false, role: 'customer', permissions: [] },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Always answers the same way, so it cannot be used to find out which emails are registered.
// What the app must still ask this customer to do before they can use it: accept the terms, verify the phone.
router.get('/onboarding', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('role email emailVerified emailVerifiedFor phone phoneVerified termsVersion dateOfBirth gender address employment bankAccount selfie aadhaarCard kycDigilocker');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const customer = !isStaffRole(user.role) && user.email !== (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
    res.json({
      termsRequired: customer && termsRequiredFor(user),
      termsVersion: currentVersion(),
      phoneVerified: !!user.phoneVerified,
      setup: setupStatus(user),
      phone: String(user.phone).replace(/(\d{2})\d{6}(\d{2})/, '$1XXXXXX$2'),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/accept-terms', authMiddleware, async (req, res) => {
  try {
    if (Number(req.body?.version) !== currentVersion()) return res.status(409).json({ error: 'The terms were just updated. Please read the new version.', code: 'TERMS_CHANGED', version: currentVersion() });
    const user = await User.findById(req.user.userId).select('email termsVersion');
    if (!user) return res.status(404).json({ error: 'User not found' });
    await User.updateOne({ _id: user._id }, { termsVersion: currentVersion(), termsAcceptedAt: new Date(), termsAcceptedIp: req.ip });
    await audit({ email: user.email, role: 'customer' }, 'TERMS_ACCEPTED', { type: 'User', id: user._id }, { version: currentVersion(), at: 'login' }, req);
    res.json({ accepted: true, version: currentVersion() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  const generic = { message: 'If that email is registered, we have sent a link to reset the password.' };
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    // One email a minute per account, so the form cannot be used to flood someone's inbox.
    const recent = user?.passwordResetRequestedAt && Date.now() - user.passwordResetRequestedAt.getTime() < 60 * 1000;
    if (user && (!user.status || user.status === 'active') && !recent) {
      const { link } = await issueResetToken(user._id, 60);
      const result = await sendPlainEmail(
        user.email,
        'Reset your LIFC password',
        `We got a request to reset your LIFC password.

Open this link within 1 hour to choose a new one:
${link}

If you did not ask for this, you can ignore this email. Your password has not changed.`
      );
      if (result !== 'sent') console.warn(`Password reset email for a customer was not sent (${result}). Email is not configured or failed.`);
      await audit({ email: user.email, role: 'customer' }, 'PASSWORD_RESET_REQUESTED', { type: 'User', id: user._id }, { emailStatus: result }, req);
    }
    res.json(generic);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const weak = passwordProblem(password);
    if (weak) return res.status(400).json({ error: weak });
    const user = await consumeResetToken(token, password);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please ask for a new one.' });

    await audit({ email: user.email, role: user.email === (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase() ? 'admin' : 'customer' }, 'PASSWORD_RESET_COMPLETED', { type: 'User', id: user._id }, {}, req);
    await sendPlainEmail(user.email, 'Your LIFC password was changed', 'Your LIFC password was just changed. If this was not you, contact support straight away.');
    res.json({ message: 'Password changed. You can now sign in.' });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
