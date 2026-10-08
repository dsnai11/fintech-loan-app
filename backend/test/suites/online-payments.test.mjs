import crypto from 'crypto';
import http from 'http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import PaymentIntent from '../../src/models/PaymentIntent.js';
import Settlement from '../../src/models/Settlement.js';
import Notification from '../../src/models/Notification.js';
import AuditLog from '../../src/models/AuditLog.js';
import { nearestOnDay } from '../../src/services/dateChange.js';

const DB = 'fintech-test-online-payments';
await connect(DB);
await Role.create([{ key: 'colviewer', label: 'Viewer', description: 't', permissions: ['collections.view'] }]);

const asked = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    asked.push({ url: req.url, body: body ? JSON.parse(body) : {} });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/payment_links') return res.end(JSON.stringify({ id: `plink_${asked.length}`, short_url: 'https://rzp.io/i/pay', status: 'created' }));
    res.end('{}');
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}/v1`;
const SECRET = 'whsec_pay';

const srv = await startServer(DB);
const prodNoKeys = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' });
const rzp = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_API_BASE: MOCK, RAZORPAY_WEBHOOK_SECRET: SECRET });
const call = client(srv.base), callNo = client(prodNoKeys.base), callRzp = client(rzp.base);
const { token: admin } = await makeAdmin();

let n = 0;
async function customer(dueDays = [20, 50, 80], { status = 'disbursed' } = {}) {
  n++;
  const user = await User.create({ firstName: `Pay${n}`, lastName: 'Er', email: `pay${n}@x.in`, phone: `9900000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved' });
  const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: dueDays.length, interestRate: 15, monthlyEMI: 10200, status, disbursementDate: day(-10) });
  for (const [i, d] of dueDays.entries()) await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: i + 1, dueDate: day(d), amount: 10200, principalAmount: 10000, interestAmount: 200, status: 'PENDING' });
  return { user, loan, token: await tokenFor(user) };
}
const form = (base, path, action) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `action=${action}`, redirect: 'manual' });
const status = (c, loan, no) => EMIPayment.findOne({ loanId: loan._id, emiNumber: no }).then(e => e.status);

section('WHAT THE CUSTOMER CAN DO');
const a = await customer();
const opt = await call('GET', `/pay/options/${a.loan._id}`, a.token);
check('pay-ahead choices are listed with their totals', opt.s === 200 && opt.d.payAhead.length === 3 && opt.d.payAhead[1].amount === 20400 && opt.d.payAhead[1].emiNumbers.join() === '1,2', JSON.stringify(opt.d).slice(0, 200));
check('closing now is quoted, with how it compares to paying normally (here it costs a little more, and says so)', opt.d.closeNow.total > 0 && opt.d.closeNow.ifPaidNormally === 30600 && opt.d.closeNow.saves + opt.d.closeNow.costsExtra === Math.abs(30600 - opt.d.closeNow.total), JSON.stringify(opt.d.closeNow));
check('test mode is shown', opt.d.mode === 'test' && opt.d.available === true);
check('someone else cannot see the loan (404)', (await call('GET', `/pay/options/${a.loan._id}`, (await customer()).token)).s === 404);

section('PAYING TWO EMIS AT ONCE (TEST MODE)');
const st = await call('POST', '/pay/start', a.token, { loanId: String(a.loan._id), purpose: 'pay_ahead', count: 2, amount: 1 });
check('it starts at the amount we work out, not one the app sends', st.s === 201 && st.d.payment.amount === 20400 && st.d.payment.url.includes('/api/pay/sandbox/'), JSON.stringify(st.d));
check('too many instalments are refused (409)', (await call('POST', '/pay/start', a.token, { loanId: String(a.loan._id), purpose: 'pay_ahead', count: 5 })).s === 409);
check('an unknown purpose is refused (400)', (await call('POST', '/pay/start', a.token, { loanId: String(a.loan._id), purpose: 'gift' })).s === 400);
const id = st.d.payment.id;
const pg = await fetch(srv.base + `/pay/sandbox/${id}`);
check('the stand-in page says it is a test', pg.status === 200 && (await pg.text()).includes('TEST MODE'));
check('nothing is paid before paying', (await status(null, a.loan, 1)) === 'PENDING');
const paid = await form(srv.base, `/pay/sandbox/${id}`, 'pay');
check('paying marks the first two instalments paid, and not the third', paid.status === 302 && (await status(null, a.loan, 1)) === 'PAID' && (await status(null, a.loan, 2)) === 'PAID' && (await status(null, a.loan, 3)) === 'PENDING');
check('the status is paid', (await call('GET', `/pay/status/${id}`, a.token)).d.payment.status === 'paid');
check('the page cannot be used twice (404)', (await form(srv.base, `/pay/sandbox/${id}`, 'pay')).status === 404);
check('the customer is told for each instalment', (await Notification.countDocuments({ userId: a.user._id, type: 'EMI_PAID' })) === 2);

