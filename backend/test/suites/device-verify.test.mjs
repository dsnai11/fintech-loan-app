import jwt from 'jsonwebtoken';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import DeviceBinding from '../../src/models/DeviceBinding.js';
import AuditLog from '../../src/models/AuditLog.js';
import PhoneOtp from '../../src/models/PhoneOtp.js';

const DB = 'fintech-test-device-verify';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const login = (email, install) => call('POST', '/auth/login', null, { email, password: 'x12345678' }, install ? { 'X-Install-Id': install } : {});
const setMode = async newDevice => {
  const cur = (await call('GET', '/app-settings/admin', admin)).d.settings;
  return call('PUT', '/app-settings/admin', admin, { security: { ...cur.security, newDevice } });
};
const mk = (n, over = {}) => User.create({ firstName: `Dev${n}`, lastName: 'V', email: `dev${n}@x.in`, phone: `9810000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, ...over });
const u1 = await mk(1);

section('SWITCHED OFF BY DEFAULT');
check('the setting exists and starts off', (await call('GET', '/app-settings')).d.security.newDevice === 'off');
check('a first sign-in on phone A just works', (await login(u1.email, A)).d.token != null);
check('and so does phone B while it is off', (await login(u1.email, B)).d.token != null);
await DeviceBinding.deleteMany({ userId: u1._id });
await login(u1.email, A);

section('SWITCHED ON');
check('staff can switch it on', (await setMode('otp')).s === 200 && (await call('GET', '/app-settings')).d.security.newDevice === 'otp');
check('a bad value falls back to off', (await setMode('banana')).s === 200 && (await call('GET', '/app-settings')).d.security.newDevice === 'off');
await setMode('otp');
const known = await login(u1.email, A);
check('a phone the account already uses is let straight in', known.d.token != null && !known.d.deviceVerificationRequired);
const fresh = await login(u1.email, B);
check('an unfamiliar phone gets no session, only a short-lived step', fresh.s === 200 && !fresh.d.token && fresh.d.deviceVerificationRequired === true && !!fresh.d.deviceToken && /XXXXXX/.test(fresh.d.phone), JSON.stringify(fresh.d));
check('and the account is not marked as signed in on that phone', !(await DeviceBinding.findOne({ userId: u1._id, installId: B })));
check('the number is shown masked, never in full', !JSON.stringify(fresh.d).includes(u1.phone));

section('PROVING THE PHONE');
const dt = fresh.d.deviceToken;
check('the token cannot be used as a sign-in token', (await call('GET', '/loans', dt)).s === 401);
check('a wrong token is refused (401)', (await call('POST', '/auth/device/send', null, { deviceToken: 'nonsense' })).s === 401);
const other = jwt.sign({ userId: String(u1._id), purpose: '2fa' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '5m' });
check('a token meant for another step is refused', (await call('POST', '/auth/device/send', null, { deviceToken: other })).s === 401);
const sent = await call('POST', '/auth/device/send', null, { deviceToken: dt });
check('a code is sent even though the number is already verified (test mode hands it back)', sent.s === 200 && /^\d{6}$/.test(sent.d.sandboxOtp || ''), JSON.stringify(sent.d));
const wrong = await call('POST', '/auth/device/verify', null, { deviceToken: dt, code: sent.d.sandboxOtp === '123456' ? '654321' : '123456' });
check('a wrong code is refused and counts an attempt', wrong.s === 400 && wrong.d.attemptsLeft === 4, JSON.stringify(wrong.d));
check('no code at all is refused', (await call('POST', '/auth/device/verify', null, { deviceToken: dt, code: '' })).s === 400);
const ok = await call('POST', '/auth/device/verify', null, { deviceToken: dt, code: sent.d.sandboxOtp });
check('the right code signs in', ok.s === 200 && !!ok.d.token && ok.d.user.email === u1.email && ok.d.user.isAdmin === false, JSON.stringify(ok.d));
check('and the new token works', (await call('GET', '/loans', ok.d.token)).s === 200);
check('the phone is now remembered', !!(await DeviceBinding.findOne({ userId: u1._id, installId: B })));
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'DEVICE_VERIFIED' })));
check('next time that phone is let straight in', (await login(u1.email, B)).d.token != null);
check('the code cannot be used again', (await call('POST', '/auth/device/verify', null, { deviceToken: dt, code: sent.d.sandboxOtp })).s === 400);
check('the phone number stays verified (nothing changed on the account)', (await User.findById(u1._id)).phoneVerified === true);

section('WHO IS NOT ASKED');
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
check('a third phone is asked', (await login(u1.email, C)).d.deviceVerificationRequired === true);
check('an old app with no install id is not locked out', (await login(u1.email, null)).d.token != null);
const u2 = await mk(2, { phoneVerified: false });
await login(u2.email, A);
check('an account whose phone was never verified is not asked', (await login(u2.email, B)).d.token != null);
const u3 = await mk(3);
check('a brand-new account signing in for the first time is not asked', (await login(u3.email, C)).d.token != null);
check('admin sign-in is not affected', (await call('POST', '/auth/login', null, { email: 'admin@lifc.in', password: 'AdminPass123' }, { 'X-Install-Id': C })).d.token != null);

section('ATTEMPTS ARE LIMITED');
const u4 = await mk(4);
await login(u4.email, A);
const f4 = await login(u4.email, B);
const s4 = await call('POST', '/auth/device/send', null, { deviceToken: f4.d.deviceToken });
const codes = [];
for (let i = 0; i < 6; i++) codes.push((await call('POST', '/auth/device/verify', null, { deviceToken: f4.d.deviceToken, code: s4.d.sandboxOtp === '111111' ? '222222' : '111111' })).s);
check('after 5 wrong codes it stops (429)', codes.slice(0, 5).every(c => c === 400) && codes[5] === 429, codes.join());
check('and even the right code no longer works until a new one is asked for', (await call('POST', '/auth/device/verify', null, { deviceToken: f4.d.deviceToken, code: s4.d.sandboxOtp })).s === 429);

srv.stop();
await disconnect();
finish();
