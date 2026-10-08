import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import Notification from '../../src/models/Notification.js';
import AuditLog from '../../src/models/AuditLog.js';
import { evaluate, DEFAULTS, validateRules, computeOffer } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-decisions';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const yearsAgo = n => new Date(Date.now() - n * 365.25 * 86400000);
let seq = 0;
const mk = async (over = {}) => {
  seq++;
  const u = await User.create({ firstName: `Cust${seq}`, lastName: 'D', email: `c${seq}@x.in`, phone: `97${String(seq).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: yearsAgo(32), selfie: { status: 'passed' }, ...over });
  return { u, tok: await tokenFor(u), n: seq };
};
const apply = (c, amount = 10000) => call('POST', '/loans/apply-full', c.tok, { loanAmount: amount, tenure: 3, purpose: 'Personal', planType: '3_emi', bankDetails: { accountHolder: 'D', accountNumber: `88800000${c.n}`, ifscCode: 'SBIN0001234' } });
const loanOf = async c => Loan.findOne({ userId: c.u._id }).sort({ createdAt: -1 });
const clean = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 0, selfieStatus: 'passed', monthlyIncome: 0, emi: 0 };

section('THE RULES ON PLAIN FACTS');
const ev = f => evaluate(DEFAULTS, { ...clean, ...f });
check('a clean applicant is approved', ev({}).outcome === 'APPROVE');
check('the credit score rule is skipped when there is no score', ev({}).checks.find(c => c.code === 'BUREAU').result === 'skip');
check('score 650 or more is clean', ev({ bureauScore: 650 }).outcome === 'APPROVE' && ev({ bureauScore: 780 }).outcome === 'APPROVE');
check('a score below 650 needs a person, however low', ev({ bureauScore: 620 }).outcome === 'REFER' && ev({ bureauScore: 480 }).outcome === 'REFER');
check('and the reason says which score', ev({ bureauScore: 620 }).checks.find(c => c.code === 'BUREAU').detail.includes('620'));
check('age 19 is referred, age 70 is referred, age 80 is rejected, age 16 is rejected', ev({ age: 19 }).outcome === 'REFER' && ev({ age: 70 }).outcome === 'REFER' && ev({ age: 80 }).outcome === 'REJECT' && ev({ age: 16 }).outcome === 'REJECT');
check('no date of birth is referred, not guessed', ev({ age: 0 }).outcome === 'REFER');
check('over the first-loan limit is referred; a repeat customer has a higher limit', ev({ amount: 40000 }).outcome === 'REFER' && ev({ amount: 40000, repeatCustomer: true }).outcome === 'APPROVE');
check('an earlier default is rejected', ev({ defaultedLoans: 1 }).outcome === 'REJECT');
check('KYC, phone, AML, open loans and overdue instalments each send it to a person', [ev({ kycApproved: false }), ev({ phoneVerified: false }), ev({ openAmlAlerts: 1 }), ev({ openLoans: 2 }), ev({ overdueEmis: 1 })].every(r => r.outcome === 'REFER'));
check('a rejection carries a plain customer reason with no internal detail', ev({ age: 80 }).customerReason.includes('age') && !ev({ age: 80 }).customerReason.includes('80'));
check('a hard reject beats a referral', ev({ defaultedLoans: 1, kycApproved: false }).outcome === 'REJECT');
const strict = { ...DEFAULTS, bureau: { ...DEFAULTS.bureau, rejectBelow: 500 } };
check('a "reject below" score rejects instead of referring', evaluate(strict, { ...clean, bureauScore: 480 }).outcome === 'REJECT' && evaluate(strict, { ...clean, bureauScore: 520 }).outcome === 'REFER');
const needScore = { ...DEFAULTS, bureau: { ...DEFAULTS.bureau, requireScore: true } };
check('"require a score" refers applicants without one', evaluate(needScore, clean).outcome === 'REFER');
check('the sign-up photo must have passed: none, or waiting for staff, sends it to a person', ev({ selfieStatus: 'none' }).outcome === 'REFER' && ev({ selfieStatus: 'review' }).outcome === 'REFER' && ev({ selfieStatus: 'passed' }).outcome === 'APPROVE');
const foirOn = { ...DEFAULTS, foir: { enabled: true, maxPercent: 50 } };
check('income against EMIs: off by default and skipped', ev({ monthlyIncome: 1000, emi: 9000 }).outcome === 'APPROVE' && ev({}).checks.find(c => c.code === 'FOIR').result === 'skip');
check('income against EMIs when on: 20,000 of 30,000 is too much, 10,000 is fine, no income goes to a person', evaluate(foirOn, { ...clean, monthlyIncome: 30000, emi: 20000 }).outcome === 'REFER' && evaluate(foirOn, { ...clean, monthlyIncome: 30000, emi: 10000 }).outcome === 'APPROVE' && evaluate(foirOn, { ...clean, monthlyIncome: 0, emi: 5000 }).outcome === 'REFER');
check('and the reason says the share', evaluate(foirOn, { ...clean, monthlyIncome: 30000, emi: 20000 }).checks.find(c => c.code === 'FOIR').detail.includes('66.7%'));
check('income and bureau history rules say they are not running yet', ev({}).checks.filter(c => c.result === 'skip').map(c => c.code).includes('EWS'));

section('VALIDATING THE RULES');
check('ages out of order refused', validateRules({ ...DEFAULTS, age: { min: 40, max: 30, hardMin: 18, hardMax: 75 } }).errors.length > 0);
check('a reject score above the clean score is refused', validateRules({ ...DEFAULTS, bureau: { ...DEFAULTS.bureau, rejectBelow: 700 } }).errors.length > 0);
check('a clean score outside 300 to 900 is refused', validateRules({ ...DEFAULTS, bureau: { ...DEFAULTS.bureau, autoMinScore: 50 } }).errors.length > 0);
check('the defaults are valid', validateRules(DEFAULTS).errors.length === 0);

section('RULES API AND ACCESS');
const rules = await call('GET', '/admin/decisions/rules', admin);
check('rules start in shadow mode, so nothing automatic happens', rules.s === 200 && rules.d.rules.mode === 'shadow', JSON.stringify(rules.d).slice(0, 120));
const hire = async (role, n) => (await call('POST', '/admin/staff', admin, { firstName: role, lastName: 'S', email: `${role}${n}@lifc.in`, phone: `96100000${n}`, role })).d.staff;
const credit = await hire('credit_officer', 1);
const coll = await hire('collections_agent', 2);
await User.updateMany({ role: { $nin: [null, 'customer'] } }, { twoFactorEnabled: true });
const [tCredit, tColl] = await Promise.all([credit, coll].map(async s => tokenFor(await User.findById(s.id), true)));
check('a credit officer can see the rules but not change them (403)', (await call('GET', '/admin/decisions/rules', tCredit)).s === 200 && (await call('PUT', '/admin/decisions/rules', tCredit, { mode: 'auto' })).s === 403);
check('a collections agent cannot see them (403)', (await call('GET', '/admin/decisions/rules', tColl)).s === 403);
check('customers cannot (403)', (await call('GET', '/admin/decisions/rules', (await mk()).tok)).s === 403);
check('a bad mode is refused (400)', (await call('PUT', '/admin/decisions/rules', admin, { mode: 'yolo' })).s === 400);
check('ages out of order are refused (400)', (await call('PUT', '/admin/decisions/rules', admin, { age: { min: 50, max: 30, hardMin: 18, hardMax: 75 } })).s === 400);

section('TRYING THE RULES ON AN IMAGINED APPLICANT');
const t1 = await call('POST', '/admin/decisions/test', tCredit, { facts: { ...clean, bureauScore: 610 } });
check('the test shows the outcome and each check', t1.s === 200 && t1.d.outcome === 'REFER' && t1.d.checks.length >= 8, JSON.stringify(t1.d).slice(0, 150));
const t2 = await call('POST', '/admin/decisions/test', tCredit, { facts: clean, rules: { amount: { firstLoanAutoMax: 5000, repeatAutoMax: 100000 } } });
check('unsaved rules can be tried before saving', t2.d.outcome === 'REFER' && (await call('GET', '/admin/decisions/rules', admin)).d.rules.amount.firstLoanAutoMax === 25000);
check('rubbish facts are refused (400)', (await call('POST', '/admin/decisions/test', admin, { facts: { amount: 'lots' } })).s === 400);

section('SHADOW MODE: RECORDS, DOES NOT ACT');
const s1 = await mk();
const a1 = await apply(s1);
const l1 = await loanOf(s1);
check('the application is accepted and stays with a person', a1.s === 201 && l1.status === 'submitted');
check('but the engine recorded what it would have done', l1.decision.outcome === 'APPROVE' && l1.decision.applied === false && l1.decision.mode === 'shadow' && l1.decision.checks.length >= 8);
check('and nothing was approved or sent', (await Notification.countDocuments({ userId: s1.u._id, type: 'LOAN_APPROVED' })) === 0 && !(await AuditLog.findOne({ action: 'LOAN_AUTO_APPROVED' })));
await call('POST', `/admin/loans/${l1._id}/approve`, admin, {});
const sum1 = await call('GET', '/admin/decisions', tCredit);
check('the summary shows how the engine and the person agreed', sum1.s === 200 && sum1.d.calibration.wouldApprove.personApproved === 1 && sum1.d.recent.length >= 1 && sum1.d.recent[0].outcome === 'APPROVE', JSON.stringify(sum1.d.calibration));

section('AUTO MODE');
const on = await call('PUT', '/admin/decisions/rules', admin, { mode: 'auto' });
check('automatic mode switched on', on.s === 200 && /automatically/.test(on.d.message));
check('the change is in the audit log', !!(await AuditLog.findOne({ action: 'DECISION_RULES_UPDATED' })));

const c1 = await mk();
await apply(c1);
const al = await loanOf(c1);
check('a clean application is approved on the spot', al.status === 'approved' && al.approvedBy === 'system:decision-engine' && al.decision.applied === true);
check('the customer is told', !!(await Notification.findOne({ userId: c1.u._id, type: 'LOAN_APPROVED' })));
check('and it is in the audit log as a system action', !!(await AuditLog.findOne({ action: 'LOAN_AUTO_APPROVED', entityId: String(al._id) })));

const c2 = await mk();
await apply(c2, 40000);
const l2 = await loanOf(c2);
check('over the first-loan limit it waits for a person', l2.status === 'submitted' && l2.decision.outcome === 'REFER');

const c3 = await mk({ kycStatus: 'pending' });
await apply(c3);
check('KYC not approved waits for a person', (await loanOf(c3)).status === 'submitted');

const c4 = await mk({ dateOfBirth: yearsAgo(16) });
await apply(c4);
const l4 = await loanOf(c4);
check('too young is rejected', l4.status === 'rejected' && l4.rejectedBy === 'system:decision-engine');
check('the customer gets a plain reason', l4.rejectionReason.includes('age') && !!(await Notification.findOne({ userId: c4.u._id, type: 'LOAN_REJECTED' })));
check('the internal detail is kept for staff only', l4.rejectionNotes.includes('Age 16') && !(await Notification.findOne({ userId: c4.u._id, type: 'LOAN_REJECTED' })).message.includes('16'));

const c5 = await mk();
await Loan.create({ userId: c5.u._id, loanAmount: 5000, tenure: 3, interestRate: 0, monthlyEMI: 2000, status: 'written_off' });
await apply(c5);
check('an earlier written-off loan is rejected', (await loanOf(c5)).status === 'rejected');

const c6 = await mk();
await AmlAlert.create({ rule: 'LARGE_LOAN', severity: 'MEDIUM', userId: c6.u._id, detail: 't' });
await apply(c6);
check('an open AML alert waits for a person', (await loanOf(c6)).status === 'submitted');

const c7 = await mk({ creditScore: 590 });
await apply(c7);
const l7 = await loanOf(c7);
check('a credit score of 590 waits for a person', l7.status === 'submitted' && l7.decision.outcome === 'REFER');
const c8 = await mk({ creditScore: 700 });
await apply(c8);
check('a credit score of 700 is approved', (await loanOf(c8)).status === 'approved');

const c9 = await mk({ phoneVerified: false });
await apply(c9);
check('an unverified phone waits for a person', (await loanOf(c9)).status === 'submitted');

section('REPEAT CUSTOMERS AND PEOPLE STILL CAN DECIDE');
const r1 = await mk();
await Loan.create({ userId: r1.u._id, loanAmount: 20000, tenure: 3, interestRate: 0, monthlyEMI: 7000, status: 'closed', closureType: 'repaid' });
await apply(r1, 60000);
check('a repeat customer can be approved for more automatically', (await loanOf(r1)).status === 'approved');
check('a person can still decide a referred loan', (await call('POST', `/admin/loans/${l2._id}/approve`, admin, {})).s === 200);

section('SWITCHED OFF');
await call('PUT', '/admin/decisions/rules', admin, { mode: 'off' });
const o1 = await mk();
await apply(o1);
const lo = await loanOf(o1);
check('with the engine off nothing is recorded and the loan waits', lo.status === 'submitted' && !lo.decision);

section('YOUR OWN RULES');
const own = { ...DEFAULTS, custom: [
  { id: 'big', name: 'Large loan', field: 'amount', op: '>', value: 20000, result: 'refer', message: 'Over 20,000' },
  { id: 'young', name: 'Under 23', field: 'age', op: '<', value: 23, result: 'reject', message: 'Too young for our policy' },
  { id: 'nokyc', name: 'KYC missing', field: 'kycApproved', op: '=', value: false, result: 'refer', message: '' },
] };
const evOwn = f => evaluate(own, { ...clean, ...f });
check('a rule of your own that fires sends the application to a person, with your note', evOwn({ amount: 22000 }).outcome === 'REFER' && evOwn({ amount: 22000 }).checks.find(c => c.code === 'CUSTOM_big').detail === 'Over 20,000');
check('one set to reject rejects, and the customer gets a general reason', evOwn({ age: 22 }).outcome === 'REJECT' && evOwn({ age: 22 }).customerReason.length > 10 && !evOwn({ age: 22 }).customerReason.includes('policy'));
check('rules that do not fire change nothing', evOwn({}).outcome === 'APPROVE');
check('yes/no rules work', evOwn({ kycApproved: false }).checks.find(c => c.code === 'CUSTOM_nokyc').result === 'refer');
check('they sit alongside the built-in rules', evOwn({ amount: 22000, defaultedLoans: 1 }).outcome === 'REJECT');
const badOwn = r => validateRules({ ...DEFAULTS, custom: [r] }).errors.length > 0;
check('a rule with no name, an unknown field, a wrong comparison, no value or no action is refused', badOwn({ name: '', field: 'amount', op: '>', value: 1, result: 'refer' }) && badOwn({ name: 'x', field: 'shoe', op: '>', value: 1, result: 'refer' }) && badOwn({ name: 'x', field: 'kycApproved', op: '>', value: true, result: 'refer' }) && badOwn({ name: 'x', field: 'amount', op: '>', value: '', result: 'refer' }) && badOwn({ name: 'x', field: 'amount', op: '>', value: 1, result: 'explode' }));
const saveOwn = await call('PUT', '/admin/decisions/rules', admin, { custom: [{ name: 'Large loan', field: 'amount', op: '>', value: 20000, result: 'refer', message: 'Over 20,000' }] });
check('your own rules are saved from the portal', saveOwn.s === 200 && saveOwn.d.rules.custom.length === 1 && saveOwn.d.rules.custom[0].id === 'large_loan');
const tryOwn = await call('POST', '/admin/decisions/test', admin, { facts: { ...clean, amount: 25000 } });
check('and show up when you try an applicant', tryOwn.d.outcome === 'REFER' && tryOwn.d.checks.some(c => c.code === 'CUSTOM_large_loan' && c.result === 'refer'));
check('the editor is told which things a rule can look at', Object.keys((await call('GET', '/admin/decisions/rules', admin)).d.customFields).includes('bureauScore'));
check('a rule of your own does not change what a customer is offered', computeOffer(own, { age: 32, defaultedLoans: 0, repeatCustomer: false, bureauScore: 700 }, { minAmount: 1000, maxAmount: 500000 }).amount === computeOffer(DEFAULTS, { age: 32, defaultedLoans: 0, repeatCustomer: false, bureauScore: 700 }, { minAmount: 1000, maxAmount: 500000 }).amount);

await srv.stop();
await disconnect();
finish();
