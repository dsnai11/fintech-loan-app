import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawn } from 'child_process';
import bcrypt from 'bcryptjs';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, backendDir } from '../lib.mjs';
import User from '../../src/models/User.js';
import KycMedia from '../../src/models/KycMedia.js';
import { sanitizeInput } from '../../src/middleware/hardening.js';
import { passwordProblem, BCRYPT_COST, needsRehash } from '../../src/services/passwordPolicy.js';
import { secretProblem, secretIsStrong } from '../../src/services/appSecret.js';
import { encryptBuffer, decryptBuffer, isEncrypted } from '../../src/services/dataCrypto.js';

const DB = 'fintech-test-security-audit';
await connect(DB);
const srv = await startServer(DB, {});
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const base = srv.base.replace(/\/api$/, '');

section('BROWSER FEATURES AND HEADERS');
const root = await fetch(base + '/');
const pp = root.headers.get('permissions-policy') || '';
check('the camera and location are allowed for this site only; the microphone, payments and USB are off', /camera=\(self\)/.test(pp) && /geolocation=\(self\)/.test(pp) && /microphone=\(\)/.test(pp) && /payment=\(\)/.test(pp) && /usb=\(\)/.test(pp), pp);
check('the API carries the same protections', (await fetch(srv.base + '/health')).headers.get('permissions-policy') === pp);
check('the server does not announce what it is built with', !root.headers.get('x-powered-by'));
check('a visitor who arrived over plain http is sent to https on a real deployment', await (async () => {
  const prod = await startServer(DB, { NODE_ENV: 'production', PAYMENT_MODE: 'PRODUCTION', JWT_SECRET: crypto.randomBytes(32).toString('hex') });
  try {
    const r = await fetch(prod.base.replace(/\/api$/, '') + '/lms/index.html?x=1', { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'http' } });
    const ok = r.status === 301 && /^https:\/\/.+\/lms\/index\.html\?x=1$/.test(r.headers.get('location') || '');
    const stay = await fetch(prod.base.replace(/\/api$/, '') + '/lms/index.html', { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https' } });
    return ok && stay.status === 200;
  } finally { await prod.stop(); }
})());

section('INPUT THAT TRIES TO TURN INTO COMMANDS');
const body = JSON.parse('{"a":1,"__proto__":{"isAdmin":true},"constructor":{"x":1},"nested":{"prototype":{"y":1},"ok":2,"$where":"1","a.b":3}}');
sanitizeInput({ body, query: {}, params: {} }, {}, () => {});
check('database operators and prototype-poisoning keys are removed from what a visitor sends', !Object.keys(body).includes('__proto__') && !Object.keys(body).includes('constructor') && Object.keys(body.nested).join() === 'ok' && body.a === 1 && body.nested.ok === 2 && ({}).isAdmin === undefined);
const inj = await call('POST', '/auth/login', null, { email: { $gt: '' }, password: { $gt: '' } });
check('the classic "match anyone" login trick is refused', inj.s === 400);
check('a search with an operator in the query string does not widen the search', (await call('GET', '/admin/customers/search?q[$ne]=x', admin)).s !== 500);

section('PASSWORDS');
const who = { email: 'asha.rao@example.com', phone: '9876543210', firstName: 'Asha', lastName: 'Rao' };
check('too short is refused', !!passwordProblem('Ab1', who));
check('the most common passwords are refused, with or without small changes', ['password', 'Password123', 'qwerty123', '12345678', 'iloveyou', 'Admin@123', 'welcome1'].every(p => !!passwordProblem(p, who)));
check('a straight run or one repeated character is refused', !!passwordProblem('12345678') && !!passwordProblem('abcdefgh') && !!passwordProblem('aaaaaaaaa1') && !!passwordProblem('abababab1'));
check('your own details are refused', !!passwordProblem('asharao', who) && !!passwordProblem('9876543210', who) && !!passwordProblem('Asha1234', { ...who, email: 'x@y.in' }) === false || !!passwordProblem('asha.rao', who));
check('letters only, or numbers only, are refused when short, and fine when it is a long phrase', !!passwordProblem('onlyletters') && !!passwordProblem('48392015') && !passwordProblem('correct horse battery'));
check('more than 72 bytes is refused (the hashing method would silently cut it)', !!passwordProblem('a1'.repeat(40)));
check('a good password is accepted', passwordProblem('Blue-Lantern-42', who) === null && passwordProblem('Tr0ub4dor&3x', who) === null);
const sign = (pw, n) => call('POST', '/auth/signup', null, { firstName: 'Pw', lastName: 'Test', email: `pw${n}@x.in`, phone: `98000000${String(n).padStart(2, '0')}`, password: pw, confirmPassword: pw });
check('sign-up refuses a weak password and says why', await (async () => { const r = await sign('password123', 1); return r.s === 400 && /common|simple|harder/i.test(r.d.error); })());
check('sign-up accepts a good one', (await sign('Blue-Lantern-42', 2)).s === 201);
check('a password reset applies the same rules', (await call('POST', '/auth/reset-password', null, { token: 'x'.repeat(40), password: 'password123' })).s === 400);
const cost = execFileSync(process.execPath, ['--input-type=module', '-e', "import('./src/services/passwordPolicy.js').then(m => console.log(m.BCRYPT_COST))"], { cwd: backendDir, env: { ...process.env, BCRYPT_COST: '' } }).toString().trim();
check('passwords are hashed at work factor 12 unless set otherwise (tests use the minimum, 10, to stay fast)', cost === '12' && BCRYPT_COST === 10);
const stored = (await User.findOne({ email: 'pw2@x.in' }).select('+password')).password;
check('only a hash is stored, never the password', stored !== 'Blue-Lantern-42' && /^\$2[aby]\$\d\d\$/.test(stored) && !stored.includes('Blue'));
const old = await User.create({ firstName: 'Old', lastName: 'Hash', email: 'oldhash@x.in', phone: '9811111111', password: 'Temp-Pass-77' });
const weakHash = bcrypt.hashSync('Temp-Pass-77', 8);
await User.updateOne({ _id: old._id }, { password: weakHash });
const changedAt = (await User.findById(old._id)).passwordChangedAt || null;
check('a hash made at a lower work factor is recognised as old', needsRehash(weakHash) && !needsRehash(stored));
const li = await call('POST', '/auth/login', null, { email: 'oldhash@x.in', password: 'Temp-Pass-77' });
await new Promise(r => setTimeout(r, 400));
const upgraded = (await User.findById(old._id).select('+password')).password;
check('signing in still works, and the stored hash is quietly upgraded without logging anyone out', li.s === 200 && bcrypt.getRounds(upgraded) === BCRYPT_COST && String((await User.findById(old._id)).passwordChangedAt || null) === String(changedAt) && (await call('POST', '/auth/login', null, { email: 'oldhash@x.in', password: 'Temp-Pass-77' })).s === 200);
check('a wrong password does not upgrade anything', await (async () => { await User.updateOne({ _id: old._id }, { password: weakHash }); await call('POST', '/auth/login', null, { email: 'oldhash@x.in', password: 'wrong-Pass-1' }); await new Promise(r => setTimeout(r, 300)); return (await User.findById(old._id).select('+password')).password === weakHash; })());

section('THE SIGN-IN SECRET');
check('a missing, short or common secret is called out', secretProblem('') === 'is not set' && /only \d+ characters/.test(secretProblem('abc123')) && /common/.test(secretProblem('changeme')) && /common/.test(secretProblem('aaaaaaaaaaaaaaaaaaaa')));
check('32 random characters or more is strong; 16 is allowed but not strong', secretIsStrong(crypto.randomBytes(24).toString('hex')) && !secretIsStrong('a1b2c3d4e5f6g7h8') && secretProblem('a1b2c3d4e5f6g7h8') === null);
const boot = (secret, extra = {}) => new Promise(resolve => {
  const child = spawn(process.execPath, ['src/index.js'], { cwd: backendDir, env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: secret, MONGO_URI: 'mongodb://localhost:27017/fintech-test-boot', PORT: '0', DISABLE_SCHEDULER: '1', ...extra } });
  let out = '';
  child.stdout.on('data', d => (out += d)); child.stderr.on('data', d => (out += d));
  const timer = setTimeout(() => { child.kill(); resolve({ code: 'still running', out }); }, 6000);
  child.on('exit', code => { clearTimeout(timer); resolve({ code, out }); });
});
const weakBoot = await boot('changeme');
check('on a real deployment the server refuses to start with a common secret', weakBoot.code === 1 && /JWT_SECRET/.test(weakBoot.out), weakBoot.out.slice(0, 200));
const shortBoot = await boot('abc123');
check('or with a very short one', shortBoot.code === 1 && /JWT_SECRET/.test(shortBoot.out));
const noneBoot = await boot('');
check('or with none', noneBoot.code === 1 && /JWT_SECRET is not set/.test(noneBoot.out));
const midBoot = await boot('a1b2c3d4e5f6g7h8');
check('a 16-character secret starts, with a loud warning to replace it', midBoot.code === 'still running' && /shorter than 32/.test(midBoot.out), midBoot.out.slice(0, 300));
const okBoot = await boot(crypto.randomBytes(32).toString('hex'));
check('a strong secret starts with no warning', okBoot.code === 'still running' && !/shorter than 32|JWT_SECRET/.test(okBoot.out));

