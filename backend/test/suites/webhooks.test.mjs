import crypto from 'crypto';
import { check, section, connect, disconnect, startServer, finish, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Transaction from '../../src/models/Transaction.js';
import Notification from '../../src/models/Notification.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-webhooks';
await connect(DB);
const SECRET = 'whsec_test_secret_value';
const off = await startServer(DB); // no webhook secret configured
const srv = await startServer(DB, { RAZORPAY_WEBHOOK_SECRET: SECRET });

const PAYOUT = '/payments/webhook/razorpay';
const INVOICE = '/emi/webhook/razorpay';
const sign = (raw, key = SECRET) => crypto.createHmac('sha256', key).update(raw).digest('hex');
async function post(base, route, raw, signature) {
  const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'x-razorpay-signature': signature } : {}) }, body: raw });
  return { s: r.status, d: await r.json().catch(() => ({})) };
}
const send = (route, obj) => { const raw = JSON.stringify(obj); return post(srv.base, route, raw, sign(raw)); };

const user = await User.create({ firstName: 'Web', lastName: 'Hook', email: 'hook@x.in', phone: '9400000001', password: 'x12345678', bankAccount: { accountNumber: '1234567890', ifscCode: 'SBIN0001234', accountHolder: 'Web Hook' } });
const mkEmis = async (loan, rows) => { for (const r of rows) await EMIPayment.create({ loanId: loan._id, userId: user._id, dueDate: day(10 * r.n), amount: 10200, principalAmount: 8000, interestAmount: 2200, status: 'PENDING', emiNumber: r.n, orderId: r.invoice }); };

const invoiceLoan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status: 'disbursed' });
await mkEmis(invoiceLoan, [{ n: 1, invoice: 'inv_A' }, { n: 2, invoice: 'inv_B' }, { n: 3, invoice: 'inv_C' }]);
const paidEvent = (id, paise, payId = 'pay_1') => ({ event: 'invoice.paid', payload: { invoice: { entity: { id, amount_paid: paise } }, payment: { entity: { id: payId } } } });

section('WEBHOOK SWITCHED OFF WHEN NO SECRET IS SET');
const raw0 = JSON.stringify(paidEvent('inv_A', 1020000));
check('invoice webhook is refused (503), even with a signature', (await post(off.base, INVOICE, raw0, sign(raw0, 'anything'))).s === 503);
check('payout webhook is refused (503)', (await post(off.base, PAYOUT, raw0, sign(raw0, 'anything'))).s === 503);
check('the old fallback secret "test_secret" no longer works', (await post(off.base, INVOICE, raw0, sign(raw0, 'test_secret'))).s === 503);
check('nothing was marked paid', (await EMIPayment.findOne({ orderId: 'inv_A' })).status === 'PENDING');

section('SIGNATURE CHECKS');
const body = paidEvent('inv_A', 1020000);
const compact = JSON.stringify(body);
check('missing signature -> 401', (await post(srv.base, INVOICE, compact)).s === 401);
check('wrong signature -> 401', (await post(srv.base, INVOICE, compact, 'f'.repeat(64))).s === 401);
check('signature that is the wrong length -> 401', (await post(srv.base, INVOICE, compact, 'abc')).s === 401);
check('signed with the old fallback secret -> 401', (await post(srv.base, INVOICE, compact, sign(compact, 'test_secret'))).s === 401);
check('signed with a different secret -> 401', (await post(srv.base, INVOICE, compact, sign(compact, 'another-secret'))).s === 401);
check('body changed after signing -> 401', (await post(srv.base, INVOICE, compact.replace('1020000', '9020000'), sign(compact))).s === 401);
const pretty = JSON.stringify({ event: 'payment.authorized', payload: {} }, null, 2);
check('signature is checked against the exact bytes sent (pretty-printed body, signed as sent)', (await post(srv.base, INVOICE, pretty, sign(pretty))).s === 200);
check('a signature over re-formatted JSON is rejected (this is what the old code relied on)', (await post(srv.base, INVOICE, pretty, sign(JSON.stringify(JSON.parse(pretty))))).s === 401);
check('none of those attempts paid anything', (await EMIPayment.findOne({ orderId: 'inv_A' })).status === 'PENDING');

