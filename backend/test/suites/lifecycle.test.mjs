import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Transaction from '../../src/models/Transaction.js';

const DB = 'fintech-test-lifecycle';
await connect(DB);
// KYC and agreement gates are covered in the compliance suite; here we test the money flow itself.
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const bank = { accountNumber: '1234567890', ifscCode: 'SBIN0001234', accountHolder: 'Test User', bankName: 'SBI' };
const user = await User.create({ firstName: 'Test', lastName: 'User', email: 'test@x.in', phone: '9000000001', password: 'x12345678', bankAccount: bank });
const other = await User.create({ firstName: 'Other', lastName: 'Person', email: 'other@x.in', phone: '9000000002', password: 'x12345678' });
const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, totalAmount: 30600 });
const t = await tokenFor(user);

section('APPROVE AND DISBURSE');
check('admin sees the loan in the list', (await call('GET', '/admin/loans', admin)).d.loans.length === 1);
check('cannot disburse before approval (400)', (await call('POST', `/admin/loans/${loan._id}/disburse`, admin)).s === 400);
check('approve works', (await call('POST', `/admin/loans/${loan._id}/approve`, admin)).s === 200 && (await Loan.findById(loan._id)).status === 'approved');
check('cannot approve twice (400)', (await call('POST', `/admin/loans/${loan._id}/approve`, admin)).s === 400);
const d = await call('POST', `/admin/loans/${loan._id}/disburse`, admin);
check('disburse works in sandbox mode', d.s === 200 && d.d.status === 'COMPLETED', JSON.stringify(d.d));
check('loan is now disbursed', (await Loan.findById(loan._id)).status === 'disbursed');
check('cannot disburse twice (400)', (await call('POST', `/admin/loans/${loan._id}/disburse`, admin)).s === 400);

section('EMI SCHEDULE');
const sch = await call('GET', `/emi/schedule/${loan._id}`, t);
check('3 pending EMIs created on disbursement', sch.s === 200 && sch.d.stats.total === 3 && sch.d.stats.pending === 3, JSON.stringify(sch.d.stats));
check('each EMI splits into principal + interest', sch.d.emis.every(e => e.principalAmount + e.interestAmount === e.amount));
check('principal adds up to exactly the loan amount', sch.d.emis.reduce((a, e) => a + e.principalAmount, 0) === 30000);
check('another customer cannot read it (404)', (await call('GET', `/emi/schedule/${loan._id}`, await tokenFor(other))).s === 404);
check('no token -> 401', (await call('GET', `/emi/schedule/${loan._id}`, null)).s === 401);
check('garbage token -> 401', (await call('GET', `/emi/schedule/${loan._id}`, 'garbage')).s === 401);

section('REPAYMENT');
const p1 = await call('POST', `/emi/initiate/${loan._id}/1`, t);
check('EMI 1 paid (sandbox)', p1.s === 200 && p1.d.status === 'PAID');
check('paying the same EMI twice is refused', (await call('POST', `/emi/initiate/${loan._id}/1`, t)).s !== 200);
check('loan still open after the first EMI', (await Loan.findById(loan._id)).status === 'disbursed');
await call('POST', `/emi/initiate/${loan._id}/2`, t);
await call('POST', `/emi/initiate/${loan._id}/3`, t);
check('all EMIs paid', (await EMIPayment.countDocuments({ loanId: loan._id, status: 'PAID' })) === 3);
check('loan closes after the last EMI', (await Loan.findById(loan._id)).status === 'closed');
const an = (await call('GET', '/emi/admin/analytics', admin)).d;
check('EMI analytics reflect the payments', an.totalEmis === 3 && an.stats.paid === 3 && an.collections.collectionRate === '100.00%', JSON.stringify(an));

