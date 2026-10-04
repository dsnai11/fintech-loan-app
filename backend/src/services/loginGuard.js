import LoginAttempt from '../models/LoginAttempt.js';

const maxAttempts = () => Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const lockMinutes = () => Number(process.env.LOGIN_LOCK_MINUTES) || 15;
const keyOf = email => String(email || '').trim().toLowerCase();

// Returns the number of seconds left on a lock, or 0 if the email is free to try.
export async function lockedSeconds(email) {
  const rec = await LoginAttempt.findOne({ key: keyOf(email) });
  if (!rec?.lockedUntil) return 0;
  const left = Math.ceil((rec.lockedUntil.getTime() - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

// Counts a failure. Returns true if this failure locked the email.
export async function recordFailure(email) {
  const key = keyOf(email);
  const rec = await LoginAttempt.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (rec.count >= maxAttempts() && !(rec.lockedUntil && rec.lockedUntil > new Date())) {
    await LoginAttempt.updateOne({ key }, { $set: { lockedUntil: new Date(Date.now() + lockMinutes() * 60 * 1000), count: 0 } });
    return true;
  }
  return false;
}

export async function recordSuccess(email) {
  await LoginAttempt.deleteOne({ key: keyOf(email) });
}

export const lockMessage = seconds => `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`;

export default { lockedSeconds, recordFailure, recordSuccess, lockMessage };