section('INVOICE PAID (the shape Razorpay really sends)');
const p1 = await send(INVOICE, paidEvent('inv_A', 1020000, 'pay_1'));
const emi1 = await EMIPayment.findOne({ orderId: 'inv_A' });
check('EMI marked paid with the gateway payment id and amount', p1.s === 200 && emi1.status === 'PAID' && emi1.paymentId === 'pay_1' && emi1.paidAmount === 10200, JSON.stringify(p1.d));
check('customer notified', (await Notification.countDocuments({ userId: user._id, title: 'EMI #1 received' })) === 1);
const replay = await send(INVOICE, paidEvent('inv_A', 1020000, 'pay_1'));
check('the same event again changes nothing (replay safe)', replay.s === 200 && replay.d.alreadyPaid === true && (await Notification.countDocuments({ userId: user._id, title: 'EMI #1 received' })) === 1, JSON.stringify(replay.d));
const under = await send(INVOICE, paidEvent('inv_B', 100000, 'pay_2'));
check('a part-payment does not mark the EMI paid', under.d.success === false && under.d.reason === 'underpaid' && (await EMIPayment.findOne({ orderId: 'inv_B' })).status === 'PENDING', JSON.stringify(under.d));
const unknown = await send(INVOICE, paidEvent('inv_unknown', 1020000));
check('an invoice that is not ours is acknowledged and ignored (200)', unknown.s === 200 && unknown.d.ignored === true);
check('other event types are acknowledged and ignored', (await send(INVOICE, { event: 'payment.failed', payload: {} })).d.ignored === true);
check('an invoice event with no invoice is a bad request (400)', (await send(INVOICE, { event: 'invoice.paid', payload: {} })).s === 400);
await send(INVOICE, paidEvent('inv_B', 1020000, 'pay_2'));
await send(INVOICE, paidEvent('inv_C', 1020000, 'pay_3'));
check('loan closes when the last EMI is paid by webhook', (await Loan.findById(invoiceLoan._id)).status === 'closed');

section('PAYOUT EVENTS');
const approved = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status: 'approved' });
await Transaction.create({ loanId: approved._id, userId: user._id, type: 'DISBURSEMENT', amount: 28230, status: 'PROCESSING', paymentGateway: 'RAZORPAY', transferId: 'pout_1', metadata: { initiatedBy: 'admin@lifc.in' } });
const payout = (event, id) => ({ event, payload: { payout: { entity: { id, failure_reason: 'bank said no' } } } });
check('payout.processed completes the disbursement', (await send(PAYOUT, payout('payout.processed', 'pout_1'))).s === 200);
const done = await Loan.findById(approved._id);
check('loan is disbursed for the net amount, with a schedule', done.status === 'disbursed' && done.disbursedAmount === 28230 && (await EMIPayment.countDocuments({ loanId: approved._id })) === 3, `${done.status} ${done.disbursedAmount}`);
check('transaction is completed', (await Transaction.findOne({ transferId: 'pout_1' })).status === 'COMPLETED');
await send(PAYOUT, payout('payout.processed', 'pout_1'));
check('the same payout event again does not duplicate the schedule or the notification', (await EMIPayment.countDocuments({ loanId: approved._id })) === 3 && (await Notification.countDocuments({ userId: user._id, title: 'Loan disbursed' })) === 1);
await send(PAYOUT, payout('payout.failed', 'pout_1'));
check('a late "failed" event cannot undo a completed payout', (await Transaction.findOne({ transferId: 'pout_1' })).status === 'COMPLETED');
await send(PAYOUT, payout('payout.reversed', 'pout_1'));
check('a reversal is recorded and flagged in the audit log', (await Transaction.findOne({ transferId: 'pout_1' })).status === 'REVERSED' && !!(await AuditLog.findOne({ action: 'DISBURSEMENT_REVERSED' })));

const failing = await Loan.create({ userId: user._id, loanAmount: 20000, tenure: 3, interestRate: 15, monthlyEMI: 6800, status: 'approved' });
await Transaction.create({ loanId: failing._id, userId: user._id, type: 'DISBURSEMENT', amount: 20000, status: 'PROCESSING', paymentGateway: 'RAZORPAY', transferId: 'pout_2' });
await send(PAYOUT, payout('payout.failed', 'pout_2'));
check('a failed payout leaves the loan approved so it can be retried', (await Loan.findById(failing._id)).status === 'approved' && (await Transaction.findOne({ transferId: 'pout_2' })).status === 'FAILED');
const ghost = await send(PAYOUT, payout('payout.processed', 'pout_unknown'));
check('a payout that is not ours is acknowledged and ignored', ghost.s === 200 && ghost.d.result.processed === false);

await off.stop();
await srv.stop();
await disconnect();
finish();
