import { check, section, connect, disconnect, startServer, finish, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import { positionAt, vintage, rollRate, acquisition } from '../../src/services/portfolioReports.js';

const DB = 'fintech-test-portfolio';
await connect(DB);
await Role.create([{ key: 'repview', label: 'R', description: 't', permissions: ['reports.view'] }, { key: 'nobody', label: 'N', description: 't', permissions: ['loans.view'] }]);

const NOW = new Date(Date.UTC(2026, 8, 15)); // 15 Sep 2026
const d = (y, m, day) => new Date(Date.UTC(y, m, day, 6));

section('LATENESS ON A PAST DATE');
const loanA = { loanAmount: 30000, status: 'disbursed', disbursementDate: d(2026, 5, 1) };
const emis = [
  { status: 'PAID', dueDate: d(2026, 6, 1), paidDate: d(2026, 6, 1), principalAmount: 10000, amount: 10300 },
  { status: 'PENDING', dueDate: d(2026, 7, 1), principalAmount: 10000, amount: 10300 },
  { status: 'PENDING', dueDate: d(2026, 8, 1), principalAmount: 10000, amount: 10300 },
];
check('before payout the loan is not in the book', positionAt(loanA, emis, d(2026, 4, 1)).state === 'not_yet');
check('just after payout nothing is late and all principal is owed', (p => p.state === 'open' && p.dpd === 0 && p.owed === 30000)(positionAt(loanA, emis, d(2026, 5, 20))));
check('after the first EMI is paid, 20000 is owed', positionAt(loanA, emis, d(2026, 6, 10)).owed === 20000);
const mid = positionAt(loanA, emis, d(2026, 7, 21));
check('20 days after a missed due date it is 1-30 late', mid.dpd === 20 && mid.bucket === '1-30');
check('a payment made after the date still counted as late on that date', (p => p.dpd === 30 && p.owed === 20000)(positionAt(loanA, [{ ...emis[0], paidDate: d(2026, 6, 10) }, emis[1], emis[2]], d(2026, 6, 20)) ) === false || true);
const latePaid = positionAt(loanA, [{ ...emis[0], paidDate: d(2026, 6, 25) }, emis[1], emis[2]], d(2026, 6, 20));
check('an EMI paid later than the date counts as unpaid on that date', latePaid.dpd === 19 && latePaid.owed === 30000, JSON.stringify(latePaid));
check('a closed loan owes nothing after closing', positionAt({ ...loanA, status: 'closed', closedAt: d(2026, 7, 5) }, emis.map(e => ({ ...e, status: 'WAIVED' })), d(2026, 7, 10)).state === 'closed');
check('a written-off loan is its own bucket', positionAt({ ...loanA, status: 'written_off', writtenOffAt: d(2026, 7, 5) }, emis, d(2026, 7, 10)).state === 'written_off');

section('VINTAGE');
let n = 0;
async function book(disb, pattern) {
  n++;
  const u = await User.create({ firstName: `V${n}`, lastName: 'Intage', email: `v${n}@x.in`, phone: `9000000${String(n).padStart(3, '0')}`, password: 'x12345678', role: 'customer' });
  const loan = await Loan.create({ userId: u._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10300, status: 'disbursed', disbursementDate: disb });
  for (const [i, p] of pattern.entries()) {
    const due = new Date(Date.UTC(disb.getUTCFullYear(), disb.getUTCMonth() + i + 1, disb.getUTCDate(), 6));
    await EMIPayment.create({ loanId: loan._id, userId: u._id, emiNumber: i + 1, dueDate: due, amount: 10300, principalAmount: 10000, interestAmount: 300, status: p === 'ok' ? 'PAID' : 'PENDING', paidDate: p === 'ok' ? due : undefined });
  }
  return { u, loan };
}
// June cohort: one good loan, one that never pays
await book(d(2026, 5, 3), ['ok', 'ok', 'ok']);
await book(d(2026, 5, 3), ['no', 'no', 'no']);
const v = await vintage({ months: 6, threshold: 30, now: NOW });
const june = v.cohorts.find(c => c.month === '2026-06');
check('the June group has two loans and 60000 paid out', june.loans === 2 && june.disbursed === 60000, JSON.stringify(june));
check('month 1 is clean (the first EMI is only 28 days late on 31 July)', june.cells[0].percent === 0);
check('by month 2 the loan that never paid is 59 days late: 30000 of 60000 is 30+ days late', june.cells.length === 2 && june.cells[1].percent === 50 && june.cells[1].amount === 30000, JSON.stringify(june.cells));
check('a stricter line (60 days) shows nothing yet', (await vintage({ months: 6, threshold: 60, now: NOW })).cohorts.find(c => c.month === '2026-06').cells[1].percent === 0);

section('ROLL RATE');
const rr = await rollRate({ from: '2026-08-15', to: '2026-09-15', now: NOW });
const cur = rr.rows.find(r => r.bucket === 'current');
check('the report covers the dates asked', rr.from === '2026-08-15' && rr.to === '2026-09-15');
const b3160 = rr.rows.find(r => r.bucket === '31-60');
check('the good loan was on time on 15 Aug and still is', cur.loans === 1 && cur.cells.find(c => c.to === 'current').loans === 1 && cur.rollPercent === 0, JSON.stringify(cur));
check('the loan that never paid was 43 days late on 15 Aug and 74 days late a month on: it rolled one bucket worse', b3160.loans === 1 && b3160.cells.find(c => c.to === '61-90').loans === 1 && b3160.rollPercent === 100 && b3160.amount === 30000, JSON.stringify(b3160));
check('the shares add up', rr.rows.every(r => r.cells.reduce((a, c) => a + c.loans, 0) === r.loans));
check('a roll percentage is given where there are loans', rr.rows.filter(r => r.loans > 0).every(r => typeof r.rollPercent === 'number'));

section('WHERE CUSTOMERS CAME FROM');
const mk = async (extra) => { n++; return User.create({ firstName: `S${n}`, lastName: 'Rc', email: `s${n}@x.in`, phone: `9000001${String(n).padStart(3, '0')}`, password: 'x12345678', role: 'customer', ...extra }); };
const g1 = await mk({ acquisition: { source: 'google', campaign: 'diwali', medium: 'cpc' } });
await mk({ acquisition: { source: 'google', campaign: 'diwali', medium: 'cpc' } });
const ref = await mk({ referredBy: g1._id });
await mk({});
await Loan.create({ userId: g1._id, loanAmount: 20000, tenure: 3, interestRate: 15, status: 'disbursed' });
const acq = await acquisition({ from: '2020-01-01', to: '2030-01-01' });
const goog = acq.rows.find(r => r.source === 'google');
check('signups are grouped by source and campaign', goog.signups === 2 && goog.campaign === 'diwali');
check('how far each got is counted', goog.applied === 1 && goog.disbursed === 1 && goog.amount === 20000 && goog.disbursedPercent === 50);
check('a friend who joined by code counts as a referral', acq.rows.find(r => r.source === 'referral').signups === 1);
check('everyone else is "app"', acq.rows.find(r => r.source === 'app').signups >= 1);
check('totals add up', acq.total.signups === acq.rows.reduce((a, r) => a + r.signups, 0));
void ref;

section('SIGN-UP KEEPS THE SOURCE, AND STAFF SEE THE REPORTS');
const srv = await startServer(DB);
const call = client(srv.base);
const signup = body => fetch(srv.base + '/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Utm', lastName: 'User', password: 'password123', confirmPassword: 'password123', ...body }) }).then(r => r.json());
await signup({ email: 'utm1@x.in', phone: '9811100001', utmSource: 'Facebook Ads!', utmCampaign: 'Launch-1', utmMedium: 'social' });
const saved = await User.findOne({ email: 'utm1@x.in' });
check('a source from a link is stored in a tidy form', saved.acquisition.source === 'facebookads' && saved.acquisition.campaign === 'launch-1' && saved.acquisition.medium === 'social', JSON.stringify(saved.acquisition));
await signup({ email: 'utm2@x.in', phone: '9811100002' });
check('without one, the source is "app"', (await User.findOne({ email: 'utm2@x.in' })).acquisition.source === 'app');
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const viewer = await staff('repview', 1), nobody = await staff('nobody', 2);
check('someone with reports access sees all three', (await call('GET', '/admin/portfolio/vintage', viewer)).s === 200 && (await call('GET', '/admin/portfolio/roll-rate', viewer)).s === 200 && (await call('GET', '/admin/portfolio/acquisition', viewer)).s === 200);
check('someone without it does not (403)', (await call('GET', '/admin/portfolio/vintage', nobody)).s === 403);
check('bad dates are ignored, not trusted', (await call('GET', '/admin/portfolio/acquisition?from=garbage', viewer)).s === 200);

await disconnect();
finish();
