import http from 'node:http';
import crypto from 'node:crypto';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import DeviceToken from '../../src/models/DeviceToken.js';
import Notification from '../../src/models/Notification.js';

const DB = 'fintech-test-push';
await connect(DB);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };

// A pretend Google sign-in and a pretend Firebase
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const messages = [];
let tokenRequests = 0, badAssertions = 0, fcmDown = false;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => (body += d));
  req.on('end', () => {
    if (req.url === '/token') {
      tokenRequests++;
      const jwt = new URLSearchParams(body).get('assertion') || '';
      const [h, c, s] = jwt.split('.');
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s || '', 'base64url'));
      const claims = ok ? JSON.parse(Buffer.from(c, 'base64url').toString()) : {};
      if (!ok || claims.iss !== 'push@proj-1.iam.test' || !/firebase\.messaging/.test(claims.scope)) { badAssertions++; res.writeHead(400); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }));
    }
    if (req.url === '/v1/projects/proj-1/messages:send') {
      if (req.headers.authorization !== 'Bearer access-1') { res.writeHead(401); return res.end('{}'); }
      if (fcmDown) { res.writeHead(503); return res.end('{}'); }
      const m = JSON.parse(body).message;
      messages.push(m);
      if (m.token.startsWith('dead')) { res.writeHead(404); return res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ name: 'projects/proj-1/messages/1' }));
    }
    res.writeHead(404); res.end('{}');
  });
});
await new Promise(r => fake.listen(0, r));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;

