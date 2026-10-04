import jwt from 'jsonwebtoken';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import AuditLog from '../../src/models/AuditLog.js';
import LoginAttempt from '../../src/models/LoginAttempt.js';
import { totp, verifyTotp, base32Encode, base32Decode, encryptSecret, decryptSecret } from '../../src/services/otp.js';

const DB = 'fintech-test-security';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { user: adminUser } = await makeAdmin();

const login = (email, password) => call('POST', '/auth/login', null, { email, password });
const hasAudit = async (action, pred = () => true) => (await AuditLog.find({ action })).some(pred);
const claims = tok => jwt.decode(tok);

section('AUTHENTICATOR CODES MATCH THE OFFICIAL TEST VECTORS (RFC 6238)');
const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
for (const [t, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]) {
  check(`code at t=${t} is ${expected}`, totp(rfcSecret, t * 1000, { digits: 8 }) === expected);
}
check('base32 round trip', base32Decode(base32Encode(Buffer.from('hello world'))).toString() === 'hello world');
const now = Date.now();
check('current code is accepted', verifyTotp(rfcSecret, totp(rfcSecret, now), now) !== null);
check('code from the previous 30 seconds is accepted (clock drift)', verifyTotp(rfcSecret, totp(rfcSecret, now - 30000), now) !== null);
check('code from 90 seconds ago is refused', verifyTotp(rfcSecret, totp(rfcSecret, now - 90000), now) === null);
check('letters and short codes are refused', verifyTotp(rfcSecret, 'abcdef', now) === null && verifyTotp(rfcSecret, '123', now) === null);
check('secrets encrypt and decrypt, and the stored form is not the secret', decryptSecret(encryptSecret(rfcSecret)) === rfcSecret && !encryptSecret(rfcSecret).includes(rfcSecret));

section('PASSWORD RULES AT SIGNUP');
const signup = (email, password, phone) => call('POST', '/auth/signup', null, { firstName: 'S', lastName: 'U', email, phone, password, confirmPassword: password });
check('too short is refused (400)', (await signup('s1@x.in', 'short', '9600000001')).s === 400);
check('over 128 characters is refused (400)', (await signup('s2@x.in', 'x'.repeat(129), '9600000002')).s === 400);
check('8 characters is accepted', (await signup('s3@x.in', 'eightchr', '9600000003')).s === 201);

section('ACCOUNT LOCKOUT');
await User.create({ firstName: 'Lock', lastName: 'Me', email: 'lockme@x.in', phone: '9600000010', password: 'Right-Password-1' });
await User.create({ firstName: 'Other', lastName: 'One', email: 'other@x.in', phone: '9600000011', password: 'Right-Password-1' });
const wrong = email => login(email, 'wrong-password-0');
const firstFive = [];
for (let i = 0; i < 5; i++) firstFive.push((await wrong('lockme@x.in')).s);
check('five wrong passwords are each refused (400)', firstFive.join() === '400,400,400,400,400', firstFive.join());
const lockedTry = await login('lockme@x.in', 'Right-Password-1');
check('then even the RIGHT password is refused (429) while locked', lockedTry.s === 429 && /minute/.test(lockedTry.d.error), JSON.stringify(lockedTry));
check('a different account is not affected', (await login('other@x.in', 'Right-Password-1')).s === 200);
check('the lock is on the email, so changing case does not dodge it', (await login('LOCKME@x.in', 'Right-Password-1')).s === 429);
check('locking was recorded in the audit log', await hasAudit('ACCOUNT_LOCKED', e => e.actor === 'lockme@x.in'));
await LoginAttempt.updateOne({ key: 'lockme@x.in' }, { lockedUntil: new Date(Date.now() - 1000) });
check('once the lock runs out the right password works again', (await login('lockme@x.in', 'Right-Password-1')).s === 200);

const ghost = [];
for (let i = 0; i < 5; i++) ghost.push((await wrong('nobody@x.in')).s);
check('an email that does not exist is limited the same way (no account fishing)', ghost.join() === '400,400,400,400,400' && (await login('nobody@x.in', 'anything-at-all')).s === 429, ghost.join());
check('no audit entry for a made-up email', !(await hasAudit('ACCOUNT_LOCKED', e => e.actor === 'nobody@x.in')));

