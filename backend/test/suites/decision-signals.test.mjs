import http from 'node:http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import { DEFAULTS, evaluate, validateRules, computeOffer, gatherFacts, SUGGESTED_START } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-decision-signals';
await connect(DB);

// ── The rules on plain facts ─────────────────────────────────────────────────────────────────
const clean = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 720, selfieStatus: 'passed', monthlyIncome: 40000, emi: 3500, applicationsRecent: 1, rejectionsRecent: 0, maxDaysLate: 0, accountAgeDays: 10, state: 'Maharashtra', pincode: '400012', bureauReportKnown: false, bureauEnquiries90: 0, bureauMaxDpd: 0, bureauActiveLoans: 0 };
const withRules = over => validateRules({ ...DEFAULTS, ...over }).rules;
const run = (over, facts) => evaluate(withRules(over), { ...clean, ...facts });
const code = (r, c) => r.checks.find(x => x.code === c);

section('NEW CHECKS ARE OFF UNTIL SWITCHED ON');
const off = evaluate(DEFAULTS, { ...clean, applicationsRecent: 9, rejectionsRecent: 9, maxDaysLate: 99, accountAgeDays: 0, state: 'Nowhere' });
check('with the defaults, even bad figures change nothing', off.outcome === 'APPROVE' && !code(off, 'VELOCITY') && !code(off, 'LATE_HISTORY'));
check('the suggested starting values are valid', validateRules({ ...DEFAULTS, ...SUGGESTED_START }).errors.length === 0);

section('VALIDATION');
const bad = (over, why) => check(why, validateRules({ ...DEFAULTS, ...over }).errors.length > 0);
bad({ velocity: { enabled: true, referAt: 5, rejectAt: 3 } }, 'rejecting at fewer applications than referring is refused');
bad({ serviceArea: { enabled: true, blockedStates: [], blockedPincodes: [] } }, 'an area check with nothing listed is refused');
bad({ serviceArea: { enabled: true, blockedPincodes: ['abc12'] } }, 'a pincode that is not digits is refused');
bad({ bureauReport: { enabled: true, maxDpd: 60, rejectDpd: 30 } }, 'rejecting at fewer days past due than referring is refused');
bad({ lateHistory: { enabled: true, referDays: 0 } }, 'zero days late is refused');
const parsed = validateRules({ ...DEFAULTS, serviceArea: { enabled: true, blockedStates: 'Goa, Sikkim\nGoa', blockedPincodes: '4000, 110' } }).rules.serviceArea;
check('states and pincodes can be typed as a list; duplicates are dropped', parsed.blockedStates.join() === 'Goa,Sikkim' && parsed.blockedPincodes.join() === '4000,110');

section('APPLICATIONS IN A SHORT TIME');
const vel = { velocity: { enabled: true, days: 30, referAt: 3, rejectAt: 5 } };
check('2 applications is fine', code(run(vel, { applicationsRecent: 2 }), 'VELOCITY').result === 'pass');
check('3 sends to a person', code(run(vel, { applicationsRecent: 3 }), 'VELOCITY').result === 'refer');
const v5 = run(vel, { applicationsRecent: 5 });
check('5 rejects, and the customer is told to try later', v5.outcome === 'REJECT' && /try again later/.test(v5.customerReason), v5.customerReason);

section('RECENT REJECTIONS AND LATE PAYMENTS');
const rej = { rejections: { enabled: true, days: 90, referAt: 2 } };
check('one rejection passes, two send to a person', code(run(rej, { rejectionsRecent: 1 }), 'REJECTIONS').result === 'pass' && code(run(rej, { rejectionsRecent: 2 }), 'REJECTIONS').result === 'refer');
const late = { lateHistory: { enabled: true, referDays: 15 } };
check('14 days late passes, 15 sends to a person', code(run(late, { maxDaysLate: 14 }), 'LATE_HISTORY').result === 'pass' && code(run(late, { maxDaysLate: 15 }), 'LATE_HISTORY').result === 'refer');

section('LOAN AGAINST INCOME');
const inc = { incomeMultiple: { enabled: true, maxMonths: 3 } };
check('no income on file sends to a person', code(run(inc, { monthlyIncome: 0 }), 'INCOME_MULTIPLE').result === 'refer');
check('a loan of 4 months of income is over a limit of 3', code(run(inc, { amount: 20000, monthlyIncome: 5000 }), 'INCOME_MULTIPLE').result === 'refer');
check('a loan of 2 months of income passes', code(run(inc, { amount: 10000, monthlyIncome: 5000 }), 'INCOME_MULTIPLE').result === 'pass');