const mk = (n, over = {}) => User.create({ firstName: `P${n}`, lastName: 'Push', email: `p${n}@x.in`, phone: `97300000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', ...over });
const [a, b, c] = await Promise.all([mk(1), mk(2), mk(3)]);
const [ta, tb] = await Promise.all([tokenFor(a), tokenFor(b)]);
const GOOD_A = 'tokenAAAAAAAAAAAAAAAAAAAA-good', DEAD_A = 'dead-tokenAAAAAAAAAAAAAAAAAA', TOKEN_B = 'tokenBBBBBBBBBBBBBBBBBBBB-good';

section('NOTHING SET UP: EVERYTHING STILL WORKS');
const plain = await startServer(DB);
const pc = client(plain.base);
const { token: padmin } = await makeAdmin();
const prefs0 = await pc('GET', '/push/preferences', ta);
check('the app is told push is not available yet, with the four kinds listed', prefs0.s === 200 && prefs0.d.available === false && prefs0.d.categories.map(x => x.key).join() === 'loan,reminders,messages,offers', JSON.stringify(prefs0.d));
check('the loan alerts are locked on', prefs0.d.categories[0].locked === true && prefs0.d.categories[0].on === true);
check('sign-in is needed (401)', (await pc('GET', '/push/preferences', null)).s === 401);
check('a short token is refused (400)', (await pc('POST', '/push/register', ta, { token: 'abc', platform: 'android' })).s === 400);
check('an unknown platform is refused (400)', (await pc('POST', '/push/register', ta, { token: GOOD_A, platform: 'windows' })).s === 400);
check('a phone registers', (await pc('POST', '/push/register', ta, { token: GOOD_A, platform: 'android', appVersion: '1.0.0' })).s === 200 && (await DeviceToken.countDocuments({ userId: a._id })) === 1);
check('registering the same phone again does not duplicate it', (await pc('POST', '/push/register', ta, { token: GOOD_A, platform: 'android' })).s === 200 && (await DeviceToken.countDocuments({ token: GOOD_A })) === 1);
const off = await pc('PUT', '/push/preferences', tb, { offers: false, loan: false });
check('a customer can switch offers off but not the loan alerts', off.d.categories.find(x => x.key === 'offers').on === false && off.d.categories.find(x => x.key === 'loan').on === true);
check('an empty choice is refused (400)', (await pc('PUT', '/push/preferences', tb, { nonsense: true })).s === 400);
const ann0 = await pc('POST', '/admin/announcements', padmin, { title: 'Hello', message: 'World', audience: 'all', expectedCount: 3, push: true });
check('an announcement still goes to the notification bell, and no push is attempted', ann0.s === 201 && ann0.d.pushQueued === false && (await Notification.countDocuments({ type: 'ANNOUNCEMENT' })) === 3, JSON.stringify(ann0.d));
const st0 = await pc('GET', '/admin/integrations', padmin);
check('the Integrations page shows push as not set up', st0.d.integrations.find(i => i.id === 'push').status.mode === 'off');
const chk0 = await pc('GET', '/admin/integrations/push-check', padmin);
check('the portal check says what is missing when nothing is set up', chk0.s === 200 && chk0.d.ok === false && chk0.d.checks[0].ok === false && /Pick fcm/.test(chk0.d.checks[0].detail), JSON.stringify(chk0.d.checks));
check('customers cannot run the check (403)', (await pc('GET', '/admin/integrations/push-check', ta)).s === 403);
await plain.stop();

section('FIREBASE CONNECTED');
const srv = await startServer(DB, { PUSH_PROVIDER: 'fcm', FCM_PROJECT_ID: 'proj-1', FCM_CLIENT_EMAIL: 'push@proj-1.iam.test', FCM_PRIVATE_KEY: privateKey, FCM_TOKEN_URL: `${fakeBase}/token`, FCM_API_BASE: fakeBase });
const call = client(srv.base);
const st1 = await call('GET', '/admin/integrations', padmin);
const pushCard = st1.d.integrations.find(i => i.id === 'push');
check('the Integrations page shows push as live, and never shows the private key', pushCard.status.mode === 'live' && !JSON.stringify(st1.d).includes('BEGIN PRIVATE KEY'), JSON.stringify(pushCard.status));
check('the app is now told push is available', (await call('GET', '/push/preferences', ta)).d.available === true);
await call('POST', '/push/register', ta, { token: DEAD_A, platform: 'ios' });
await call('POST', '/push/register', tb, { token: TOKEN_B, platform: 'android' });
check('the announcement form can see how many phones are registered', (await call('GET', '/admin/announcements/count?audience=all', padmin)).d.devices === 2);

const chk1 = await call('GET', '/admin/integrations/push-check', padmin);
check('with Firebase connected the check passes: key readable, Google accepts it, phones registered', chk1.d.ok === true && chk1.d.checks.map(c => c.name).join() === 'Provider chosen,Settings filled in,Private key is readable,Google accepts the key,Phones registered', JSON.stringify(chk1.d.checks));

section('AN ANNOUNCEMENT AS A PUSH');
const ann = await call('POST', '/admin/announcements', padmin, { title: 'Festival offer', message: 'Apply this week', audience: 'all', expectedCount: 3, push: true });
check('it is sent and the push is queued', ann.s === 201 && ann.d.pushQueued === true, JSON.stringify(ann.d));
await until(() => messages.length >= 2);
await sleep(300);
const toA = messages.filter(m => m.token === GOOD_A);
check('customer A\'s phone got it with the title, text and kind', toA.length === 1 && toA[0].notification.title === 'Festival offer' && toA[0].notification.body === 'Apply this week' && toA[0].data.type === 'ANNOUNCEMENT', JSON.stringify(messages.map(m => m.token)));
check('customer B switched offers off, so B got nothing', !messages.some(m => m.token === TOKEN_B));
check('the customer with no phone registered is simply skipped', messages.length === 2);
check('a phone that no longer has the app is forgotten', (await DeviceToken.countDocuments({ token: DEAD_A })) === 0);
check('Google was asked for an access key once, with a valid signed request', tokenRequests === 1 && badAssertions === 0, `${tokenRequests} requests, ${badAssertions} bad`);

section('LOAN ALERTS ARE ALWAYS SENT');
const loan = await Loan.create({ userId: b._id, loanAmount: 10000, tenure: 3, interestRate: 15, monthlyEMI: 3500, totalAmount: 10500, status: 'submitted' });
const before = messages.length;
const approve = await call('POST', `/admin/loans/${loan._id}/approve`, padmin, {});
await until(() => messages.length > before);
const loanMsg = messages.find(m => m.token === TOKEN_B && m.data.type === 'LOAN_APPROVED');
check('approving a loan pushes to the customer even with offers switched off', approve.s === 200 && !!loanMsg && String(loanMsg.data.loanId) === String(loan._id), JSON.stringify(loanMsg));
check('the notification records that the push was sent', (await Notification.findOne({ userId: b._id, type: 'LOAN_APPROVED' })).channels.push === 'sent');

section('WHEN FIREBASE FAILS');
fcmDown = true;
const loan2 = await Loan.create({ userId: b._id, loanAmount: 5000, tenure: 3, interestRate: 15, monthlyEMI: 1700, totalAmount: 5100, status: 'submitted' });
const rej = await call('POST', `/admin/loans/${loan2._id}/reject`, padmin, { reason: 'Test' });
check('the loan action still works and the notification still appears in the app', rej.s === 200 && !!(await Notification.findOne({ userId: b._id, type: 'LOAN_REJECTED' })));
check('and records that the push failed', (await Notification.findOne({ userId: b._id, type: 'LOAN_REJECTED' })).channels.push === 'failed');
fcmDown = false;

section('SIGNING OUT OF PUSH');
check('a phone can be removed', (await call('DELETE', '/push/register', tb, { token: TOKEN_B })).s === 200 && (await DeviceToken.countDocuments({ userId: b._id })) === 0);
for (let i = 0; i < 7; i++) await call('POST', '/push/register', ta, { token: `extra-phone-${i}-xxxxxxxxxxxxxxxx`, platform: 'android' });
check('a customer keeps at most 5 phones', (await DeviceToken.countDocuments({ userId: a._id })) === 5);

await srv.stop();
fake.close();
await disconnect();
finish();
