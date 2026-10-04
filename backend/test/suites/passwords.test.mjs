import crypto from 'crypto';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-passwords';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { user: adminUser, token: adminToken } = await makeAdmin();

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const login = (email, password) => call('POST', '/auth/login', null, { email, password });
const reset = (token, password) => call('POST', '/auth/reset-password', null, { token, password });
const forgot = email => call('POST', '/auth/forgot-password', null, { email });
const hasAudit = async (action, pred = () => true) => (await AuditLog.find({ action })).some(pred);
// Stands in for the email: we cannot read the real token from a hash, so we plant a token whose hash we know.
async function plantToken(userId, minutes = 10) {
  const t = newToken();
  await User.updateOne({ _id: userId }, { passwordResetHash: sha(t), passwordResetExpires: new Date(Date.now() + minutes * 60 * 1000) });
  return t;
}

const alice = await User.create({ firstName: 'Alice', lastName: 'A', email: 'alice@x.in', phone: '9500000001', password: 'OldPassword-1' });
const blocked = await User.create({ firstName: 'Blocked', lastName: 'B', email: 'blocked@x.in', phone: '9500000002', password: 'OldPassword-1', status: 'blocked' });

section('EMAIL CASE AND SPACES AT SIGN-IN');
check('lower-case email works', (await login('alice@x.in', 'OldPassword-1')).s === 200);
check('Capitalised email works (phone keyboards do this)', (await login('Alice@X.in', 'OldPassword-1')).s === 200);
check('trailing space works', (await login(' alice@x.in ', 'OldPassword-1')).s === 200);
check('wrong password is still refused', (await login('alice@x.in', 'nope')).s === 400);
check('signup cannot create a second account that differs only by case', (await call('POST', '/auth/signup', null, { firstName: 'A', lastName: 'B', email: 'ALICE@x.in', phone: '9500000099', password: 'Whatever-123', confirmPassword: 'Whatever-123' })).s === 400);

section('ASKING FOR A RESET LINK');
const known = await forgot('alice@x.in');
const unknown = await forgot('nobody@x.in');
check('known and unknown emails get the same answer (no account fishing)', known.s === 200 && unknown.s === 200 && known.d.message === unknown.d.message);
const stored = await User.findById(alice._id).select('+passwordResetHash +passwordResetExpires');
check('a reset token hash is stored, valid for about an hour', /^[a-f0-9]{64}$/.test(stored.passwordResetHash) && Math.abs(stored.passwordResetExpires - Date.now() - 3600000) < 60000);
await forgot('alice@x.in');
check('asking again within a minute does not send or replace anything', (await User.findById(alice._id).select('+passwordResetHash')).passwordResetHash === stored.passwordResetHash);
await forgot('blocked@x.in');
check('a blocked account gets no reset token', !(await User.findById(blocked._id).select('+passwordResetHash')).passwordResetHash);
check('empty email is a bad request (400)', (await call('POST', '/auth/forgot-password', null, {})).s === 400);
check('the request is recorded, without the token', await hasAudit('PASSWORD_RESET_REQUESTED', e => !JSON.stringify(e).includes(stored.passwordResetHash)));

section('USING A TOKEN');
const t1 = await plantToken(alice._id);
check('password under 8 characters is refused (400)', (await reset(t1, 'short')).s === 400);
check('password over 128 characters is refused (400)', (await reset(t1, 'x'.repeat(129))).s === 400);
check('a malformed token is refused (400)', (await reset('not-a-token', 'NewPassword-2')).s === 400);
check('a well-formed but unknown token is refused (400)', (await reset(newToken(), 'NewPassword-2')).s === 400);
await User.updateOne({ _id: alice._id }, { passwordResetExpires: new Date(Date.now() - 1000) });
check('an expired token is refused (400)', (await reset(t1, 'NewPassword-2')).s === 400);

const t2 = await plantToken(alice._id);
const oldSession = (await login('alice@x.in', 'OldPassword-1')).d.token;
check('the old session works before the reset', (await call('GET', '/notifications', oldSession)).s === 200);
await sleep(1100); // tokens are timestamped in whole seconds
const ok = await reset(t2, 'NewPassword-2');
check('a valid token sets the new password (200)', ok.s === 200, JSON.stringify(ok.d));
check('new password signs in', (await login('alice@x.in', 'NewPassword-2')).s === 200);
check('old password no longer works', (await login('alice@x.in', 'OldPassword-1')).s === 400);
check('the same link cannot be used twice', (await reset(t2, 'AnotherPassword-3')).s === 400);
const afterReset = await call('GET', '/notifications', oldSession);
check('sessions from before the reset are signed out (401)', afterReset.s === 401 && /password was changed/i.test(afterReset.d.error), JSON.stringify(afterReset));
check('a fresh sign-in works after the reset', (await call('GET', '/notifications', (await login('alice@x.in', 'NewPassword-2')).d.token)).s === 200);
check('completion is recorded in the audit log', await hasAudit('PASSWORD_RESET_COMPLETED', e => e.entityId === String(alice._id)));

