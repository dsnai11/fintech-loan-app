import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import LoyaltyAward from '../../src/models/LoyaltyAward.js';
import Notification from '../../src/models/Notification.js';
import { validateProgram, streakFor, afterPayment, saveProgram, DEFAULTS } from '../../src/services/rewardsService.js';
import { markEMIPaid } from '../../src/services/emiService.js';

const DB = 'fintech-test-rewards';
await connect(DB);
await Role.create([{ key: 'refviewer', label: 'Viewer', description: 't', permissions: ['referrals.view'] }]);

let n = 0;
async function customer(pattern) {
  // pattern: for each EMI, 'ok' (paid on time), 'late' (paid 5 days after), 'open' (not due yet), 'over' (overdue)
  n++;
  const user = await User.create({ firstName: `Rew${n}`, lastName: 'Ard', email: `rew${n}@x.in`, phone: `9200000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved' });
  const loan = await Loan.create({ userId: user._id, loanAmount: 60000, tenure: pattern.length, interestRate: 15, monthlyEMI: 10200, status: 'disbursed' });
  for (const [i, p] of pattern.entries()) {
    const due = day(-30 * (pattern.length - i));
    await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: i + 1, dueDate: p === 'open' ? day(10 + i) : due, amount: 10200, principalAmount: 10000, interestAmount: 200, status: p === 'open' ? 'PENDING' : p === 'over' ? 'OVERDUE' : 'PAID', paidDate: p === 'ok' ? new Date(+due - 864e5) : p === 'late' ? new Date(+due + 5 * 864e5) : undefined });
  }
  return { user, loan, token: await tokenFor(user) };
}

section('THE RULES');
check('the defaults are valid', validateProgram(DEFAULTS).errors.length === 0);
check('two milestones at the same count are refused', validateProgram({ ...DEFAULTS, milestones: [{ streak: 3, title: 'A', cashback: 0 }, { streak: 3, title: 'B', cashback: 0 }] }).errors.some(e => /Two milestones/.test(e)));
check('a huge cash reward is refused', validateProgram({ ...DEFAULTS, milestones: [{ streak: 3, title: 'A', cashback: 99999 }] }).errors.length > 0);
check('a nameless milestone is refused', validateProgram({ ...DEFAULTS, milestones: [{ streak: 3, title: '', cashback: 0 }] }).errors.length > 0);

section('COUNTING THE STREAK');
const a = await customer(['ok', 'ok', 'ok', 'open']);
check('three on-time EMIs in a row is a streak of 3', (await streakFor(a.user._id)).current === 3);
const b = await customer(['ok', 'late', 'ok', 'ok']);
const sb = await streakFor(b.user._id);
check('a late payment ends the run; the run after it counts, and the best is kept', sb.current === 2 && sb.best === 2 && sb.onTime === 3);
const c = await customer(['ok', 'ok', 'over']);
check('an EMI overdue now ends the streak', (await streakFor(c.user._id)).current === 0);
const d = await customer(['ok', 'ok', 'ok', 'ok']);
await EMIPayment.updateOne({ loanId: d.loan._id, emiNumber: 4 }, { paidDate: new Date(+(await EMIPayment.findOne({ loanId: d.loan._id, emiNumber: 4 })).dueDate + 0.5 * 864e5) });
check('paying within the grace day still counts', (await streakFor(d.user._id)).current === 4);

section('BADGES');
check('nothing is given while the programme is off', (await afterPayment(a.user._id)).length === 0 && (await LoyaltyAward.countDocuments()) === 0);
await saveProgram({ enabled: true, graceDays: 1, milestones: [{ streak: 3, title: 'On-time starter', cashback: 0 }, { streak: 4, title: 'Gold', cashback: 50 }] }, 'test');
const g1 = await afterPayment(a.user._id);
check('three in a row earns the first badge, with a notice', g1.length === 1 && g1[0].title === 'On-time starter' && (await Notification.countDocuments({ userId: a.user._id, type: 'REWARD' })) === 1);
check('it is given only once', (await afterPayment(a.user._id)).length === 0 && (await LoyaltyAward.countDocuments({ userId: a.user._id })) === 1);
const g4 = await afterPayment(d.user._id);
check('four in a row earns both, and the cash one is marked due', g4.length === 2 && (await LoyaltyAward.findOne({ userId: d.user._id, key: 'streak-4' })).status === 'due');
const live = await customer(['ok', 'ok', 'open']);
await markEMIPaid(await EMIPayment.findOne({ loanId: live.loan._id, emiNumber: 3 }), 'pay_1', 10200);
const lp = await LoyaltyAward.findOne({ userId: live.user._id });
check('paying the third EMI really does hand out the badge (it is wired into payments)', !!lp && lp.key === 'streak-3', JSON.stringify(lp));

const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

section('THE CUSTOMER SCREEN');
const me = await call('GET', '/rewards/me', a.token);
check('streak, badges and the next goal are shown', me.s === 200 && me.d.enabled && me.d.streak === 3 && me.d.badges.length === 1 && me.d.next.streak === 4 && me.d.next.toGo === 1 && me.d.next.cashback === 50, JSON.stringify(me.d).slice(0, 250));
check('login needed (401)', (await call('GET', '/rewards/me', null)).s === 401);

section('STAFF');
const viewer = await tokenFor(await User.create({ firstName: 'V', lastName: 'W', email: 'rv@lifc.in', phone: '9600000077', password: 'x12345678', role: 'refviewer', twoFactorEnabled: true }), true);
const ov = await call('GET', '/admin/rewards', viewer);
check('a viewer sees the programme, totals and awards', ov.s === 200 && ov.d.totals.due === 1 && ov.d.totals.dueAmount === 50 && ov.d.awards.length >= 4 && ov.d.canManage === false);
check('a viewer cannot change rules (403)', (await call('PUT', '/admin/rewards/settings', viewer, { enabled: false })).s === 403);
check('bad rules are refused (400)', (await call('PUT', '/admin/rewards/settings', admin, { enabled: true, graceDays: 20 })).s === 400);
const due = ov.d.awards.find(x => x.status === 'due');
check('a reference is needed to mark paid (400)', (await call('POST', `/admin/rewards/awards/${due.id}/paid`, admin, {})).s === 400);
check('a viewer cannot mark paid (403)', (await call('POST', `/admin/rewards/awards/${due.id}/paid`, viewer, { reference: 'UTR1' })).s === 403);
check('finance marks it paid, and the customer is told', (await call('POST', `/admin/rewards/awards/${due.id}/paid`, admin, { reference: 'UTR123' })).d.status === 'paid' && (await Notification.countDocuments({ title: 'Your reward was paid' })) === 1);
check('it cannot be paid twice (409)', (await call('POST', `/admin/rewards/awards/${due.id}/paid`, admin, { reference: 'UTR123' })).s === 409);

await disconnect();
finish();
