import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-regulatory';
await connect(DB);
await Role.create([
  { key: 'repviewer', label: 'Reports', description: 't', permissions: ['reports.view'] },
  { key: 'auditorx', label: 'Auditor', description: 't', permissions: ['reports.view', 'audit.view'] },
]);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, n) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${n}`, password: 'x12345678', role, twoFactorEnabled: true }), true);

let n = 0;
// A customer with a loan whose first instalment fell due `overdueDays` ago (0 = nothing overdue)
async function borrower(overdueDays, over = {}) {
  n++;
  const u = await User.create({ firstName: `B${n}`, lastName: 'Rower', email: `b${n}@x.in`, phone: `98300000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', dateOfBirth: new Date('1990-05-17'), gender: 'Male', panNumber: `ABCDE${1000 + n}F`, aadharNumber: `1234567890${String(10 + n)}`, address: { street: '1 Main Rd', city: 'Pune', state: 'MH', zipCode: '411001' }, ...over });
  const loan = await Loan.create({ userId: u._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status: 'disbursed', disbursementDate: day(-100) });
  for (let i = 1; i <= 3; i++) {
    const due = overdueDays > 0 ? day(-overdueDays + (i - 1) * 30) : day(10 * i);
    await EMIPayment.create({ loanId: loan._id, userId: u._id, emiNumber: i, dueDate: due, amount: 10200, principalAmount: 10000, interestAmount: 200, status: 'PENDING' });
  }
  return { u, loan };
}

const std = await borrower(0), s0 = await borrower(10), s1 = await borrower(45), s2 = await borrower(75), npa = await borrower(120), dbt = await borrower(500, { panNumber: undefined });

section('CLASSES FOLLOW THE DAYS PAST DUE');
const rep = await staff('repviewer', 1), aud = await staff('auditorx', 2);
const r = await call('GET', '/admin/regulatory/classification', rep);
const by = Object.fromEntries(r.d.loans.map(l => [l.loanId, l]));
check('it loads for someone with the reports permission', r.s === 200 && r.d.loans.length === 6, JSON.stringify(r.d).slice(0, 200));
check('nothing overdue is standard', by[std.loan._id].class === 'STANDARD' && by[std.loan._id].dpd === 0);
check('10 days is SMA-0', by[s0.loan._id].class === 'SMA0' && by[s0.loan._id].dpd === 10);
check('45 days is SMA-1', by[s1.loan._id].class === 'SMA1');
check('75 days is SMA-2', by[s2.loan._id].class === 'SMA2');
check('120 days is an NPA (sub-standard)', by[npa.loan._id].class === 'SUBSTANDARD' && by[npa.loan._id].stage === 3);
check('500 days is doubtful', by[dbt.loan._id].class === 'DOUBTFUL');
check('stage follows the days (stage 1, 2, 3)', by[s0.loan._id].stage === 1 && by[s1.loan._id].stage === 2 && by[s2.loan._id].stage === 2);
check('the oldest overdue instalment sets the days, not the newest', by[s2.loan._id].dpd === 75);
check('outstanding is the principal still to pay', by[std.loan._id].outstanding === 30000);
check('provision is the percentage of what is outstanding (25% of 30000 for sub-standard)', by[npa.loan._id].provision === 7500, JSON.stringify(by[npa.loan._id]));
check('gross NPA counts the NPA loans', r.d.totals.npa === 60000 && r.d.totals.grossNpaPercent === 33.33, JSON.stringify(r.d.totals));
check('class filter works', (await call('GET', '/admin/regulatory/classification?class=SMA1', rep)).d.loans.length === 1);

section('ONE BAD LOAN MAKES THE BORROWER BAD');
const second = await Loan.create({ userId: npa.u._id, loanAmount: 5000, tenure: 1, interestRate: 15, monthlyEMI: 5200, status: 'disbursed' });
await EMIPayment.create({ loanId: second._id, userId: npa.u._id, emiNumber: 1, dueDate: day(10), amount: 5200, principalAmount: 5000, interestAmount: 200, status: 'PENDING' });
const r2 = await call('GET', '/admin/regulatory/classification', rep);
const sec = r2.d.loans.find(l => l.loanId === String(second._id));
check('the healthy loan of that borrower is classed with the worst one', sec.loanClass === 'STANDARD' && sec.class === 'SUBSTANDARD' && sec.carriedFromOtherLoan === true && sec.stage === 3);