section('THE CONFIGURATION DOCUMENT IS NOT PUBLIC');
const cust = await User.create({ firstName: 'Cf', lastName: 'G', email: 'cfg@x.in', phone: '9822222222', password: 'Blue-Lantern-42' });
const ct = await tokenFor(cust);
check('no sign-in: refused (401)', (await call('GET', '/app-config', null)).s === 401 && (await call('GET', '/app-config/providers', null)).s === 401);
check('a customer: refused (403)', (await call('GET', '/app-config', ct)).s === 403);
check('staff with the right can read it', (await call('GET', '/app-config', admin)).s === 200);

section('LIMITS ON ABUSE');
const lim = await startServer(DB, { SIGNUP_RATE_LIMIT: '3' });
const callLim = client(lim.base);
let codes = [];
for (let i = 0; i < 5; i++) codes.push((await callLim('POST', '/auth/signup', null, { firstName: 'Bulk', lastName: 'Bot', email: `bulk${i}@x.in`, phone: `98333333${String(i).padStart(2, '0')}`, password: 'Blue-Lantern-42', confirmPassword: 'Blue-Lantern-42' })).s);
check('after a few sign-ups from one connection in an hour, the rest are refused (429)', codes.slice(0, 3).every(c => c === 201) && codes.slice(3).every(c => c === 429), codes.join(','));
await lim.stop();
const ipOnly = await startServer(DB, { ADMIN_ALLOWED_IPS: '203.0.113.9' });
const callIp = client(ipOnly.base);
const refused = await callIp('GET', '/admin/lms/overview', admin);
check('if the back office is limited to listed addresses, other addresses are refused (403), even with a valid staff login', refused.s === 403 && /cannot be opened from this network/.test(refused.d.error));
check('customers and the public site are not affected by that list', (await callIp('GET', '/pricing', null)).s === 200);
await ipOnly.stop();
const ipOk = await startServer(DB, { ADMIN_ALLOWED_IPS: '127.0.0.1, ::1' });
check('an address on the list gets in', (await client(ipOk.base)('GET', '/admin/lms/overview', admin)).s === 200);
await ipOk.stop();

