import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import SupportThread from '../../src/models/SupportThread.js';

const DB = 'fintech-test-dashboard';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const mk = async (n, over = {}) => User.create({ firstName: `C${n}`, lastName: 'D', email: `d${n}@x.in`, phone: `9620000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved', ...over });
const [u1, u2, u3, u4, u5] = await Promise.all([mk(1, { phoneVerified: true, bureauConsentAt: new Date() }), mk(2, { phoneVerified: true }), mk(3), mk(4), mk(5)]);
const setDates = async (model, id, dates) => model.collection.updateOne({ _id: id }, { $set: dates }); // createdAt is write-protected in the model, so go underneath
const hours = n => n * 36e5;

const mkLoan = async (u, status, amount, createdDaysAgo, extra = {}) => {
  const l = await Loan.create({ userId: u._id, loanAmount: amount, tenure: 3, interestRate: 15, monthlyEMI: amount / 3, totalAmount: amount, status, ...extra });
  const created = day(-createdDaysAgo);
  await setDates(Loan, l._id, { createdAt: created });
  return { l, created };
};
const emi = (l, u, n, dueDaysAgo, status, amount, principal, extra = {}) => EMIPayment.create({ loanId: l._id, userId: u._id, emiNumber: n, dueDate: day(-dueDaysAgo), amount, principalAmount: principal, interestAmount: amount - principal, status, ...extra });

// A: lent 3 days ago, decided after 2 hours, paid out after 5 hours, first EMI paid
const A = await mkLoan(u1, 'disbursed', 30000, 3, { disbursementDate: new Date(Date.now() - 3 * 864e5 + hours(5)), approvalDate: new Date(Date.now() - 3 * 864e5 + hours(2)), disbursedAmount: 29000 });
await emi(A.l, u1, 1, 1, 'PAID', 10000, 9000, { paidAmount: 10000, paidDate: day(-1) });
await emi(A.l, u1, 2, -29, 'PENDING', 10000, 9500);
// B: lent 60 days ago, an instalment 45 days late
const B = await mkLoan(u2, 'disbursed', 9000, 60, { disbursementDate: day(-59), approvalDate: day(-59.9) });
await emi(B.l, u2, 1, 45, 'OVERDUE', 3000, 2800);
await emi(B.l, u2, 2, 15, 'OVERDUE', 3000, 2800);
// C: rejected, D: waiting, E: lent in the period before this one
await mkLoan(u3, 'rejected', 5000, 4, { rejectionReason: 'Income too low' });
await mkLoan(u4, 'submitted', 7000, 1);
await mkLoan(u5, 'disbursed', 5000, 40, { disbursementDate: day(-40), approvalDate: day(-40) });
await AmlAlert.create({ userId: u1._id, type: 'DUPLICATE_PAN', severity: 'HIGH', status: 'OPEN', description: 't' }).catch(() => {});
await SupportThread.create({ userId: u2._id, status: 'open', lastFrom: 'customer', messages: [{ from: 'customer', text: 'hello' }] });

section('ACCESS');
check('sign-in is needed (401)', (await call('GET', '/admin/dashboard', null)).s === 401);
check('a customer cannot see it (403)', (await call('GET', '/admin/dashboard', await tokenFor(u1))).s === 403);

section('HEADLINE FIGURES FOR 30 DAYS');
const d = await call('GET', '/admin/dashboard?days=30', admin);
check('it loads', d.s === 200 && d.d.days === 30 && d.d.kpis.length === 8, JSON.stringify(d.d).slice(0, 200));
const k = Object.fromEntries(d.d.kpis.map(x => [x.key, x]));
check('money lent is the paid-out amount of loans lent in the period (A: 29,000, not E from 40 days ago)', k.disbursed.value === 29000, k.disbursed.value);
check('the period before has B (9,000) and E (5,000) and the change is worked out', k.disbursed.previous === 14000 && k.disbursed.change === 107.1, JSON.stringify(k.disbursed));
check('money collected is what was paid in the period', k.collected.value === 10000);
check('applications in the period: A, C, D, B is older (3 of the 5 are within 30 days)', k.applications.value === 3, k.applications.value);
check('new customers', k.customers.value === 5);
check('approval rate: A approved, C rejected = 50%', k.approval.value === 50, k.approval.value);
check('median time to decision is 2 hours', k.decision.value === 2, k.decision.value);
check('average loan', k.ticket.value === 29000);

section('BOOK HEALTH');
const b = d.d.book;
const bk = Object.fromEntries(b.buckets.map(x => [x.key, x]));
check('loan B is in the 31 to 60 days late bucket (worst instalment 45 days)', bk.d31_60.loans === 1 && bk.d31_60.overdueAmount === 6000, JSON.stringify(bk));
check('loan A is not late', bk.current.loans === 1);
check('outstanding principal adds up the unpaid instalments', b.outstandingPrincipal === 9500 + 2800 + 2800, b.outstandingPrincipal);
check('more than 30 days late is that loan\'s share of the book', b.par30 === +((5600 / 15100) * 100).toFixed(1) && b.par90 === 0, JSON.stringify([b.par30, b.par90]));

section('FUNNEL, MIX AND ATTENTION');
const f = Object.fromEntries(d.d.funnel.map(x => [x.key, x]));
check('funnel counts people at each step', f.registered.count === 5 && f.phone.count === 2 && f.checked.count === 1 && f.applied.count === 5 && f.disbursed.count === 3, JSON.stringify(d.d.funnel.map(x => x.count)));
check('each step is shown as a share of those registered', f.phone.ofRegistered === 40);
check('rejection reasons are listed', d.d.mix.rejectionReasons[0].reason === 'Income too low');
check('the product mix is listed', d.d.mix.products[0].product === 'personal');
const att = Object.fromEntries(d.d.needsAttention.map(x => [x.key, x.count]));
check('items needing attention: 1 application to decide, 1 open message', att.decide === 1 && att.support === 1, JSON.stringify(att));
check('and each has a page to go to', d.d.needsAttention.every(x => /\.html$/.test(x.href)));
check('plain-language insights are given', d.d.insights.length >= 3 && d.d.insights.every(i => i.text && i.tone));

section('PERIODS');
const week = await call('GET', '/admin/dashboard?days=7', admin);
check('7 days: loan A still counts, the older ones do not', week.d.kpis.find(x => x.key === 'disbursed').value === 29000 && week.d.trend.grain === 'day');
const year = await call('GET', '/admin/dashboard?days=365', admin);
check('a year groups the trend by week and includes the older loans (29,000 + 9,000 + 5,000)', year.d.trend.grain === 'week' && year.d.kpis.find(x => x.key === 'disbursed').value === 43000, year.d.kpis.find(x => x.key === 'disbursed').value);
check('an odd period falls back to 30 days', (await call('GET', '/admin/dashboard?days=11', admin)).d.days === 30);

section('TARGETS');
check('credit officers can read but not set targets (403)', await (async () => {
  const officer = await User.create({ firstName: 'Off', lastName: 'Icer', email: 'officer@lifc.in', phone: '9630000001', password: 'x12345678', role: 'credit_officer', twoFactorEnabled: true });
  const t = await tokenFor(officer, true);
  return (await call('GET', '/admin/dashboard', t)).s === 200 && (await call('PUT', '/admin/dashboard/targets', t, { monthlyDisbursal: 1 })).s === 403;
})());
check('a negative target is refused (400)', (await call('PUT', '/admin/dashboard/targets', admin, { monthlyDisbursal: -5 })).s === 400);
check('efficiency above 100 is refused (400)', (await call('PUT', '/admin/dashboard/targets', admin, { collectionEfficiencyPct: 120 })).s === 400);
check('targets are saved', (await call('PUT', '/admin/dashboard/targets', admin, { monthlyDisbursal: 1000000, collectionEfficiencyPct: 95, monthlyNewCustomers: 100 })).s === 200);
const t2 = (await call('GET', '/admin/dashboard', admin)).d;
check('progress against the target is shown', t2.targets.monthlyDisbursal === 1000000 && typeof t2.monthToDate.expectedByNow === 'number' && t2.insights.some(i => /monthly target/.test(i.text)), JSON.stringify(t2.monthToDate));

section('EXPORT');
const csv = await fetch(`${srv.base}/admin/dashboard/export?days=30`, { headers: { Authorization: `Bearer ${admin}` } });
const text = await csv.text();
check('a spreadsheet of the same figures ' + csv.status + text.slice(0, 80), csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && text.includes('Money lent') && text.includes('Outstanding principal'));

await srv.stop();
await disconnect();
finish();
