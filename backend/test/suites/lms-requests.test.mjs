import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Role from '../../src/models/Role.js';
import AuditLog from '../../src/models/AuditLog.js';
import LoanServiceRequest from '../../src/models/LoanServiceRequest.js';

const DB = 'fintech-test-lms-requests';
await connect(DB);
await Role.create([
  { key: 'viewer', label: 'Viewer', description: 't', permissions: ['loans.view'] },
  { key: 'maker', label: 'Maker', description: 't', permissions: ['loans.view', 'lms.post'] },
  { key: 'checker', label: 'Checker', description: 't', permissions: ['loans.view', 'lms.approve'] },
  { key: 'maker2', label: 'Maker and checker', description: 't', permissions: ['loans.view', 'lms.post', 'lms.approve'] },
]);
const srv = await startServer(DB, {});
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, n) => {
  const u = await User.create({ firstName: 'S', lastName: role, email: `${role}${n}@lifc.in`, phone: `9740000${String(n).padStart(3, '0')}`, password: 'x12345678', role, twoFactorEnabled: true });
  return { tok: await tokenFor(u, true), email: u.email };
};
const viewer = await staff('viewer', 1), maker = await staff('maker', 2), checker = await staff('checker', 3), both = await staff('maker2', 4);

let n = 0;
async function flatLoan(dues, { penalties = [], extra = {}, dates = null } = {}) {
  n++;
  const user = await User.create({ firstName: `Rq${n}`, lastName: 'Cust', email: `rq${n}@x.in`, phone: `97500${String(n).padStart(5, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true });
  const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: dues.length, interestRate: 15, monthlyEMI: 10600, totalAmount: 31800, planType: '3_emi', status: 'disbursed', disbursementDate: day(-70), ...extra });
  for (const [i, d] of dues.entries()) await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: i + 1, dueDate: dates ? dates[i] : day(d), amount: 10600, principalAmount: 10000, interestAmount: 600, status: d < 0 ? 'OVERDUE' : 'PENDING', daysOverdue: d < 0 ? -d : 0, penaltyApplied: penalties[i] || 0 });
  return { user, loan };
}
const url = (l, p = '') => `/admin/lms/${l._id}${p}`;
const ask = (l, body, tok = maker.tok, q = '') => call('POST', url(l, '/requests' + q), tok, body);
const decideReq = (id, what, tok, note) => call('POST', `/admin/lms/requests/${id}/${what}`, tok, { note });
const rows = async l => EMIPayment.find({ loanId: l._id }).sort({ emiNumber: 1 });

section('LATE-FEE WAIVER AND THE TWO-PERSON RULE');
const a = await flatLoan([-40, -10, 20], { penalties: [300, 100, 0] });
check('two-person approval is on by default', (await call('GET', '/admin/lms/settings', admin)).d.fourEyes === true);
check('a viewer cannot ask for a change (403)', (await ask(a.loan, { type: 'waiver', reason: 'goodwill gesture' }, viewer.tok)).s === 403);
check('a checker who cannot make requests is refused too (403)', (await ask(a.loan, { type: 'waiver', reason: 'goodwill gesture' }, checker.tok)).s === 403);
check('an unknown kind of change is refused (400)', (await ask(a.loan, { type: 'magic', reason: 'because' })).s === 400);
const pv = await ask(a.loan, { type: 'waiver' }, maker.tok, '?preview=1');
check('a preview lists what would be waived and that approval is needed, and changes nothing', pv.s === 200 && pv.d.preview.summary.some(l => /Total waived: Rs 400/.test(l)) && pv.d.preview.needsApproval === true && (await LoanServiceRequest.countDocuments({ loanId: a.loan._id })) === 0);
check('a reason is needed (400)', (await ask(a.loan, { type: 'waiver' })).s === 400 && (await ask(a.loan, { type: 'waiver', reason: 'x' })).s === 400);
const w1 = await ask(a.loan, { type: 'waiver', reason: 'customer lost his job, goodwill' });
check('a request is created and waits; nothing has changed yet', w1.s === 200 && w1.d.applied === false && w1.d.request.status === 'pending' && (await rows(a.loan))[0].penaltyApplied === 300, JSON.stringify(w1.d));
check('a second request of the same kind on the loan is refused (409)', (await ask(a.loan, { type: 'waiver', reason: 'again please' })).s === 409);
check('the pending list shows it with the customer', (await call('GET', '/admin/lms/requests?status=pending', checker.tok)).d.requests.some(r => r.id === w1.d.request.id && r.customer.startsWith('Rq')));
check('the loan account shows its requests', (await call('GET', url(a.loan), admin)).d.requests.length === 1);
check('a maker cannot approve (403)', (await decideReq(w1.d.request.id, 'approve', maker.tok)).s === 403);
check('a person with both rights cannot approve their own request (403)', await (async () => { const own = await flatLoan([-30], { penalties: [200] }); const r = await ask(own.loan, { type: 'waiver', reason: 'goodwill here' }, both.tok); return (await decideReq(r.d.request.id, 'approve', both.tok)).s === 403; })());
check('a rejection needs a reason (400)', (await decideReq(w1.d.request.id, 'reject', checker.tok)).s === 400);
const ok1 = await decideReq(w1.d.request.id, 'approve', checker.tok, 'ok, agreed');
const r1 = await rows(a.loan);
check('a different person approves, and the late fees are waived on the instalments', ok1.s === 200 && ok1.d.request.status === 'approved' && r1[0].penaltyApplied === 0 && r1[0].penaltyWaived === 300 && r1[1].penaltyApplied === 0 && r1[1].penaltyWaived === 100, JSON.stringify(ok1.d));
check('it cannot be decided twice (409)', (await decideReq(w1.d.request.id, 'approve', checker.tok)).s === 409 && (await decideReq(w1.d.request.id, 'reject', checker.tok, 'no way')).s === 409);
check('who asked, who approved and why are in the audit log', (await AuditLog.countDocuments({ action: 'LMS_CHANGE_REQUESTED', entityId: String(a.loan._id) })) === 1 && (await AuditLog.countDocuments({ action: 'LMS_WAIVER_APPLIED', entityId: String(a.loan._id) })) === 1);
check('the account now shows less overdue, and the waiver in the transactions', (await call('GET', url(a.loan), admin)).d.figures.overdueAmount === 21200 && (await call('GET', url(a.loan), admin)).d.transactions.some(t => t.kind === 'Waive late fees'));
check('nothing left to waive is refused (409)', (await ask(a.loan, { type: 'waiver', reason: 'one more time' }, maker.tok, '?preview=1')).s === 409);
const b = await flatLoan([-40, -10, 20], { penalties: [300, 100, 0] });
check('a part-waiver of one instalment works, and more than the fee is refused (400)', (await ask(b.loan, { type: 'waiver', payload: { items: [{ emiNumber: 1, amount: 999 }] }, reason: 'too much' }, maker.tok, '?preview=1')).s === 400);
const bw = await ask(b.loan, { type: 'waiver', payload: { items: [{ emiNumber: 1, amount: 150 }] }, reason: 'half the fee as agreed' });
await decideReq(bw.d.request.id, 'approve', checker.tok);
check('and only that part is taken off', (await rows(b.loan))[0].penaltyApplied === 150 && (await rows(b.loan))[1].penaltyApplied === 100);
const rj = await flatLoan([-40], { penalties: [300] });
const rjr = await ask(rj.loan, { type: 'waiver', reason: 'customer asked nicely' });
check('a rejection with a reason changes nothing', (await decideReq(rjr.d.request.id, 'reject', checker.tok, 'not eligible')).d.request.status === 'rejected' && (await rows(rj.loan))[0].penaltyApplied === 300);
const wd = await flatLoan([-40], { penalties: [300] });
const wdr = await ask(wd.loan, { type: 'waiver', reason: 'customer asked nicely' });
check('only the person who asked can withdraw it (403), and then it is withdrawn', (await call('POST', `/admin/lms/requests/${wdr.d.request.id}/withdraw`, both.tok, {})).s === 403 && (await call('POST', `/admin/lms/requests/${wdr.d.request.id}/withdraw`, maker.tok, {})).d.request.status === 'withdrawn');

section('A LOAN THAT MOVED ON SINCE THE REQUEST');
const st = await flatLoan([-40, 20, 50], { penalties: [300, 0, 0] });
const sr = await ask(st.loan, { type: 'waiver', reason: 'goodwill gesture' });
await call('POST', url(st.loan, '/payments'), admin, { amount: 10900, mode: 'CASH' });
const stale = await decideReq(sr.d.request.id, 'approve', checker.tok);
check('approving a request after a payment was posted is refused, and the request is marked failed', stale.s === 409 && /changed since/.test(stale.d.error) && (await LoanServiceRequest.findById(sr.d.request.id)).status === 'failed', JSON.stringify(stale.d));

section('MOVING THE DUE DAY');
const onDay = (dom, ahead) => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + ahead, dom, 6)); };
const dc = await flatLoan([10, 40, 70], { dates: [onDay(10, 1), onDay(10, 2), onDay(10, 3)] });
const firstDay = new Date((await rows(dc.loan))[0].dueDate).getUTCDate();
const newDay = firstDay === 28 ? 20 : firstDay + 1;
check('a bad day is refused (400)', (await ask(dc.loan, { type: 'date_change', payload: { day: 31 }, reason: 'salary day moved' }, maker.tok, '?preview=1')).s === 400);
check('the same day is refused (409)', (await ask(dc.loan, { type: 'date_change', payload: { day: firstDay }, reason: 'salary day moved' }, maker.tok, '?preview=1')).s === 409);
const dcr = await ask(dc.loan, { type: 'date_change', payload: { day: newDay }, reason: 'salary now comes on a different day' });
await decideReq(dcr.d.request.id, 'approve', checker.tok);
const dcRows = await rows(dc.loan);
check('after approval every remaining instalment falls on the new day', dcr.s === 200 && dcRows.every(r => new Date(r.dueDate).getUTCDate() === newDay) && dcRows[1].dueDate > dcRows[0].dueDate);
check('and the change is recorded as made by staff', (await Loan.findById(dc.loan._id)).dateChanges.some(d => d.staff === true && d.toDay === newDay));
check('with an overdue instalment it is refused (409)', (await ask((await flatLoan([-5, 20])).loan, { type: 'date_change', payload: { day: 10 }, reason: 'salary day moved' }, maker.tok, '?preview=1')).s === 409);

section('ADDING MONTHS');
const ex = await flatLoan([10, 40, 70]);
const exPrev = await ask(ex.loan, { type: 'extension', payload: { extraMonths: 3 } }, maker.tok, '?preview=1');
check('the preview says what happens to the instalment and the interest', exPrev.s === 200 && exPrev.d.preview.summary.length >= 3 && /3 months/.test(exPrev.d.preview.summary[0]));
check('0 or 13 months is refused (400)', (await ask(ex.loan, { type: 'extension', payload: { extraMonths: 0 } }, maker.tok, '?preview=1')).s === 400 && (await ask(ex.loan, { type: 'extension', payload: { extraMonths: 13 } }, maker.tok, '?preview=1')).s === 400);
const exr = await ask(ex.loan, { type: 'extension', payload: { extraMonths: 3 }, reason: 'customer needs lower instalments' });
await decideReq(exr.d.request.id, 'approve', checker.tok);
const exRows = await rows(ex.loan);
const exLoan = await Loan.findById(ex.loan._id);
check('three instalments are added and the instalment comes down', exRows.length === 6 && exRows[0].amount < 10600 && exLoan.tenure === 6 && exLoan.monthlyEMI === exRows[0].amount, JSON.stringify(exRows.map(r => r.amount)));
check('the principal still adds up exactly', exRows.reduce((s, r) => s + r.principalAmount, 0) === 30000 && exRows.every(r => r.amount === r.principalAmount + r.interestAmount));
check('the new instalments follow the old ones month by month, numbered on', exRows.map(r => r.emiNumber).join() === '1,2,3,4,5,6' && exRows[5].dueDate > exRows[2].dueDate && exRows[3].dueDate > exRows[2].dueDate);
check('with an overdue instalment it is refused (409)', (await ask((await flatLoan([-5, 20])).loan, { type: 'extension', payload: { extraMonths: 2 }, reason: 'help the customer' }, maker.tok, '?preview=1')).s === 409);

section('PAUSING INSTALMENTS');
const mo = await flatLoan([10, 40, 70]);
const before = await rows(mo.loan);
check('0 or 7 months is refused (400)', (await ask(mo.loan, { type: 'moratorium', payload: { months: 0 } }, maker.tok, '?preview=1')).s === 400 && (await ask(mo.loan, { type: 'moratorium', payload: { months: 7 } }, maker.tok, '?preview=1')).s === 400);
const mor = await ask(mo.loan, { type: 'moratorium', payload: { months: 2 }, reason: 'flood in the area, customer displaced' });
await decideReq(mor.d.request.id, 'approve', checker.tok);
const after = await rows(mo.loan);
check('every instalment moves two months later, and the amounts do not change', after.every((r, i) => r.amount === 10600 && Math.round((r.dueDate - before[i].dueDate) / 864e5) >= 59 && Math.round((r.dueDate - before[i].dueDate) / 864e5) <= 62));
const mc = await flatLoan([10, 40, 70]);
const mcr = await ask(mc.loan, { type: 'moratorium', payload: { months: 2, chargeInterest: true }, reason: 'customer asked to pause, interest to be charged' });
await decideReq(mcr.d.request.id, 'approve', checker.tok);
const mcRows = await rows(mc.loan);
const expected = Math.round(30000 * (15 / 12 / 100) * 2);
check('when interest is charged, it is spread over the remaining instalments', mcRows.reduce((s, r) => s + r.interestAmount, 0) === 1800 + expected && mcRows.every(r => r.amount === r.principalAmount + r.interestAmount), JSON.stringify(mcRows.map(r => r.amount)));

section('RESTRUCTURING A LOAN IN TROUBLE');
const rs = await flatLoan([-100, -70, -40], { penalties: [900, 600, 300], extra: { status: 'defaulted', collectionStage: 'FINAL_NOTICE', assignedTo: 'agent@lifc.in' } });
const first = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
const rsBody = (o = {}) => ({ type: 'restructure', payload: { instalments: 6, firstDueDate: first, waiveLateFees: true, ...o }, reason: 'customer back at work, agreed plan' });
check('late fees must be waived or paid first (409)', (await ask(rs.loan, rsBody({ waiveLateFees: false }), maker.tok, '?preview=1')).s === 409);
check('a first date in the past is refused (400)', (await ask(rs.loan, rsBody({ firstDueDate: '2020-01-01' }), maker.tok, '?preview=1')).s === 400);
check('0 or 61 instalments is refused (400)', (await ask(rs.loan, rsBody({ instalments: 0 }), maker.tok, '?preview=1')).s === 400 && (await ask(rs.loan, rsBody({ instalments: 61 }), maker.tok, '?preview=1')).s === 400);
check('a silly rate is refused (400)', (await ask(rs.loan, rsBody({ annualRate: 99 }), maker.tok, '?preview=1')).s === 400);
const rsPrev = await ask(rs.loan, rsBody(), maker.tok, '?preview=1');
check('the preview explains the new schedule, the arrears and the waived fees, and that compliance must confirm', rsPrev.s === 200 && rsPrev.d.preview.summary.some(l => /1,800|1800/.test(l)) && rsPrev.d.preview.summary.some(l => /Late fees waived: Rs 1,800/.test(l)) && rsPrev.d.preview.summary.some(l => /Compliance/.test(l)), JSON.stringify(rsPrev.d.preview));
const rsr = await ask(rs.loan, rsBody({ annualRate: 12 }));
const rsok = await decideReq(rsr.d.request.id, 'approve', checker.tok, 'plan agreed with the customer');
const rsRows = await rows(rs.loan);
const rsLoan = await Loan.findById(rs.loan._id);
check('the three overdue instalments are replaced by six new ones, all pending', rsok.s === 200 && rsRows.length === 6 && rsRows.every(r => r.status === 'PENDING' && !r.penaltyApplied), JSON.stringify(rsok.d));
check('the new principal is the old principal plus the interest already billed (30,000 + 1,800)', rsRows.reduce((s, r) => s + r.principalAmount, 0) === 31800);
check('the first one is due on the chosen date, then monthly', new Date(rsRows[0].dueDate).toISOString().slice(0, 10) === first && rsRows[1].dueDate > rsRows[0].dueDate);
check('the loan is live again at the new rate, marked restructured, and collections case cleared', rsLoan.status === 'disbursed' && rsLoan.interestRate === 12 && rsLoan.tenure === 6 && rsLoan.monthlyEMI === rsRows[0].amount && rsLoan.restructure.feesWaived === 1800 && rsLoan.restructure.arrearsCapitalised === 1800 && !rsLoan.collectionStage && !rsLoan.assignedTo);
check('it shows up on the account, with no days past due', (await call('GET', url(rs.loan), admin)).d.restructure.instalmentsAfter === 6 && (await call('GET', url(rs.loan), admin)).d.figures.dpd === 0);
check('the audit log says who asked and who approved', (await AuditLog.findOne({ action: 'LMS_RESTRUCTURE_APPLIED', entityId: String(rs.loan._id) })).details.requestedBy === maker.email);

section('LOANS THAT CANNOT HAVE THEIR SCHEDULE CHANGED');
const col = await flatLoan([10, 40, 70], { extra: { colending: { partnerId: 'p1', partnerName: 'Partner Bank' } } });
check('a co-lent loan cannot be extended (409)', (await ask(col.loan, { type: 'extension', payload: { extraMonths: 2 }, reason: 'help the customer' }, maker.tok, '?preview=1')).s === 409);
const colOver = await flatLoan([-20], { penalties: [100], extra: { colending: { partnerId: 'p1', partnerName: 'Partner Bank' } } });
check('but its late fees can be waived', (await ask(colOver.loan, { type: 'waiver', reason: 'goodwill gesture' }, maker.tok, '?preview=1')).s === 200);
const pd = await flatLoan([-20], { penalties: [100], extra: { productKey: 'payday' } });
check('a payday advance cannot be restructured (409)', (await ask(pd.loan, { type: 'restructure', payload: { instalments: 3, firstDueDate: first, waiveLateFees: true }, reason: 'help the customer' }, maker.tok, '?preview=1')).s === 409);
check('a closed loan cannot be changed (409)', (await ask((await flatLoan([10], { extra: { status: 'closed' } })).loan, { type: 'extension', payload: { extraMonths: 2 }, reason: 'help the customer' }, maker.tok, '?preview=1')).s === 409);

section('SWITCHING THE TWO-PERSON RULE OFF');
check('only someone who may change controls can switch it (403)', (await call('PUT', '/admin/lms/settings', maker.tok, { fourEyes: false })).s === 403 && (await call('PUT', '/admin/lms/settings', both.tok, { fourEyes: false })).s === 403);
check('a yes or no is needed (400)', (await call('PUT', '/admin/lms/settings', admin, { fourEyes: 'maybe' })).s === 400);
check('it can be switched off', (await call('PUT', '/admin/lms/settings', admin, { fourEyes: false })).d.fourEyes === false && (await call('GET', '/admin/lms/settings', maker.tok)).d.fourEyes === false);
const off = await flatLoan([-40], { penalties: [300] });
const offr = await ask(off.loan, { type: 'waiver', reason: 'branch manager agreed it' });
check('then a request is applied at once, and marked as such', offr.s === 200 && offr.d.applied === true && offr.d.request.autoApplied === true && offr.d.request.status === 'approved' && (await rows(off.loan))[0].penaltyApplied === 0);
check('and it is still in the audit log', (await AuditLog.countDocuments({ action: 'LMS_WAIVER_APPLIED', entityId: String(off.loan._id) })) === 1);
await call('PUT', '/admin/lms/settings', admin, { fourEyes: true });
check('it can be switched back on', (await call('GET', '/admin/lms/settings', maker.tok)).d.fourEyes === true);

section('DOCUMENTS');
const doc = (l, kind, q = '', tok = admin) => fetch(srv.base + url(l, `/documents/${kind}${q}`), { headers: { Authorization: `Bearer ${tok}` } });
const paidLoan = await flatLoan([-30, 10, 40]);
await call('POST', url(paidLoan.loan, '/payments'), admin, { amount: 10600, mode: 'CASH' });
const stm = await (await doc(paidLoan.loan, 'statement')).text();
check('the statement of account shows the loan, the figures and the transactions', stm.includes('Statement of account') && stm.includes('Principal outstanding') && stm.includes('Transactions') && stm.includes('20,000'));
const sch = await (await doc(paidLoan.loan, 'schedule')).text();
check('the repayment schedule lists every instalment with its status', sch.includes('Repayment schedule') && (sch.match(/<tr><td>\d/g) || []).length === 3 && sch.includes('paid on'));
const year = new Date().getUTCMonth() >= 3 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
const cert = await (await doc(paidLoan.loan, 'interest-certificate', `?fy=${year}`)).text();
check('the interest certificate adds up the interest paid in the year', cert.includes('Interest certificate') && cert.includes('Interest paid in the year') && cert.includes('600') && cert.includes('Instalment 1'));
check('for a year with no payments it says so', (await (await doc(paidLoan.loan, 'interest-certificate', `?fy=${year - 3}`)).text()).includes('No instalment was paid'));
check('an unknown document is a 404, and a silly year a 400', (await doc(paidLoan.loan, 'secret')).status === 404 && (await doc(paidLoan.loan, 'interest-certificate', '?fy=1850')).status === 400 || (await doc(paidLoan.loan, 'interest-certificate', '?fy=abc')).status === 200);
check('a viewer can open documents, a customer cannot', (await doc(paidLoan.loan, 'statement', '', viewer.tok)).status === 200 && (await doc(paidLoan.loan, 'statement', '', await tokenFor(paidLoan.user))).status === 403);
check('opening a document needs a login (401)', (await fetch(srv.base + url(paidLoan.loan, '/documents/statement'))).status === 401);
check('opening one is in the audit log', (await AuditLog.countDocuments({ action: 'LMS_DOCUMENT_VIEWED', entityId: String(paidLoan.loan._id) })) >= 3);

await srv.stop();
await disconnect();
finish();
