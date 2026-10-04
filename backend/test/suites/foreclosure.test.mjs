import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Notification from '../../src/models/Notification.js';

const DB = 'fintech-test-foreclosure';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const alice = await User.create({ firstName: 'Alice', lastName: 'U', email: 'alice@x.in', phone: '9300000001', password: 'x12345678' });
const mallory = await User.create({ firstName: 'Mallory', lastName: 'U', email: 'mallory@x.in', phone: '9300000002', password: 'x12345678' });
const mkLoan = status => Loan.create({ userId: alice._id, loanAmount: 24000, tenure: 3, interestRate: 15, monthlyEMI: 10000, status, disbursementDate: day(-40), disbursedAmount: 24000 });
const loan = await mkLoan('disbursed');
const mkEmi = (n, due, status = 'PENDING') => EMIPayment.create({ loanId: loan._id, userId: alice._id, emiNumber: n, dueDate: due, amount: 10000, principalAmount: 8000, interestAmount: 2000, status });
await mkEmi(1, day(-10), 'OVERDUE'); // 10 days late
await mkEmi(2, day(20));
await mkEmi(3, day(50));
const submitted = await mkLoan('submitted');
const ta = await tokenFor(alice);

section('QUOTE (worked out by hand)');
// overdue: 10,000 + 500 late fee (2% is under the 500 minimum) = 10,500
// principal still to pay: 2 x 8,000 = 16,000
// interest so far on the next EMI: 2,000 x 10/30 days = 667
// closure fee: 2% of 16,000 = 320
const q = await call('GET', `/emi/foreclosure/${loan._id}`, ta);
check('overdue EMIs and late fee 10,500', q.d.overdueAmount === 10500 && q.d.overdueEmis === 1, JSON.stringify(q.d));
check('remaining principal 16,000 over 2 EMIs', q.d.principal === 16000 && q.d.remainingEmis === 2);
check('interest accrued so far 667', q.d.accruedInterest === 667, q.d.accruedInterest);
check('closure fee 320 (2%)', q.d.fee === 320 && q.d.feePercent === 2);
check('total to pay 27,487', q.d.total === 27487, q.d.total);
check("another customer cannot get the quote (404)", (await call('GET', `/emi/foreclosure/${loan._id}`, await tokenFor(mallory))).s === 404);
check('a loan that is not active has no quote (400)', (await call('GET', `/emi/foreclosure/${submitted._id}`, ta)).s === 400);

section('PAYING');
check('a stale amount is refused (409) with the new quote', await (async () => { const r = await call('POST', `/emi/foreclosure/${loan._id}`, ta, { expectedAmount: 20000 }); return r.s === 409 && r.d.quote.total === 27487; })());
check('no amount is refused (409)', (await call('POST', `/emi/foreclosure/${loan._id}`, ta, {})).s === 409);
check('nothing changed after the refusals', (await Loan.findById(loan._id)).status === 'disbursed');
const [x, y] = await Promise.all([
  call('POST', `/emi/foreclosure/${loan._id}`, ta, { expectedAmount: 27487 }),
  call('POST', `/emi/foreclosure/${loan._id}`, ta, { expectedAmount: 27487 }),
]);
check('double tap: exactly one success and one refusal', (([x.s, y.s].sort().join() === '200,409') || ([x.s, y.s].sort().join() === '200,400')), [x.s, y.s].join());

section('AFTER CLOSURE');
const closed = await Loan.findById(loan._id);
check('loan is closed with the foreclosure recorded', closed.status === 'closed' && closed.foreclosure.amount === 16987 && closed.foreclosure.fee === 320 && closed.foreclosure.accruedInterest === 667, JSON.stringify(closed.foreclosure));
const emis = await EMIPayment.find({ loanId: loan._id }).sort({ emiNumber: 1 });
check('overdue EMI marked paid, future EMIs waived', emis[0].status === 'PAID' && emis[0].paidAmount === 10500 && emis[1].status === 'WAIVED' && emis[2].status === 'WAIVED', emis.map(e => e.status).join());
check('no quote once closed (400)', (await call('GET', `/emi/foreclosure/${loan._id}`, ta)).s === 400);
check('customer is told', (await Notification.find({ userId: alice._id })).some(n => n.title === 'Loan closed early'));

section('REVENUE REPORT');
const rev = (await call('GET', '/admin/reports/summary', admin)).d;
check('revenue adds up: principal 24,000, interest 2,667, fee 320, total 27,487', rev.revenue.principalRecovered === 24000 && rev.revenue.interestCollected === 2667 && rev.revenue.foreclosureFees === 320 && rev.revenue.totalCollected === 27487, JSON.stringify(rev.revenue));
check('nothing outstanding, nothing overdue', rev.portfolio.outstandingPrincipal === 0 && rev.risk.overdueAmount === 0);

await srv.stop();
await disconnect();
finish();
