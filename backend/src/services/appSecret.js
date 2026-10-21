import { isProduction } from './securityChecks.js';

// The secret that signs sign-in tokens, and that scrambles one-time codes and identity fingerprints before they are stored.
// On a real deployment it must be set; the made-up fallback is only for a developer's own machine.
export function appSecret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (isProduction()) throw new Error('JWT_SECRET is not set');
  return 'dev-only';
}

// Secrets that must never be used for real: too short or one of the words people choose
const WEAK = ['secret', 'jwt_secret', 'changeme', 'change-me', 'test-secret', 'your-secret-key', 'password', '123456'];
export function secretProblem(s = process.env.JWT_SECRET || '') {
  if (!s) return 'is not set';
  if (WEAK.includes(String(s).toLowerCase()) || /^(.)\1+$/.test(s)) return 'is a common word or one repeated character';
  if (s.length < 16) return `is only ${s.length} characters long (use at least 32, 64 is better)`;
  return null;
}
export const secretIsStrong = (s = process.env.JWT_SECRET || '') => !secretProblem(s) && s.length >= 32;
