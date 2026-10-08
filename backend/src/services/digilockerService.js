import crypto from 'crypto';
import DigilockerSession from '../models/DigilockerSession.js';
import User from '../models/User.js';
import { getConfig } from './configService.js';
import { baseUrl } from './passwordReset.js';
import { audit } from './auditService.js';
import { namesCompatible, flagDuplicatePan, flagDuplicateAadhaar } from './amlService.js';
import { STATES } from './chargesEngine.js';

// KYC through DigiLocker. The customer signs in at DigiLocker with their Aadhaar-linked mobile number and agrees
// to share their Aadhaar and PAN details with us. We compare the name and date of birth with their account,
// keep only the last four digits of the Aadhaar number, and approve KYC when everything matches.
//
// A real DigiLocker connection goes through a provider that holds the registration with the government
// (for example Digio, Signzy, Setu or IDfy). Their adapter is registered in PROVIDERS below once the lender has an
// account. Until then, outside production, a test mode runs the whole flow with a stand-in DigiLocker page. Test
// mode never approves KYC by itself; the customer goes to the KYC review queue.

const SESSION_MINUTES = 15;
const SESSIONS_PER_HOUR = 5;

// A provider adapter is { start({ user, session, redirectUrl }) -> { providerRef, url },
//                         fetch({ session }) -> { name, dob, gender, address, aadhaarLast4, aadhaarUid?, panNumber? } }.
export const PROVIDERS = {};
export const providerName = () => getConfig('DIGILOCKER_PROVIDER') || '';
const realProvider = () => PROVIDERS[providerName()] || null;
export const sandboxAllowed = () => !realProvider() && process.env.PAYMENT_MODE !== 'PRODUCTION';
export const modeNow = () => (realProvider() ? 'digilocker' : sandboxAllowed() ? 'sandbox' : 'unavailable');

const fullName = u => `${u.firstName} ${u.lastName}`.trim();
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
const fail = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) });

export async function startSession(user) {
  const mode = modeNow();
  if (mode === 'unavailable') return fail(503, 'DigiLocker verification is not available right now. Please contact support.', 'UNAVAILABLE');
  const recent = await DigilockerSession.countDocuments({ userId: user._id, createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } });
  if (recent >= SESSIONS_PER_HOUR) return fail(429, 'You have tried a lot of times in the last hour. Please wait a little and try again.');
  const now = Date.now();
  const session = await DigilockerSession.create({ userId: user._id, mode, expiresAt: new Date(now + SESSION_MINUTES * 60000), deleteAt: new Date(now + 24 * 3600 * 1000) });
  let url;
  if (mode === 'digilocker') {
    const started = await realProvider().start({ user, session, redirectUrl: `${baseUrl()}/api/kyc/digilocker/callback?session=${session._id}` });
    session.providerRef = started.providerRef;
    await session.save();
    url = started.url;
  } else {
    url = `${baseUrl()}/api/kyc/digilocker/sandbox/${session._id}`;
  }
  return { ok: true, session, url, mode, expiresInSeconds: SESSION_MINUTES * 60 };
}

// Compares what DigiLocker says with the account, saves the outcome, and approves KYC when it is safe to.
export async function completeSession(session, doc, req = null) {
  const user = await User.findById(session.userId);
  if (!user) return fail(404, 'Account not found');
  const flags = [];
  const name = String(doc?.name ?? '').trim();
  if (!name) return fail(422, 'DigiLocker did not return a name');

  const nameMatch = namesCompatible(fullName(user), name);
  if (!nameMatch) flags.push('name_differs');

  const dob = doc.dob ? new Date(doc.dob) : null;
  const dobOk = dob && !Number.isNaN(dob.getTime());
  const dobMatch = !user.dateOfBirth || !dobOk ? null : day(user.dateOfBirth) === day(dob);
  if (dobMatch === false) flags.push('date_of_birth_differs');
  if (!dobOk) flags.push('no_date_of_birth');

  const last4 = String(doc.aadhaarLast4 ?? '').replace(/\D/g, '').slice(-4);
  const key = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-only').update(`${doc.aadhaarUid || ''}|${last4}|${dobOk ? day(dob) : ''}|${name.toLowerCase().replace(/\s+/g, ' ')}`).digest('hex');
  const dupe = await User.findOne({ _id: { $ne: user._id }, 'kycDigilocker.key': key }).select('_id');
  if (dupe) { flags.push('same_aadhaar_on_another_account'); await flagDuplicateAadhaar(user); }

  // The PAN, when DigiLocker has it
  const set = {};
  let panFound = false;
  if (doc.panNumber) {
    const pan = String(doc.panNumber).toUpperCase().trim();
    if (/^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/.test(pan)) {
      panFound = true;
      if (user.panNumber && user.panNumber !== pan) flags.push('pan_differs');
      else if (!user.panNumber) {
        if (await User.exists({ panNumber: pan, _id: { $ne: user._id } })) { flags.push('pan_on_another_account'); await flagDuplicatePan(user, pan); }
        else set.panNumber = pan;
      }
    }
  }

  // Fill in what the customer has not given yet, from the government record
  if (!user.dateOfBirth && dobOk) set.dateOfBirth = dob;
  if (!user.gender && ['Male', 'Female', 'Other'].includes(doc.gender)) set.gender = doc.gender;
  const a = doc.address || {};
  if (!user.address?.street && a.street) set['address.street'] = String(a.street).slice(0, 200);
  if (!user.address?.city && a.city) set['address.city'] = String(a.city).slice(0, 60);
  if (!user.address?.state && STATES.includes(a.state)) set['address.state'] = a.state;
  if (!user.address?.zipCode && /^[1-9]\d{5}$/.test(String(a.zipCode ?? ''))) set['address.zipCode'] = String(a.zipCode);

  const status = flags.length === 0 ? 'verified' : 'review';
  const summary = { status, mode: session.mode, provider: session.mode === 'digilocker' ? providerName() : 'sandbox', at: new Date(), nameMatch, dobMatch, aadhaarLast4: last4, panFound, flags, key, dob: dobOk ? day(dob) : null };
  set.kycDigilocker = summary;
  // Real DigiLocker with everything matching approves KYC. Test mode, or anything that does not match, goes to a person.
  const approve = status === 'verified' && session.mode === 'digilocker';
  if (approve && user.kycStatus !== 'approved') set.kycStatus = 'approved';
  await User.updateOne({ _id: user._id }, { $set: set });

  session.status = 'completed';
  session.result = { status, nameMatch, dobMatch, flags, kycApproved: approve };
  await session.save();
  await audit({ email: user.email, role: 'customer' }, status === 'verified' ? 'KYC_DIGILOCKER_VERIFIED' : 'KYC_DIGILOCKER_REVIEW', { type: 'User', id: user._id }, { mode: session.mode, flags, kycApproved: approve }, req);
  return { ok: true, status, nameMatch, dobMatch, flags, kycApproved: approve };
}

// For a real provider, the customer comes back and we fetch what they shared.
export async function finishWithProvider(session, req = null) {
  const p = realProvider();
  if (!p || session.mode !== 'digilocker') return fail(400, 'This session is not a DigiLocker session');
  try {
    const doc = await p.fetch({ session });
    return await completeSession(session, doc, req);
  } catch (e) {
    session.status = 'failed';
    session.result = { error: String(e.message).slice(0, 120) };
    await session.save();
    return fail(502, 'We could not get your details from DigiLocker. Please try again.');
  }
}

export default { startSession, completeSession, finishWithProvider, modeNow, PROVIDERS };
