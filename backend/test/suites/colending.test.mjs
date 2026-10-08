import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import ColendingPartner from '../../src/models/ColendingPartner.js';
import ColendingEntry from '../../src/models/ColendingEntry.js';
import { assign, onEmiPaid, onSettlement, validatePartner } from '../../src/services/colendingService.js';
import { markEMIPaid } from '../../src/services/emiService.js';

const DB = 'fintech-test-colending';
await connect(DB);
await Role.create([{ key: 'repview', label: 'R', description: 't', permissions: ['reports.view'] }, { key: 'fin', label: 'F', description: 't', permissions: ['reports.view', 'loans.disburse'] }]);

section('THE PARTNER');
check('a good partner is valid', validatePartner({ name: 'HDFC', partnerSharePercent: 80, partnerRatePercent: 11 }).errors.length === 0);
check('the company must keep at least 10%', validatePartner({ name: 'X', partnerSharePercent: 95, partnerRatePercent: 11 }).errors.length > 0);
check('a nameless partner or a silly rate is refused', validatePartner({ name: '', partnerSharePercent: 50, partnerRatePercent: 11 }).errors.length > 0 && validatePartner({ name: 'X', partnerSharePercent: 50, partnerRatePercent: 99 }).errors.length > 0);
check('a smallest loan above the largest is refused', validatePartner({ name: 'X', partnerSharePercent: 50, partnerRatePercent: 11, minAmount: 5000, maxAmount: 1000 }).errors.length > 0);

const u = await User.create({ firstName: 'Co', lastName: 'Lend', email: 'co@x.in', phone: '9100000001', password: 'x12345678' });
const mkLoan = async (amount = 30000) => {
  const loan = await Loan.create({ userId: u._id, loanAmount: amount, tenure: 3, interestRate: 15, monthlyEMI: amount / 3 + 300, status: 'disbursed', disbursementDate: new Date() });
  for (let i = 1; i <= 3; i++) await EMIPayment.create({ loanId: loan._id, userId: u._id, emiNumber: i, dueDate: day(30 * i), amount: amount / 3 + 300, principalAmount: amount / 3, interestAmount: 300, status: 'PENDING' });
  return loan;
};

section('NO PARTNER, NO CHANGE');
const plain = await mkLoan();
check('without a partner nothing is recorded', (await assign(plain)) === null && (await ColendingEntry.countDocuments()) === 0);
await markEMIPaid(await EMIPayment.findOne({ loanId: plain._id, emiNumber: 1 }), 'pay_0', 10300);
check('and paying an instalment records nothing for co-lending', (await ColendingEntry.countDocuments()) === 0);

section('A LOAN GOES TO A PARTNER');
const bank = await ColendingPartner.create({ name: 'Test Bank', partnerSharePercent: 80, partnerRatePercent: 12, minAmount: 10000, maxAmount: 100000, monthlyCap: 40000 });
const small = await mkLoan(5000);
check('a loan outside the partner\'s range is not given to it', (await assign(small)) === null);
const l1 = await mkLoan(30000);
const asg = await assign(l1);
check('a fitting loan is given to the partner with the shares worked out', asg.partnerShare === 80 && asg.nbfcShare === 20 && asg.funding === 24000, JSON.stringify(asg));
check('the partner owes its share of the loan', (await ColendingEntry.findOne({ loanId: l1._id, kind: 'funding' })).total === 24000);
check('assigning twice does nothing', (await assign(await Loan.findById(l1._id))) === null && (await ColendingEntry.countDocuments({ loanId: l1._id, kind: 'funding' })) === 1);
const l2 = await mkLoan(30000);
check('the monthly limit stops the next one (24000 + 24000 is over 40000)', (await assign(l2)) === null);

section('INSTALMENTS');
await markEMIPaid(await EMIPayment.findOne({ loanId: l1._id, emiNumber: 1 }), 'pay_1', 10300);
const e1 = await ColendingEntry.findOne({ loanId: l1._id, kind: 'remittance', emiNumber: 1 });
// principal share 80% of 10000 = 8000; interest = 80% of 30000 owed before = 24000 x 12% / 12 = 240
check('we owe the partner 80% of the principal, and its interest on its share of what was owed', e1.principal === 8000 && e1.interest === 240 && e1.total === 8240, JSON.stringify(e1));
await markEMIPaid(await EMIPayment.findOne({ loanId: l1._id, emiNumber: 2 }), 'pay_2', 10300);
const e2 = await ColendingEntry.findOne({ loanId: l1._id, kind: 'remittance', emiNumber: 2 });
check('the next month the interest is on less (80% of 20000 = 16000 at 12% a year = 160)', e2.principal === 8000 && e2.interest === 160, JSON.stringify(e2));
check('the same instalment is never recorded twice', (await onEmiPaid((await EMIPayment.findOne({ loanId: l1._id, emiNumber: 2 }))._id)) === null && (await ColendingEntry.countDocuments({ loanId: l1._id, kind: 'remittance' })) === 2);
const l3 = await Loan.findById(l1._id);
await onSettlement(l1._id, 5000);
check('a settlement gives the partner its share of what was received', (await ColendingEntry.findOne({ loanId: l3._id, source: 'settlement' })).total === 4000);

const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const viewer = await staff('repview', 1), fin = await staff('fin', 2);

section('STAFF');
const ov = await call('GET', '/admin/colending', viewer);
const p = ov.d.partners[0];
check('a viewer sees the partner with what is owed each way', ov.s === 200 && p.loans === 1 && p.funding === 24000 && p.fundingPending.total === 24000 && p.remitPending.total === 8240 + 8160 + 4000 && ov.d.canManage === false && ov.d.canSettle === false, JSON.stringify(p));
check('a viewer cannot add a partner (403)', (await call('POST', '/admin/colending/partners', viewer, { name: 'N', partnerSharePercent: 50, partnerRatePercent: 10 })).s === 403);
check('the super admin can; a bad one is refused (400)', (await call('POST', '/admin/colending/partners', admin, { name: 'Second Bank', partnerSharePercent: 50, partnerRatePercent: 10 })).s === 201 && (await call('POST', '/admin/colending/partners', admin, { name: 'Bad', partnerSharePercent: 99, partnerRatePercent: 10 })).s === 400);
check('a partner can be stopped for new loans', (await call('PUT', `/admin/colending/partners/${p.id}`, admin, { active: false })).s === 200 && (await ColendingPartner.findById(p.id)).active === false);
const list = await call('GET', '/admin/colending/entries?status=pending', viewer);
check('the entries list shows each amount and where it came from', list.d.entries.length === 4 && list.d.entries.some(e => e.kind === 'funding'));
const id = list.d.entries[0].id;
check('a viewer cannot settle (403)', (await call('POST', `/admin/colending/entries/${id}/settle`, viewer, { reference: 'UTR1' })).s === 403);
check('finance needs a reference (400)', (await call('POST', `/admin/colending/entries/${id}/settle`, fin, {})).s === 400);
check('finance settles it', (await call('POST', `/admin/colending/entries/${id}/settle`, fin, { reference: 'UTR9' })).d.status === 'settled');
check('settling again is refused (409)', (await call('POST', `/admin/colending/entries/${id}/settle`, fin, { reference: 'UTR9' })).s === 409);
const dl = await fetch(srv.base + '/admin/colending/export', { headers: { Authorization: 'Bearer ' + viewer } });
const csv = await dl.text();
check('the CSV downloads', dl.status === 200 && csv.startsWith('"Date","Partner"') && csv.includes('We pay the partner'));

await disconnect();
finish();
