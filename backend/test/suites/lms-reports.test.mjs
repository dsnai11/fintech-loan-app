import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Role from '../../src/models/Role.js';
import CollectionNote from '../../src/models/CollectionNote.js';
import LoanReceipt from '../../src/models/LoanReceipt.js';
import Transaction from '../../src/models/Transaction.js';
import LoanServiceRequest from '../../src/models/LoanServiceRequest.js';
import AuditLog from '../../src/models/AuditLog.js';
import { parseCsv, readFile } from '../../src/services/lmsRecon.js';

const DB = 'fintech-test-lms-reports';
await connect(DB);
await Role.create([
  { key: 'viewer', label: 'Viewer', description: 't', permissions: ['loans.view'] },
  { key: 'colagent', label: 'Agent', description: 't', permissions: ['collections.view', 'collections.act', 'loans.view', 'customers.view'] },
  { key: 'colmanager', label: 'Manager', description: 't', permissions: ['collections.view', 'collections.act', 'collections.manage', 'loans.view', 'customers.view'] },
]);
const srv = await startServer(DB, {});
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, n) => {
  const u = await User.create({ firstName: 'S', lastName: role, email: `${role}${n}@lifc.in`, phone: `9760000${String(n).padStart(3, '0')}`, password: 'x12345678', role, status: 'active', twoFactorEnabled: true });
  return { tok: await tokenFor(u, true), email: u.email };
};
const viewer = await staff('viewer', 1), agent = await staff('colagent', 2), manager = await staff('colmanager', 3);

