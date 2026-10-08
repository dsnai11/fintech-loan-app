import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import AuditLog from '../../src/models/AuditLog.js';
import DigilockerSession from '../../src/models/DigilockerSession.js';
import { completeSession } from '../../src/services/digilockerService.js';

const DB = 'fintech-test-digilocker';
await connect(DB);
const srv = await startServer(DB, {});
const base = srv.base;
const call = client(base);
const { token: admin } = await makeAdmin();
const origin = base.replace(/\/api$/, '');
// The server hands out links on its public address; in a test the same path is opened on the local server.
const local = u => origin + new URL(u).pathname;

let n = 0;
const mk = async (over = {}) => {
  n++;
  const u = await User.create({ firstName: 'Deepak', lastName: `Baid${n === 1 ? '' : n}`, email: `k${n}@x.in`, phone: `92${String(n).padStart(8, '0')}`, password: 'x12345678', ...over });
  return { u, tok: await tokenFor(u), n };
};
const start = c => call('POST', '/kyc/digilocker/start', c.tok);
// Plays the part of the customer in the browser: opens the stand-in DigiLocker page and presses a button.
async function browse(url, fields, action = 'allow') {
  url = local(url);
  const page = await fetch(url);
  const html = await page.text();
  if (page.status !== 200) return { page: page.status, html };
  const post = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'Deepak Baid', dob: '1992-04-12', gender: 'Male', last4: '4321', pan: '', street: '12 Test Street', city: 'Jaipur', state: 'Rajasthan', zip: '302001', ...fields, action }) });
  const done = post.headers.get('location') ? await fetch(origin + post.headers.get('location')) : null;
  return { page: page.status, html, post: post.status, done: done && (await done.text()) };
}
async function run(c, fields, action) {
  const s = await start(c);
  const b = await browse(s.d.url, fields, action);
  const st = await call('GET', `/kyc/digilocker/status/${s.d.sessionId}`, c.tok);
  return { s, b, st, user: await User.findById(c.u._id) };
}

section('STARTING');
const c1 = await mk({ firstName: 'Deepak', lastName: 'Baid' });
check('no login -> 401', (await call('POST', '/kyc/digilocker/start', null)).s === 401);
const s1 = await start(c1);
check('a session starts in test mode and gives a link to open', s1.s === 200 && s1.d.mode === 'sandbox' && /\/api\/kyc\/digilocker\/sandbox\//.test(s1.d.url) && s1.d.expiresInSeconds === 900, JSON.stringify(s1.d));
check('its status starts as created', (await call('GET', `/kyc/digilocker/status/${s1.d.sessionId}`, c1.tok)).d.status === 'created');
check("another customer cannot see it (404)", (await call('GET', `/kyc/digilocker/status/${s1.d.sessionId}`, (await mk()).tok)).s === 404);
check('a made-up session id is refused (400)', (await call('GET', '/kyc/digilocker/status/nonsense', c1.tok)).s === 400);

section('A MATCHING CUSTOMER');
const ok = await run(c1, {});
check('the stand-in page says it is a test and asks for permission', /TEST MODE/.test(ok.b.html) && /Allow/.test(ok.b.html) && ok.b.page === 200);
check('allowing finishes the session', ok.b.post === 302 && /Done/.test(ok.b.done) && ok.st.d.status === 'completed' && ok.st.d.result.status === 'verified');
check('the name and date of birth were compared and matched', ok.st.d.result.nameMatch === true && ok.user.kycDigilocker.nameMatch === true);
check('only the last four digits of the Aadhaar are kept', ok.user.kycDigilocker.aadhaarLast4 === '4321' && !JSON.stringify(ok.user.toObject()).match(/\d{12}/));
check('the missing profile fields were filled in from the record', ok.user.address.city === 'Jaipur' && ok.user.address.zipCode === '302001' && ok.user.gender === 'Male' && !!ok.user.dateOfBirth);
check('in test mode KYC is not approved by itself', ok.user.kycStatus === 'pending' && ok.st.d.result.kycApproved === false);
check('the set-up step is done', (await call('GET', '/onboarding/status', c1.tok)).d.steps.kyc === true);
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'KYC_DIGILOCKER_VERIFIED', actor: c1.u.email })));
const again = await start(c1);
const once = await browse(again.d.url, {});
check('a finished test page cannot be opened again (404)', (await fetch(local(again.d.url))).status === 404 && once.post === 302);