section('WRITTEN OFF AND CLOSED LOANS');
await Loan.updateOne({ _id: dbt.loan._id }, { status: 'written_off', writtenOffAmount: 20000, recoveredAmount: 5000 });
const r3 = await call('GET', '/admin/regulatory/classification', rep);
const wo = r3.d.loans.find(l => l.loanId === String(dbt.loan._id));
check('a written-off loan is a loss, fully provided on what is not recovered', wo.class === 'LOSS' && wo.outstanding === 15000 && wo.provision === 15000);

section('THE RULES ARE EDITABLE BY THE RIGHT PEOPLE');
check('a viewer cannot change them (403)', (await call('PUT', '/admin/regulatory/policy', rep, {})).s === 403);
check('days that do not go up are refused (400)', (await call('PUT', '/admin/regulatory/policy', admin, { sma0From: 5, sma1From: 3 })).s === 400);
check('a provision over 100 is refused (400)', (await call('PUT', '/admin/regulatory/policy', admin, { rates: { LOSS: 150 } })).s === 400);
const saved = await call('PUT', '/admin/regulatory/policy', admin, { npaFrom: 60, sma2From: 50, sma1From: 30, rates: { SUBSTANDARD: 30 } });
check('good rules are saved', saved.s === 200 && saved.d.policy.npaFrom === 60 && saved.d.policy.rates.SUBSTANDARD === 30, JSON.stringify(saved.d));
const r4 = await call('GET', '/admin/regulatory/classification', rep);
check('the new rules apply at once (75 days is now an NPA, at 30%)', r4.d.loans.find(l => l.loanId === String(s2.loan._id)).class === 'SUBSTANDARD' && r4.d.loans.find(l => l.loanId === String(s2.loan._id)).provision === 9000);
check('the change is in the audit log', (await AuditLog.countDocuments({ action: 'ASSET_POLICY_UPDATED' })) === 1);

section('FILES');
const get = (path, token) => fetch(srv.base + path, { headers: { Authorization: 'Bearer ' + token } }).then(async x => ({ s: x.status, t: await x.text(), type: x.headers.get('content-type') }));
check('someone without audit access cannot download (403)', (await get('/admin/regulatory/export/bureau', rep)).s === 403);
const bureau = await get('/admin/regulatory/export/bureau', aud);
const lines = bureau.t.split('\r\n');
check('the bureau file has a header and one line per account', bureau.s === 200 && /text\/csv/.test(bureau.type) && lines[0].startsWith('"Account number"') && lines.length === 1 + 7, `${lines.length} lines`);
check('it carries days past due and the class', lines.some(l => l.includes('"SUB"')) && lines.some(l => l.includes('"STD"')) && lines.some(l => l.includes('"LSS"')));
check('dates are written DDMMYYYY', lines.some(l => l.includes('"17051990"')));
const ck = await get('/admin/regulatory/export/ckyc', aud);
check('the CKYC file never holds a full Aadhaar number', ck.s === 200 && !/123456789012/.test(ck.t) && ck.t.includes('XXXXXXXX'), ck.t.slice(0, 300));
check('the classification file downloads', (await get('/admin/regulatory/export/classification', aud)).s === 200);
check('an unknown file is a 404', (await get('/admin/regulatory/export/other', aud)).s === 404);
check('every download is in the audit log', (await AuditLog.countDocuments({ action: 'REGULATORY_EXPORT' })) === 3);
const readiness = await call('GET', '/admin/regulatory/ckyc/readiness', rep);
check('CKYC readiness counts borrowers and what is missing', readiness.s === 200 && readiness.d.borrowers === 6 && readiness.d.ready === 5 && readiness.d.notCollected.length >= 1, JSON.stringify(readiness.d));

await disconnect();
finish();
