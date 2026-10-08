import { check, section, connect, disconnect, startServer, finish, makeAdmin, client } from '../lib.mjs';

const DB = 'fintech-test-app-lock';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

section('THE APP READS THE LOCK RULES');
const pub = await call('GET', '/app-settings', null);
check('by default customers may choose a PIN, the app locks after 30 seconds and signs out after 15 idle minutes', pub.s === 200 && pub.d.security.appLock === 'optional' && pub.d.security.lockAfterSeconds === 30 && pub.d.security.idleLogoutMinutes === 15, JSON.stringify(pub.d.security));

section('STAFF CHANGE THEM');
const cur = (await call('GET', '/app-settings/admin', admin)).d.settings;
const save = security => call('PUT', '/app-settings/admin', admin, { ...cur, security });
const ok = await save({ appLock: 'required', lockAfterSeconds: 0, idleLogoutMinutes: 5 });
check('a PIN can be made compulsory', ok.s === 200 && ok.d.settings.security.appLock === 'required' && ok.d.settings.security.lockAfterSeconds === 0);
check('the app sees it at once', (await call('GET', '/app-settings', null)).d.security.idleLogoutMinutes === 5);
check('a silly value is refused (400)', (await save({ appLock: 'required', lockAfterSeconds: 99999, idleLogoutMinutes: 5 })).s === 400);
check('an unknown mode falls back to the default', (await save({ appLock: 'sometimes', lockAfterSeconds: 30, idleLogoutMinutes: 15 })).d.settings.security.appLock === 'optional');
check('"never sign out" is allowed (0)', (await save({ appLock: 'off', lockAfterSeconds: 30, idleLogoutMinutes: 0 })).d.settings.security.idleLogoutMinutes === 0);
check('a customer cannot change it (403)', (await call('PUT', '/app-settings/admin', null, { ...cur })).s === 401);

await disconnect();
finish();
