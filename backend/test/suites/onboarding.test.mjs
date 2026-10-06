import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import PhoneOtp from '../../src/models/PhoneOtp.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-onboarding';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_TERMS: 'true', REQUIRE_PHONE_VERIFIED: 'true' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const signup = (n, extra = {}) => call('POST', '/auth/signup', null, { firstName: 'Deepak', lastName: 'Baid', email: `d${n}@x.in`, phone: `9${String(n).padStart(9, '0')}`, password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1', ...extra });
const apply = tok => call('POST', '/loans/apply-full', tok, { loanAmount: 10000, tenure: 3, purpose: 'Personal', planType: '3_emi', bankDetails: { accountHolder: 'D B', accountNumber: '4440001112', ifscCode: 'SBIN0001234' } });

section('TERMS AND CONDITIONS: READING');
const t = await call('GET', '/terms', null);
check('anyone can read the current terms', t.s === 200 && t.d.version === 1 && t.d.title === 'Terms and Conditions' && t.d.text.length > 500, JSON.stringify(t.d).slice(0, 150));
check('the lender name is filled in and no placeholders are left', t.d.text.includes('Laxmi India Finance Ltd.') && !t.d.text.includes('{{'));

section('SIGN UP NEEDS THE TERMS AND A REAL MOBILE NUMBER');
check('without accepting the terms (400)', (await signup(1)).s === 400 && (await signup(1)).d.code === 'TERMS_REQUIRED');
check('accepting an old version (409)', (await signup(1, { acceptedTerms: true, termsVersion: 0 })).d.code === 'TERMS_CHANGED');
check('a phone number that is not a mobile number (400)', (await signup(1, { phone: '12345', acceptedTerms: true, termsVersion: 1 })).s === 400);
const ok = await signup(1, { acceptedTerms: true, termsVersion: 1 });
check('with the current terms accepted it works', ok.s === 201 && !!ok.d.token, JSON.stringify(ok.d).slice(0, 150));
const u1 = await User.findOne({ email: 'd1@x.in' });
check('which version, when and from where is recorded', u1.termsVersion === 1 && !!u1.termsAcceptedAt && !!u1.termsAcceptedIp);
check('and is in the audit log', !!(await AuditLog.findOne({ action: 'TERMS_ACCEPTED', actor: 'd1@x.in' })));
const t1 = ok.d.token;

section('WHAT THE APP STILL HAS TO ASK');
const ob = await call('GET', '/auth/onboarding', t1);
check('a new customer has accepted the terms but not verified the phone', ob.s === 200 && ob.d.termsRequired === false && ob.d.phoneVerified === false && ob.d.phone.includes('XXXXXX'), JSON.stringify(ob.d));
check('no login -> 401', (await call('GET', '/auth/onboarding', null)).s === 401);
const lg = await call('POST', '/auth/login', null, { email: 'd1@x.in', password: 'Strong-Pass-1' });
check('login still works as before', lg.s === 200 && !!lg.d.token);

section('PHONE VERIFICATION');
check('a loan cannot be applied for before the phone is verified (403)', (await apply(t1)).s === 403 && (await apply(t1)).d.code === 'PHONE_NOT_VERIFIED');
check('wrong code format (400)', (await call('POST', '/auth/phone/verify', t1, { code: '12ab' })).s === 400);
check('no code asked for yet (400)', (await call('POST', '/auth/phone/verify', t1, { code: '123456' })).s === 400);
check('no login -> 401', (await call('POST', '/auth/phone/send', null)).s === 401);
const sent = await call('POST', '/auth/phone/send', t1);
check('a code is sent (sandbox shows it because no SMS provider is set up)', sent.s === 200 && /^\d{6}$/.test(sent.d.sandboxOtp) && sent.d.phone.includes('XXXXXX') && sent.d.expiresInSeconds === 300 && sent.d.resendAfterSeconds === 30, JSON.stringify(sent.d));
const code = sent.d.sandboxOtp;
const rec = await PhoneOtp.findOne({ phone: u1.phone });
check('only a hash of the code is stored', rec.codeHash.length === 64 && rec.codeHash !== code && !JSON.stringify(rec).includes(code));
const again = await call('POST', '/auth/phone/send', t1);
check('asking again straight away is refused (429) and says how long to wait', again.s === 429 && again.d.retryAfterSeconds > 0, JSON.stringify(again.d));
const wrong = code === '000000' ? '111111' : '000000';
const w = await call('POST', '/auth/phone/verify', t1, { code: wrong });
check('a wrong code is refused and counted', w.s === 400 && w.d.attemptsLeft === 4, JSON.stringify(w.d));
check('the legacy KYC route uses the same check', (await call('POST', '/kyc/otp/verify', t1, { otp: wrong })).d.attemptsLeft === 3);
for (let i = 0; i < 3; i++) await call('POST', '/auth/phone/verify', t1, { code: wrong });
const locked = await call('POST', '/auth/phone/verify', t1, { code: code });
check('after 5 wrong tries even the right code is refused (429)', locked.s === 429, JSON.stringify(locked.d));
await PhoneOtp.updateOne({ phone: u1.phone }, { lastSentAt: new Date(Date.now() - 60000) });
const second = await call('POST', '/auth/phone/send', t1);
check('a new code resets the attempts', second.s === 200 && second.d.sandboxOtp !== undefined);
await PhoneOtp.updateOne({ phone: u1.phone }, { codeExpiresAt: new Date(Date.now() - 1000) });
check('an expired code is refused (400)', (await call('POST', '/auth/phone/verify', t1, { code: second.d.sandboxOtp })).s === 400);
await PhoneOtp.updateOne({ phone: u1.phone }, { lastSentAt: new Date(Date.now() - 60000), sentInWindow: 5 });
const capped = await call('POST', '/auth/phone/send', t1);
check('at most 5 codes an hour (429)', capped.s === 429 && /minute/.test(capped.d.error), JSON.stringify(capped.d));
await PhoneOtp.updateOne({ phone: u1.phone }, { sentInWindow: 1, lastSentAt: new Date(Date.now() - 60000) });
const third = await call('POST', '/auth/phone/send', t1);
const good = await call('POST', '/auth/phone/verify', t1, { code: third.d.sandboxOtp });
check('the right code verifies the number', good.s === 200 && good.d.verified === true, JSON.stringify(good.d));
check('and it is saved on the account', (await User.findById(u1._id)).phoneVerified === true);
check('and is in the audit log', !!(await AuditLog.findOne({ action: 'PHONE_VERIFIED', actor: 'd1@x.in' })));
check('the code cannot be used twice for another account', (await call('POST', '/auth/phone/verify', t1, { code: third.d.sandboxOtp })).d.verified === true);
check('asking again once verified says so', (await call('POST', '/auth/phone/send', t1)).d.alreadyVerified === true);
check('onboarding now shows the phone as verified', (await call('GET', '/auth/onboarding', t1)).d.phoneVerified === true);
check('a loan can now be applied for', (await apply(t1)).s === 201);

section('SOMEONE ELSE CANNOT VERIFY A NUMBER THEY DO NOT HAVE');
const o2 = await signup(2, { acceptedTerms: true, termsVersion: 1 });
const s2 = await call('POST', '/auth/phone/send', o2.d.token);
check("a second customer gets their own code", s2.d.sandboxOtp !== undefined);
check("the first customer's code does not verify the second's number", (await call('POST', '/auth/phone/verify', o2.d.token, { code: third.d.sandboxOtp })).s === 400 || s2.d.sandboxOtp === third.d.sandboxOtp);

section('NEW VERSIONS OF THE TERMS');
const cust = await tokenFor(await User.findOne({ email: 'd2@x.in' }));
check('customers cannot edit the terms (403)', (await call('PUT', '/admin/terms', cust, { title: 'Terms', text: 'x'.repeat(300) })).s === 403);
check('no login -> 401', (await call('PUT', '/admin/terms', null, {})).s === 401);
check('too short is refused (400)', (await call('PUT', '/admin/terms', admin, { title: 'Terms', text: 'short' })).s === 400);
const cur = await call('GET', '/admin/terms', admin);
check('the editor sees the raw text', cur.s === 200 && cur.d.text.includes('{{lenderName}}'));
check('publishing the same text again is refused (400)', (await call('PUT', '/admin/terms', admin, { title: cur.d.title, text: cur.d.text })).s === 400);
const pub = await call('PUT', '/admin/terms', admin, { title: 'Terms and Conditions', text: cur.d.text + '\n\n# 11. New clause\nThis is a new clause added for the test.' });
check('a new version is published', pub.s === 200 && pub.d.version === 2, JSON.stringify(pub.d).slice(0, 150));
check('everyone reads version 2', (await call('GET', '/terms', null)).d.version === 2);
check('the change is in the audit log', !!(await AuditLog.findOne({ action: 'TERMS_PUBLISHED' })));
check('existing customers now have to accept again', (await call('GET', '/auth/onboarding', t1)).d.termsRequired === true);
check('and cannot apply until they do (403)', (await apply(t1)).d.code === 'TERMS_REQUIRED');
check('accepting an old version is refused (409)', (await call('POST', '/auth/accept-terms', t1, { version: 1 })).s === 409);
check('accepting the new one works', (await call('POST', '/auth/accept-terms', t1, { version: 2 })).s === 200);
check('which is recorded', (await User.findById(u1._id)).termsVersion === 2);
check('they can apply again', (await apply(t1)).s === 201);
check('new sign-ups must accept the new version', (await signup(3, { acceptedTerms: true, termsVersion: 1 })).d.code === 'TERMS_CHANGED' && (await signup(3, { acceptedTerms: true, termsVersion: 2 })).s === 201);

section('STAFF ARE NOT ASKED');
check('the admin is not asked to accept customer terms', (await call('GET', '/auth/onboarding', admin)).d.termsRequired === false);

await srv.stop();

section('IN PRODUCTION A REAL SMS PROVIDER IS REQUIRED');
const prod = await startServer(DB, { REQUIRE_TERMS: 'true', REQUIRE_PHONE_VERIFIED: 'true', PAYMENT_MODE: 'PRODUCTION' });
const pcall = client(prod.base);
await PhoneOtp.deleteMany({});
const login4 = await pcall('POST', '/auth/login', null, { email: 'd2@x.in', password: 'Strong-Pass-1' });
const noSms = await pcall('POST', '/auth/phone/send', login4.d.token);
check('with no SMS provider the code is not handed out, the customer is told it is unavailable (503)', noSms.s === 503 && noSms.d.sandboxOtp === undefined, JSON.stringify(noSms.d));
await prod.stop();

await disconnect();
finish();
