import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import { setConfig } from '../../src/services/configService.js';
import { nextPayday, DEFAULTS, validateSettings, aprFor } from '../../src/services/paydayService.js';
import { createEMISchedule } from '../../src/services/emiService.js';

const DB = 'fintech-test-payday';
await connect(DB);
const ENV = { REQUIRE_ONBOARDING: 'false', REQUIRE_TERMS: 'false', REQUIRE_PHONE_VERIFIED: 'true' };

let n = 0;
const mk = async (over = {}) => {
  n++;
  const user = await User.create({ firstName: `Pay${n}`, lastName: 'Day', email: `pay${n}@x.in`, phone: `9500000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, ...over });
  return { user, token: await tokenFor(user) };
};

section('SWITCHED OFF BY DEFAULT');
const off = await startServer(DB, ENV);
const callOff = client(off.base);
const c0 = await mk();
const s0 = (await callOff('GET', '/payday/status', c0.token)).d;
check('status says it is off and nobody is eligible', s0.enabled === false && s0.eligible === false);
const a0 = await callOff('POST', '/payday/apply', c0.token, { amount: 5000 });
check('applying is refused (400 PAYDAY_OFF)', a0.s === 400 && a0.d.code === 'PAYDAY_OFF', JSON.stringify(a0.d));

section('PAYDAY DATES');
const D = { ...DEFAULTS };
const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const iso = d => d.toISOString().slice(0, 10);
const p1 = nextPayday(28, at(2026, 1, 10), D);
check('salary on the 28th, today the 10th: due the 29th, 19 days', iso(p1.due) === '2026-01-29' && p1.days === 19, JSON.stringify(p1));
const p2 = nextPayday(28, at(2026, 1, 26), D);
check('payday only 3 days away: moves to the next one (1 March)', iso(p2.due) === '2026-03-01' && p2.days === 34, JSON.stringify(p2));
const p3 = nextPayday(31, at(2026, 2, 3), D);
check('salary on the 31st in February: last day of the month, due 1 March', iso(p3.due) === '2026-03-01' && p3.days === 26, JSON.stringify(p3));
const p4 = nextPayday(1, at(2026, 12, 20), D);
check('crosses the year: salary on the 1st, due 2 January', iso(p4.due) === '2027-01-02', JSON.stringify(p4));

section('THE RULES CANNOT BE SET WRONG');
check('a fee of 30% is refused', validateSettings({ ...D, feePercent: 30 }).errors.length === 1);
check('smallest above largest is refused', validateSettings({ ...D, minAmount: 9000, maxAmount: 5000 }).errors.length === 1);
check('the defaults are accepted', validateSettings(D).errors.length === 0);
check('yearly cost is higher for fewer days', aprFor(100, 1000, 5) > aprFor(100, 1000, 30));

section('ON');
await setConfig('PAYDAY_SETTINGS', JSON.stringify({ ...DEFAULTS, enabled: true }), { group: 'app' });
const srv = await startServer(DB, ENV);
const call = client(srv.base);
const admin = await makeAdmin();

const c1 = await mk();
const st1 = (await call('GET', '/payday/status', c1.token)).d;
check('a new customer: on, but not eligible', st1.enabled === true && st1.eligible === false);
const missing = st1.checks.filter(x => !x.ok).map(x => x.key);
check('salary day, income and salaried are what is missing', ['salaried', 'salaryDay', 'income'].every(k => missing.includes(k)), missing.join());
check('they are told what to do first', !!st1.firstProblem);
check('a salary day of 40 is refused', (await call('PUT', '/payday/salary-day', c1.token, { salaryDay: 40, monthlyIncome: 40000 })).s === 400);
check('income of 10 rupees is refused', (await call('PUT', '/payday/salary-day', c1.token, { salaryDay: 5, monthlyIncome: 10 })).s === 400);
const set = await call('PUT', '/payday/salary-day', c1.token, { salaryDay: 28, monthlyIncome: 40000, company: 'Acme Ltd' });
check('salary day and income saved: now eligible', set.s === 200 && set.d.eligible === true && set.d.salaryDay === 28, JSON.stringify(set.d));
check('they can borrow half their income (20,000), no more', set.d.maxAmount === 20000 && set.d.minAmount === 1000, JSON.stringify([set.d.minAmount, set.d.maxAmount]));
check('the next payday is shown', !!set.d.nextPayday?.dueDate && set.d.nextPayday.days >= 5);

section('THE COST');
const q = (await call('GET', '/payday/quote?amount=10000', c1.token)).d.quote;
check('fee 4% = 400, GST 72, they receive 9,528 and repay 10,000', q.processingFee === 400 && q.gst === 72 && q.netDisbursed === 9528 && q.totalRepayable === 10000, JSON.stringify([q.processingFee, q.gst, q.netDisbursed, q.totalRepayable]));
check('the yearly cost is shown and matches the days', q.aprPercent === aprFor(472, 9528, q.payday.days) && q.aprPercent > 0);
check('the repayment date is the payday', !!q.payday.dueDate && q.payday.salaryDay === 28);

section('APPLYING');
const over = await call('POST', '/payday/apply', c1.token, { amount: 25000 });
check('above their limit is refused (400 ABOVE_LIMIT)', over.s === 400 && over.d.code === 'ABOVE_LIMIT');
check('a part-rupee amount is refused', (await call('POST', '/payday/apply', c1.token, { amount: 5000.5 })).s === 400);
const ok = await call('POST', '/payday/apply', c1.token, { amount: 10000 });
check('within their limit is accepted (201)', ok.s === 201 && ok.d.loan.disbursedAmount === 9528 && ok.d.loan.repay === 10000, JSON.stringify(ok.d));
const loan = await Loan.findById(ok.d.loan.id);
check('stored as a payday advance with its due date and fee', loan.productKey === 'payday' && loan.loanType === 'Micro Loan' && loan.tenure === 1 && loan.interestRate === 0 && !!loan.payday.dueDate && loan.payday.fee === 472);
check('a second advance while one is running is refused (403)', (await call('POST', '/payday/apply', c1.token, { amount: 2000 })).s === 403);
check('the salary day cannot be changed meanwhile', (await call('PUT', '/payday/salary-day', c1.token, { salaryDay: 5 })).s === 400);

section('WHO IS HELD BACK');
const c2 = await mk({ phoneVerified: false, employment: { status: 'Employed', monthlyIncome: 40000, salaryDay: 5 } });
check('phone not verified (403)', (await call('POST', '/payday/apply', c2.token, { amount: 2000 })).s === 403);
const c3 = await mk({ employment: { status: 'Self-Employed', monthlyIncome: 40000, salaryDay: 5 } });
const s3 = (await call('GET', '/payday/status', c3.token)).d;
check('not salaried: not eligible', !s3.eligible && s3.checks.find(x => x.key === 'salaried').ok === false);
const c4 = await mk({ employment: { status: 'Employed', monthlyIncome: 40000, salaryDay: 5 } });
const l4 = await Loan.create({ userId: c4.user._id, loanAmount: 30000, tenure: 3, monthlyEMI: 10200, status: 'disbursed', disbursementDate: day(-30) });
await EMIPayment.create({ loanId: l4._id, userId: c4.user._id, emiNumber: 1, dueDate: day(-3), amount: 10200, principalAmount: 10000, interestAmount: 200, status: 'OVERDUE' });
check('an overdue instalment elsewhere: not eligible (403)', (await call('POST', '/payday/apply', c4.token, { amount: 2000 })).s === 403);
const c5 = await mk({ employment: { status: 'Employed', monthlyIncome: 40000, salaryDay: 5 } });
await AmlAlert.create({ userId: c5.user._id, rule: 'SHARED_DEVICE', severity: 'HIGH', status: 'OPEN', description: 'test' });
check('an open review: not eligible', (await call('GET', '/payday/status', c5.token)).d.eligible === false);
const c6 = await mk({ employment: { status: 'Employed', monthlyIncome: 40000, salaryDay: 5 } });
await Loan.create({ userId: c6.user._id, loanAmount: 30000, tenure: 3, monthlyEMI: 5000, status: 'disbursed', disbursementDate: day(-30) });
check('instalments already paid come off the room (20,000 - 5,000 = 15,000)', (await call('GET', '/payday/status', c6.token)).d.maxAmount === 15000);
const c7 = await mk({ employment: { status: 'Employed', monthlyIncome: 1500, salaryDay: 5 } });
const s7 = (await call('GET', '/payday/status', c7.token)).d;
check('a small income leaves too little room: not eligible', !s7.eligible && s7.maxAmount === 0);

section('PAYING OUT AND REPAYMENT');
loan.status = 'disbursed';
loan.disbursementDate = new Date();
await loan.save();
await createEMISchedule(loan._id);
const emis = await EMIPayment.find({ loanId: loan._id });
check('one repayment of the full amount, with no interest', emis.length === 1 && emis[0].amount === 10000 && emis[0].principalAmount === 10000 && emis[0].interestAmount === 0, JSON.stringify(emis));
const after = await Loan.findById(loan._id);
check('it falls due on the payday', new Date(emis[0].dueDate).getTime() === new Date(after.payday.dueDate).getTime() && new Date(after.nextEmiDate).getTime() === new Date(emis[0].dueDate).getTime());
// Payday came close while the loan waited for approval: move to the next one
await Loan.updateOne({ _id: loan._id }, { 'payday.dueDate': day(1) });
await createEMISchedule(loan._id);
const moved = await EMIPayment.findOne({ loanId: loan._id });
check('if payday is now too close, it moves to the next payday', new Date(moved.dueDate) > day(4));

section('FOR STAFF');
await EMIPayment.updateOne({ loanId: loan._id }, { dueDate: day(3) });
const ov = (await call('GET', '/admin/payday', admin.token)).d;
check('shows what is due this week and what is owed', ov.dueThisWeek.length === 1 && ov.dueThisWeek[0].amount === 10000 && ov.outstanding.amount === 10000, JSON.stringify(ov.dueThisWeek));
await EMIPayment.updateOne({ loanId: loan._id }, { dueDate: day(-2), status: 'OVERDUE' });
const ov2 = (await call('GET', '/admin/payday', admin.token)).d;
check('an unpaid one past its day shows as overdue', ov2.overdue.length === 1);
check('fees are counted', ov2.totals.feesEarned === 472);
check('the rules can be changed and are kept', (await call('PUT', '/admin/payday/settings', admin.token, { ...DEFAULTS, enabled: true, maxAmount: 15000, feePercent: 3 })).s === 200 && (await call('GET', '/admin/payday', admin.token)).d.settings.maxAmount === 15000);
check('a bad value is refused with the reason (400)', (await call('PUT', '/admin/payday/settings', admin.token, { ...DEFAULTS, feePercent: 50 })).s === 400);
const notStaff = await call('GET', '/admin/payday', c1.token);
check('a customer cannot open the staff page', notStaff.s === 403 || notStaff.s === 401, String(notStaff.s));

await disconnect();
finish();
