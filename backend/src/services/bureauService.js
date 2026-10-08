import crypto from 'crypto';
import { getConfig } from './configService.js';
import User from '../models/User.js';

// The credit check: asks a credit bureau for the customer's score.
//
// How it routes:
//   - A real bureau is configured (BUREAU_PROVIDER=generic plus its address and key): every check goes to it,
//     and the test score is never used, in any mode.
//   - Nothing configured, outside production: a test score worked out from the customer's PAN, marked "sandbox".
//   - Nothing configured, in production: no score. The offer is then worked out without one. A score is never invented.
//   - A real bureau is configured but fails or answers with something unusable: no score for that check (never the test score).
//
// The "generic" adapter calls any bureau or aggregator that answers a JSON request with a JSON reply containing the
// score. Settings (Configuration page or environment variables):
//   BUREAU_API_URL, BUREAU_API_KEY, BUREAU_METHOD (POST), BUREAU_AUTH_HEADER (Authorization), BUREAU_AUTH_SCHEME (Bearer),
//   BUREAU_REQUEST_TEMPLATE (JSON with {{pan}} {{name}} {{dob}} {{phone}} {{email}}), BUREAU_SCORE_PATH (score),
//   BUREAU_TIMEOUT_MS (10000). A vendor with a different flow gets its own adapter in PROVIDERS below.

const FRESH_DAYS = 30;

const fullName = u => `${u.firstName || ''} ${u.lastName || ''}`.trim();
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

const fillTemplate = (node, vars) => {
  if (typeof node === 'string') return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
  if (Array.isArray(node)) return node.map(n => fillTemplate(n, vars));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillTemplate(v, vars)]));
  return node;
};
const pathGet = (o, p) => String(p || 'score').split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

// Adapters: { check(user) -> { score } } or throws.
export const PROVIDERS = {
  generic: {
    required: ['BUREAU_API_URL', 'BUREAU_API_KEY'],
    async check(user) {
      const method = String(getConfig('BUREAU_METHOD', 'POST')).toUpperCase();
      const vars = { pan: user.panNumber || '', name: fullName(user), dob: day(user.dateOfBirth), phone: user.phone || '', email: user.email || '' };
      let template = {};
      try { template = JSON.parse(getConfig('BUREAU_REQUEST_TEMPLATE', '') || '{"pan":"{{pan}}","name":"{{name}}","dob":"{{dob}}","mobile":"{{phone}}"}'); } catch (e) { throw new Error('BUREAU_REQUEST_TEMPLATE is not valid JSON'); }
      const header = getConfig('BUREAU_AUTH_HEADER', 'Authorization');
      const scheme = getConfig('BUREAU_AUTH_SCHEME', 'Bearer ');
      const res = await fetch(getConfig('BUREAU_API_URL'), {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', [header]: `${scheme}${getConfig('BUREAU_API_KEY')}` },
        body: method === 'GET' ? undefined : JSON.stringify(fillTemplate(template, vars)),
        signal: AbortSignal.timeout(Number(getConfig('BUREAU_TIMEOUT_MS', '10000')) || 10000),
      });
      if (!res.ok) throw new Error(`Bureau answered ${res.status}`);
      const score = Number(pathGet(await res.json(), getConfig('BUREAU_SCORE_PATH', 'score')));
      if (!Number.isFinite(score) || score < 300 || score > 900) throw new Error('Bureau reply had no usable score');
      return { score: Math.round(score) };
    },
  },
};

export const providerName = () => getConfig('BUREAU_PROVIDER') || '';
const adapter = () => PROVIDERS[providerName()] || null;
export const missingSettings = () => (adapter() ? adapter().required.filter(k => !getConfig(k)) : []);
export const bureauConfigured = () => !!adapter() && missingSettings().length === 0;
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
      try {
        const r = await adapter().check(user);
        result = { score: r.score, source: 'bureau' };
      } catch (e) {
        console.error('Credit bureau call failed:', e.message);
      }
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

export default { checkCredit, bureauConfigured, providerName, missingSettings, PROVIDERS };