section('PLAN TYPES: PRINCIPAL AND INTEREST SPLIT');
// Approve and disburse a loan through the API, then return its schedule.
async function scheduleFor(fields) {
  const l = await Loan.create({ userId: user._id, interestRate: 15, ...fields });
  await call('POST', `/admin/loans/${l._id}/approve`, admin);
  const r = await call('POST', `/admin/loans/${l._id}/disburse`, admin);
  const s = await EMIPayment.find({ loanId: l._id }).sort({ emiNumber: 1 });
  return { loan: l, res: r, emis: s };
}
const sum = (rows, k) => rows.reduce((a, e) => a + e[k], 0);

const flat3 = await scheduleFor({ loanAmount: 30000, tenure: 3, interestRate: 5, monthlyEMI: 10500, planType: '3_emi' });
check('3-month plan: 10,000 principal + 500 interest every month', flat3.emis.every(e => e.principalAmount === 10000 && e.interestAmount === 500 && e.amount === 10500), JSON.stringify(flat3.emis.map(e => [e.principalAmount, e.interestAmount])));

const legacy6 = await scheduleFor({ loanAmount: 30000, tenure: 6, interestRate: 9, monthlyEMI: 5450 });
check('older 6-month loan with no plan stored is still recognised as flat', legacy6.emis.every(e => e.principalAmount === 5000 && e.interestAmount === 450), JSON.stringify(legacy6.emis.map(e => [e.principalAmount, e.interestAmount])));

const once = await scheduleFor({ loanAmount: 30000, tenure: 1, interestRate: 0, monthlyEMI: 30000, planType: 'one_time' });
check('pay-in-one plan: one EMI, all principal, no interest', once.emis.length === 1 && once.emis[0].principalAmount === 30000 && once.emis[0].interestAmount === 0);

const reducing = await scheduleFor({ loanAmount: 100000, tenure: 12, interestRate: 15, monthlyEMI: 9026 });
check('15% reducing loan: principal adds up to exactly 100,000', sum(reducing.emis, 'principalAmount') === 100000, sum(reducing.emis, 'principalAmount'));
check('reducing loan: interest falls month by month', reducing.emis.every((e, i) => i === 0 || e.interestAmount <= reducing.emis[i - 1].interestAmount));
check('reducing loan: every EMI is 9,026 except a small adjustment on the last', reducing.emis.slice(0, 11).every(e => e.amount === 9026) && Math.abs(reducing.emis[11].amount - 9026) <= 20, reducing.emis[11].amount);
check('total interest is close to the textbook figure (8,310)', Math.abs(sum(reducing.emis, 'interestAmount') - 8310) <= 15, sum(reducing.emis, 'interestAmount'));

section('PAYOUT IS NET OF FEES');
const withFees = await scheduleFor({ loanAmount: 30000, tenure: 3, interestRate: 5, monthlyEMI: 10500, planType: '3_emi', disbursalDetails: { accountNumber: '1234567890', disbursedAmount: 28230 } });
const stored = await Loan.findById(withFees.loan._id);
check('customer is paid the loan minus processing fee and GST', withFees.res.d.status === 'COMPLETED' && stored.disbursedAmount === 28230, `${stored.disbursedAmount}`);
check('the payment record shows the net amount, not the loan amount', (await Transaction.findOne({ loanId: withFees.loan._id })).amount === 28230);
check('a loan with no fees is paid in full', (await Transaction.findOne({ loanId: flat3.loan._id })).amount === 30000);

section('REJECTION');
const loan2 = await Loan.create({ userId: user._id, loanAmount: 5000, tenure: 3, interestRate: 15, monthlyEMI: 1700 });
check('rejection needs a reason (400)', (await call('POST', `/admin/loans/${loan2._id}/reject`, admin, {})).s === 400);
check('rejection works', (await call('POST', `/admin/loans/${loan2._id}/reject`, admin, { reason: 'Low score' })).s === 200 && (await Loan.findById(loan2._id)).status === 'rejected');
check('a rejected loan cannot be approved (400)', (await call('POST', `/admin/loans/${loan2._id}/approve`, admin)).s === 400);
check('customer cannot use admin routes (403)', (await call('POST', `/admin/loans/${loan2._id}/approve`, t)).s === 403);

await srv.stop();
await disconnect();
finish();