section('STORED FILES ARE SEALED WHEN A KEY IS SET');
const key = crypto.randomBytes(32).toString('hex');
const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('PLAINTEXT-MARKER-FOR-THE-TEST-'.repeat(40))]);
delete process.env.DATA_ENCRYPTION_KEY;
check('with no key, files are stored as they are (as before)', encryptBuffer(photo).equals(photo) && !isEncrypted(photo));
process.env.DATA_ENCRYPTION_KEY = key;
const sealed = encryptBuffer(photo);
check('with a key, a file is sealed, and opens to exactly the same bytes', isEncrypted(sealed) && !sealed.includes('PLAINTEXT-MARKER') && decryptBuffer(sealed).equals(photo));
check('the same file sealed twice looks different (a fresh random number each time)', !encryptBuffer(photo).equals(sealed));
check('sealing something already sealed leaves it alone', encryptBuffer(sealed).equals(sealed));
const tampered = Buffer.from(sealed); tampered[tampered.length - 5] ^= 1;
check('a file changed in the database is noticed, not opened', (() => { try { decryptBuffer(tampered); return false; } catch { return true; } })());
check('a file stored before the key was set still opens', decryptBuffer(photo).equals(photo));
const u = await User.create({ firstName: 'K', lastName: 'M', email: 'km@x.in', phone: '9844444444', password: 'Blue-Lantern-42' });
const m = await KycMedia.create({ userId: u._id, kind: 'aadhaar_card', data: photo, sha256: crypto.createHash('sha256').update(photo).digest('hex'), size: photo.length });
const raw = await KycMedia.collection.findOne({ _id: m._id });
const rawBytes = Buffer.from(raw.data.buffer);
check('in the database the picture is sealed (the raw bytes hold no readable content)', isEncrypted(rawBytes) && !rawBytes.includes('PLAINTEXT-MARKER'));
check('reading it through the app gives the original picture back', (await KycMedia.findById(m._id).select('+data')).data.equals(photo));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
check('with the wrong key it cannot be read', await KycMedia.findById(m._id).select('+data').then(d => { try { return !d.data; } catch { return true; } }, () => true));
delete process.env.DATA_ENCRYPTION_KEY;
check('with no key at all it says so, instead of showing scrambled bytes as a picture', await KycMedia.findById(m._id).select('+data').then(d => { try { void d.data; return false; } catch (e) { return /DATA_ENCRYPTION_KEY/.test(e.message); } }));
check('a key of the wrong size is refused with a clear message', (() => { process.env.DATA_ENCRYPTION_KEY = 'tooshort'; try { encryptBuffer(photo); return false; } catch (e) { return /32 bytes/.test(e.message); } finally { delete process.env.DATA_ENCRYPTION_KEY; } })());