section('CLOSING THE LOAN (TEST MODE)');
const f = await customer();
const fs = await call('POST', '/pay/start', f.token, { loanId: String(f.loan._id), purpose: 'foreclosure' });
check('closing quotes the amount', fs.s === 201 && fs.d.payment.amount === (await call('GET', `/pay/options/${f.loan._id}`, f.token)).d.closeNow.total);
await form(srv.base, `/pay/sandbox/${fs.d.payment.id}`, 'pay');
const fl = await Loan.findById(f.loan._id);
check('paying closes the loan early and waives the rest', fl.status === 'closed' && fl.closureType === 'foreclosure' && (await EMIPayment.countDocuments({ loanId: f.loan._id, status: 'PAID' })) === 0 && (await EMIPayment.countDocuments({ loanId: f.loan._id, status: 'WAIVED' })) === 3);
const cancelled = await customer();
const cs = await call('POST', '/pay/start', cancelled.token, { loanId: String(cancelled.loan._id), purpose: 'foreclosure' });
await form(srv.base, `/pay/sandbox/${cs.d.payment.id}`, 'cancel');
check('cancelling changes nothing', (await Loan.findById(cancelled.loan._id)).status === 'disbursed' && (await call('GET', `/pay/status/${cs.d.payment.id}`, cancelled.token)).d.payment.status === 'cancelled');

section('A SETTLEMENT THE CUSTOMER ACCEPTED');
const s = await customer([-70, -40, -10]);
await EMIPayment.updateMany({ loanId: s.loan._id }, { status: 'OVERDUE' });
check('without an accepted offer it is refused (409)', (await call('POST', '/pay/start', s.token, { loanId: String(s.loan._id), purpose: 'settlement' })).s === 409);
const offer = await Settlement.create({ loanId: s.loan._id, userId: s.user._id, status: 'accepted', originalDue: 30600, waiverPercent: 20, amount: 24480, validUntil: day(5), createdBy: 'agent' });
const ss = await call('POST', '/pay/start', s.token, { loanId: String(s.loan._id), purpose: 'settlement' });
check('the amount is the offer', ss.s === 201 && ss.d.payment.amount === 24480);
await form(srv.base, `/pay/sandbox/${ss.d.payment.id}`, 'pay');
check('paying closes the loan as settled', (await Loan.findById(s.loan._id)).closureType === 'settlement' && (await Settlement.findById(offer._id)).status === 'paid');

