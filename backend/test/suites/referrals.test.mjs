import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import Referral from '../../src/models/Referral.js';
import ReferralReward from '../../src/models/ReferralReward.js';
import Notification from '../../src/models/Notification.js';

const DB = 'fintech-test-referrals';
await connect(DB);
await Role.create([
  { key: 'refviewer', label: 'Viewer', description: 't', permissions: ['referrals.view'] },
  { key: 'refmanager', label: 'Manager', description: 't', permissions: ['referrals.view', 'referrals.manage'] },
]);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const bank = { accountHolder: 'R', accountNumber: '123456789012', ifscCode: 'SBIN0001234', bankName: 'SBI' };
const mk = (n, over = {}) => User.create({ firstName: `Cust${n}`, lastName: 'Ref', email: `r${n}@x.in`, phone: `98100000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', bankAccount: bank, ...over });
const staff = async (role, n) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}${n}@lifc.in`, phone: `97100000${n}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const signup = (n, extra = {}) => call('POST', '/auth/signup', null, { firstName: `New${n}`, lastName: 'Friend', email: `new${n}@x.in`, phone: `98200000${String(n).padStart(2, '0')}`, password: 'password123', confirmPassword: 'password123', ...extra });

const referrer = await mk(1);
const tR = await tokenFor(referrer);

section('THE PROGRAMME IS OFF UNTIL STAFF TURN IT ON');
const off = await call('GET', '/referrals/me', tR);
check('a customer sees it is off and has no code', off.s === 200 && off.d.enabled === false && off.d.code === null);
check('a code is refused while it is off (400)', (await signup(1, { referralCode: 'LIFCABC234' })).s === 400);
check('signing up without a code still works', (await signup(2)).s === 201);

section('STAFF SET THE RULES');
check('a customer cannot change them (403)', (await call('PUT', '/admin/referrals/settings', tR, { enabled: true })).s === 403);
const viewer = await staff('refviewer', 1), manager = await staff('refmanager', 2);
check('a viewer can look but not change (403)', (await call('GET', '/admin/referrals', viewer)).s === 200 && (await call('PUT', '/admin/referrals/settings', viewer, { enabled: true })).s === 403);
check('a reward of zero on both sides cannot be switched on (400)', (await call('PUT', '/admin/referrals/settings', manager, { enabled: true, referrerReward: 0, refereeReward: 0 })).s === 400);
check('a silly waiting period is refused (400)', (await call('PUT', '/admin/referrals/settings', manager, { holdDays: 9999 })).s === 400);
const on = await call('PUT', '/admin/referrals/settings', manager, { enabled: true, referrerReward: 150, refereeReward: 100, minLoanAmount: 5000, holdDays: 30, maxRewardsPerReferrer: 2 });
check('programme switched on', on.s === 200 && on.d.program.enabled && on.d.program.referrerReward === 150, JSON.stringify(on.d));

section('SHARING A CODE');
const me = await call('GET', '/referrals/me', tR);
check('the customer gets a code and share text', /^LIFC[A-Z2-9]{6}$/.test(me.d.code) && me.d.shareText.includes(me.d.code) && me.d.referrerReward === 150 && me.d.terms.length > 20, JSON.stringify(me.d).slice(0, 200));
check('the code stays the same', (await call('GET', '/referrals/me', tR)).d.code === me.d.code);
check('an unknown code is refused (400)', (await signup(3, { referralCode: 'LIFCZZZZZZ' })).d.code === 'REFERRAL_INVALID');
check('your own code cannot be used', (await signup(4, { referralCode: me.d.code, phone: referrer.phone, email: 'someoneelse@x.in' })).s === 400);
const friend1 = await signup(5, { referralCode: ` ${me.d.code.toLowerCase()} ` });
check('a friend signs up with the code (spaces and capitals do not matter)', friend1.s === 201, JSON.stringify(friend1.d));
const friend1User = await User.findOne({ email: 'new5@x.in' });
check('the link is recorded', String((await Referral.findOne({ refereeId: friend1User._id })).referrerId) === String(referrer._id) && String(friend1User.referredBy) === String(referrer._id));
check('the referrer sees the friend with a short name', (await call('GET', '/referrals/me', tR)).d.referrals[0].name === 'New5 F.' && (await call('GET', '/referrals/me', tR)).d.stats.invited === 1);

section('THE FRIEND TAKES A LOAN');
const lend = async (user, amount) => {
  const loan = await Loan.create({ userId: user._id, loanAmount: amount, tenure: 3, interestRate: 15, monthlyEMI: amount / 3, totalAmount: amount, status: 'approved' });
  await User.updateOne({ _id: user._id }, { bankAccount: bank, kycStatus: 'approved' });
  const r = await call('POST', `/admin/loans/${loan._id}/disburse`, admin, {});
  return { loan, r };
};
const small = await lend(friend1User, 3000);
check('a loan under the minimum does not start the clock', small.r.s === 200 && (await Referral.findOne({ refereeId: friend1User._id })).status === 'signed_up', JSON.stringify(small.r.d));
const big = await lend(friend1User, 12000);
const ref1 = await Referral.findOne({ refereeId: friend1User._id });
check('a qualifying loan starts the waiting period (30 days)', big.r.s === 200 && ref1.status === 'in_hold' && Math.round((ref1.eligibleAt - Date.now()) / 864e5) === 30 && String(ref1.loanId) === String(big.loan._id), JSON.stringify(big.r.d));
const early = await call('POST', '/admin/referrals/settle', manager, {});
check('settling early rewards nothing', early.s === 200 && early.d.rewarded === 0 && (await ReferralReward.countDocuments()) === 0);

section('REWARDS');
await Referral.updateOne({ _id: ref1._id }, { eligibleAt: day(-1) });
const settled = await call('POST', '/admin/referrals/settle', manager, {});
check('after the waiting period both are owed a reward', settled.d.rewarded === 1 && (await ReferralReward.countDocuments({ status: 'due' })) === 2, JSON.stringify(settled.d));
const rw = await ReferralReward.find().lean();
check('150 for the referrer and 100 for the friend', rw.find(r => r.role === 'referrer').amount === 150 && rw.find(r => r.role === 'referee').amount === 100);
check('both are told', (await Notification.countDocuments({ type: 'REFERRAL_REWARD' })) === 2);
await call('POST', '/admin/referrals/settle', manager, {});
check('settling again never pays twice', (await ReferralReward.countDocuments()) === 2);
check('the referrer sees what they earned', (await call('GET', '/referrals/me', tR)).d.stats.toBePaid === 150);
const list = await call('GET', '/admin/referrals', viewer);
const refRw = list.d.rewards.find(r => r.role === 'referrer');
check('staff see who is owed what, with the bank details they need (last 4 digits only)', list.d.money.due === 250 && refRw.bank.last4 === '9012' && !JSON.stringify(list.d).includes('123456789012'), JSON.stringify(refRw));
check('a viewer cannot mark paid (403)', (await call('POST', `/admin/referrals/rewards/${refRw.id}/paid`, viewer, { reference: 'UTR123456' })).s === 403);
check('paying needs a bank reference (400)', (await call('POST', `/admin/referrals/rewards/${refRw.id}/paid`, manager, { reference: 'x' })).s === 400);
check('marked paid', (await call('POST', `/admin/referrals/rewards/${refRw.id}/paid`, manager, { reference: 'UTR123456' })).s === 200);
check('paying twice is refused (409)', (await call('POST', `/admin/referrals/rewards/${refRw.id}/paid`, manager, { reference: 'UTR123456' })).s === 409);
check('the customer is told it was paid and sees it as paid', (await Notification.countDocuments({ type: 'REFERRAL_REWARD', title: 'Referral reward paid' })) === 1 && (await call('GET', '/referrals/me', tR)).d.stats.paid === 150);
const friendRw = list.d.rewards.find(r => r.role === 'referee');
check('cancelling needs a reason (400)', (await call('POST', `/admin/referrals/rewards/${friendRw.id}/void`, manager, {})).s === 400);
check('a reward can be cancelled with a reason', (await call('POST', `/admin/referrals/rewards/${friendRw.id}/void`, manager, { reason: 'Duplicate customer' })).s === 200);
check('a paid reward cannot be cancelled (409)', (await call('POST', `/admin/referrals/rewards/${refRw.id}/void`, manager, { reason: 'Mistake here' })).s === 409);

section('SAFEGUARDS');
const f2 = await User.findById((await signup(6, { referralCode: me.d.code })).d.user.id);
await lend(f2, 9000);
const r2 = await Referral.findOne({ refereeId: f2._id });
await AmlAlert.create({ userId: f2._id, rule: 'DUPLICATE_PAN', severity: 'HIGH', status: 'OPEN', detail: 'test' });
await Referral.updateOne({ _id: r2._id }, { eligibleAt: day(-1) });
const held = await call('POST', '/admin/referrals/settle', manager, {});
check('an open high-severity alert holds the reward rather than paying it', held.d.waiting === 1 && (await Referral.findById(r2._id)).status === 'in_hold');
await AmlAlert.updateMany({ userId: f2._id }, { status: 'CLEARED' });
await call('POST', '/admin/referrals/settle', manager, {});
check('once the alert is cleared the reward is owed', (await Referral.findById(r2._id)).status === 'rewarded');

const f3 = await User.findById((await signup(7, { referralCode: me.d.code })).d.user.id);
await lend(f3, 9000);
const r3 = await Referral.findOne({ refereeId: f3._id });
await Referral.updateOne({ _id: r3._id }, { eligibleAt: day(-1) });
await call('POST', '/admin/referrals/settle', manager, {});
check('the referrer limit (2) is respected: the third is cancelled with a reason', (await Referral.findById(r3._id)).status === 'void' && /limit of 2/.test((await Referral.findById(r3._id)).voidReason));

const f4 = await User.findById((await signup(8, { referralCode: (await call('GET', '/referrals/me', await tokenFor(await mk(9)))).d.code })).d.user.id);
const l4 = await lend(f4, 9000);
const r4 = await Referral.findOne({ refereeId: f4._id });
await Loan.updateOne({ _id: l4.loan._id }, { status: 'defaulted' });
await Referral.updateOne({ _id: r4._id }, { eligibleAt: day(-1) });
await call('POST', '/admin/referrals/settle', manager, {});
check('a loan that went overdue during the waiting period earns nothing', (await Referral.findById(r4._id)).status === 'void' && /overdue/.test((await Referral.findById(r4._id)).voidReason));

section('SWITCHED OFF AGAIN');
await call('PUT', '/admin/referrals/settings', manager, { enabled: false });
check('rewards stop being worked out and new codes are refused', (await call('POST', '/admin/referrals/settle', manager, {})).d.rewarded === 0 && (await signup(10, { referralCode: me.d.code })).s === 400);
const audit = JSON.stringify((await call('GET', '/admin/compliance/audit?limit=200', admin)).d);
check('every change is in the audit log', ['REFERRAL_PROGRAM_UPDATED', 'REFERRAL_CREATED', 'REFERRALS_SETTLED', 'REFERRAL_REWARD_PAID', 'REFERRAL_REWARD_VOIDED'].every(a => audit.includes(a)));

await srv.stop();
await disconnect();
finish();
