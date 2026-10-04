import crypto from 'crypto';
import User from '../models/User.js';

const sha = t => crypto.createHash('sha256').update(t).digest('hex');

// Never built from the request's Host header: a forged Host could point the emailed link at an attacker.
export const baseUrl = () => (process.env.PUBLIC_BASE_URL || 'https://fintech-loan-app-production.up.railway.app').replace(/\/$/, '');

// Only the hash of the token is stored, so a database leak does not hand out working reset links.
export async function issueResetToken(userId, minutes) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + minutes * 60 * 1000);
  await User.updateOne({ _id: userId }, { passwordResetHash: sha(token), passwordResetExpires: expires, passwordResetRequestedAt: new Date() });
  return { token, expires, link: `${baseUrl()}/reset-password.html?token=${token}` };
}

// Claiming the token is one atomic step, so a link works exactly once even if used twice at the same time.
export async function consumeResetToken(token, newPassword) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const user = await User.findOneAndUpdate(
    { passwordResetHash: sha(token), passwordResetExpires: { $gt: new Date() } },
    { $unset: { passwordResetHash: '', passwordResetExpires: '' } },
    { new: true }
  );
  if (!user) return null;
  user.password = newPassword;
  await user.save();
  return user;
}

export default { issueResetToken, consumeResetToken, baseUrl };