await User.create({ firstName: 'Reset', lastName: 'Count', email: 'counter@x.in', phone: '9600000012', password: 'Right-Password-1' });
for (let i = 0; i < 3; i++) await wrong('counter@x.in');
await login('counter@x.in', 'Right-Password-1');
const after = [];
for (let i = 0; i < 3; i++) after.push((await wrong('counter@x.in')).s);
check('a good sign-in resets the count (3 wrong, 1 right, 3 wrong is not a lock)', after.join() === '400,400,400' && (await login('counter@x.in', 'Right-Password-1')).s === 200, after.join());

await User.create({ firstName: 'In', lastName: 'Active', email: 'inactive@x.in', phone: '9600000013', password: 'Right-Password-1', status: 'inactive' });
check('an inactive account is refused with the right password (403)', (await login('inactive@x.in', 'Right-Password-1')).s === 403);

section('TWO-FACTOR SIGN-IN FOR THE ADMIN');
const customer = await User.findOne({ email: 'other@x.in' });
const custToken = await tokenFor(customer);
const stat = await call('GET', '/auth/2fa/status', custToken);
check('customers are told it is not available to them', stat.s === 200 && stat.d.available === false);
check('customers cannot set it up (403)', (await call('POST', '/auth/2fa/setup', custToken, {})).s === 403);

const plain = await login('admin@lifc.in', 'AdminPass123');
check('admin signs in with just a password while two-factor is off', plain.s === 200 && !!plain.d.token && !plain.d.twoFactorRequired);
let adminTok = plain.d.token;
const setup = await call('POST', '/auth/2fa/setup', adminTok, {});
check('setup gives a secret and a setup link', setup.s === 200 && /^[A-Z2-7]{32}$/.test(setup.d.secret) && setup.d.otpauthUrl.startsWith('otpauth://totp/LIFC:'), JSON.stringify(setup.d));
const pending = await User.findById(adminUser._id).select('+twoFactorPendingSecret');
check('the pending secret is stored encrypted, not as typed in the app', !!pending.twoFactorPendingSecret && !pending.twoFactorPendingSecret.includes(setup.d.secret) && decryptSecret(pending.twoFactorPendingSecret) === setup.d.secret);
check('turning on with a wrong code is refused (400)', (await call('POST', '/auth/2fa/enable', adminTok, { code: '000000' })).s === 400);
const enable = await call('POST', '/auth/2fa/enable', adminTok, { code: totp(setup.d.secret) });
const codes = enable.d.recoveryCodes || [];
check('turning on with the right code works and returns 8 recovery codes', enable.s === 200 && codes.length === 8 && codes.every(c => /^[a-f0-9]{4}-[a-f0-9]{4}$/.test(c)), JSON.stringify(enable.d));
const stored = await User.findById(adminUser._id).select('+twoFactorSecret +twoFactorRecovery');
check('recovery codes are stored only as hashes', stored.twoFactorRecovery.length === 8 && stored.twoFactorRecovery.every(h => /^[a-f0-9]{64}$/.test(h)) && !stored.twoFactorRecovery.includes(codes[0]));
check('setup cannot be started again while on (409)', (await call('POST', '/auth/2fa/setup', adminTok, {})).s === 409);

const step1 = await login('admin@lifc.in', 'AdminPass123');
check('now sign-in asks for a code and gives no session yet', step1.s === 200 && step1.d.twoFactorRequired === true && !!step1.d.challengeToken && !step1.d.token, JSON.stringify(step1.d));
check('the challenge token is NOT a session on admin routes (401)', (await call('GET', '/admin/compliance/audit', step1.d.challengeToken)).s === 401);
check('the challenge token is NOT a session on customer routes (401)', (await call('GET', '/notifications', step1.d.challengeToken)).s === 401);
check('a challenge from a different secret is refused (401)', (await call('POST', '/auth/2fa/verify', null, { challengeToken: jwt.sign({ userId: String(adminUser._id), purpose: '2fa' }, 'other-secret'), code: totp(setup.d.secret) })).s === 401);
check('an ordinary session token is not accepted as a challenge (401)', (await call('POST', '/auth/2fa/verify', null, { challengeToken: await tokenFor(adminUser, true), code: totp(setup.d.secret) })).s === 401);
check('an expired challenge is refused (401)', (await call('POST', '/auth/2fa/verify', null, { challengeToken: jwt.sign({ userId: String(adminUser._id), purpose: '2fa' }, 'test-secret', { expiresIn: -10 }), code: totp(setup.d.secret) })).s === 401);
check('a wrong code is refused (400)', (await call('POST', '/auth/2fa/verify', null, { challengeToken: step1.d.challengeToken, code: '123456' })).s === 400);