section('A CUSTOMER WHOSE DETAILS DO NOT MATCH');
const c2 = await mk({ firstName: 'Meena', lastName: 'Rao' });
const nm = await run(c2, { name: 'Somebody Else' });
check('a different name goes to review, not approval', nm.st.d.result.status === 'review' && nm.st.d.result.flags.includes('name_differs') && nm.user.kycStatus === 'pending');
check('a review still counts as the step being done, for staff to look at', (await call('GET', '/onboarding/status', c2.tok)).d.steps.kyc === true);
check('a spelling difference in the order and the middle name still matches', (await run(await mk({ firstName: 'Rahul', lastName: 'Verma' }), { name: 'VERMA RAHUL KUMAR' })).st.d.result.nameMatch === true);
const c3 = await mk({ firstName: 'Asha', lastName: 'Singh', dateOfBirth: new Date('1990-01-01') });
const dm = await run(c3, { name: 'Asha Singh', dob: '1991-02-02' });
check('a different date of birth goes to review', dm.st.d.result.flags.includes('date_of_birth_differs') && dm.st.d.result.status === 'review');

section('DUPLICATES AND THE PAN');
const c4 = await mk({ firstName: 'Deepak', lastName: 'Baid' });
const dup = await run(c4, { name: 'Deepak Baid', dob: '1992-04-12', last4: '4321' });
check('the same Aadhaar details on a second account are held for review with an alert', dup.st.d.result.status === 'review' && dup.st.d.result.flags.includes('same_aadhaar_on_another_account') && !!(await AmlAlert.findOne({ rule: 'DUPLICATE_AADHAAR', userId: c4.u._id })));
const c5 = await mk({ firstName: 'Kiran', lastName: 'Shah' });
const p1 = await run(c5, { name: 'Kiran Shah', last4: '1111', pan: 'ABCPE1234F' });
check('a PAN shared through DigiLocker is saved on the account', p1.user.panNumber === 'ABCPE1234F' && p1.user.kycDigilocker.panFound === true);
const c6 = await mk({ firstName: 'Lata', lastName: 'Joshi', panNumber: 'ZZZPZ9999Z' });
check('a PAN that differs from the one on the account goes to review', (await run(c6, { name: 'Lata Joshi', last4: '2222', pan: 'ABCPE7777F' })).st.d.result.flags.includes('pan_differs'));
const c7 = await mk({ firstName: 'Mohan', lastName: 'Das' });
const pd = await run(c7, { name: 'Mohan Das', last4: '3333', pan: 'ABCPE1234F' });
check('a PAN already on another account goes to review with an alert', pd.st.d.result.flags.includes('pan_on_another_account') && !!(await AmlAlert.findOne({ rule: 'DUPLICATE_PAN', userId: c7.u._id })) && !pd.user.panNumber);

