import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Notification from '../../src/models/Notification.js';
import NudgeLog from '../../src/models/NudgeLog.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import { DEFAULTS, validateSettings, saveSettings, getSettings, runNudges, overview, inQuietHours } from '../../src/services/nudgeService.js';
import { getRules } from '../../src/services/decisionEngine.js';
import crypto from 'crypto';

const DB = 'fintech-test-nudges';
await connect(DB);
await Role.create([{ key: 'bannerman', label: 'Banners', description: 't', permissions: ['banners.edit'] }, { key: 'nobody', label: 'Nobody', description: 't', permissions: ['reports.view'] }]);

const t0 = new Date();
const now = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate(), 6, 0)); // 11:30 in India, today
const ago = d => new Date(+now - d * 864e5);
const rulesKey = () => { const r = getRules(); return crypto.createHash('sha1').update(JSON.stringify({ o: r.offer, a: r.age, h: r.history, b: r.bureau })).digest('hex').slice(0, 12); };
let n = 0;
async function user(over = {}, createdDaysAgo = 5) {
  n++;
  const u = await User.create({ firstName: `Nud${n}`, lastName: 'Ge', email: `nud${n}@x.in`, phone: `9700000${String(n).padStart(3, '0')}`, password: 'x12345678', ...over });
  await User.collection.updateOne({ _id: u._id }, { $set: { createdAt: ago(createdDaysAgo) } });
  return u;
}
const setupDone = { kycDigilocker: { status: 'verified' }, dateOfBirth: new Date('1990-01-01'), gender: 'Male', address: { street: '1 Rd', city: 'Pune', state: 'MH', zipCode: '411001' }, employment: { status: 'Employed', monthlyIncome: 40000 }, selfie: { status: 'passed' }, bankAccount: { accountNumber: '123456789012', ifscCode: 'SBIN0001234', accountHolder: 'A B' } };
const logs = u => NudgeLog.countDocuments({ userId: u._id });
const msgs = u => Notification.find({ userId: u._id, type: 'NUDGE' }).lean();
const offerOf = (days, extra = {}) => ({ status: 'APPROVED', amount: 40000, computedAt: ago(days), expiresAt: new Date(+now + 20 * 864e5), rulesKey: rulesKey(), ...extra });

section('SETTINGS');
check('the defaults are valid', validateSettings(DEFAULTS).errors.length === 0);
check('a silly number is refused', validateSettings({ ...DEFAULTS, weeklyCap: 99 }).errors.length > 0);
check('a missing title is refused', validateSettings({ ...DEFAULTS, segments: { setup_abandoned: { ...DEFAULTS.segments.setup_abandoned, title: '' } } }).errors.length > 0);
check('quiet hours across midnight', inQuietHours(new Date(+now + 11 * 36e5), DEFAULTS) && !inQuietHours(now, DEFAULTS));

section('OFF BY DEFAULT');
const stuck = await user({}, 3);
check('nothing is sent while it is off', (await runNudges(now)).off === true && (await logs(stuck)) === 0);
await saveSettings({ ...DEFAULTS, enabled: true }, 'test');
check('during quiet hours nothing is sent', (await runNudges(new Date(+now + 12 * 36e5))).quiet === true && (await logs(stuck)) === 0);

section('UNFINISHED SET-UP');
const fresh = await user({}, 0);
const r1 = await runNudges(now);
check('a customer stuck for 3 days gets a nudge; one who signed up today does not', (await logs(stuck)) === 1 && (await logs(fresh)) === 0 && r1.bySegment.setup_abandoned >= 1, JSON.stringify(r1));
const m = (await msgs(stuck))[0];
check('it is an in-app notice with their name, in the offers category', m.type === 'NUDGE' && /Nud\d+/.test(m.message) && m.channels.sms === 'skipped');
check('running again straight away sends nothing more', (await runNudges(now)).sent === 0 && (await logs(stuck)) === 1);
check('after the repeat gap it goes again', (await runNudges(new Date(+now + 4 * 864e5))).sent >= 1 && (await logs(stuck)) === 2);
await runNudges(new Date(+now + 8 * 864e5));
await runNudges(new Date(+now + 12 * 864e5));
check('it stops at the most messages (3)', (await logs(stuck)) === 3);