// The code used to turn it on was this window's; the next window's code is accepted for clock drift.
const nextCode = totp(setup.d.secret, Date.now() + 30000);
const ok = await call('POST', '/auth/2fa/verify', null, { challengeToken: step1.d.challengeToken, code: nextCode });
check('the right code gives a session', ok.s === 200 && !!ok.d.token, JSON.stringify(ok.d));
adminTok = ok.d.token;
check('and that session works on admin routes', (await call('GET', '/admin/compliance/audit', adminTok)).s === 200);
check('admin session lasts 8 hours, not 7 days', claims(adminTok).exp - claims(adminTok).iat === 8 * 3600, String(claims(adminTok).exp - claims(adminTok).iat));
check('an ordinary customer session still lasts 7 days', claims((await login('other@x.in', 'Right-Password-1')).d.token).exp - claims(custToken).iat >= 7 * 24 * 3600 - 5);

const step2 = await login('admin@lifc.in', 'AdminPass123');
const replay = await call('POST', '/auth/2fa/verify', null, { challengeToken: step2.d.challengeToken, code: nextCode });
check('the same code cannot be used twice (replay refused)', replay.s === 400, JSON.stringify(replay));

await User.updateOne({ _id: adminUser._id }, { $unset: { twoFactorLastStep: '' } }); // stands in for time passing
const rec = await call('POST', '/auth/2fa/verify', null, { challengeToken: step2.d.challengeToken, code: codes[0] });
check('a recovery code works once', rec.s === 200 && !!rec.d.token);
const step3 = await login('admin@lifc.in', 'AdminPass123');
check('the same recovery code is refused the second time', (await call('POST', '/auth/2fa/verify', null, { challengeToken: step3.d.challengeToken, code: codes[0] })).s === 400);
check('recovery codes left goes down to 7', (await call('GET', '/auth/2fa/status', rec.d.token)).d.recoveryCodesRemaining === 7);
check('sign-ins with two-factor are recorded with their method', await hasAudit('ADMIN_LOGIN', e => e.details.method === 'recovery') && await hasAudit('ADMIN_LOGIN', e => e.details.method === '2fa'));

section('SECRETS NEVER LEAK');
const profile = await call('GET', '/users/profile', rec.d.token);
check('the profile does not include any two-factor or reset fields', profile.s === 200 && !/twoFactorSecret|twoFactorRecovery|twoFactorPending|passwordResetHash|"password"/.test(JSON.stringify(profile.d)), Object.keys(profile.d).join());
await User.updateOne({ _id: customer._id }, { passwordResetHash: 'h'.repeat(64), passwordResetExpires: new Date(Date.now() + 60000) });
const exported = await call('GET', '/compliance/my-data', custToken);
check('the data export does not include the reset token hash', exported.s === 200 && !JSON.stringify(exported.d).includes('h'.repeat(64)));

