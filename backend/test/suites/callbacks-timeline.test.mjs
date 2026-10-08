import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import AgreementAcceptance from '../../src/models/AgreementAcceptance.js';
import Notification from '../../src/models/Notification.js';
import CallbackRequest from '../../src/models/CallbackRequest.js';

const DB = 'fintech-test-callbacks';
await connect(DB);
await Role.create([{ key: 'supviewer', label: 'Viewer', description: 't', permissions: ['support.view'] }, { key: 'supagent', label: 'Agent', description: 't', permissions: ['support.view', 'support.reply'] }]);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const viewer = await staff('supviewer', 1), agent = await staff('supagent', 2);

let n = 0;
async function customer() {
  n++;
  const user = await User.create({ firstName: `Cb${n}`, lastName: 'Cust', email: `cb${n}@x.in`, phone: `9100000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved' });
  return { user, token: await tokenFor(user) };
}
const loanFor = (c, status, extra = {}) => Loan.create({ userId: c.user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status, ...extra });

section('CALL ME BACK');
const a = await customer();
check('a login is needed (401)', (await call('POST', '/callbacks', null, { slot: 'morning', day: 'today' })).s === 401);
check('a time must be chosen (400)', (await call('POST', '/callbacks', a.token, { topic: 'loan' })).s === 400);
const made = await call('POST', '/callbacks', a.token, { topic: 'payment', slot: 'evening', day: 'tomorrow', note: 'Please call after work' });
check('the request is made, with the phone number from the account', made.s === 201 && made.d.request.slotText === '4 pm to 7 pm' && (await CallbackRequest.findOne({ userId: a.user._id })).phone === a.user.phone);
check('a second open request is refused (409)', (await call('POST', '/callbacks', a.token, { slot: 'morning', day: 'today' })).s === 409);
check('the customer sees it', (await call('GET', '/callbacks/mine', a.token)).d.requests[0].status === 'open');

const b = await customer();
const mb = await call('POST', '/callbacks', b.token, { topic: 'kyc', slot: 'morning', day: 'today' });
check('another customer cannot cancel it (404)', (await call('POST', `/callbacks/${mb.d.request.id}/cancel`, a.token)).s === 404);
check('the owner can cancel', (await call('POST', `/callbacks/${mb.d.request.id}/cancel`, b.token)).d.request.status === 'cancelled');

section('STAFF');
const list = await call('GET', '/admin/callbacks', viewer);
check('a viewer sees the open list, today first', list.s === 200 && list.d.open === 1 && list.d.requests[0].customer.startsWith('Cb1') && list.d.canReply === false);
check('a customer cannot see it (403)', (await call('GET', '/admin/callbacks', a.token)).s === 403);
const id = list.d.requests[0].id;
check('a viewer cannot act (403)', (await call('POST', `/admin/callbacks/${id}/done`, viewer, { outcome: 'x' })).s === 403);
check('an agent takes it', (await call('POST', `/admin/callbacks/${id}/claim`, agent)).d.assignedTo === 'supagent@lifc.in');
check('someone else cannot take it (409)', (await call('POST', `/admin/callbacks/${id}/claim`, admin)).s === 409);
check('an outcome is needed (400)', (await call('POST', `/admin/callbacks/${id}/done`, agent, {})).s === 400);
check('it is marked done', (await call('POST', `/admin/callbacks/${id}/done`, agent, { outcome: 'Explained the late fee' })).d.status === 'done');
check('it cannot be done twice (409)', (await call('POST', `/admin/callbacks/${id}/done`, agent, { outcome: 'again' })).s === 409);
const c = await customer();
const mc = await call('POST', '/callbacks', c.token, { slot: 'afternoon', day: 'today' });
check('when nobody answers the customer is told', (await call('POST', `/admin/callbacks/${mc.d.request.id}/missed`, agent)).d.status === 'done' && (await Notification.countDocuments({ userId: c.user._id, title: 'We tried to call you' })) === 1);
check('they can ask again afterwards', (await call('POST', '/callbacks', c.token, { slot: 'morning', day: 'tomorrow' })).s === 201);

section('APPLICATION TIMELINE');
const t = await customer();
const L = await loanFor(t, 'submitted');
const tl = id => call('GET', `/loans/${id}/timeline`, t.token);
const t1 = await tl(L._id);
const st = (r, key) => r.d.steps.find(s => s.key === key).state;
check('just applied: the review is under way', t1.s === 200 && st(t1, 'applied') === 'done' && st(t1, 'review') === 'current' && st(t1, 'agreement') === 'todo' && /checking/.test(t1.d.next), JSON.stringify(t1.d.steps.map(s => s.key + ':' + s.state)));
await Loan.updateOne({ _id: L._id }, { status: 'under_review' });
check('with a person looking: says so', /team/.test((await tl(L._id)).d.steps.find(s => s.key === 'review').detail));
await Loan.updateOne({ _id: L._id }, { status: 'approved', approvalDate: new Date() });
const t3 = await tl(L._id);
check('approved: waiting for the customer to sign', st(t3, 'decision') === 'done' && st(t3, 'agreement') === 'current' && /Sign/.test(t3.d.next));
await AgreementAcceptance.create({ loanId: L._id, userId: t.user._id, version: 'v2', hash: 'h', text: 't' });
const t4 = await tl(L._id);
check('signed: the payout is the current step', st(t4, 'agreement') === 'done' && st(t4, 'payout') === 'current');
await Loan.updateOne({ _id: L._id }, { status: 'disbursed', disbursementDate: new Date() });
for (const i of [1, 2, 3]) await EMIPayment.create({ loanId: L._id, userId: t.user._id, emiNumber: i, dueDate: day(i * 30), amount: 10200, status: i === 1 ? 'PAID' : 'PENDING' });
const t5 = await tl(L._id);
check('paid out: repayment shows progress and the next due date', st(t5, 'payout') === 'done' && st(t5, 'repay') === 'current' && /1 of 3 EMIs paid/.test(t5.d.steps.find(s => s.key === 'repay').detail) && /Pay your next EMI/.test(t5.d.next));
const rej = await loanFor(t, 'rejected', { rejectionReason: 'We cannot offer a loan for your age at this time.' });
const t6 = await tl(rej._id);
check('rejected: stops with the reason the customer is allowed to see', st(t6, 'decision') === 'stopped' && /age/.test(t6.d.steps.find(s => s.key === 'decision').detail) && t6.d.steps.length === 3);
check('someone else cannot see it (404)', (await call('GET', `/loans/${L._id}/timeline`, a.token)).s === 404);

await disconnect();
finish();
