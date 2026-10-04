import { check, section, connect, disconnect, startServer, finish, client } from '../lib.mjs';
import AuditLog from '../../src/models/AuditLog.js';
import User from '../../src/models/User.js';

const DB = 'fintech-test-bootstrap';
await connect(DB);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The same database is used across restarts, like a real deployment.
let srv;
const boot = async env => { if (srv) await srv.stop(); srv = await startServer(DB, env); return client(srv.base); };
const login = (call, password) => call('POST', '/auth/login', null, { email: 'admin@lifc.in', password });

section('FRESH DATABASE, VARIABLE SET: ADMIN IS CREATED');
let call = await boot({ ADMIN_RESET_PASSWORD: 'First-Admin-Pass-1' });
check('server logged that it created the admin, and not the password', /was created/.test(srv.logs()) && !srv.logs().includes('First-Admin-Pass-1'));
const first = await login(call, 'First-Admin-Pass-1');
check('the admin can sign in', first.s === 200);
check('and the token works on an admin-only route', (await call('GET', '/admin/compliance/audit', first.d.token)).s === 200);
check('a customer-style wrong password is refused', (await login(call, 'wrong-password-1')).s === 400);

section('RESTART WITH A DIFFERENT VALUE: PASSWORD CHANGES');
await sleep(1100); // tokens are timestamped in whole seconds
call = await boot({ ADMIN_RESET_PASSWORD: 'Second-Admin-Pass-2' });
check('the old password stops working', (await login(call, 'First-Admin-Pass-1')).s === 400);
const second = await login(call, 'Second-Admin-Pass-2');
check('the new password works', second.s === 200);
check('the session from before the change is signed out', (await call('GET', '/admin/compliance/audit', first.d.token)).s === 401);
check('the new session works', (await call('GET', '/admin/compliance/audit', second.d.token)).s === 200);
check('the log says the account was updated', /was updated/.test(srv.logs()));

section('VARIABLE REMOVED: NOTHING CHANGES');
call = await boot({});
check('no admin message in the log', !/Admin account/.test(srv.logs()));
check('the password still works', (await login(call, 'Second-Admin-Pass-2')).s === 200);

section('VARIABLE TOO SHORT: IGNORED');
call = await boot({ ADMIN_RESET_PASSWORD: 'short' });
check('server warns that it was ignored', /ignored/.test(srv.logs()));
check('the existing password is untouched', (await login(call, 'Second-Admin-Pass-2')).s === 200);
check('the short value is not a password', (await login(call, 'short')).s === 400);

section('RESET ALSO LIFTS A LOCKOUT AND TURNS TWO-FACTOR OFF');
call = await boot({});
for (let i = 0; i < 5; i++) await login(call, 'wrong-wrong-1');
check('five wrong passwords lock the admin out (even a right password is refused)', (await login(call, 'Second-Admin-Pass-2')).s === 429);
await User.updateOne({ email: 'admin@lifc.in' }, { twoFactorEnabled: true, twoFactorSecret: 'planted' });
call = await boot({ ADMIN_RESET_PASSWORD: 'Fourth-Admin-Pass-4' });
const back = await login(call, 'Fourth-Admin-Pass-4');
check('the reset gets the admin back in, with no code asked for', back.s === 200 && !!back.d.token && !back.d.twoFactorRequired, JSON.stringify(back.d));
const adm = await User.findOne({ email: 'admin@lifc.in' }).select('+twoFactorSecret');
check('two-factor is switched off and its secret removed', adm.twoFactorEnabled === false && !adm.twoFactorSecret);

section('AUDIT TRAIL');
const actions = (await AuditLog.find().sort({ seq: 1 })).map(e => e.action);
check('creation and reset were recorded', actions.includes('ADMIN_CREATED') && actions.includes('ADMIN_PASSWORD_RESET'), actions.join());
check('no password appears anywhere in the audit log', !JSON.stringify(await AuditLog.find().lean()).includes('Admin-Pass'));

await srv.stop();
await disconnect();
finish();