section('WHERE WE LEND');
const area = { serviceArea: { enabled: true, blockedStates: ['Sikkim'], blockedPincodes: ['4000'] } };
const sik = run(area, { state: 'sikkim' });
check('a blocked state rejects (capitals do not matter), and the customer is told we do not lend there', sik.outcome === 'REJECT' && /do not offer loans in your area/.test(sik.customerReason), sik.customerReason);
check('a blocked pincode prefix rejects a whole area', run(area, { pincode: '400012' }).outcome === 'REJECT');
check('other places are fine', run(area, { state: 'Karnataka', pincode: '560001' }).outcome === 'APPROVE');
check('no address sends to a person', run(area, { state: '', pincode: '' }).outcome === 'REFER');
check('the loan offer is refused for a blocked place too', computeOffer(withRules(area), { ...clean, state: 'Sikkim' }, { minAmount: 1000, maxAmount: 500000 }).status === 'DECLINED');

section('NEW ACCOUNTS');
const age = { accountAge: { enabled: true, minDays: 2 } };
check('a brand-new account goes to a person, an older one passes', code(run(age, { accountAgeDays: 0 }), 'ACCOUNT_AGE').result === 'refer' && code(run(age, { accountAgeDays: 5 }), 'ACCOUNT_AGE').result === 'pass');

section('CREDIT BUREAU HISTORY');
const br = { bureauReport: { enabled: true, maxEnquiries90: 5, maxDpd: 30, rejectDpd: 90, maxActiveLoans: 4 } };
check('without bureau details the rule does not run, and says why', code(run(br, {}), 'EWS').result === 'skip' && /not returned/.test(code(run(br, {}), 'EWS').detail));
const known = { bureauReportKnown: true };
check('a clean report passes', code(run(br, known), 'EWS').result === 'pass');
check('40 days past due sends to a person', code(run(br, { ...known, bureauMaxDpd: 40 }), 'EWS').result === 'refer');
const dpd = run(br, { ...known, bureauMaxDpd: 95 });
check('95 days past due rejects, with the customer told in neutral words', dpd.outcome === 'REJECT' && /credit record/.test(dpd.customerReason) && !/days/.test(dpd.customerReason), dpd.customerReason);
check('8 enquiries in 90 days sends to a person', code(run(br, { ...known, bureauEnquiries90: 8 }), 'EWS').result === 'refer');
check('5 live loans sends to a person', code(run(br, { ...known, bureauActiveLoans: 5 }), 'EWS').result === 'refer');
check('with the rule switched off it is skipped', code(evaluate(DEFAULTS, clean), 'EWS').result === 'skip');

section('YOUR OWN RULES CAN USE THE NEW FIGURES');
const own = withRules({ custom: [{ name: 'Slow payer', field: 'maxDaysLate', op: '>=', value: 10, result: 'refer', message: 'Paid late before' }, { name: 'No report', field: 'bureauReportKnown', op: '=', value: false, result: 'refer', message: 'No bureau report' }] });
const ownRes = evaluate(own, { ...clean, maxDaysLate: 12 });
check('a rule on days late and a rule on whether bureau details exist both fire', ownRes.checks.filter(c => c.code.startsWith('CUSTOM_') && c.result === 'refer').length === 2);

// ── The real figures, from real records ─────────────────────────────────────────────────────
section('FIGURES WORKED OUT FROM THE CUSTOMER\'S RECORDS');
const user = await User.create({ firstName: 'Sig', lastName: 'Nal', email: 'sig@x.in', phone: '9650000001', password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 864e5), address: { street: '1 Road', city: 'Pune', state: 'Maharashtra', zipCode: '411001' }, employment: { status: 'Employed', monthlyIncome: 20000 }, bureauReport: { enquiries90: 7, maxDpd: 45, activeLoans: 3, at: new Date() } });
await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: day(-10) } });
const mkLoan = async (status, daysAgo) => { const l = await Loan.create({ userId: user._id, loanAmount: 5000, tenure: 3, interestRate: 15, monthlyEMI: 1700, totalAmount: 5100, status }); await Loan.collection.updateOne({ _id: l._id }, { $set: { createdAt: day(-daysAgo) } }); return l; };
const old = await mkLoan('closed', 200);
await mkLoan('rejected', 5);
await mkLoan('rejected', 40);
await mkLoan('rejected', 120);
const current = await mkLoan('submitted', 0);
await EMIPayment.create({ loanId: old._id, userId: user._id, emiNumber: 1, dueDate: day(-150), amount: 1700, principalAmount: 1600, status: 'PAID', paidDate: day(-130), paidAmount: 1700 });
const rules = withRules({ velocity: { enabled: true, days: 30, referAt: 3, rejectAt: null }, rejections: { enabled: true, days: 90, referAt: 2 } });
const f = await gatherFacts(current, await User.findById(user._id), rules);
check('applications in the last 30 days, counting this one: the rejection from 5 days ago plus this = 2 (40 days ago is outside)', f.applicationsRecent === 2, f.applicationsRecent);
check('rejections in the last 90 days: 2 (the one from 120 days ago is outside)', f.rejectionsRecent === 2, f.rejectionsRecent);
check('the most days late: an instalment paid 20 days after it was due', f.maxDaysLate === 20, f.maxDaysLate);
check('account age, income multiple, place and pincode', f.accountAgeDays === 10 && f.amountToIncomeMonths === 0.3 && f.state === 'Maharashtra' && f.pincode === '411001', JSON.stringify(f));
check('bureau details from the stored report', f.bureauReportKnown === true && f.bureauEnquiries90 === 7 && f.bureauMaxDpd === 45 && f.bureauActiveLoans === 3);
const noReport = await gatherFacts(current, await User.create({ firstName: 'No', lastName: 'Report', email: 'nr@x.in', phone: '9650000002', password: 'x12345678' }), rules);
check('a customer without a bureau report is "not known", not zero', noReport.bureauReportKnown === false);

