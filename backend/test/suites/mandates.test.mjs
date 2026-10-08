import crypto from 'crypto';
import http from 'http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Mandate from '../../src/models/Mandate.js';
import MandateDebit from '../../src/models/MandateDebit.js';
import Notification from '../../src/models/Notification.js';

const DB = 'fintech-test-mandates';
await connect(DB);
await Role.create([{ key: 'colviewer', label: 'Viewer', description: 't', permissions: ['collections.view'] }]);

// A stand-in for Razorpay's API that remembers what it was asked
const asked = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    asked.push({ url: req.url, body: body ? JSON.parse(body) : {} });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/plans') return res.end(JSON.stringify({ id: 'plan_1' }));
    if (req.url === '/v1/subscriptions') return res.end(JSON.stringify({ id: `sub_${asked.length}`, short_url: 'https://rzp.io/i/abc' }));
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}/v1`;
const SECRET = 'whsec_mandates';

const srv = await startServer(DB);
const failing = await startServer(DB, { MANDATE_SANDBOX_RESULT: 'fail' });
const prod = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION' });
const rzp = await startServer(DB, { MANDATE_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_API_BASE: MOCK, RAZORPAY_WEBHOOK_SECRET: SECRET });
const call = client(srv.base), callFail = client(failing.base), callProd = client(prod.base), callRzp = client(rzp.base);
const { token: admin } = await makeAdmin();

let n = 0;
async function customer(due = [1, 31, 61]) {
  n++;
  const user = await User.create({ firstName: `Auto${n}`, lastName: 'Debit', email: `auto${n}@x.in`, phone: `9500000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved' });
  const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: due.length, interestRate: 15, monthlyEMI: 10200, status: 'disbursed' });
  for (const [i, d] of due.entries()) await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: i + 1, dueDate: day(d), amount: 10200, principalAmount: 8000, interestAmount: 2200, status: 'PENDING' });
  return { user, loan, token: await tokenFor(user) };
}
const form = (base, path, action) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `action=${action}` }).then(async r => ({ s: r.status, t: await r.text() }));
const sendHook = async (obj, secret = SECRET) => {
  const raw = JSON.stringify(obj);
  const r = await fetch(rzp.base + '/emi/webhook/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }, body: raw });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const backdateNotice = id => MandateDebit.updateMany({ mandateId: id }, { notifiedAt: new Date(Date.now() - 2 * 864e5) });

section('TEST MODE: SETTING IT UP');
const a = await customer();
const mine0 = await call('GET', '/mandates/mine', a.token);
check('test mode is offered, with the loan listed', mine0.s === 200 && mine0.d.available && mine0.d.mode === 'test' && mine0.d.loansWithoutAutoDebit.length === 1, JSON.stringify(mine0.d));
check('a loan that is not the customer\'s is refused (404)', (await call('POST', '/mandates/start', (await customer()).token, { loanId: String(a.loan._id) })).s === 404);
check('a bad method is refused (400)', (await call('POST', '/mandates/start', a.token, { loanId: String(a.loan._id), method: 'cash' })).s === 400);
const started = await call('POST', '/mandates/start', a.token, { loanId: String(a.loan._id), method: 'upi' });
const mid = started.d.mandate?.id;
check('it starts and waits for approval', started.s === 201 && started.d.mandate.status === 'pending_auth' && started.d.mandate.authUrl.includes('/api/mandates/sandbox/') && started.d.mandate.maxAmount >= 10200, JSON.stringify(started.d));
check('starting twice is refused (409)', (await call('POST', '/mandates/start', a.token, { loanId: String(a.loan._id) })).s === 409);
const pageGet = await fetch(srv.base + `/mandates/sandbox/${mid}`);
check('the stand-in approval page is shown and says it is a test', pageGet.status === 200 && (await pageGet.text()).includes('TEST MODE'));
check('nothing is collected before approval', (await call('POST', '/admin/mandates/run', admin, {})).d.notified === 0);
check('approving turns it on', (await form(srv.base, `/mandates/sandbox/${mid}`, 'allow')).s === 200 && (await Mandate.findById(mid)).status === 'active');
check('the approval page expires once used (404)', (await fetch(srv.base + `/mandates/sandbox/${mid}`)).status === 404);
check('the customer is told it is on', (await Notification.countDocuments({ userId: a.user._id, type: 'AUTOPAY' })) === 1);

section('TEST MODE: NOTICE FIRST, THEN COLLECTION');
const r1 = await call('POST', '/admin/mandates/run', admin, {});
check('the customer is told a day ahead and nothing is collected yet', r1.s === 200 && r1.d.notified === 1 && r1.d.collected === 0 && (await EMIPayment.findOne({ loanId: a.loan._id, emiNumber: 1 })).status === 'PENDING', JSON.stringify(r1.d));
check('running again does not tell them twice', (await call('POST', '/admin/mandates/run', admin, {})).d.notified === 0);
await backdateNotice(mid);
await EMIPayment.updateOne({ loanId: a.loan._id, emiNumber: 1 }, { dueDate: day(-0.01) });
const r2 = await call('POST', '/admin/mandates/run', admin, {});
check('after the notice period the instalment is collected', r2.d.collected === 1 && (await EMIPayment.findOne({ loanId: a.loan._id, emiNumber: 1 })).status === 'PAID', JSON.stringify(r2.d));
check('the loan stays open with instalments left', (await Loan.findById(a.loan._id)).status === 'disbursed');
check('the customer sees it on their screen', (await call('GET', '/mandates/mine', a.token)).d.mandates[0].status === 'active');

section('TEST MODE: A COLLECTION THAT FAILS');
const f = await customer();
const fs = await callFail('POST', '/mandates/start', f.token, { loanId: String(f.loan._id) });
await form(failing.base, `/mandates/sandbox/${fs.d.mandate.id}`, 'allow');
await callFail('POST', '/admin/mandates/run', admin, {});
await backdateNotice(fs.d.mandate.id);
await EMIPayment.updateOne({ loanId: f.loan._id, emiNumber: 1 }, { dueDate: day(-0.01) });
const f1 = await callFail('POST', '/admin/mandates/run', admin, {});
const d1 = await MandateDebit.findOne({ mandateId: fs.d.mandate.id });
check('a failed collection is recorded with a reason and a later retry', f1.d.failed === 1 && d1.status === 'failed' && d1.attempts === 1 && d1.nextAttemptAt > new Date() && /balance/.test(d1.failureReason), JSON.stringify(d1));
check('the instalment stays unpaid', (await EMIPayment.findOne({ loanId: f.loan._id, emiNumber: 1 })).status === 'PENDING');
check('the customer is told it failed', (await Notification.countDocuments({ userId: f.user._id, title: 'Auto-debit did not go through' })) === 1);
check('running at once does not retry (too soon)', (await callFail('POST', '/admin/mandates/run', admin, {})).d.failed === 0);
for (const k of [2, 3]) {
  await MandateDebit.updateOne({ mandateId: fs.d.mandate.id }, { nextAttemptAt: new Date(Date.now() - 1000) });
  await callFail('POST', '/admin/mandates/run', admin, {});
  check(`try number ${k} is made`, (await MandateDebit.findOne({ mandateId: fs.d.mandate.id })).attempts === k);
}
await MandateDebit.updateOne({ mandateId: fs.d.mandate.id }, { nextAttemptAt: new Date(Date.now() - 1000) });
check('it gives up after 3 tries', (await callFail('POST', '/admin/mandates/run', admin, {})).d.failed === 0 && (await MandateDebit.findOne({ mandateId: fs.d.mandate.id })).attempts === 3);

section('DECLINING, STOPPING AND STAFF CONTROLS');
const c = await customer();
const cs = await call('POST', '/mandates/start', c.token, { loanId: String(c.loan._id) });
check('declining leaves nothing active', (await form(srv.base, `/mandates/sandbox/${cs.d.mandate.id}`, 'deny')).s === 200 && (await Mandate.findById(cs.d.mandate.id)).status === 'failed');
const c2 = await call('POST', '/mandates/start', c.token, { loanId: String(c.loan._id) });
await form(srv.base, `/mandates/sandbox/${c2.d.mandate.id}`, 'allow');
const stranger = await customer();
check('someone else cannot stop it (404)', (await call('POST', `/mandates/${c2.d.mandate.id}/cancel`, stranger.token)).s === 404);
const viewer = await tokenFor(await User.create({ firstName: 'V', lastName: 'W', email: 'colview@lifc.in', phone: '9600000001', password: 'x12345678', role: 'colviewer', twoFactorEnabled: true }), true);
const list = await call('GET', '/admin/mandates', viewer);
check('a viewer can see the list', list.s === 200 && list.d.canManage === false && list.d.counts.active >= 1 && list.d.mandates.some(m => m.id === c2.d.mandate.id), JSON.stringify(list.d).slice(0, 200));
check('a viewer cannot pause (403)', (await call('POST', `/admin/mandates/${c2.d.mandate.id}/pause`, viewer, {})).s === 403);
check('a viewer cannot run collections (403)', (await call('POST', '/admin/mandates/run', viewer, {})).s === 403);
check('a customer cannot use the staff list (403)', (await call('GET', '/admin/mandates', c.token)).s === 403);
check('staff can pause it', (await call('POST', `/admin/mandates/${c2.d.mandate.id}/pause`, admin, {})).d.status === 'paused');
await EMIPayment.updateOne({ loanId: c.loan._id, emiNumber: 1 }, { dueDate: day(0.5) });
check('a paused mandate is left alone', (await call('POST', '/admin/mandates/run', admin, {})).d.notified === 0);
check('staff can resume it', (await call('POST', `/admin/mandates/${c2.d.mandate.id}/resume`, admin, {})).d.status === 'active');
check('resuming something active is refused (409)', (await call('POST', `/admin/mandates/${c2.d.mandate.id}/resume`, admin, {})).s === 409);
await call('POST', '/admin/mandates/run', admin, {});
const hist = await call('GET', `/admin/mandates/${c2.d.mandate.id}/debits`, viewer);
check('the history lists the notified collection', hist.s === 200 && hist.d.debits.length === 1 && hist.d.debits[0].status === 'notified');
check('the customer can stop it', (await call('POST', `/mandates/${c2.d.mandate.id}/cancel`, c.token)).d.mandate.status === 'cancelled');
check('a stopped mandate is never collected', (await call('POST', '/admin/mandates/run', admin, {})).d.collected === 0);
check('the customer can start it again', (await call('POST', '/mandates/start', c.token, { loanId: String(c.loan._id) })).s === 201);

section('PRODUCTION WITHOUT A PROVIDER');
const p = await customer();
const pm = await callProd('GET', '/mandates/mine', p.token);
check('it says auto-debit is not available', pm.d.available === false && pm.d.mode === 'unavailable');
check('starting is refused (503)', (await callProd('POST', '/mandates/start', p.token, { loanId: String(p.loan._id) })).s === 503);
check('the test approval page is not there (404)', (await fetch(prod.base + '/mandates/sandbox/' + new (await import('mongoose')).default.Types.ObjectId())).status === 404);

section('RAZORPAY');
const z = await customer([5, 35, 65]);
await EMIPayment.updateOne({ loanId: z.loan._id, emiNumber: 3 }, { amount: 9000 });
const zs = await callRzp('POST', '/mandates/start', z.token, { loanId: String(z.loan._id), method: 'enach' });
const plan = asked.find(x => x.url === '/v1/plans'), sub = asked.find(x => x.url === '/v1/subscriptions');
check('a plan is made for the monthly amount, and a subscription for the equal instalments only', zs.s === 201 && plan.body.item.amount === 1020000 && sub.body.total_count === 2 && sub.body.plan_id === 'plan_1', JSON.stringify(asked));
check('the customer is sent to Razorpay to approve', zs.d.mandate.authUrl === 'https://rzp.io/i/abc' && zs.d.mandate.provider === 'razorpay');
const subId = (await Mandate.findById(zs.d.mandate.id)).providerRef;
check('a webhook without the right signature is refused (401)', (await sendHook({ event: 'subscription.activated', payload: { subscription: { entity: { id: subId } } } }, 'wrong')).s === 401);
check('activation turns it on', (await sendHook({ event: 'subscription.activated', payload: { subscription: { entity: { id: subId } } } })).d.status === 'active' && (await Mandate.findById(zs.d.mandate.id)).status === 'active');
check('an unknown subscription is ignored', (await sendHook({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_nope' } }, payment: { entity: { id: 'pay_9', amount: 1020000 } } } })).d.ignored === true);
const charged = pay => sendHook({ event: 'subscription.charged', payload: { subscription: { entity: { id: subId } }, payment: { entity: { id: pay.id, amount: pay.amount } } } });
check('a short payment does not mark the instalment paid', (await charged({ id: 'pay_short', amount: 500000 })).d.success === false && (await EMIPayment.findOne({ loanId: z.loan._id, emiNumber: 1 })).status === 'PENDING');
check('a full payment marks it paid', (await charged({ id: 'pay_1', amount: 1020000 })).d.status === 'collected' && (await EMIPayment.findOne({ loanId: z.loan._id, emiNumber: 1 })).status === 'PAID');
check('the same payment sent again changes nothing', (await charged({ id: 'pay_1', amount: 1020000 })).d.duplicate === true && (await EMIPayment.countDocuments({ loanId: z.loan._id, status: 'PAID' })) === 1);
check('the collection is recorded', (await MandateDebit.findOne({ mandateId: zs.d.mandate.id, emiNumber: 1 })).status === 'success');
check('our own schedule does not collect for Razorpay (only the advance notice)', (await EMIPayment.updateOne({ loanId: z.loan._id, emiNumber: 2 }, { dueDate: day(-0.01) })) && (await callRzp('POST', '/admin/mandates/run', admin, {})).d.collected === 0);
check('a halted subscription pauses it and tells the customer', (await sendHook({ event: 'subscription.halted', payload: { subscription: { entity: { id: subId } } } })).d.status === 'paused' && (await Notification.countDocuments({ userId: z.user._id, title: 'Auto-debit did not go through' })) === 1);
const before = asked.length;
check('the customer can stop it and Razorpay is told', (await callRzp('POST', `/mandates/${zs.d.mandate.id}/cancel`, z.token)).d.mandate.status === 'cancelled' && asked.slice(before).some(x => x.url === `/v1/subscriptions/${subId}/cancel`));

mock.close();
await disconnect();
finish();
