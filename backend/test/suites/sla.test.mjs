import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import SupportThread from '../../src/models/SupportThread.js';
import CallbackRequest from '../../src/models/CallbackRequest.js';
import DataRequest from '../../src/models/DataRequest.js';
import AgreementAcceptance from '../../src/models/AgreementAcceptance.js';
import SlaEscalation from '../../src/models/SlaEscalation.js';
import { report, escalate, saveSettings, validateSettings, DEFAULTS } from '../../src/services/slaService.js';

const DB = 'fintech-test-sla';
await connect(DB);
await Role.create([{ key: 'repview', label: 'R', description: 't', permissions: ['reports.view'] }, { key: 'nobody', label: 'N', description: 't', permissions: ['loans.view'] }]);
const hrs = h => new Date(Date.now() - h * 36e5);
const q = (r, k) => r.queues.find(x => x.key === k);

section('TARGETS');
check('the defaults are valid', validateSettings(DEFAULTS).errors.length === 0);
check('a silly target is refused', validateSettings({ hours: { support: 0 } }).errors.length > 0 && validateSettings({ hours: { support: 9999 } }).errors.length > 0);
check('a bad alert address is refused', validateSettings({ alertEmail: 'not an email' }).errors.length > 0);

const u = async n => User.create({ firstName: `Sla${n}`, lastName: 'User', email: `sla${n}@x.in`, phone: `9300000${String(n).padStart(3, '0')}`, password: 'x12345678', role: 'customer' });
const c1 = await u(1), c2 = await u(2), c3 = await u(3), c4 = await u(4);

section('WHAT IS WAITING');
check('nothing is waiting at the start', (await report()).totals.waiting === 0);
// support: one late (6h, target 4h), one close (3.5h), one fine (1h), one the assistant is still handling
const th = (user, h, over = {}) => SupportThread.create({ userId: user._id, subject: 'Help', status: 'open', lastFrom: 'customer', lastMessageAt: hrs(h), bot: { active: false }, messages: [{ from: 'customer', text: 'hi' }], ...over });
await th(c1, 6); await th(c2, 3.5); await th(c3, 1); await th(c4, 20, { bot: { active: true } });
await SupportThread.create({ userId: c1._id, subject: 'Replied', status: 'open', lastFrom: 'staff', lastMessageAt: hrs(30), bot: { active: false }, messages: [{ from: 'staff', text: 'ok' }] });
let r = await report();
const sp = q(r, 'support');
check('messages are late, close to the limit, or fine; the assistant\'s and answered ones are not counted', sp.waiting === 3 && sp.late === 1 && sp.soon === 1 && sp.items[0].state === 'late' && sp.items[0].hoursOver === 2, JSON.stringify(sp.items.map(i => [i.state, i.hoursOver])));
check('the worst comes first', sp.items[0].waitingHours >= sp.items[1].waitingHours);

await Loan.create({ userId: c1._id, loanAmount: 20000, tenure: 3, interestRate: 15, status: 'submitted', createdAt: hrs(30) });
await Loan.collection.updateOne({ userId: c1._id }, { $set: { createdAt: hrs(30) } });
const signedLoan = await Loan.create({ userId: c2._id, loanAmount: 15000, tenure: 3, interestRate: 15, status: 'approved' });
await AgreementAcceptance.create({ loanId: signedLoan._id, userId: c2._id, version: 'v2', hash: 'h', text: 't', acceptedAt: hrs(5) });
await Loan.create({ userId: c3._id, loanAmount: 15000, tenure: 3, interestRate: 15, status: 'approved' }); // approved, not signed: waiting on the customer, not the team
r = await report();
check('an application older than 24 hours is late', q(r, 'loanReview').late === 1 && q(r, 'loanReview').waiting === 1);
check('a signed loan not paid out within 4 hours is late; an unsigned one is not the team\'s wait', q(r, 'payout').waiting === 1 && q(r, 'payout').late === 1);

await User.updateOne({ _id: c4._id }, { kycStatus: 'pending', 'kycDigilocker.status': 'review', 'kycDigilocker.at': hrs(30) });
check('a KYC check waiting more than 24 hours is late', q(await report(), 'kyc').late === 1);

await CallbackRequest.create({ userId: c1._id, phone: c1.phone, topic: 'loan', day: 'today', slot: 'morning', status: 'open' });
await CallbackRequest.collection.updateOne({ userId: c1._id }, { $set: { createdAt: hrs(60) } });
check('a call-back whose slot has long ended is late', q(await report(), 'callback').late === 1);
const fresh = await CallbackRequest.create({ userId: c2._id, phone: c2.phone, topic: 'loan', day: 'tomorrow', slot: 'evening', status: 'open' });
check('a call-back for tomorrow evening is fine', q(await report(), 'callback').waiting === 2 && q(await report(), 'callback').late === 1, String(fresh._id));

await DataRequest.create({ userId: c1._id, type: 'DELETE', status: 'OPEN' });
await DataRequest.collection.updateOne({ userId: c1._id }, { $set: { createdAt: hrs(24 * 10) } });
check('a data request older than 7 days is late', q(await report(), 'requests').late === 1);

section('REPORTING LATE ITEMS');
await saveSettings({ ...DEFAULTS, alertEmail: 'managers@x.in' }, 'test');
const e1 = await escalate();
const lateNow = (await report()).totals.late;
check('every late item is reported once', e1.newlyLate === lateNow && (await SlaEscalation.countDocuments()) === lateNow, `${e1.newlyLate} ${lateNow}`);
check('running again reports nothing new', (await escalate()).newlyLate === 0);
await th(await u(5), 9);
check('a newly late item is reported on the next run', (await escalate()).newlyLate === 1);
await saveSettings({ ...DEFAULTS, enabled: false }, 'test');
await th(await u(6), 12);
check('switched off, nothing is reported', (await escalate()).newlyLate === 0);

section('STAFF');
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const viewer = await staff('repview', 1), nobody = await staff('nobody', 2);
const page = await call('GET', '/admin/sla', viewer);
check('a manager sees the queues and totals', page.s === 200 && page.d.queues.length === 6 && page.d.totals.late >= 1 && page.d.canEdit === false);
check('someone without reports access cannot (403)', (await call('GET', '/admin/sla', nobody)).s === 403);
check('a viewer cannot change targets (403)', (await call('PUT', '/admin/sla/settings', viewer, DEFAULTS)).s === 403);
check('the super admin can, and a bad value is refused', (await call('PUT', '/admin/sla/settings', admin, { ...DEFAULTS, hours: { ...DEFAULTS.hours, support: 2 } })).s === 200 && (await call('PUT', '/admin/sla/settings', admin, { hours: { support: -1 } })).s === 400);

await disconnect();
finish();