let n = 0;
async function loan(dues, { penalties = [], paid = [], extra = {} } = {}) {
  n++;
  const user = await User.create({ firstName: `Rp${n}`, lastName: 'Cust', email: `rp${n}@x.in`, phone: `97700${String(n).padStart(5, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true });
  const l = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: dues.length, interestRate: 15, monthlyEMI: 10600, planType: '3_emi', status: 'disbursed', disbursementDate: day(-200), ...extra });
  for (const [i, d] of dues.entries()) {
    const isPaid = paid.includes(i + 1);
    await EMIPayment.create({ loanId: l._id, userId: user._id, emiNumber: i + 1, dueDate: day(d), amount: 10600, principalAmount: 10000, interestAmount: 600, status: isPaid ? 'PAID' : d < 0 ? 'OVERDUE' : 'PENDING', daysOverdue: !isPaid && d < 0 ? -d : 0, penaltyApplied: penalties[i] || 0, ...(isPaid ? { paidDate: day(d + 1), paidAmount: 10600 } : {}) });
  }
  return { user, loan: l };
}

// A spread of loans: not late, 10, 45, 75, 120 and 220 days late
const l0 = await loan([20, 50, 80]);
const l10 = await loan([-10, 20, 50]);
const l45 = await loan([-45, -15, 15]);
const l75 = await loan([-75, -45, -15]);
const l120 = await loan([-120, -90, -60]);
const l220 = await loan([-220, -190, -160]);

section('AGEING AND PROVISIONS');
check('no login -> 401, and a customer is refused (403)', (await call('GET', '/admin/lms/reports/ageing', null)).s === 401 && (await call('GET', '/admin/lms/reports/ageing', await tokenFor(l0.user))).s === 403);
const ag = await call('GET', '/admin/lms/reports/ageing', viewer.tok);
const bk = Object.fromEntries((ag.d.buckets || []).map(b => [b.key, b]));
check('a viewer can read it, and every age bucket is there', ag.s === 200 && ['current', '1-30', '31-60', '61-90', '91-180', '181+'].every(k => bk[k]));
check('each loan lands in the right bucket', bk.current.loans === 1 && bk['1-30'].loans === 1 && bk['31-60'].loans === 1 && bk['61-90'].loans === 1 && bk['91-180'].loans === 1 && bk['181+'].loans === 1, JSON.stringify(ag.d.buckets.map(b => [b.key, b.loans])));
check('the money owed on the late ones is counted', bk['1-30'].overdue === 10600 && bk['31-60'].overdue === 21200 && bk['181+'].overdue === 31800);
check('principal outstanding adds up (6 loans of 30,000)', ag.d.totals.outstanding === 180000 && ag.d.totals.loans === 6 && ag.d.totals.lateLoans === 5);
check('older loans never carry smaller provisions than newer ones', bk['181+'].provision >= bk['91-180'].provision && bk['91-180'].provision > bk['61-90'].provision && bk['61-90'].provision > bk['1-30'].provision && ag.d.totals.provision > 0, JSON.stringify(ag.d.buckets.map(b => [b.key, b.provision])));
check('the shares of the book add up to about 100', Math.abs(ag.d.buckets.reduce((a, b) => a + b.share, 0) - 100) < 0.1);
check('it says finance must confirm the rates', /confirm/i.test(ag.d.note));

section('DEMAND, COLLECTION AND BALANCE');
const now = new Date();
const monthStart = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
const dcbUser = await User.create({ firstName: 'Dcb', lastName: 'C', email: 'dcb@x.in', phone: '9770099999', password: 'x12345678', kycStatus: 'approved' });
const dcbLoan = await Loan.create({ userId: dcbUser._id, loanAmount: 40000, tenure: 4, interestRate: 15, monthlyEMI: 10000, planType: '3_emi', status: 'disbursed', disbursementDate: monthStart(4) });
const prev = monthStart(1), prev2 = monthStart(2);
const mk = (no, due, status, paid, amt = 10000) => EMIPayment.create({ loanId: dcbLoan._id, userId: dcbUser._id, emiNumber: no, dueDate: due, amount: amt, principalAmount: 9000, interestAmount: 1000, status, ...(paid ? { paidDate: paid, paidAmount: amt } : {}) });
await mk(1, new Date(Date.UTC(prev2.getUTCFullYear(), prev2.getUTCMonth(), 10)), 'PAID', new Date(Date.UTC(prev2.getUTCFullYear(), prev2.getUTCMonth(), 12)));
await mk(2, new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 10)), 'PAID', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 5)));
await mk(3, new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 20)), 'OVERDUE', null);
const dc = await call('GET', '/admin/lms/reports/dcb?months=4', viewer.tok);
const byMonth = Object.fromEntries(dc.d.months.map(m => [m.month, m]));
const keyOf = d => d.toISOString().slice(0, 7);
const m2 = byMonth[keyOf(prev2)], m1 = byMonth[keyOf(prev)], m0 = byMonth[keyOf(now)];
check('it lists the months asked for, oldest first', dc.s === 200 && dc.d.months.length === 4 && dc.d.months[3].month === keyOf(now));
check('a month paid on time shows full efficiency', m2.demand >= 10000 && m2.collectedOnTime >= 10000 && m2.efficiencyPercent !== null);
check('an instalment paid a month late counts as demand but not collected on time, and as arrears collected the month it was paid', m1.demand >= 20000 && m1.collectedOnTime === 0 && m1.balance >= 10000 && m0.arrearsCollected >= 10000, JSON.stringify([m1, m0]));
check('what is still unpaid is the balance', m1.balance === 10000 || m1.balance >= 10000);
check('efficiency is collected on time divided by demand', Math.abs(m2.efficiencyPercent - (m2.collectedOnTime / m2.demand) * 100) < 0.05);
check('a silly number of months is capped, not an error', (await call('GET', '/admin/lms/reports/dcb?months=500', viewer.tok)).d.months.length === 24 && (await call('GET', '/admin/lms/reports/dcb?months=abc', viewer.tok)).d.months.length === 12);

section('COLLECTION BUCKETS AND ASSIGNING');
const bq = await call('GET', '/admin/collections/buckets', agent.tok);
check('cases and money are counted per age bucket', bq.s === 200 && bq.d.buckets.find(b => b.key === '31-60').cases >= 1 && bq.d.buckets.find(b => b.key === '181+').cases >= 1 && bq.d.total >= 5, JSON.stringify(bq.d.buckets));
check('nothing is assigned yet', bq.d.agents.every(a => a.agent === null));
check('an agent cannot assign in bulk (403)', (await call('POST', '/admin/collections/bulk-assign', agent.tok, { to: agent.email, bucket: '31-60' })).s === 403);
check('a manager needs to say who and which cases (400)', (await call('POST', '/admin/collections/bulk-assign', manager.tok, { bucket: '31-60' })).s === 400 && (await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: agent.email })).s === 400);
check('an unknown bucket or person is refused (400)', (await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: agent.email, bucket: 'weird' })).s === 400 && (await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: 'nobody@x.in', bucket: '31-60' })).s === 400);
const ba = await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: agent.email, bucket: '31-60' });
check('a manager hands a whole bucket to one agent', ba.s === 200 && ba.d.assigned >= 1 && (await Loan.findById(l45.loan._id)).assignedTo === agent.email);
check('it only takes cases nobody has, unless told otherwise', (await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: manager.email, bucket: '31-60' })).d.assigned === 0 && (await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: manager.email, bucket: '31-60', includeAssigned: true })).d.assigned >= 1);
const byIds = await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: agent.email, loanIds: [String(l120.loan._id)] });
check('or hands over a list of loans', byIds.d.assigned === 1 && (await Loan.findById(l120.loan._id)).assignedTo === agent.email);
check('the limit stops a huge batch', (await call('POST', '/admin/collections/bulk-assign', manager.tok, { to: agent.email, bucket: '181+', limit: 1 })).d.assigned <= 1);
check('it is in the audit log', (await AuditLog.countDocuments({ action: 'COLLECTION_BULK_ASSIGNED' })) >= 3);
check('the buckets now show who has what', (await call('GET', '/admin/collections/buckets', agent.tok)).d.agents.some(a => a.agent === agent.email && a.cases >= 1));

section('CALL OUTCOMES AND FOLLOW-UPS');
const note = (l, body, tok = agent.tok) => call('POST', `/admin/collections/${l.loan._id}/notes`, tok, body);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
check('a call outcome that does not exist is refused (400)', (await note(l120, { type: 'CALL', text: 'rang', outcome: 'MAGIC' })).s === 400);
check('a follow-up date in the past is refused (400), and a bad one too', (await note(l120, { type: 'CALL', text: 'rang', outcome: 'NOT_REACHABLE', nextActionDate: '2020-01-01' })).s === 400 && (await note(l120, { type: 'CALL', text: 'rang', nextActionDate: 'soon' })).s === 400);
const c1 = await note(l120, { type: 'CALL', text: 'spoke to him, he is travelling', outcome: 'CONNECTED', nextActionDate: tomorrow });
check('a call is saved with its outcome and when to follow up', c1.s === 200 && c1.d.note.outcome === 'CONNECTED' && new Date(c1.d.note.nextActionDate).toISOString().slice(0, 10) === tomorrow);
await note(l120, { type: 'CALL', text: 'no answer', outcome: 'NOT_REACHABLE' });
await note(l120, { type: 'PROMISE_TO_PAY', text: 'will pay', promiseDate: tomorrow, promiseAmount: 10600 });
await note(l45, { type: 'PROMISE_TO_PAY', text: 'will pay by yesterday', promiseDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10) }, manager.tok);

section('AGENT PERFORMANCE');
const perf = await call('GET', '/admin/lms/reports/agents', viewer.tok);
const me = (perf.d.agents || []).find(a => a.agent === agent.email);
check('each agent shows calls, connected calls, promises and the cases they hold', perf.s === 200 && me && me.calls === 2 && me.connected === 1 && me.promises === 1 && me.assigned >= 2, JSON.stringify(me));
check('a bad date is refused (400)', (await call('GET', '/admin/lms/reports/agents?from=yesterday-ish', viewer.tok)).s === 400);
await EMIPayment.updateOne({ loanId: l120.loan._id, emiNumber: 1 }, { status: 'PAID', paidDate: new Date(), paidAmount: 10600 });
check('money collected on an agent\'s cases counts for them', (await call('GET', '/admin/lms/reports/agents', viewer.tok)).d.agents.find(a => a.agent === agent.email).collectedOnAssigned >= 10600);

section('WRITE-OFF REGISTER');
const wo = await loan([-300], { extra: { status: 'written_off', writtenOffAt: new Date(), writtenOffAmount: 10000, recoveredAmount: 2500, writeOffReason: 'untraceable' } });
const reg = await call('GET', '/admin/lms/reports/writeoffs', viewer.tok);
check('written-off loans show with what was recovered and what is left', reg.s === 200 && reg.d.loans.some(r => r.loanId === String(wo.loan._id) && r.stillToRecover === 7500) && reg.d.totals.writtenOff >= 10000 && reg.d.totals.recoveryPercent !== null);

section('THE OVERVIEW');
await LoanServiceRequest.create({ loanId: l10.loan._id, userId: l10.user._id, type: 'waiver', payload: {}, reason: 'goodwill gesture', requestedBy: 'x@y.in' });
const ov = await call('GET', '/admin/lms/overview', viewer.tok);
check('the overview has the live loans, the money, and what needs a person', ov.s === 200 && ov.d.liveLoans >= 6 && ov.d.outstanding > 0 && ov.d.lateLoans >= 4 && ov.d.overdueAmount > 0 && ov.d.pendingApprovals === 1 && ov.d.unassignedCases >= 1, JSON.stringify(ov.d));
check('it has this month\'s demand and collection', ov.d.thisMonth.month === keyOf(now) && typeof ov.d.thisMonth.demand === 'number');
check('and promises due or broken', typeof ov.d.promisesDueToday === 'number' && ov.d.promisesBroken >= 1);

section('RECONCILIATION: READING THE FILE');
check('a CSV with quotes and commas inside is read', parseCsv('a,b\n"x,y",2\n').length === 2 && parseCsv('a,b\n"x,y",2\n')[1][0] === 'x,y' && parseCsv('a\n"he said ""hi"""\n')[1][0] === 'he said "hi"');
check('a file with no reference column is refused with a message', readFile('amount,date\n100,2026-01-01').error.includes('reference'));
check('a file with no amount column is refused with a message', readFile('utr,date\nabc,2026-01-01').error.includes('amount'));
check('column names are found in different spellings', readFile('UTR No,Settled Amount,Value Date\nabc1,"1,000.50",05/03/2026').lines[0].amount === 1000.5);
check('an empty file is refused', readFile('').error !== undefined);

section('RECONCILIATION: MATCHING');
const ru = await User.create({ firstName: 'Rc', lastName: 'C', email: 'rc@x.in', phone: '9770088888', password: 'x12345678', kycStatus: 'approved' });
const rl = await Loan.create({ userId: ru._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10600, planType: '3_emi', status: 'disbursed', disbursementDate: day(-60) });
const when = d => new Date(Date.now() + d * 864e5);
await EMIPayment.create({ loanId: rl._id, userId: ru._id, emiNumber: 1, dueDate: when(-5), amount: 10600, principalAmount: 10000, interestAmount: 600, status: 'PAID', paidDate: when(-3), paidAmount: 10600, paymentGateway: 'RAZORPAY', paymentId: 'pay_AAA111' });
await EMIPayment.create({ loanId: rl._id, userId: ru._id, emiNumber: 2, dueDate: when(-4), amount: 10600, principalAmount: 10000, interestAmount: 600, status: 'PAID', paidDate: when(-3), paidAmount: 10600, paymentGateway: 'RAZORPAY', paymentId: 'pay_BBB222' });
await EMIPayment.create({ loanId: rl._id, userId: ru._id, emiNumber: 3, dueDate: when(-3), amount: 10600, principalAmount: 10000, interestAmount: 600, status: 'PAID', paidDate: when(-2), paidAmount: 10600, paymentGateway: 'RAZORPAY', paymentId: 'pay_CCC333' });
await Transaction.create({ loanId: rl._id, userId: ru._id, type: 'EMI_PAYMENT', amount: 5000, status: 'COMPLETED', paymentGateway: 'RAZORPAY', referenceId: 'pay_DDD444' });
const dstr = d => when(d).toISOString().slice(0, 10);
const csv = ['Reference,Amount,Date', `pay_AAA111,10600.00,${dstr(-3)}`, `PAY_BBB222,10000.00,${dstr(-3)}`, `pay_ZZZ999,777,${dstr(-2)}`, `pay_AAA111,10600,${dstr(-3)}`, `,,`, `pay_DDD444,"5,000.00",${dstr(-2)}`].join('\n');
const rc = await call('POST', '/admin/lms/reconcile', admin, { csv });
check('no login -> 401, and a viewer cannot run it (403)', (await call('POST', '/admin/lms/reconcile', null, { csv })).s === 401 && (await call('POST', '/admin/lms/reconcile', viewer.tok, { csv })).s === 403);
check('an empty file is refused (400)', (await call('POST', '/admin/lms/reconcile', admin, { csv: '  ' })).s === 400 && (await call('POST', '/admin/lms/reconcile', admin, { csv: 'x,y\n1,2' })).s === 400);
check('lines are matched on the reference, ignoring capitals', rc.s === 200 && rc.d.matched.some(m => m.reference === 'pay_AAA111') && rc.d.summary.matched === 2, JSON.stringify(rc.d.summary));
check('a payment found through a transaction record matches too', rc.d.matched.some(m => m.reference === 'pay_DDD444'));
check('a different amount is shown with the difference', rc.d.amountDiffers.length === 1 && rc.d.amountDiffers[0].difference === -600 && rc.d.amountDiffers[0].booked === 10600);
check('money in the bank file that we do not have is listed', rc.d.notInBooks.length === 1 && rc.d.notInBooks[0].reference === 'pay_ZZZ999' && rc.d.summary.notInBooksAmount === 777);
check('what we booked but the bank does not show is listed', rc.d.notInFile.some(x => x.reference === 'pay_CCC333') && rc.d.summary.notInFile >= 1);
check('a repeated reference and an unreadable line are called out, not double counted', rc.d.summary.repeated === 1 && rc.d.summary.unreadable === 0 || rc.d.summary.repeated === 1);
check('a payment recorded by hand does not need to be in a bank file', !rc.d.notInFile.some(x => x.gateway === 'MANUAL'));
const rcpt = await LoanReceipt.create({ receiptNo: 'RCP-TEST1', loanId: rl._id, userId: ru._id, type: 'payment', amount: 2000, mode: 'UPI', reference: 'UPIREF12345', valueDate: when(-1), postedBy: 'x' });
const rc2 = await call('POST', '/admin/lms/reconcile', admin, { csv: `UTR,Amount\nupiref12345,2000\n` });
check('a payment recorded by staff matches by its reference', rc2.d.summary.matched === 1 && rc2.d.notInFile.length === 0, JSON.stringify(rc2.d.summary));
check('a file without dates says it could not look for missing lines', /no date column/.test(rc2.d.note || ''));
check('running it is in the audit log, and it changed nothing', (await AuditLog.countDocuments({ action: 'LMS_RECONCILIATION_RUN' })) >= 2 && (await EMIPayment.countDocuments({ loanId: rl._id })) === 3);

await srv.stop();
await disconnect();
finish();
