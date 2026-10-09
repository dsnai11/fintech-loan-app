import fs from 'fs';
import path from 'path';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, backendDir } from '../lib.mjs';
import User from '../../src/models/User.js';
import { sanitizeInput } from '../../src/middleware/hardening.js';
import { securityChecks } from '../../src/services/securityChecks.js';
import { permissionFor } from '../../src/services/permissions.js';

const DB = 'fintech-test-hardening';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const admin = await makeAdmin();

const victim = await User.create({ firstName: 'Vic', lastName: 'Tim', email: 'victim@x.in', phone: '9700000001', password: 'x12345678', kycStatus: 'approved', phoneVerified: true });
const vt = await tokenFor(victim);

section('OPERATORS CANNOT BE SMUGGLED INTO LOOKUPS');
const inj = await call('POST', '/auth/login', null, { email: { $ne: null }, password: 'x12345678' });
check('logging in with {"$ne": null} as the email does not work', inj.s !== 200 && !inj.d.token, `${inj.s} ${JSON.stringify(inj.d).slice(0, 100)}`);
const inj2 = await call('POST', '/auth/login', null, { email: 'victim@x.in', password: { $gt: '' } });
check('nor does {"$gt": ""} as the password', inj2.s !== 200 && !inj2.d.token, `${inj2.s}`);
const body = { a: { $where: 'x', ok: 1 }, 'b.c': 2, list: [{ $gt: 1, keep: 2 }], name: 'fine' };
sanitizeInput({ body, query: {}, params: {} }, {}, () => {});
check('keys starting with $ or containing a dot are removed, the rest is kept', body.a.$where === undefined && body.a.ok === 1 && body['b.c'] === undefined && body.list[0].$gt === undefined && body.list[0].keep === 2 && body.name === 'fine', JSON.stringify(body));
const q = await fetch(`${srv.base}/admin/customers?q[$ne]=zz`, { headers: { Authorization: `Bearer ${admin.token}` } });
const qj = await q.json();
check('a query string with an operator is neutralised: it matches nobody', q.status === 400 || (q.status === 200 && (qj.customers || []).length === 0), `${q.status} ${JSON.stringify(qj).slice(0, 80)}`);

section('NOTHING PERSONAL IS KEPT BY BROWSERS OR PROXIES');
const mine = await fetch(`${srv.base}/loans`, { headers: { Authorization: `Bearer ${vt}` } });
check('API answers say do not store', /no-store/.test(mine.headers.get('cache-control') || ''));

section('ERRORS DO NOT SHOW OUR INSIDES');
const broken = await fetch(`${srv.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email": ' });
const bj = await broken.json();
check('broken JSON gets a plain 400 with a reference', broken.status === 400 && /valid JSON/.test(bj.error) && !!bj.requestId && !/SyntaxError|Unexpected/.test(JSON.stringify(bj)), JSON.stringify(bj));
const cast = await fetch(`${srv.base}/loans/not-an-id`, { headers: { Authorization: `Bearer ${vt}` } });
const cj = await cast.json();
check('a database error is not shown to the caller (no "Cast to ObjectId")', !/Cast to|ObjectId|mongoose|BSON/i.test(JSON.stringify(cj)) && cast.status >= 400, `${cast.status} ${JSON.stringify(cj)}`);
check('a server error answer carries a reference to quote to support', cast.status < 500 || (!!cj.requestId && /support/.test(cj.error)), `${cast.status}`);
const logs = srv.logs();
check('the real error went to the log with that reference', cast.status < 500 || logs.includes(cj.requestId), '');

section('THE SETTINGS SELF-CHECK');
const keep = { ...process.env };
Object.assign(process.env, { JWT_SECRET: 'test-secret', ALLOWED_ORIGINS: '', STAFF_REQUIRE_2FA: 'false', ADMIN_RESET_PASSWORD: 'something-long-1', MONGO_URI: 'mongodb://localhost:27017/x' });
let bad = securityChecks().filter(c => !c.ok).map(c => c.key);
check('a weak secret, open origins, no staff 2FA, a leftover reset password and an open database are all flagged', ['jwt', 'origins', 'staff2fa', 'reset', 'db'].every(k => bad.includes(k)), bad.join());
Object.assign(process.env, { JWT_SECRET: 'x'.repeat(8) + 'Qz9!kLmN2pRtVwXy4aBcDeFg6hJ', ALLOWED_ORIGINS: 'https://portal.lifc.in', STAFF_REQUIRE_2FA: '', ADMIN_RESET_PASSWORD: '', MONGO_URI: 'mongodb+srv://user:pw@cluster.mongodb.net/x', EMAIL_USER: 'a@b.in', API_RATE_LIMIT: '', AUTH_RATE_LIMIT: '', REQUIRE_PHONE_VERIFIED: '', REQUIRE_ONBOARDING: '', REQUIRE_TERMS: '' });
bad = securityChecks().filter(c => !c.ok).map(c => c.key);
check('a properly set deployment passes every check', bad.length === 0, bad.join());
for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
Object.assign(process.env, keep);

section('EVERY STAFF AREA IS LOCKED TO THE RIGHT PEOPLE');
const appSrc = fs.readFileSync(path.join(backendDir, 'src', 'app.js'), 'utf8');
const prefixes = [...appSrc.matchAll(/app\.use\('(\/api\/admin\/[a-z-]+)'/g)].map(m => m[1]);
check('found the staff areas to test', prefixes.length >= 30, String(prefixes.length));
check('an unknown staff path is super-admin only by default', permissionFor('GET', '/api/admin/zzz-new-area') === 'super' && permissionFor('POST', '/api/admin/zzz-new-area') === 'super');
const auditor = await User.create({ firstName: 'Read', lastName: 'Only', email: 'auditor@x.in', phone: '9700000002', password: 'x12345678', role: 'auditor', twoFactorEnabled: true });
const at = await tokenFor(auditor);
const writes = [];
for (const p of prefixes) {
  const r = await call('POST', `${p}/probe`, at, {});
  if (![403, 404].includes(r.s)) writes.push(`${p} -> ${r.s}`);
}
check('a read-only auditor cannot change anything in any staff area', writes.length === 0, writes.join('; '));
const custReads = [];
for (const p of prefixes) {
  const r = await call('GET', p, vt);
  if (![401, 403, 404].includes(r.s)) custReads.push(`${p} -> ${r.s}`);
}
check('a customer token opens none of the staff areas', custReads.length === 0, custReads.join('; '));
const noToken = [];
for (const p of prefixes) {
  const r = await call('GET', p, null);
  if (![401, 403, 404].includes(r.s)) noToken.push(`${p} -> ${r.s}`);
}
check('no sign-in opens none of them either', noToken.length === 0, noToken.join('; '));
for (const p of ['/admin/staff', '/admin/roles', '/admin/config', '/admin/integrations']) {
  const r = await call('GET', p, at);
  check(`the auditor cannot even read ${p}`, r.s === 403, String(r.s));
}

await disconnect();
srv.stop();
finish();
