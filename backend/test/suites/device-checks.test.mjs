import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor } from '../lib.mjs';
import User from '../../src/models/User.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import DeviceBinding from '../../src/models/DeviceBinding.js';

const DB = 'fintech-test-device';
await connect(DB);
const srv = await startServer(DB, { FRAUD_SHARED_IP_ACCOUNTS: '3' });
const { token: admin } = await makeAdmin();

const call = async (method, path, token, body, headers = {}) => {
  const r = await fetch(srv.base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
let n = 0;
const signup = (id, ip) => {
  n++;
  return call('POST', '/auth/signup', null, { firstName: `Dev${n}`, lastName: 'Ice', email: `dev${n}@x.in`, phone: `98400000${String(n).padStart(2, '0')}`, password: 'password123', confirmPassword: 'password123' }, { ...(id ? { 'X-Install-Id': id } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}), 'X-Platform': 'android', 'X-App-Version': '1.0.0' });
};
const login = (email, id) => call('POST', '/auth/login', null, { email, password: 'password123' }, id ? { 'X-Install-Id': id } : {});
const alerts = rule => AmlAlert.find({ rule }).lean();

section('ONE PHONE, ONE ACCOUNT');
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const s1 = await signup(A, '10.0.0.1');
check('signing up records the phone', s1.s === 201 && (await DeviceBinding.countDocuments({ installId: A })) === 1);
check('no alert for a single account', (await AmlAlert.countDocuments()) === 0);
const s2 = await signup(A, '10.0.0.2');
check('a second account on the same phone raises an alert for both', s2.s === 201 && (await alerts('SHARED_DEVICE')).length === 2);
const sd = await alerts('SHARED_DEVICE');
check('it is a high-severity review item with a plain explanation', sd.every(a => a.severity === 'HIGH' && /same phone/i.test(a.detail)), JSON.stringify(sd[0]));
await login('dev1@x.in', A);
check('logging in again does not pile up alerts', (await alerts('SHARED_DEVICE')).length === 2);
const noId = await signup(null, null);
check('a request without an id is fine and records nothing', noId.s === 201 && (await DeviceBinding.countDocuments({ userId: noId.d.user.id })) === 0);
check('a made-up id is ignored', (await signup('short', null)).s === 201 && (await DeviceBinding.countDocuments({ installId: 'short' })) === 0);

section('MANY ACCOUNTS FROM ONE ADDRESS');
await signup('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '10.0.0.9');
await signup('cccccccccccccccccccccccccccccccc', '10.0.0.9');
check('two accounts from one address: nothing yet', (await alerts('SHARED_IP')).length === 0);
await signup('dddddddddddddddddddddddddddddddd', '10.0.0.9');
check('the third (limit 3) raises a medium alert', (await alerts('SHARED_IP')).some(a => a.severity === 'MEDIUM'), JSON.stringify(await alerts('SHARED_IP')));

section('A NEW PHONE AT APPLICATION TIME');
const u = await User.findOne({ email: 'dev1@x.in' });
await DeviceBinding.updateOne({ installId: A, userId: u._id }, { firstSeenAt: new Date(Date.now() - 30 * 864e5) });
const tok = await tokenFor(u);
const apply = id => call('POST', '/loans/apply', tok, { loanAmount: 5000, tenure: 3, purpose: 'Personal' }, { 'X-Install-Id': id });
await apply('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
check('applying from a phone not seen before raises a review item', (await alerts('NEW_DEVICE')).length === 1);
const sameBefore = (await alerts('NEW_DEVICE')).length;
await apply(A);
check('applying from the usual phone does not', (await alerts('NEW_DEVICE')).length === sameBefore);

section('WHAT STAFF SEE');
const detail = await call('GET', `/admin/customers/${u._id}`, admin);
check('the customer record lists the phones, and flags sharing', detail.s === 200 && detail.d.customer.devices.length >= 1 && detail.d.customer.devices.some(d => d.otherAccounts >= 1), JSON.stringify(detail.d.customer.devices));
const list = await call('GET', '/admin/compliance/aml/alerts', admin);
check('the alerts are in the compliance list', list.s === 200 && JSON.stringify(list.d).includes('SHARED_DEVICE'));

await disconnect();
finish();
