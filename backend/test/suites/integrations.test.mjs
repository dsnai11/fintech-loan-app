import http from 'node:http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-integrations';
await connect(DB);

// A pretend credit bureau
let mode = 'ok';
const seen = [];
const bureau = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => (body += d));
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, body });
    if (mode === 'down') { res.writeHead(503); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mode === 'junk' ? { data: { score: 'none' } } : { data: { score: 731 } }));
  });
});
await new Promise(r => bureau.listen(0, r));
const bureauUrl = `http://127.0.0.1:${bureau.address().port}/score`;

const srv = await startServer(DB, { OFFER_LIMIT: 'true', REQUIRE_PHONE_VERIFIED: 'true' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

let seq = 0;
const mk = async () => {
  seq++;
  const u = await User.create({ firstName: 'Ina', lastName: `T${seq}`, email: `i${seq}@x.in`, phone: `93${String(seq).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: new Date(Date.now() - 32 * 365.25 * 864e5), panNumber: `ABCPE${2000 + seq}F` });
  return { u, tok: await tokenFor(u) };
};
const eligibility = c => call('POST', '/loans/check-eligibility', c.tok, { consent: true });

section('STATUS PAGE: EVERYTHING STARTS IN TEST MODE');
check('customers cannot see it (403)', (await call('GET', '/admin/integrations', (await mk()).tok)).s === 403);
const first = await call('GET', '/admin/integrations', admin);
const by = r => Object.fromEntries(r.d.integrations.map(i => [i.id, i]));
check('with nothing set up: SMS, bureau and DigiLocker are in test mode, email is off', first.s === 200 && by(first).sms.status.mode === 'test' && by(first).bureau.status.mode === 'test' && by(first).digilocker.status.mode === 'test' && by(first).email.status.mode === 'off', JSON.stringify(first.d).slice(0, 300));
check('payments are in test mode until PAYMENT_MODE is PRODUCTION', by(first).payments.status.mode === 'test');

section('A TEST SCORE BEFORE THE BUREAU IS CONNECTED');
const a = await mk();
const r1 = await eligibility(a);
check('the offer uses the test score and says so', r1.s === 200 && r1.d.offer.creditCheck === 'sandbox', JSON.stringify(r1.d));

section('CONNECTING THE BUREAU TAKES EFFECT AT ONCE');
check('an unknown provider is refused (400)', (await call('PUT', '/admin/integrations', admin, { values: { NOT_A_SETTING: 'x' } })).s === 400);
const half = await call('PUT', '/admin/integrations', admin, { values: { BUREAU_PROVIDER: 'generic', BUREAU_API_URL: bureauUrl } });
check('a provider with settings missing is flagged and names what is missing', by(half).bureau.status.mode === 'misconfigured' && by(half).bureau.status.missing.includes('BUREAU_API_KEY'), JSON.stringify(by(half).bureau.status));
const full = await call('PUT', '/admin/integrations', admin, { values: { BUREAU_API_KEY: 'secret-key-123', BUREAU_SCORE_PATH: 'data.score' } });
check('with the key in, the bureau is live', by(full).bureau.status.mode === 'live' && by(full).bureau.status.provider === 'generic', JSON.stringify(by(full).bureau.status));
check('the key is never sent back, only that it is set', by(full).bureau.fields.find(f => f.key === 'BUREAU_API_KEY').set === true && !JSON.stringify(full.d).includes('secret-key-123'));
const b = await mk();
const r2 = await eligibility(b);
const ub = await User.findById(b.u._id);
check('the next check goes to the bureau, not the test score', r2.s === 200 && r2.d.offer.creditCheck === 'bureau' && ub.creditScore === 731 && ub.creditScoreSource === 'bureau', JSON.stringify(r2.d));
check('it sent the key and the customer\'s PAN', seen.length === 1 && seen[0].auth === 'Bearer secret-key-123' && seen[0].body.includes(ub.panNumber), JSON.stringify(seen));
check('the secret is not in the audit log', !JSON.stringify(await AuditLog.find({ action: 'INTEGRATIONS_UPDATED' }).lean()).includes('secret-key-123'));

section('WHEN THE BUREAU FAILS THE TEST SCORE IS NOT USED');
mode = 'down';
const c = await mk();
const r3 = await eligibility(c);
check('bureau down: no score, the no-score offer, and no test score invented', r3.s === 200 && r3.d.offer.creditCheck === 'none' && !(await User.findById(c.u._id)).creditScore, JSON.stringify(r3.d));
mode = 'junk';
const d = await mk();
check('an unusable reply is treated the same way', (await eligibility(d)).d.offer.creditCheck === 'none');
mode = 'ok';

section('SWITCHING BACK');
await call('PUT', '/admin/integrations', admin, { values: { BUREAU_PROVIDER: '' } });
const back = await call('GET', '/admin/integrations', admin);
check('clearing the provider returns to test mode', by(back).bureau.status.mode === 'test');

section('DIGILOCKER NEEDS AN ADAPTER');
const dl = await call('PUT', '/admin/integrations', admin, { values: { DIGILOCKER_PROVIDER: 'digio' } });
check('a provider with no adapter installed is flagged, not silently ignored', by(dl).digilocker.status.mode === 'misconfigured' && /adapter/.test(by(dl).digilocker.status.note), JSON.stringify(by(dl).digilocker.status));

section('PRODUCTION WITH NOTHING SET UP');
await call('PUT', '/admin/integrations', admin, { values: { DIGILOCKER_PROVIDER: '' } });
const prod = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' });
const pcall = client(prod.base);
const pv = await pcall('GET', '/admin/integrations', admin);
check('production with no providers says "not available" rather than faking it', pv.d.productionMode && by(pv).sms.status.mode === 'unavailable' && by(pv).bureau.status.mode === 'unavailable' && by(pv).digilocker.status.mode === 'unavailable', JSON.stringify(pv.d).slice(0, 300));
check('production without Razorpay keys is flagged', by(pv).payments.status.mode === 'misconfigured' && by(pv).payments.status.missing.length === 3);
await prod.stop();

await srv.stop();
bureau.close();
await disconnect();
finish();
