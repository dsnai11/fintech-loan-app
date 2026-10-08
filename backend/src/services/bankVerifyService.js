import crypto from 'crypto';
import User from '../models/User.js';
import { getConfig } from './configService.js';
import { namesCompatible } from './amlService.js';
import { audit } from './auditService.js';

// Checks that a bank account is real, live and in the customer's name, with a Rs 1 deposit ("penny drop") through the
// payment provider. The bank answers with the name on the account, which we compare with the name the customer gave.
//
// Routing, like every other outside service:
//   - Razorpay is chosen and set up (RazorpayX): every check goes to it, and the test mode is never used.
//   - Nothing chosen, outside production: a clearly marked test answer (an account ending 0000 fails, 1111 shows a
//     different name, anything else passes).
//   - Nothing chosen, in production: the account is saved but stays "not verified". No result is ever invented.
// If the company switches on REQUIRE_BANK_VERIFIED, a loan cannot be paid out to an account that is not verified.

const production = () => process.env.PAYMENT_MODE === 'PRODUCTION';
export const providerName = () => getConfig('BANK_VERIFY_PROVIDER') || '';
const rzpBase = () => getConfig('RAZORPAY_API_BASE') || 'https://api.razorpay.com/v1';
const auth = () => 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
async function rzp(method, path, body) {
  const res = await fetch(`${rzpBase()}${path}`, { method, headers: { Authorization: auth(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.description || `Razorpay answered ${res.status}`);
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const fingerprint = b => crypto.createHash('sha256').update(`${String(b?.accountNumber || '').trim()}|${String(b?.ifscCode || '').trim().toUpperCase()}`).digest('hex').slice(0, 24);

export const PROVIDERS = {
  razorpay: {
    name: 'razorpay',
    ready: () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && getConfig('RAZORPAYX_ACCOUNT_NUMBER')),
    // -> { accountActive, nameAtBank, ref }
    async check({ user, bank }) {
      const name = (bank.accountHolder || `${user.firstName} ${user.lastName}`).trim();
      const contact = await rzp('POST', '/contacts', { name, type: 'customer', reference_id: String(user._id) });
      const fa = await rzp('POST', '/fund_accounts', { contact_id: contact.id, account_type: 'bank_account', bank_account: { name, ifsc: bank.ifscCode.toUpperCase(), account_number: bank.accountNumber } });
      let v = await rzp('POST', '/fund_accounts/validations', { account_number: getConfig('RAZORPAYX_ACCOUNT_NUMBER'), fund_account: { id: fa.id }, amount: 100, currency: 'INR', notes: { userId: String(user._id) } });
      for (let i = 0; i < 12 && v.status === 'created'; i++) { await sleep(2000); v = await rzp('GET', `/fund_accounts/validations/${v.id}`); }
      if (v.status === 'created') throw new Error('The bank has not answered yet');
      return { accountActive: v.status === 'completed' && v.results?.account_status === 'active', nameAtBank: v.results?.registered_name || null, ref: v.id };
    },
  },
  sandbox: {
    name: 'sandbox',
    ready: () => true,
    async check({ bank }) {
      const last4 = String(bank.accountNumber).slice(-4);
      if (last4 === '0000') return { accountActive: false, nameAtBank: null, ref: 'sandbox' };
      return { accountActive: true, nameAtBank: last4 === '1111' ? 'RAMESH KUMAR' : String(bank.accountHolder || 'TEST HOLDER').toUpperCase(), ref: 'sandbox' };
    },
  },
};

export function availability() {
  const p = providerName();
  if (p && p !== 'razorpay') return { mode: 'misconfigured', provider: null, note: `"${p}" is not a bank-check provider here. Choose razorpay.` };
  if (p === 'razorpay') return PROVIDERS.razorpay.ready() ? { mode: 'live', provider: PROVIDERS.razorpay } : { mode: 'misconfigured', provider: null, note: 'Razorpay is chosen but RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAYX_ACCOUNT_NUMBER are not all set.' };
  return production() ? { mode: 'unavailable', provider: null, note: 'No provider is set up, so accounts are saved but not verified.' } : { mode: 'test', provider: PROVIDERS.sandbox, note: 'Test mode: the bank answer is made up. An account ending 0000 fails; 1111 shows a different name.' };
}

export const required = () => getConfig('REQUIRE_BANK_VERIFIED', 'false') === 'true';

// Is the saved account the one that was checked, and did the check pass?
export function isVerified(user) {
  const v = user?.bankVerification;
  return !!v && v.status === 'verified' && v.fingerprint === fingerprint(user.bankAccount);
}

// Runs the check on the account saved on the customer and saves the outcome. Never throws.
export async function verifyBank(user, req = null) {
  const bank = user.bankAccount;
  if (!bank?.accountNumber || !bank?.ifscCode) return { status: 'unverified', reason: 'no bank account' };
  const a = availability();
  const base = { fingerprint: fingerprint(bank), at: new Date(), mode: a.mode, last4: String(bank.accountNumber).slice(-4), ifsc: bank.ifscCode.toUpperCase() };
  let result;
  if (!a.provider) {
    result = { ...base, status: 'unverified', note: a.note };
  } else {
    try {
      const r = await a.provider.check({ user, bank });
      if (!r.accountActive) result = { ...base, status: 'failed', note: 'The bank says this account is not valid or not active.', ref: r.ref };
      else if (r.nameAtBank && !namesCompatible(bank.accountHolder || `${user.firstName} ${user.lastName}`, r.nameAtBank)) result = { ...base, status: 'name_mismatch', nameAtBank: r.nameAtBank, ref: r.ref, note: 'The name on the account is different from the name given.' };
      else result = { ...base, status: 'verified', nameAtBank: r.nameAtBank, ref: r.ref };
    } catch (e) {
      console.error('Bank check failed:', e.message);
      result = { ...base, status: 'unverified', note: 'The bank check could not be completed. Please try again.' };
    }
  }
  await User.updateOne({ _id: user._id }, { bankVerification: result });
  user.bankVerification = result;
  await audit({ email: user.email, role: 'customer' }, 'BANK_VERIFICATION', { type: 'User', id: user._id }, { status: result.status, mode: result.mode, last4: result.last4 }, req);
  return result;
}

export async function markManually(user, by, note) {
  const bank = user.bankAccount;
  const v = { fingerprint: fingerprint(bank), at: new Date(), mode: 'manual', status: 'verified', last4: String(bank.accountNumber).slice(-4), ifsc: bank.ifscCode.toUpperCase(), note: String(note).slice(0, 200), by };
  await User.updateOne({ _id: user._id }, { bankVerification: v });
  await audit({ email: by, role: 'staff' }, 'BANK_VERIFIED_MANUALLY', { type: 'User', id: user._id }, { note: v.note, last4: v.last4 }, null);
  return v;
}

export const view = user => {
  const v = user?.bankVerification;
  if (!v) return null;
  return { status: v.status, current: v.fingerprint === fingerprint(user.bankAccount), mode: v.mode, at: v.at, nameAtBank: v.nameAtBank || null, note: v.note || '', by: v.by || null };
};

export default { verifyBank, isVerified, markManually, availability, required, view, fingerprint, PROVIDERS };
