import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-email-verify';
await connect(DB);
const test = await startServer(DB, {});
const prod = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION' });
const call = client(test.base), callProd = client(prod.base);
const { token: admin } = await makeAdmin();
let n = 0;
const customer = async (over = {}) => {
  n++;
  const user = await User.create({ firstName: `E${n}`, lastName: 'V', email: `Email${n}@Example.in`, phone: `91${String(n).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, ...over });
  return { user, token: await tokenFor(user) };
};

section('SENDING A CODE');
const c1 = await customer();
check('no login -> 401', (await call('POST', '/email-verify/send', null, {})).s === 401);
const st0 = await call('GET', '/email-verify/status', c1.token);
check('a new account is not verified, and the mode is shown', st0.s === 200 && st0.d.verified === false && st0.d.mode === 'test');
const sent = await call('POST', '/email-verify/send', c1.token, {});
check('with no email account set up (test mode) the code is handed back so it can be tried', sent.s === 200 && /^\d{6}$/.test(sent.d.sandboxCode) && sent.d.emailSent === false, JSON.stringify(sent.d));
check('the address is masked in the reply', sent.d.email === 'E***@Example.in' || /^.\*\*\*@/.test(sent.d.email));
const u1 = await User.findById(c1.user._id);
check('only a hash of the code is stored, never the code', !!u1.emailOtp.hash && !JSON.stringify(u1.emailOtp).includes(sent.d.sandboxCode));
check('asking again at once is refused (429)', (await call('POST', '/email-verify/send', c1.token, {})).s === 429);
const prodSend = await callProd('POST', '/email-verify/send', (await customer()).token, {});
check('in production with no email account it says it is not available, and gives no code (503)', prodSend.s === 503 && !prodSend.d.sandboxCode);

section('ENTERING IT');
check('a code that is not 6 digits is refused (400)', (await call('POST', '/email-verify/verify', c1.token, { code: '12' })).s === 400);
const wrong = await call('POST', '/email-verify/verify', c1.token, { code: sent.d.sandboxCode === '123456' ? '654321' : '123456' });
check('a wrong code is refused, and the tries left are counted', wrong.s === 400 && wrong.d.attemptsLeft === 4, JSON.stringify(wrong.d));
check('verifying before asking for a code is refused', (await call('POST', '/email-verify/verify', (await customer()).token, { code: '123456' })).s === 400);
const ok = await call('POST', '/email-verify/verify', c1.token, { code: sent.d.sandboxCode });
check('the right code verifies the email', ok.s === 200 && ok.d.verified === true);
const after = await User.findById(c1.user._id);
check('the account is marked verified for that address, and the code is gone', after.emailVerified === true && after.emailVerifiedFor === 'email1@example.in' && !after.emailOtp);
check('the status now says verified', (await call('GET', '/email-verify/status', c1.token)).d.verified === true);
check('asking again says already verified', (await call('POST', '/email-verify/send', c1.token, {})).d.alreadyVerified === true);
check('it is in the audit log', (await AuditLog.countDocuments({ action: 'EMAIL_VERIFIED', entityId: String(c1.user._id) })) === 1);
check('staff can see it on the customer page', (await call('GET', `/admin/customers/${c1.user._id}`, admin)).d.customer.emailVerified === true);

section('LIMITS AND CHANGES');
const c2 = await customer();
const s2 = await call('POST', '/email-verify/send', c2.token, {});
for (let i = 0; i < 5; i++) await call('POST', '/email-verify/verify', c2.token, { code: '000000' === s2.d.sandboxCode ? '111111' : '000000' });
check('after 5 wrong codes even the right one is refused (429)', (await call('POST', '/email-verify/verify', c2.token, { code: s2.d.sandboxCode })).s === 429);
const c3 = await customer();
await call('POST', '/email-verify/send', c3.token, {});
await User.updateOne({ _id: c3.user._id }, { 'emailOtp.expiresAt': new Date(Date.now() - 1000) });
check('an old code has expired (400)', (await call('POST', '/email-verify/verify', c3.token, { code: '123456' })).d.error.includes('expired'));
const c4 = await customer({ emailVerified: true, emailVerifiedFor: 'old@example.in' });
check('if the address was changed after verifying, it counts as not verified', (await call('GET', '/email-verify/status', c4.token)).d.verified === false);
check('and a new code can be asked for', (await call('POST', '/email-verify/send', c4.token, {})).s === 200);

await test.stop(); await prod.stop();
await disconnect();
finish();
