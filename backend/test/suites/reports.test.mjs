import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';

const DB = 'fintech-test-reports';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const mkUser = (first, last, phone, state) => User.create({ firstName: first, lastName: last, email: `${first.replace(/\W/g, '')}@x.in`.toLowerCase(), phone, password: 'x12345678', address: state ? { state } : undefined });
const a = await mkUser('=HYPERLINK(1)', 'Aa', '9200000001', 'Maharashtra');
const b = await mkUser('Bee', 'Bb', '9200000002', 'Maharashtra');
const c = await mkUser('Cee', 'Cc', '9200000003', null);

const mkLoan = (u, amount, status, extra = {}) => Loan.create({ userId: u._id, loanAmount: amount, tenure: 3, interestRate: 15, monthlyEMI: 10000, status, ...extra });
const l1 = await mkLoan(a, 30000, 'disbursed', { disbursementDate: day(-100), disbursedAmount: 30000 });
const l2 = await mkLoan(b, 20000, 'disbursed', { disbursementDate: day(-60), disbursedAmount: 20000 });
const l3 = await mkLoan(c, 10000, 'closed', { disbursementDate: day(-70), disbursedAmount: 10000 });
await mkLoan(a, 5000, 'rejected');
await mkLoan(b, 7000, 'submitted');

const emi = (l, u, n, due, status, extra = {}) => EMIPayment.create({ loanId: l._id, userId: u._id, emiNumber: n, dueDate: due, amount: 10000, principalAmount: 8000, interestAmount: 2000, status, ...extra });
await emi(l1, a, 1, day(-100), 'OVERDUE'); // 100 days overdue
await emi(l1, a, 2, day(-70), 'PENDING');
await emi(l2, b, 1, day(-40), 'OVERDUE'); // 40 days overdue
await emi(l2, b, 2, day(20), 'PENDING'); // not due yet
await emi(l3, c, 1, day(-60), 'PAID', { paidDate: day(-59), paidAmount: 10500, penaltyApplied: 500 });
await emi(l3, c, 2, day(-30), 'PAID', { paidDate: day(-29), paidAmount: 10000 });

section('SUMMARY NUMBERS (worked out by hand from the data above)');
const r = await call('GET', '/admin/reports/summary', admin);
const d = r.d;
check('summary loads', r.s === 200);
check('5 loans in total', d.portfolio.totalLoans === 5);
check('total disbursed 60,000 (30k + 20k + 10k)', d.portfolio.totalDisbursed === 60000, d.portfolio.totalDisbursed);
check('outstanding principal 32,000 (4 unpaid EMIs x 8,000)', d.portfolio.outstandingPrincipal === 32000, d.portfolio.outstandingPrincipal);
check('average loan 20,000', d.portfolio.averageTicket === 20000);
check('approval rate 75% (3 approved of 4 decided)', d.portfolio.approvalRate === 75, d.portfolio.approvalRate);
check('interest collected 4,000', d.revenue.interestCollected === 4000);
check('late fees collected 500', d.revenue.penaltiesCollected === 500);
check('principal recovered 16,000', d.revenue.principalRecovered === 16000);
check('total collected 20,500', d.revenue.totalCollected === 20500);
check('overdue amount 30,000 (three missed EMIs)', d.risk.overdueAmount === 30000, d.risk.overdueAmount);
check('overdue EMI rate 60% (3 missed of 5 due)', d.risk.overdueEmiRate === 60, d.risk.overdueEmiRate);
check('2 loans past due, 2 at 30+ days, 1 at 90+ days', d.risk.loansPastDue === 2 && d.risk.loans30Plus === 2 && d.risk.loans90Plus === 1);
check('default rate 33.3% (1 of 3 disbursed loans)', d.risk.defaultRate90 === 33.3, d.risk.defaultRate90);
check('top state is Maharashtra with 4 loans and 62,000', d.geography[0].state === 'Maharashtra' && d.geography[0].loans === 4 && d.geography[0].amount === 62000, JSON.stringify(d.geography[0]));
check('customers with no state are grouped, not lost', d.geography.some(g => g.state === 'Not provided' && g.amount === 10000));
check('6 months of trend, amounts add up', d.trend.length === 6 && d.trend.reduce((s, m) => s + m.disbursed, 0) === 60000 && d.trend.reduce((s, m) => s + m.collected, 0) === 20500);

section('CSV EXPORT');
const raw = await fetch(`${srv.base}/admin/reports/export?type=loans`, { headers: { Authorization: `Bearer ${admin}` } });
const csv = await raw.text();
check('loans CSV downloads with a header row', raw.status === 200 && csv.startsWith('"Loan ID","Applied"') && csv.split('\r\n').length === 6);
check('formula injection is blocked (cell starting with = is prefixed)', csv.includes(`"'=HYPERLINK(1) Aa"`), csv.split('\r\n')[1]);
const emisCsv = await fetch(`${srv.base}/admin/reports/export?type=emis`, { headers: { Authorization: `Bearer ${admin}` } });
check('EMI CSV downloads', emisCsv.status === 200 && (await emisCsv.text()).split('\r\n').length === 7);
check('month filter must be YYYY-MM (400)', (await call('GET', '/admin/reports/export?month=2026-13', admin)).s === 400);
check('unknown export type (400)', (await call('GET', '/admin/reports/export?type=x', admin)).s === 400);

section('ACCESS');
check('no token -> 401', (await call('GET', '/admin/reports/summary', null)).s === 401);
check('customer -> 403', (await call('GET', '/admin/reports/summary', await tokenFor(a))).s === 403);

await srv.stop();
await disconnect();
finish();