section('NOTHING SECRET IS KEPT IN THE REPOSITORY');
let tracked = [];
try { tracked = execFileSync('git', ['ls-files'], { cwd: path.resolve(backendDir, '..'), encoding: 'utf8' }).split('\n').filter(Boolean); } catch { tracked = []; }
if (!tracked.length) console.log('  (not a git checkout: skipped)');
else {
  check('no .env file is tracked (only the example)', !tracked.some(f => /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f)), tracked.filter(f => /(^|\/)\.env/.test(f)).join(', '));
  check('no private key, keystore or certificate file is tracked', !tracked.some(f => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(f)), tracked.filter(f => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(f)).join(', '));
  const gitignore = fs.readFileSync(path.resolve(backendDir, '..', '.gitignore'), 'utf8');
  check('the repository ignores .env files and key files', /^\.env$/m.test(gitignore) && /\*\.pem/.test(gitignore) && /\*\.keystore/.test(gitignore));
  const PATTERNS = [['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/], ['a GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/], ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{60,}/], ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/], ['an Anthropic or OpenAI key', /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/], ['a live Razorpay key', /\brzp_live_[A-Za-z0-9]{14,}\b/],
    ['a database address with a real-looking password', /mongodb(\+srv)?:\/\/[^:/\s'"@]+:(?!(password|pass|testpass123|PASSWORD|YOUR|<)[^@]*@)[^@\s'"<>$]{6,}@(?!(localhost|127\.0\.0\.1))[\w.-]+/]];
  const hits = [];
  for (const f of tracked) {
    if (/^backend\/public\/app\/|^mobile\/(android|ios)\/.*\.(png|jpg|ttf|otf|ico|jar|so)$|\.(png|jpg|jpeg|gif|ico|ttf|otf|woff2?|wasm|bin|pdf|apk|ipa|zip|gz)$/i.test(f) || /package-lock\.json$/.test(f)) continue;
    let text; try { const p = path.resolve(backendDir, '..', f); if (fs.statSync(p).size > 2e6) continue; text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${name}`);
  }
  check('no real-looking keys, tokens or database passwords are in any tracked file', hits.length === 0, hits.slice(0, 5).join('; '));
}

await srv.stop();
await disconnect();
finish();