section('PRODUCTION');
const p = await customer();
check('without Razorpay keys it says not available (503)', (await callNo('POST', '/pay/start', p.token, { loanId: String(p.loan._id), purpose: 'pay_ahead', count: 1 })).s === 503 && (await callNo('GET', `/pay/options/${p.loan._id}`, p.token)).d.available === false);
check('the old closing route stays shut in production (501)', (await callRzp('POST', `/emi/foreclosure/${p.loan._id}`, p.token, { expectedAmount: 1 })).s === 501);
check('the test page does not exist in production (404)', (await fetch(rzp.base + '/pay/sandbox/64b000000000000000000000')).status === 404);
const rs = await callRzp('POST', '/pay/start', p.token, { loanId: String(p.loan._id), purpose: 'pay_ahead', count: 2 });
const link = asked.find(x => x.url === '/v1/payment_links');
check('a Razorpay payment link is made for the right amount, tied to our record', rs.s === 201 && link.body.amount === 2040000 && link.body.reference_id === rs.d.payment.id && rs.d.payment.url === 'https://rzp.io/i/pay', JSON.stringify(link?.body));
const pay = obj => { const raw = JSON.stringify(obj); return fetch(rzp.base + '/emi/webhook/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', SECRET).update(raw).digest('hex') }, body: raw }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) })); };
const paidEvent = (amountPaise, payId = 'pay_A') => ({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: rs.d.payment ? `plink_${asked.indexOf(link) + 1}` : '', reference_id: rs.d.payment.id, amount_paid: amountPaise } }, payment: { entity: { id: payId } } } });
check('a short payment does not apply and goes to review', (await pay(paidEvent(1000000, 'pay_short'))).d.review === true && (await PaymentIntent.findById(rs.d.payment.id)).status === 'review' && (await status(null, p.loan, 1)) === 'PENDING');
const q = await customer();
const qs = await callRzp('POST', '/pay/start', q.token, { loanId: String(q.loan._id), purpose: 'pay_ahead', count: 2 });
const qEvent = (amt, payId) => ({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: `plink_x`, reference_id: qs.d.payment.id, amount_paid: amt } }, payment: { entity: { id: payId } } } });
check('the full payment applies the instalments', (await pay(qEvent(2040000, 'pay_Q'))).d.ok === true && (await status(null, q.loan, 1)) === 'PAID' && (await status(null, q.loan, 2)) === 'PAID');
check('the same event again changes nothing', (await pay(qEvent(2040000, 'pay_Q'))).d.duplicate === true && (await Notification.countDocuments({ userId: q.user._id, type: 'EMI_PAID' })) === 2);
check('an unsigned event is refused (401)', (await fetch(rzp.base + '/emi/webhook/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'bad' }, body: JSON.stringify(qEvent(1, 'x')) })).status === 401);
const r2 = await customer();
const r2s = await callRzp('POST', '/pay/start', r2.token, { loanId: String(r2.loan._id), purpose: 'pay_ahead', count: 1 });
await EMIPayment.updateOne({ loanId: r2.loan._id, emiNumber: 1 }, { status: 'PAID' });
check('if the instalment was paid in the meantime, the money is put aside, not lost', (await pay({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_y', reference_id: r2s.d.payment.id, amount_paid: 1020000 } }, payment: { entity: { id: 'pay_R' } } } })).d.review === true && (await PaymentIntent.findById(r2s.d.payment.id)).reviewReason.includes('already paid'));
const f2 = await customer();
const f2s = await callRzp('POST', '/pay/start', f2.token, { loanId: String(f2.loan._id), purpose: 'foreclosure' });
await pay({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_z', reference_id: f2s.d.payment.id, amount_paid: Math.round(f2s.d.payment.amount * 100) } }, payment: { entity: { id: 'pay_F' } } } });
check('a paid early-closure link closes the loan in production', (await Loan.findById(f2.loan._id)).closureType === 'foreclosure');

section('PAYMENTS THAT NEED A LOOK');
const viewer = await tokenFor(await User.create({ firstName: 'V', lastName: 'W', email: 'colview@lifc.in', phone: '9600000099', password: 'x12345678', role: 'colviewer', twoFactorEnabled: true }), true);
const list = await call('GET', '/admin/online-payments?status=review', viewer);
check('staff see the two held payments', list.s === 200 && list.d.payments.length === 2 && list.d.payments.every(x => x.status === 'review' && x.reviewReason), JSON.stringify(list.d).slice(0, 200));
check('a viewer cannot resolve (403)', (await call('POST', `/admin/online-payments/${rs.d.payment.id}/resolve`, viewer, { note: 'x' })).s === 403);
check('a note is required (400)', (await call('POST', `/admin/online-payments/${rs.d.payment.id}/resolve`, admin, {})).s === 400);
check('staff resolve one', (await call('POST', `/admin/online-payments/${rs.d.payment.id}/resolve`, admin, { note: 'Refunded the short payment' })).d.status === 'resolved' && !!(await AuditLog.findOne({ action: 'PAYMENT_RESOLVED' })));
check('resolving again is refused (409)', (await call('POST', `/admin/online-payments/${rs.d.payment.id}/resolve`, admin, { note: 'again' })).s === 409);

section('MOVING THE DUE DATE');
check('the closest date with that day is chosen', nearestOnDay(new Date(Date.UTC(2026, 5, 12)), 5).toISOString().slice(0, 10) === '2026-06-05' && nearestOnDay(new Date(Date.UTC(2026, 5, 28)), 2).toISOString().slice(0, 10) === '2026-07-02');
const d = await customer([10, 40, 70]);
const el = await call('GET', `/pay/options/${d.loan._id}`, d.token);
check('it is allowed, with the rules shown', el.d.dueDate.allowed === true && el.d.dueDate.maxShiftDays === 15 && el.d.dueDate.changesLeft === 1);
const first = new Date((await EMIPayment.findOne({ loanId: d.loan._id, emiNumber: 1 })).dueDate);
const strict = await startServer(DB, { DATE_CHANGE_MAX_SHIFT_DAYS: '3' });
const farDay = ((first.getUTCDate() + 8 - 1) % 28) + 1;
check('a move bigger than the allowed days is refused (409)', (await client(strict.base)('POST', `/pay/change-date/${d.loan._id}`, d.token, { day: farDay })).s === 409 && (await Loan.findById(d.loan._id)).dateChanges.length === 0);
check('a bad day is refused (400)', (await call('POST', `/pay/change-date/${d.loan._id}`, d.token, { day: 31 })).s === 400);
const target = first.getUTCDate() === 28 ? 27 : first.getUTCDate() + 1;
const moved = await call('POST', `/pay/change-date/${d.loan._id}`, d.token, { day: target });
const after = await EMIPayment.find({ loanId: d.loan._id }).sort({ emiNumber: 1 });
check('all the remaining instalments move to that day, one month apart, amounts unchanged', moved.s === 200 && after.every(e => e.dueDate.getUTCDate() === target) && after[0].amount === 10200 && Math.round((after[1].dueDate - after[0].dueDate) / 864e5) >= 28, JSON.stringify(moved.d));
check('the change is recorded and audited', (await Loan.findById(d.loan._id)).dateChanges.length === 1 && !!(await AuditLog.findOne({ action: 'EMI_DATE_CHANGED' })));
check('a second change is refused (409)', (await call('POST', `/pay/change-date/${d.loan._id}`, d.token, { day: 3 })).s === 409);
const od = await customer([-5, 25, 55]);
await EMIPayment.updateOne({ loanId: od.loan._id, emiNumber: 1 }, { status: 'OVERDUE' });
check('with an overdue instalment it is refused (409)', (await call('POST', `/pay/change-date/${od.loan._id}`, od.token, { day: 10 })).s === 409);
check('someone else cannot change it (404)', (await call('POST', `/pay/change-date/${d.loan._id}`, od.token, { day: 10 })).s === 404);

mock.close();
await disconnect();
finish();