section('TURNING IT OFF');
await User.updateOne({ _id: adminUser._id }, { $unset: { twoFactorLastStep: '' } });
check('needs the right password (400)', (await call('POST', '/auth/2fa/disable', rec.d.token, { password: 'wrong', code: totp(setup.d.secret) })).s === 400);
check('needs a valid code (400)', (await call('POST', '/auth/2fa/disable', rec.d.token, { password: 'AdminPass123', code: '000000' })).s === 400);
const off = await call('POST', '/auth/2fa/disable', rec.d.token, { password: 'AdminPass123', code: totp(setup.d.secret) });
check('password plus a valid code turns it off', off.s === 200);
const gone = await User.findById(adminUser._id).select('+twoFactorSecret +twoFactorRecovery');
check('the secret and recovery codes are deleted', gone.twoFactorEnabled === false && !gone.twoFactorSecret && !(gone.twoFactorRecovery || []).length);
check('sign-in is password-only again', !!(await login('admin@lifc.in', 'AdminPass123')).d.token);
check('both changes are in the audit log', await hasAudit('TWO_FACTOR_ENABLED') && await hasAudit('TWO_FACTOR_DISABLED'));

section('GUESSING CODES LOCKS THE ACCOUNT');
await LoginAttempt.deleteMany({});
const s2 = await call('POST', '/auth/2fa/setup', (await login('admin@lifc.in', 'AdminPass123')).d.token, {});
await call('POST', '/auth/2fa/enable', (await login('admin@lifc.in', 'AdminPass123')).d.token, { code: totp(s2.d.secret) });
await User.updateOne({ _id: adminUser._id }, { $unset: { twoFactorLastStep: '' } });
const ch = (await login('admin@lifc.in', 'AdminPass123')).d.challengeToken;
const guesses = [];
for (let i = 0; i < 5; i++) guesses.push((await call('POST', '/auth/2fa/verify', null, { challengeToken: ch, code: '111111' })).s);
check('five wrong codes are each refused', guesses.join() === '400,400,400,400,400', guesses.join());
check('then even the right code is refused while locked (429)', (await call('POST', '/auth/2fa/verify', null, { challengeToken: ch, code: totp(s2.d.secret) })).s === 429);
check('and so is signing in again with the right password (429)', (await login('admin@lifc.in', 'AdminPass123')).s === 429);

await LoginAttempt.deleteMany({});
const again = [];
const ch2 = (await login('admin@lifc.in', 'AdminPass123')).d.challengeToken;
for (let i = 0; i < 4; i++) { await call('POST', '/auth/2fa/verify', null, { challengeToken: ch2, code: '222222' }); await login('admin@lifc.in', 'AdminPass123'); }
again.push((await call('POST', '/auth/2fa/verify', null, { challengeToken: ch2, code: '222222' })).s);
check('signing in again does not give fresh guesses (the password step does not reset the count)', again[0] === 400 && (await login('admin@lifc.in', 'AdminPass123')).s === 429, again.join());

section('SECURITY HEADERS');
const root = await fetch(srv.base.replace('/api', '/'));
const csp = root.headers.get('content-security-policy') || '';
check('the portal is served with a content security policy', root.status === 200 && csp.length > 0);
check("no framing, no plugins, scripts and connections only from this site", ["frame-ancestors 'none'", "object-src 'none'", "default-src 'self'", "connect-src 'self'", "base-uri 'self'", "form-action 'self'"].every(d => csp.includes(d)), csp);
check('no eval and no outside script sources', !csp.includes('unsafe-eval') && !/script-src[^;]*https?:/.test(csp));
const api = await fetch(`${srv.base}/health`);
check('API responses also carry the headers', (api.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'") && api.headers.get('x-content-type-options') === 'nosniff');
check('HSTS tells browsers to always use HTTPS', /max-age=\d+/.test(api.headers.get('strict-transport-security') || ''));

section('SIGN OUT EVERYWHERE WORKS EVEN WITHIN THE SAME SECOND');
const quick = await User.create({ firstName: 'Q', lastName: 'K', email: 'quick@x.in', phone: '9777777777', password: 'x12345678' });
const qTok = await tokenFor(quick);
check('a fresh session works', (await call('GET', '/notifications', qTok)).s === 200);
await User.updateOne({ _id: quick._id }, { passwordChangedAt: new Date() });
check('the same token, revoked in the same second, is refused (401)', (await call('GET', '/notifications', qTok)).s === 401);
await new Promise(r => setTimeout(r, 5));
check('a token made after the change works', (await call('GET', '/notifications', await tokenFor(quick))).s === 200);

await srv.stop();
await disconnect();
finish();