const t3 = await plantToken(alice._id);
const both = await Promise.all([reset(t3, 'RacePassword-A1'), reset(t3, 'RacePassword-B2')]);
check('two simultaneous uses of one link: exactly one wins', both.map(r => r.s).sort().join() === '200,400', both.map(r => r.s).join());

section('LINK CREATED BY AN ADMIN');
const bob = await User.create({ firstName: 'Bob', lastName: 'B', email: 'bob@x.in', phone: '9500000003', password: 'OldPassword-1' });
const make = (identifier, tok = adminToken, headers = {}) => call('POST', '/admin/compliance/customers/reset-link', tok, { identifier }, headers);
check('a customer cannot create reset links (403)', (await make('bob@x.in', await tokenFor(alice))).s === 403);
check('missing identifier (400)', (await make('')).s === 400);
check('unknown customer (404)', (await make('ghost@x.in')).s === 404);
check('the admin account cannot be reset this way (403)', (await make('admin@lifc.in')).s === 403);
const byEmail = await make('BOB@x.in');
check('link by email (any case) names the customer', byEmail.s === 200 && byEmail.d.customer.name === 'Bob B' && byEmail.d.customer.email === 'bob@x.in', JSON.stringify(byEmail.d));
check('link points at the real site and carries a 64-character token', /^https:\/\/fintech-loan-app-production\.up\.railway\.app\/reset-password\.html\?token=[a-f0-9]{64}$/.test(byEmail.d.link), byEmail.d.link);
const spoof = await make('9500000003', adminToken, { 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' });
check('a forged host header cannot change the link', spoof.d.link.startsWith('https://fintech-loan-app-production.up.railway.app/'));
check('link can be found by phone number too', spoof.s === 200 && spoof.d.customer.phone === '9500000003');
const tokenFromLink = byEmail.d.link.split('token=')[1];
check('the admin-created link is replaced by the newer one (only the latest works)', (await reset(tokenFromLink, 'BobsNewPassword-1')).s === 400);
const bobsLink = spoof.d.link.split('token=')[1];
check('the latest link works once', (await reset(bobsLink, 'BobsNewPassword-1')).s === 200 && (await login('bob@x.in', 'BobsNewPassword-1')).s === 200);
check('creating the link is recorded in the audit log', await hasAudit('ADMIN_RESET_LINK_CREATED', e => e.entityId === String(bob._id) && e.actor === 'admin@lifc.in'));

section('ADMIN SESSIONS ARE REVOKED TOO');
await sleep(1100);
const tAdmin = await plantToken(adminUser._id);
check('admin token works before the password changes', (await call('GET', '/admin/compliance/audit', adminToken)).s === 200);
check('admin password can be reset with a valid token', (await reset(tAdmin, 'NewAdminPass-77')).s === 200);
const stale = await call('GET', '/admin/compliance/audit', adminToken);
check('the old admin session stops working (401)', stale.s === 401, JSON.stringify(stale));
const freshAdmin = (await login('admin@lifc.in', 'NewAdminPass-77')).d.token;
check('signing in again restores admin access', (await call('GET', '/admin/compliance/audit', freshAdmin)).s === 200);
check('an account that is blocked loses access at once', await (async () => {
  const tk = (await login('bob@x.in', 'BobsNewPassword-1')).d.token;
  await User.updateOne({ _id: bob._id }, { status: 'blocked' });
  return (await call('GET', '/notifications', tk)).s === 403;
})());

section('SIGN-IN RATE LIMIT (per visitor)');
const limited = await startServer(DB, { AUTH_RATE_LIMIT: '3' });
const lcall = client(limited.base);
const attempt = ip => lcall('POST', '/auth/login', null, { email: 'alice@x.in', password: 'wrong-password' }, { 'x-forwarded-for': ip });
const results = [];
for (let i = 0; i < 5; i++) results.push((await attempt('198.51.100.10')).s);
check('after 3 attempts from one visitor, further attempts are blocked (429)', results.join() === '400,400,400,429,429', results.join());
check('a different visitor is not affected', (await attempt('198.51.100.11')).s === 400);
await limited.stop();

await srv.stop();
await disconnect();
finish();
