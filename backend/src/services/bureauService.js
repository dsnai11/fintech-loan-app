import crypto from 'crypto';
import { getConfig } from './configService.js';
import User from '../models/User.js';

// The credit check: asks a credit bureau for the customer's score.
// No real bureau is connected yet. Until one is, outside production the check returns a test score worked out
// from the customer's PAN (clearly marked "sandbox"), so the whole flow can be tried. In production with no
// bureau, there is no score and the customer's offer is worked out without one.

const FRESH_DAYS = 30;

export const bureauConfigured = () => {
  const p = getConfig('BUREAU_PROVIDER');
  return !!p && p !== 'sandbox' && !!getConfig('BUREAU_API_KEY'); // a real provider will be wired in here
};

const sandboxAllowed = () => process.env.PAYMENT_MODE !== 'PRODUCTION';

function sandboxScore(user) {
  const seed = String(user.panNumber || user.phone || user._id);
  const n = parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16);
  return 550 + (n % 251); // 550 to 800
}

// Returns the customer's score, using a recent one if there is one. Never throws.
export async function checkCredit(user, { force = false } = {}) {
  const fresh = user.creditScore > 0 && user.creditScoreAt && Date.now() - new Date(user.creditScoreAt).getTime() < FRESH_DAYS * 86400000;
  if (fresh && !force) return { score: user.creditScore, source: user.creditScoreSource || 'bureau', cached: true };
  try {
    let result = { score: null, source: 'none' };
    if (bureauConfigured()) {
      // Real bureau call goes here once an account exists (CIBIL, Experian, CRIF or Equifax).
      result = { score: null, source: 'none' };
    } else if (sandboxAllowed()) {
      result = { score: sandboxScore(user), source: 'sandbox' };
    }
    if (result.score) await User.updateOne({ _id: user._id }, { creditScore: result.score, creditScoreAt: new Date(), creditScoreSource: result.source });
    return { ...result, cached: false };
  } catch (e) {
    console.error('Credit check failed:', e.message);
    return { score: null, source: 'none', cached: false };
  }
}

export default { checkCredit, bureauConfigured };