// ── Over the web, and the bureau handing back the details ───────────────────────────────────
let reply = { data: { score: 710, enquiries: 6, dpd: 35, loans: 2 } };
const bureau = http.createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply)); }); });
await new Promise(r => bureau.listen(0, r));
const srv = await startServer(DB, { OFFER_LIMIT: 'true', REQUIRE_PHONE_VERIFIED: 'true', BUREAU_PROVIDER: 'generic', BUREAU_API_URL: `http://127.0.0.1:${bureau.address().port}/x`, BUREAU_API_KEY: 'k', BUREAU_SCORE_PATH: 'data.score', BUREAU_ENQUIRIES_PATH: 'data.enquiries', BUREAU_MAXDPD_PATH: 'data.dpd', BUREAU_ACTIVELOANS_PATH: 'data.loans' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

section('THE BUREAU HANDS BACK ITS DETAILS');
const cust = await User.create({ firstName: 'Bu', lastName: 'Reau', email: 'bu@x.in', phone: '9650000003', password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 864e5), panNumber: 'ABCPE1234F' });
const chk = await call('POST', '/loans/check-eligibility', await tokenFor(cust), { consent: true });
const saved = await User.findById(cust._id);
check('the credit check stores the score and the extra details', chk.s === 200 && saved.creditScore === 710 && saved.bureauReport.enquiries90 === 6 && saved.bureauReport.maxDpd === 35 && saved.bureauReport.activeLoans === 2, JSON.stringify(saved.bureauReport));
const facts2 = await gatherFacts(await Loan.create({ userId: cust._id, loanAmount: 5000, tenure: 3, interestRate: 15, monthlyEMI: 1700, totalAmount: 5100, status: 'submitted' }), saved, rules);
check('and the engine can now use them', facts2.bureauReportKnown && facts2.bureauMaxDpd === 35);

section('THE TRY-IT SCREEN AND THE RULES SCREEN');
const rulesRes = await call('GET', '/admin/decisions/rules', admin);
check('the rules screen is given the suggested starting values', rulesRes.d.suggested.velocity.referAt === 3 && rulesRes.d.customFields.maxDaysLate);
const tried = await call('POST', '/admin/decisions/test', admin, { rules: { velocity: { enabled: true, days: 30, referAt: 3, rejectAt: 5 }, serviceArea: { enabled: true, blockedStates: ['Sikkim'], blockedPincodes: [] } }, facts: { amount: 10000, age: 30, kycApproved: true, phoneVerified: true, applicationsRecent: 5, state: 'Sikkim', monthlyIncome: 40000, emi: 3500 } });
check('trying an applicant with the new figures shows the new checks', tried.s === 200 && tried.d.outcome === 'REJECT' && tried.d.checks.some(c => c.code === 'VELOCITY' && c.result === 'reject') && tried.d.checks.some(c => c.code === 'SERVICE_AREA'), JSON.stringify(tried.d).slice(0, 200));
const saveRules = await call('PUT', '/admin/decisions/rules', admin, { ...SUGGESTED_START });
check('the suggested starting values can be saved', saveRules.s === 200 && saveRules.d.rules.velocity.enabled && saveRules.d.rules.bureauReport.rejectDpd === 90, JSON.stringify(saveRules.d).slice(0, 160));
check('a bad rule is refused (400)', (await call('PUT', '/admin/decisions/rules', admin, { velocity: { enabled: true, referAt: 9, rejectAt: 2 } })).s === 400);

await srv.stop();
bureau.close();
await disconnect();
finish();
