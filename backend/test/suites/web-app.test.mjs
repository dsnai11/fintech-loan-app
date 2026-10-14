import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import KycMedia from '../../src/models/KycMedia.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-web-app';
await connect(DB);

// A stand-in for the built web app
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifc-web-'));
fs.mkdirSync(path.join(dir, 'canvaskit'));
fs.writeFileSync(path.join(dir, 'index.html'), '<!DOCTYPE html><html><head><base href="/app/"><title>LIFC</title></head><body>app</body></html>');
fs.writeFileSync(path.join(dir, 'main.dart.js'), 'console.log("app")');
fs.writeFileSync(path.join(dir, 'canvaskit', 'canvaskit.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
const srv = await startServer(DB, { WEB_APP_DIR: dir });
const none = await startServer(DB, { WEB_APP_DIR: path.join(dir, 'does-not-exist') });
const origin = srv.base.replace('/api', '');
const call = client(srv.base);

section('THE WEB APP IS SERVED BY THE SAME SERVER');
const idx = await fetch(`${origin}/app/`);
check('the app opens at /app/', idx.status === 200 && /text\/html/.test(idx.headers.get('content-type')) && (await idx.text()).includes('<base href="/app/">'));
const noSlash = await fetch(`${origin}/app`, { redirect: 'manual' });
check('/app goes to /app/', noSlash.status === 301 && noSlash.headers.get('location') === '/app/');
const js = await fetch(`${origin}/app/main.dart.js`);
check('its files are served, and checked again each time so a new release shows at once', js.status === 200 && js.headers.get('cache-control') === 'no-cache' && /no-cache/.test(idx.headers.get('cache-control')));
const wasm = await fetch(`${origin}/app/canvaskit/canvaskit.wasm`);
check('the drawing engine files may be kept for a week', wasm.status === 200 && /max-age=604800/.test(wasm.headers.get('cache-control')));
check('a file that is not there is a 404', (await fetch(`${origin}/app/nothing.js`)).status === 404);
const noApp = await fetch(`${none.base.replace('/api', '')}/app/`);
check('before the first build there is simply nothing at /app/ (404), not an error', noApp.status === 404);

section('THE SECURITY RULES FIT THE APP, AND ONLY THE APP');
const csp = idx.headers.get('content-security-policy') || '';
check('the app may run WebAssembly and use fonts from Google\'s font host', csp.includes("'wasm-unsafe-eval'") && csp.includes('https://fonts.gstatic.com') && csp.includes("worker-src 'self' blob:"));
check('but nothing else from outside, no framing, no plugins', /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && !/script-src[^;]*https?:/.test(csp) && !csp.includes("'unsafe-eval'"));
const portal = await fetch(`${origin}/`);
check('the staff portal keeps its stricter policy (no WebAssembly)', !((portal.headers.get('content-security-policy') || '').includes('wasm-unsafe-eval')) && /frame-ancestors 'none'/.test(portal.headers.get('content-security-policy') || ''));
const api = await fetch(`${srv.base}/health`);
check('so does the API', !((api.headers.get('content-security-policy') || '').includes('wasm-unsafe-eval')));

section('THE APP CAN CALL THE API FROM A BROWSER');
const pre = await fetch(`${srv.base}/loans`, { method: 'OPTIONS', headers: { Origin: 'https://app.example.in', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-install-id,x-app-version,x-platform,x-device-rooted' } });
const allowed = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
check('the preflight allows the headers the app sends (so it also works from another address)', pre.status < 300 && ['authorization', 'x-install-id', 'x-app-version', 'x-platform', 'x-device-rooted'].every(h => allowed.includes(h)), allowed);

section('A SELFIE FROM THE WEB: ONE PHOTO, CHECKED BY A PERSON');
const jpeg = (tag, size = 12000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x01, 0xe0, 0x01, 0x01, 0x11, 0x00]), crypto.createHash('sha256').update(tag).digest(), Buffer.alloc(size, 9), Buffer.from([0xff, 0xd9])]).toString('base64');
const mk = async n => { const u = await User.create({ firstName: `Web${n}`, lastName: 'U', email: `web${n}@x.in`, phone: `98500000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved' }); return { u, t: await tokenFor(u) }; };
const c1 = await mk(1);
const up = photo => call('POST', '/onboarding/selfie/upload', c1.t, { photo });
check('no photo is refused', (await up('')).s === 422);
check('a file that is not a JPEG is refused', (await up(Buffer.from('not a picture at all '.repeat(800)).toString('base64'))).s === 422);
check('a tiny picture is refused', (await up(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'))).s === 422);
const ok = await up(jpeg('one'));
check('a good photo is accepted', ok.s === 200 && ok.d.selfie.status === 'review', JSON.stringify(ok.d));
const u1 = await User.findById(c1.u._id);
check('it waits for a person: status "review", marked as having no blink check', u1.selfie.status === 'review' && u1.selfie.method === 'photo_upload' && u1.selfie.flag === 'no_blink_check');
check('the account set-up counts the selfie step as done', ok.d.steps.selfie === true);
check('the photo is kept for staff, who can open it', (await KycMedia.countDocuments({ userId: c1.u._id })) === 1);
const { token: admin } = await makeAdmin();
const view = await fetch(`${srv.base}/admin/customers/${c1.u._id}/selfie`, { headers: { Authorization: `Bearer ${admin}` } });
check('staff open it in the normal selfie review', view.status === 200 && view.headers.get('content-type') === 'image/jpeg');
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'SELFIE_UPLOADED' })));
const c2 = await mk(2);
const dup = await call('POST', '/onboarding/selfie/upload', c2.t, { photo: jpeg('one') });
check('the same photo on another account is flagged for review', dup.s === 200 && (await User.findById(c2.u._id)).selfie.flag === 'same_photo_on_another_account' && (await AmlAlert.countDocuments({ userId: c2.u._id, rule: 'DUPLICATE_SELFIE' })) === 1);
const codes = [];
for (let i = 0; i < 7; i++) codes.push((await up(jpeg('try' + i))).s);
check('too many attempts in an hour are stopped (429)', codes.includes(429), codes.join());
check('signing in is needed', (await call('POST', '/onboarding/selfie/upload', null, { photo: jpeg('x') })).s === 401);

srv.stop();
none.stop();
fs.rmSync(dir, { recursive: true, force: true });
await disconnect();
finish();
