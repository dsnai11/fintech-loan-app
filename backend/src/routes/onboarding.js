import express from 'express';
import User from '../models/User.js';
import KycMedia from '../models/KycMedia.js';
import LivenessChallenge from '../models/LivenessChallenge.js';
import AmlAlert from '../models/AmlAlert.js';
import { authMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { setupStatus, checkProfile } from '../services/onboardingService.js';
import { analyseBlinks, readFrame, REQUIRED_BLINKS } from '../services/livenessService.js';

// Account setup for the signed-in customer: personal details, a selfie with a blink check, and (through the
// KYC routes) the bank account. The app walks the customer through these right after sign-up.
const router = express.Router();
router.use(authMiddleware);

const CHALLENGE_SECONDS = 180;
const ATTEMPTS_PER_HOUR = 6;
const bad = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

router.get('/status', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return bad(res, 404, 'User not found');
    res.json({ steps: setupStatus(user), selfie: user.selfie ? { status: user.selfie.status, capturedAt: user.selfie.capturedAt } : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Personal details. The same route is used when the customer changes them later from their profile.
router.put('/profile', async (req, res) => {
  try {
    const current = await User.findById(req.user.userId).select('kycDigilocker');
    const { errors, update } = checkProfile(req.body, current);
    if (errors.length) return bad(res, 400, errors[0], { errors });
    const user = await User.findByIdAndUpdate(req.user.userId, { $set: update }, { new: true });
    if (!user) return bad(res, 404, 'User not found');
    await audit(req.user, 'PROFILE_DETAILS_SAVED', { type: 'User', id: user._id }, { fields: Object.keys(update) }, req);
    res.json({ message: 'Details saved', steps: setupStatus(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step one of the selfie: a one-time challenge the app has to answer.
router.post('/selfie/challenge', async (req, res) => {
  try {
    const recent = await LivenessChallenge.countDocuments({ userId: req.user.userId, createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } });
    if (recent >= ATTEMPTS_PER_HOUR * 2) return bad(res, 429, 'You have tried a lot of times in the last hour. Please wait a little and try again.');
    const now = Date.now();
    const c = await LivenessChallenge.create({ userId: req.user.userId, blinks: REQUIRED_BLINKS, expiresAt: new Date(now + CHALLENGE_SECONDS * 1000), deleteAt: new Date(now + 3600 * 1000) });
    res.json({ challengeId: String(c._id), blinks: c.blinks, expiresInSeconds: CHALLENGE_SECONDS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step two: the photos and what the camera saw of the customer's eyes.
router.post('/selfie', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return bad(res, 404, 'User not found');
    const { challengeId, before, after, blink } = req.body || {};

    // A limit on attempts, kept on the account so it holds across servers.
    const now = Date.now();
    const w = user.selfieAttempts || {};
    const inWindow = w.windowStart && now - new Date(w.windowStart).getTime() < 3600 * 1000;
    const count = inWindow ? w.count || 0 : 0;
    if (count >= ATTEMPTS_PER_HOUR) return bad(res, 429, 'Too many attempts in the last hour. Please wait a little and try again.');
    await User.updateOne({ _id: user._id }, { selfieAttempts: { count: count + 1, windowStart: inWindow ? w.windowStart : new Date(now) } });

    // The challenge is used up whether or not the check passes, so it cannot be replayed.
    const c = await LivenessChallenge.findOneAndUpdate({ _id: String(challengeId), userId: user._id, usedAt: null, expiresAt: { $gt: new Date() } }, { usedAt: new Date() }, { new: true }).catch(() => null);
    if (!c) return bad(res, 400, 'That check has timed out. Please start again.', { code: 'CHALLENGE_EXPIRED' });

    const fail = async (reasons, code = 'LIVENESS_FAILED') => {
      await audit(req.user, 'SELFIE_REJECTED', { type: 'User', id: user._id }, { reasons }, req);
      return bad(res, 422, reasons[0], { code, reasons });
    };

    const f1 = readFrame(before, 'first');
    if (f1.error) return fail([f1.error], 'PHOTO_INVALID');
    const f2 = readFrame(after, 'second');
    if (f2.error) return fail([f2.error], 'PHOTO_INVALID');
    if (f1.sha256 === f2.sha256) return fail(['The two photos are the same picture. Please try again.'], 'PHOTO_INVALID');

    const result = analyseBlinks(blink?.samples, c.blinks);
    if (!result.ok) return fail(result.reasons);
    // The blinks cannot have taken longer than the time since the challenge was handed out.
    if (result.durationMs > now - new Date(c.issuedAt).getTime() + 1500) return fail(['The check did not happen in real time. Please try again.']);

    // The same photo on another account is a sign of a stolen or reused picture.
    const dupe = await KycMedia.findOne({ sha256: { $in: [f1.sha256, f2.sha256] }, userId: { $ne: user._id } }).select('userId');
    await KycMedia.deleteMany({ userId: user._id });
    await KycMedia.create([
      { userId: user._id, kind: 'selfie_before', data: f1.data, sha256: f1.sha256, size: f1.data.length, width: f1.width, height: f1.height, challengeId: String(c._id) },
      { userId: user._id, kind: 'selfie_after', data: f2.data, sha256: f2.sha256, size: f2.data.length, width: f2.width, height: f2.height, challengeId: String(c._id) },
    ]);
    const selfie = { status: dupe ? 'review' : 'passed', capturedAt: new Date(), challengeId: String(c._id), blinks: result.blinks, method: 'blink_on_device', flag: dupe ? 'same_photo_on_another_account' : null };
    const updated = await User.findByIdAndUpdate(user._id, { selfie }, { new: true });
    if (dupe) await AmlAlert.create({ rule: 'DUPLICATE_SELFIE', severity: 'MEDIUM', userId: user._id, detail: 'The selfie photo is the same picture as one on another account.' });
    await audit(req.user, 'SELFIE_CAPTURED', { type: 'User', id: user._id }, { blinks: result.blinks, status: selfie.status }, req);
    res.json({ message: dupe ? 'Thank you. Our team will look at your photo.' : 'Photo verified', selfie: { status: selfie.status }, steps: setupStatus(updated) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The customer's own photo, for their profile
router.get('/selfie/image', async (req, res) => {
  try {
    const m = await KycMedia.findOne({ userId: req.user.userId, kind: req.query.frame === 'after' ? 'selfie_after' : 'selfie_before' }).select('+data mime');
    if (!m) return bad(res, 404, 'No photo yet');
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(m.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