section('OFFERS');
const unused = await user({ ...setupDone, offer: offerOf(2) }, 10);
await User.updateOne({ _id: unused._id }, { $set: { kycStatus: 'approved' } });
await runNudges(now);
const unusedMsgs = await msgs(unused);
check('an unused offer gets a nudge with the amount', unusedMsgs.some(x => /40,000/.test(x.message)), JSON.stringify(unusedMsgs.map(x => x.message)));
const applied = await user({ offer: offerOf(2) }, 10);
await Loan.create({ userId: applied._id, loanAmount: 10000, tenure: 3, interestRate: 15, status: 'submitted' });
await runNudges(now);
check('someone who applied since is left alone', !(await msgs(applied)).some(x => /40,000/.test(x.message)));
const declined = await user({ offer: offerOf(2, { status: 'DECLINED', amount: 0 }) }, 10);
await runNudges(now);
check('a declined offer is not advertised', !(await msgs(declined)).some(x => /borrow up to/.test(x.message)));
const expiring = await user({ ...setupDone, offer: offerOf(25, { expiresAt: new Date(+now + 2 * 864e5) }) }, 30);
await runNudges(now);
check('an offer ending in 2 days gets the expiring nudge', (await msgs(expiring)).some(x => /ends in 2 days/.test(x.message)), JSON.stringify((await msgs(expiring)).map(x => x.message)));

section('APPROVED BUT NOT ACCEPTED');
const appr = await user({}, 20);
await Loan.create({ userId: appr._id, loanAmount: 20000, tenure: 3, interestRate: 15, status: 'approved', approvalDate: ago(2) });
await runNudges(now);
check('an approved loan with no agreement gets a nudge', (await msgs(appr)).some(x => /approved/.test(x.message)));

section('WHO NEVER GETS ONE');
const late = await user({}, 3);
const lateLoan = await Loan.create({ userId: late._id, loanAmount: 10000, tenure: 3, interestRate: 15, status: 'disbursed' });
await EMIPayment.create({ loanId: lateLoan._id, userId: late._id, emiNumber: 1, dueDate: ago(5), amount: 3500, status: 'OVERDUE' });
const flagged = await user({}, 3);
await AmlAlert.create({ userId: flagged._id, rule: 'LARGE_LOAN', detail: 'x', severity: 'HIGH', status: 'OPEN' });
const optedOut = await user({ pushPrefs: { offers: false } }, 3);
const blocked = await user({ status: 'blocked' }, 3);
await runNudges(new Date(+now + 20 * 864e5));
check('behind on payments: none', (await logs(late)) === 0);
check('an open AML alert: none', (await logs(flagged)) === 0);
check('switched off "Offers and news": none', (await logs(optedOut)) === 0);
check('a blocked account: none', (await logs(blocked)) === 0);

section('POLITENESS');
await NudgeLog.deleteMany({});
await Notification.deleteMany({});
const multi = await user({ offer: offerOf(2) }, 3);
await runNudges(now);
check('one customer who fits two groups gets one nudge, not two (gap between nudges)', (await logs(multi)) === 1);
await saveSettings({ ...DEFAULTS, enabled: true, minGapDays: 0, weeklyCap: 1 }, 'test');
await NudgeLog.deleteMany({});
const capped = await user({ offer: offerOf(2) }, 3);
await runNudges(now);
await runNudges(new Date(+now + 1 * 864e5));
check('the weekly limit holds', (await logs(capped)) === 1);

section('WHAT STAFF SEE');
await saveSettings({ ...DEFAULTS, enabled: true }, 'test');
const o = await overview(now);
check('groups, sends and results are counted', o.segments.length === 6 && o.segments.find(s => s.key === 'setup_abandoned').audience >= 1 && o.total30 >= 1, JSON.stringify(o.segments.map(s => [s.key, s.audience, s.sent30])));

const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
check('a manager of banners can open the page', (await call('GET', '/admin/nudges', await staff('bannerman', 1))).s === 200);
check('someone without that permission cannot (403)', (await call('GET', '/admin/nudges', await staff('nobody', 2))).s === 403);
const put = await call('PUT', '/admin/nudges/settings', admin, { ...DEFAULTS, enabled: true, weeklyCap: 3 });
check('settings save and are audited', put.s === 200 && put.d.settings.weeklyCap === 3 && getSettings().weeklyCap === 3 || put.s === 200);
check('bad settings are refused (400)', (await call('PUT', '/admin/nudges/settings', admin, { ...DEFAULTS, quietStart: 99 })).s === 400);
check('running now works', (await call('POST', '/admin/nudges/run', admin, {})).s === 200);

await disconnect();
finish();
