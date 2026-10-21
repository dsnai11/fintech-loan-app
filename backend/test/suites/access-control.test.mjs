import fs from 'fs';
import jwt from 'jsonwebtoken';
import { check, section, connect, disconnect, startServer, finish, tokenFor, makeAdmin, backendDir } from '../lib.mjs';
import User from '../../src/models/User.js';

// Every API route, checked from the outside. The list of routes is read from the code itself, so a route added later is
// checked too, and a new route that needs no sign-in has to be added to the short list below on purpose.
const DB = 'fintech-test-access-control';
await connect(DB);
const root = new URL('../../src/', import.meta.url);
const app = fs.readFileSync(new URL('app.js', root), 'utf8');
const imports = Object.fromEntries([...app.matchAll(/import (\w+) from '\.\/routes\/([\w.-]+)'/g)].map(m => [m[1], m[2]]));
const mounts = [...app.matchAll(/app\.use\('(\/[^']*)',\s*(?:\w+Limiter,\s*)?(\w+)\)/g)].map(m => ({ base: m[1], name: m[2] })).filter(m => imports[m.name]);
const routes = [];
for (const m of mounts) {
  const router = (await import(new URL('routes/' + imports[m.name], root).href)).default;
  if (!router?.stack) continue;
  const wide = [];
  for (const layer of router.stack) {
    if (!layer.route) { wide.push(layer.handle.name || 'anonymous'); continue; }
    const names = [...wide, ...layer.route.stack.map(s => s.handle.name || 'anonymous')];
    const who = names.includes('adminMiddleware') ? 'ADMIN' : names.includes('authMiddleware') ? 'USER' : 'PUBLIC';
    for (const method of Object.keys(layer.route.methods)) routes.push({ method: method.toUpperCase(), path: m.base + (layer.route.path === '/' ? '' : layer.route.path), who });
  }
}
const ID = '5f0000000000000000000000';
const urlOf = r => r.path.replace(/:\w+/g, ID);

section('THE LIST OF ROUTES');
check('the routes were read from the code', routes.length > 300, `${routes.length}`);
check('there are staff routes, customer routes and public routes', ['ADMIN', 'USER', 'PUBLIC'].every(k => routes.some(r => r.who === k)));

// Routes that answer without a sign-in, on purpose. A new one must be added here by a person who has thought about it.
const PUBLIC_OK = new Set([
  'GET /api/pricing', 'GET /api/pricing/quote', 'GET /api/pricing/quotes', 'GET /api/terms', 'GET /api/app-settings', 'GET /api/app-home/strings', 'GET /api/app-home/languages',
  'POST /api/auth/signup', 'POST /api/auth/login', 'POST /api/auth/2fa/verify', 'POST /api/auth/device/send', 'POST /api/auth/device/verify', 'POST /api/auth/forgot-password', 'POST /api/auth/reset-password',
  'GET /api/loans/statement-view', 'GET /api/esign/pdf',
  'GET /api/kyc/digilocker/callback', 'GET /api/kyc/digilocker/sandbox/:id', 'POST /api/kyc/digilocker/sandbox/:id',
  'GET /api/income-check/callback', 'GET /api/income-check/sandbox/:id', 'POST /api/income-check/sandbox/:id',
  'GET /api/esign/callback', 'GET /api/esign/sandbox/:id', 'POST /api/esign/sandbox/:id',
  'GET /api/pay/callback', 'GET /api/pay/sandbox/:id', 'POST /api/pay/sandbox/:id',
  'GET /api/mandates/sandbox/:id', 'POST /api/mandates/sandbox/:id',
  'POST /api/payments/webhook/razorpay', 'POST /api/emi/webhook/razorpay',
  'POST /api/partner/login', 'GET /api/partner/me', 'POST /api/partner/change-password',
]);
const open = routes.filter(r => r.who === 'PUBLIC');
check('no route is open to the public by accident', open.every(r => PUBLIC_OK.has(`${r.method} ${r.path}`)), open.filter(r => !PUBLIC_OK.has(`${r.method} ${r.path}`)).map(r => `${r.method} ${r.path}`).join(', '));
check('and the list above has no route that no longer exists', [...PUBLIC_OK].every(k => open.some(r => `${r.method} ${r.path}` === k)), [...PUBLIC_OK].filter(k => !open.some(r => `${r.method} ${r.path}` === k)).join(', '));

const srv = await startServer(DB, {});
const base = srv.base.replace(/\/api$/, '');
const hit = async (r, token) => {
  const res = await fetch(base + urlOf(r), { method: r.method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: r.method === 'GET' || r.method === 'HEAD' ? undefined : '{}', redirect: 'manual' });
  await res.arrayBuffer().catch(() => {});
  return res.status;
};
const customer = await User.create({ firstName: 'Ac', lastName: 'Cust', email: 'acc@x.in', phone: '9790000001', password: 'Blue-Lantern-42', kycStatus: 'approved', phoneVerified: true });
const customerToken = await tokenFor(customer);

section('STAFF ROUTES WITHOUT A STAFF SIGN-IN');
const staffRoutes = routes.filter(r => r.who === 'ADMIN');
let noToken = [], asCustomer = [], badToken = [];
for (const r of staffRoutes) {
  const a = await hit(r, null); if (a !== 401) noToken.push(`${r.method} ${r.path} -> ${a}`);
  const b = await hit(r, customerToken); if (b !== 403) asCustomer.push(`${r.method} ${r.path} -> ${b}`);
  const c = await hit(r, 'not.a.token'); if (c !== 401) badToken.push(`${r.method} ${r.path} -> ${c}`);
}
check(`all ${staffRoutes.length} staff routes refuse a visitor with no sign-in (401)`, noToken.length === 0, noToken.slice(0, 5).join('; '));
check('all of them refuse an ordinary customer (403)', asCustomer.length === 0, asCustomer.slice(0, 5).join('; '));
check('all of them refuse a made-up token (401)', badToken.length === 0, badToken.slice(0, 5).join('; '));

section('CUSTOMER ROUTES WITHOUT A SIGN-IN');
const userRoutes = routes.filter(r => r.who === 'USER');
const open401 = [];
for (const r of userRoutes) { const s = await hit(r, null); if (s !== 401) open401.push(`${r.method} ${r.path} -> ${s}`); }
check(`all ${userRoutes.length} customer routes refuse a visitor with no sign-in (401)`, open401.length === 0, open401.slice(0, 5).join('; '));
const badUser = [];
for (const r of userRoutes.slice(0, 80)) { const s = await hit(r, 'not.a.token'); if (s !== 401) badUser.push(`${r.method} ${r.path} -> ${s}`); }
check('and a made-up token (401)', badUser.length === 0, badUser.slice(0, 5).join('; '));

section('TOKENS THAT ARE NOT SESSIONS');
const profile = { method: 'GET', path: '/api/users/profile' }, adminRoute = { method: 'GET', path: '/api/admin/lms/active' };
const secret = process.env.JWT_SECRET;
const good = jwt.sign({ userId: String(customer._id), email: customer.email, iatMs: Date.now() }, secret, { algorithm: 'HS256', expiresIn: '1h' });
check('a proper token works', (await hit(profile, good)) === 200);
check('a token signed another way (HS512) is refused, even with the right secret', (await hit(profile, jwt.sign({ userId: String(customer._id), email: customer.email, iatMs: Date.now() }, secret, { algorithm: 'HS512', expiresIn: '1h' }))) === 401);
const unsigned = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ userId: String(customer._id), email: customer.email, iatMs: Date.now() })).toString('base64url') + '.';
check('a token with no signature at all ("alg none") is refused', (await hit(profile, unsigned)) === 401);
check('a token signed with the wrong secret is refused', (await hit(profile, jwt.sign({ userId: String(customer._id), email: customer.email }, 'some-other-secret-value', { algorithm: 'HS256' }))) === 401);
check('an expired token is refused', (await hit(profile, jwt.sign({ userId: String(customer._id), email: customer.email, iatMs: Date.now() }, secret, { algorithm: 'HS256', expiresIn: -10 }))) === 401);
check('a one-purpose token (such as the 5-minute statement link) is not a session', (await hit(profile, jwt.sign({ userId: String(customer._id), purpose: 'statement', loanId: ID }, secret, { algorithm: 'HS256', expiresIn: '5m' }))) === 401);
check('a customer token that claims to be staff is still refused on staff routes (the database decides, not the token)', (await hit(adminRoute, jwt.sign({ userId: String(customer._id), email: customer.email, isAdmin: true, role: 'super_admin', iatMs: Date.now() }, secret, { algorithm: 'HS256', expiresIn: '1h' }))) === 403);
check('a token for an account that does not exist is refused', (await hit(profile, jwt.sign({ userId: ID, email: 'ghost@x.in', iatMs: Date.now() }, secret, { algorithm: 'HS256', expiresIn: '1h' }))) === 401);
await User.updateOne({ _id: customer._id }, { passwordChangedAt: new Date(Date.now() + 5000) });
check('a token made before a password change stops working at once', (await hit(profile, good)) === 401);
await User.updateOne({ _id: customer._id }, { $unset: { passwordChangedAt: 1 }, status: 'inactive' });
check('a deactivated account is refused', (await hit(profile, good)) === 403);

await srv.stop();
await disconnect();
finish();