section('NOT ALLOWED, EXPIRED, AND THE DATE OF BIRTH IN THE PROFILE');
const c8 = await mk({ firstName: 'Nina', lastName: 'Roy' });
const dn = await run(c8, {}, 'deny');
check('denying at DigiLocker fails the session and changes nothing', dn.st.d.status === 'failed' && !dn.user.kycDigilocker && /could not finish/.test(dn.b.done));
const c9 = await mk({ firstName: 'Omar', lastName: 'Khan' });
const exp = await start(c9);
await DigilockerSession.updateOne({ _id: exp.d.sessionId }, { expiresAt: new Date(Date.now() - 1000) });
check('an expired session says so', (await call('GET', `/kyc/digilocker/status/${exp.d.sessionId}`, c9.tok)).d.status === 'expired' && (await fetch(local(exp.d.url))).status === 404);
const dobFixed = await run(c9, { name: 'Omar Khan', dob: '1988-08-08' });
const prof = { gender: 'Male', address: { street: '9 Lake Road, Bani Park', city: 'Jaipur', state: 'Rajasthan', zipCode: '302016' }, employment: { status: 'Student' } };
check('the profile cannot give a date of birth that disagrees with the Aadhaar record (400)', dobFixed.st.d.status === 'completed' && (await call('PUT', '/onboarding/profile', c9.tok, { ...prof, dateOfBirth: '1990-01-01' })).s === 400);
check('the matching date is accepted', (await call('PUT', '/onboarding/profile', c9.tok, { ...prof, dateOfBirth: '1988-08-08' })).s === 200);
const lim = await mk();
let last;
for (let i = 0; i < 6; i++) last = await start(lim);
check('after five tries in an hour the customer is slowed down (429)', last.s === 429);

section('A REAL DIGILOCKER CONNECTION APPROVES KYC');
const real = await mk({ firstName: 'Priya', lastName: 'Nair' });
const sess = await DigilockerSession.create({ userId: real.u._id, mode: 'digilocker', expiresAt: new Date(Date.now() + 60000), deleteAt: new Date(Date.now() + 3600000) });
const r = await completeSession(sess, { name: 'Priya Nair', dob: '1995-05-05', gender: 'Female', aadhaarLast4: '5555', panNumber: 'ABCPE5555F', address: { street: '5 Park Street, Salt Lake', city: 'Kolkata', state: 'West Bengal', zipCode: '700091' } });
const ru = await User.findById(real.u._id);
check('when everything matches, KYC is approved', r.ok && r.status === 'verified' && r.kycApproved === true && ru.kycStatus === 'approved');
const mis = await mk({ firstName: 'Quinn', lastName: 'Abel' });
const sess2 = await DigilockerSession.create({ userId: mis.u._id, mode: 'digilocker', expiresAt: new Date(Date.now() + 60000), deleteAt: new Date(Date.now() + 3600000) });
const r2 = await completeSession(sess2, { name: 'Not Quinn', dob: '1995-05-05', aadhaarLast4: '6666' });
check('when something does not match it is not approved', r2.status === 'review' && r2.kycApproved === false && (await User.findById(mis.u._id)).kycStatus === 'pending');
check('a record with no name is refused', (await completeSession(sess2, { name: '' })).ok === false);

section('WHAT STAFF SEE');
const ov = (await call('GET', `/admin/customers/${c1.u._id}`, admin)).d.customer;
check('the customer page shows the DigiLocker result', ov.digilocker.status === 'verified' && ov.digilocker.mode === 'sandbox' && ov.digilocker.aadhaarLast4 === '4321' && ov.digilocker.nameMatch === true);
check('the Aadhaar hash is not shown to staff', !JSON.stringify(ov).includes('"key"'));

await srv.stop();

section('IN PRODUCTION WITH NO DIGILOCKER PROVIDER');
const prod = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION' });
const pcall = client(prod.base);
const pc = await mk();
const pr = await pcall('POST', '/kyc/digilocker/start', pc.tok);
check('there is no test mode in production, so the customer is told it is unavailable (503)', pr.s === 503 && pr.d.code === 'UNAVAILABLE');
const ghost = await DigilockerSession.create({ userId: pc.u._id, mode: 'sandbox', expiresAt: new Date(Date.now() + 60000), deleteAt: new Date(Date.now() + 3600000) });
check('and the stand-in page does not exist (404)', (await fetch(`${prod.base}/kyc/digilocker/sandbox/${ghost._id}`)).status === 404);
await prod.stop();

await disconnect();
finish();
