import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Transaction from '../../src/models/Transaction.js';
import Notification from '../../src/models/Notification.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-pricing';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const mk = (first, i) => User.create({ firstName: first, lastName: 'T', email: `p${i}@x.in`, phone: `97000000${10 + i}`, password: 'x12345678', kycStatus: 'approved' });
const alice = await mk('Alice', 1);
const bob = await mk('Bob', 2);
const ta = await tokenFor(alice);
const tb = await tokenFor(bob);
const bank = { accountHolder: 'Alice T', accountNumber: '1234567890', ifscCode: 'SBIN0001234' };
const applyFull = (tok, extra = {}) => call('POST', '/loans/apply-full', tok, { loanAmount: 30000, tenure: 3, purpose: 'Personal', planType: '3_emi', bankDetails: bank, ...extra });
const quote = q => call('GET', `/pricing/quote?${q}`, null);
const put = body => call('PUT', '/admin/pricing', admin, body);
const get = () => call('GET', '/admin/pricing', admin);

section('PUBLIC PRICING: DEFAULTS MATCH WHAT THE APP CHARGED BEFORE');
const pub = await call('GET', '/pricing', null);
check('anyone can read the current terms (no login)', pub.s === 200 && pub.d.policy.processingFeePercent === 2.5 && pub.d.policy.gstPercent === 18);
check('three plans are offered', Object.keys(pub.d.policy.plans).join() === 'one_time,3_emi,6_emi');
check('internal setting (APR ceiling) is not part of the public view', !('maxAprPercent' in pub.d.policy));
const q3 = (await quote('amount=30000&plan=3_emi')).d.quote;
check('3-month plan: EMI 10,500, fee 750 + GST 135, customer receives 29,115, repays 31,500', q3.emi === 10500 && q3.processingFee === 750 && q3.gst === 135 && q3.netDisbursed === 29115 && q3.totalRepayable === 31500, JSON.stringify(q3));
check('the true yearly cost (APR) counts the fees: 48.5%', q3.aprPercent === 48.5, q3.aprPercent);
check('one-time plan APR 36.5%, 6-month 41.1%', (await quote('amount=30000&plan=one_time')).d.quote.aprPercent === 36.5 && (await quote('amount=30000&plan=6_emi')).d.quote.aprPercent === 41.1);
const std = (await quote('amount=100000&tenure=12')).d.quote;
check('12-month standard loan: EMI 9,026 and APR 20.8%', std.emi === 9026 && std.aprPercent === 20.8 && std.interestType === 'reducing', JSON.stringify(std));
const all = (await call('GET', '/pricing/quotes?amount=30000', null)).d;
check('all plans for one amount in a single call', all.quotes.length === 3 && all.quotes.every(x => x.amount === 30000));
check('amount below the minimum is refused (400)', (await quote('amount=500&plan=3_emi')).s === 400);
check('amount above the maximum is refused (400)', (await quote('amount=900000&plan=3_emi')).s === 400);
check('unknown plan is refused (400)', (await quote('amount=30000&plan=nope')).s === 400);
check('tenure outside the allowed range is refused (400)', (await quote('amount=30000&tenure=99')).s === 400);

section('ADMIN SETTINGS: VALIDATION AND ACCESS');
check('customers cannot read or change pricing (403)', (await call('GET', '/admin/pricing', ta)).s === 403 && (await call('PUT', '/admin/pricing', ta, { processingFeePercent: 0 })).s === 403);
check('no login -> 401', (await call('PUT', '/admin/pricing', null, {})).s === 401);
for (const [name, body] of [
  ['a fee above 20%', { processingFeePercent: 150 }],
  ['a negative rate', { annualRatePercent: -1 }],
  ['text instead of a number', { gstPercent: 'lots' }],
  ['minimum above maximum', { minAmount: 90000, maxAmount: 80000, offerAmount: 85000 }],
  ['a plan with 0 months', { plans: { '3_emi': { tenureMonths: 0 } } }],
  ['a fractional tenure', { plans: { '3_emi': { tenureMonths: 2.5 } } }],
  ['more than 30 cooling-off days', { coolingOffDays: 99 }],
  ['a bad support email', { institution: { supportEmail: 'not-an-email' } }],
  ['a bad website', { institution: { website: 'javascript:alert(1)' } }],
  ['an empty lender name', { institution: { lenderName: '  ' } }],
  ['an over-long address', { institution: { address: 'x'.repeat(401) } }],
]) {
  const r = await put(body);
  check(`refused: ${name} (400)`, r.s === 400 && typeof r.d.error === 'string', JSON.stringify(r));
}
check('nothing was changed by the refused requests', (await get()).d.policy.processingFeePercent === 2.5);
check('unknown fields are ignored, not stored', (await put({ processingFeePercent: 2.5, evil: 'x', plans: { hack: { tenureMonths: 1 } } })).s === 200 && !('evil' in (await get()).d.policy) && !('hack' in (await get()).d.policy.plans));
const missing = (await get()).d.missingInstitutionDetails;
check('admin is told which lender details are still missing', missing.length === 7 && missing.includes('NBFC registration number') && missing.includes('Grievance officer name'), missing.join());

section('CHANGES TAKE EFFECT, AND ARE AUDITED');
const changed = await put({ processingFeePercent: 1, gstPercent: 18 });
check('saved', changed.s === 200 && /Existing loans keep/.test(changed.d.message));
const q1 = (await quote('amount=30000&plan=3_emi')).d.quote;
check('a 1% fee is used straight away: fee 300 + GST 54, customer receives 29,646', q1.processingFee === 300 && q1.gst === 54 && q1.netDisbursed === 29646, JSON.stringify(q1));
check('and the APR falls', q1.aprPercent < 48.5, q1.aprPercent);
const entry = (await AuditLog.find({ action: 'PRICING_UPDATED' }).sort({ seq: -1 }).limit(1))[0];
check('the change is in the audit log with before and after', entry && entry.details.before.processingFeePercent === 2.5 && entry.details.after.processingFeePercent === 1 && entry.actor === 'admin@lifc.in');
check('a plan can be switched off: it disappears and cannot be applied for', (await put({ plans: { '6_emi': { enabled: false } } })).s === 200 && !('6_emi' in (await call('GET', '/pricing', null)).d.policy.plans) && (await quote('amount=30000&plan=6_emi')).s === 400 && (await call('GET', '/pricing/quotes?amount=30000', null)).d.quotes.length === 2);
await put({ plans: { '6_emi': { enabled: true } }, processingFeePercent: 2.5 });

section('APR CEILING');
const capTry = await put({ maxAprPercent: 30 });
check('a ceiling the current pricing breaks is refused (409), naming the plans', capTry.s === 409 && capTry.d.errors.length >= 3 && /APR/.test(capTry.d.errors[0]), JSON.stringify(capTry.d));
check('and nothing is saved', (await get()).d.policy.maxAprPercent === null);
check('a ceiling above every plan is accepted', (await put({ maxAprPercent: 60 })).s === 200);
const tooDear = await put({ plans: { '3_emi': { flatInterestPercent: 40 } } });
check('pricing that would break the ceiling is then refused (409)', tooDear.s === 409 && tooDear.d.errors.some(e => /3-month/.test(e)), JSON.stringify(tooDear.d));
await put({ maxAprPercent: null });

section('APPLYING USES THE POLICY AND KEEPS THE OFFER');
const a1 = await applyFull(ta);
check('3-month application: EMI 10,500, customer receives 29,115', a1.s === 201 && a1.d.loan.monthlyEMI === 10500 && a1.d.loan.disbursedAmount === 29115 && a1.d.loan.processingFee === 750 && a1.d.loan.gst === 135 && a1.d.loan.gstPercent === 18, JSON.stringify(a1.d));
check('the response carries the key facts including APR', a1.d.loan.aprPercent === 48.5 && a1.d.loan.kfs.totalRepayable === 31500);
const loan1 = await Loan.findById(a1.d.loan.id);
check('the offer is stored on the loan', loan1.kfs.aprPercent === 48.5 && loan1.kfs.coolingOffDays === 3 && loan1.planType === '3_emi' && loan1.interestRate === 5);
const std1 = await call('POST', '/loans/apply-full', ta, { loanAmount: 100000, tenure: 12, purpose: 'Personal', bankDetails: bank });
check('a standard loan (no plan) is priced at the policy rate', std1.s === 201 && std1.d.loan.monthlyEMI === 9026 && std1.d.loan.kfs.interestType === 'reducing');
check('the older /loans/apply path also uses the policy and charges the fee', (await call('POST', '/loans/apply', ta, { loanAmount: 30000, tenure: 6, purpose: 'Personal' })).d.loan.processingFee === 750);
check('amount over the maximum is refused (400)', (await applyFull(ta, { loanAmount: 900000 })).s === 400);
check('unknown plan is refused (400)', (await applyFull(ta, { planType: 'nope' })).s === 400);
check('unknown purpose is refused (400), not a server error', (await applyFull(ta, { purpose: 'Holiday' })).s === 400);
check('a fractional amount is refused (400)', (await applyFull(ta, { loanAmount: 30000.5 })).s === 400);

await put({ plans: { '3_emi': { flatInterestPercent: 4 } }, processingFeePercent: 2 });
const a2 = await applyFull(ta);
check('after a price change a new application uses the new price (4% flat, 2% fee)', a2.d.loan.monthlyEMI === 10400 && a2.d.loan.processingFee === 600, JSON.stringify(a2.d.loan));
const stillOld = await Loan.findById(a1.d.loan.id);
check('the earlier loan keeps the offer the customer saw (EMI 10,500, fee 750)', stillOld.monthlyEMI === 10500 && stillOld.kfs.processingFee === 750 && stillOld.kfs.aprPercent === 48.5);
await put({ plans: { '3_emi': { flatInterestPercent: 5 } }, processingFeePercent: 2.5 });

section('PAYOUT, LATE FEE AND CLOSURE FEE FOLLOW THE POLICY');
await call('POST', `/admin/loans/${a1.d.loan.id}/approve`, admin);
const pay = await call('POST', `/admin/loans/${a1.d.loan.id}/disburse`, admin);
check('customer is paid the amount after fees', pay.s === 200 && (await Loan.findById(a1.d.loan.id)).disbursedAmount === 29115 && (await Transaction.findOne({ loanId: a1.d.loan.id })).amount === 29115, JSON.stringify(pay.d));

await put({ lateFee: { percentPerMonth: 3, minimum: 100 }, foreclosureFeePercent: 1 });
const lf = await Loan.create({ userId: bob._id, loanAmount: 24000, tenure: 3, interestRate: 15, monthlyEMI: 10000, status: 'disbursed', disbursementDate: day(-40), disbursedAmount: 24000 });
for (const [n, d] of [[1, -10], [2, 20], [3, 50]]) await EMIPayment.create({ loanId: lf._id, userId: bob._id, emiNumber: n, dueDate: day(d), amount: 10000, principalAmount: 8000, interestAmount: 2000, status: 'PENDING' });
await call('POST', '/emi/admin/check-overdue', admin);
check('late fee uses the policy: 3% of 10,000 for one month = 300 (above the 100 minimum)', (await EMIPayment.findOne({ loanId: lf._id, emiNumber: 1 })).penaltyApplied === 300);
const fq = await call('GET', `/emi/foreclosure/${lf._id}`, tb);
check('early-closure quote uses the policy: 1% fee on 16,000 = 160, overdue 10,300', fq.d.fee === 160 && fq.d.feePercent === 1 && fq.d.overdueAmount === 10300, JSON.stringify(fq.d));
await put({ lateFee: { percentPerMonth: 2, minimum: 500 }, foreclosureFeePercent: 2 });

section('LENDER DETAILS APPEAR ON THE AGREEMENT');
await put({ institution: { registrationNumber: 'N-14.01234', address: '1 Test Street, Mumbai', supportEmail: 'help@nbfc.test', supportPhone: '+91 22 1234 5678', grievanceOfficerName: 'Asha Rao', grievanceOfficerEmail: 'grievance@nbfc.test', grievanceOfficerPhone: '+91 22 8765 4321' } });
check('no lender details are missing any more', (await get()).d.missingInstitutionDetails.length === 0);
const ag = (await call('GET', `/compliance/agreement/${a1.d.loan.id}`, ta)).d;
check('agreement names the lender, registration, grievance officer and support', ['Laxmi India Finance Ltd.', 'N-14.01234', 'Grievance officer: Asha Rao', 'help@nbfc.test'].every(t => ag.text.includes(t)), ag.text.slice(0, 300));
check('agreement carries the key facts exactly as offered', ['Processing fee (2.5%): Rs 750', 'GST on the processing fee (18%): Rs 135', 'Amount you receive: Rs 29,115', 'Total you repay: Rs 31,500', 'APR), counting all fees: 48.5%', 'COOLING-OFF PERIOD', '3 day(s)'].every(t => ag.text.includes(t)));
await put({ processingFeePercent: 5 });
const ag2 = (await call('GET', `/compliance/agreement/${a1.d.loan.id}`, ta)).d;
check('a later price change does not alter that loan\'s agreement figures', ag2.text.includes('Processing fee (2.5%): Rs 750') && !ag2.text.includes('(5%)'));
await put({ processingFeePercent: 2.5 });

section('COOLING-OFF EXIT');
// a1 was disbursed a moment ago with the 3-day window printed in its offer
const co = await call('GET', `/emi/cooling-off/${a1.d.loan.id}`, ta);
const expectedInterest = Math.round((29115 * 0.485 * 1) / 365);
check('quote: give back what was received plus a day of interest at the loan APR', co.s === 200 && co.d.principal === 29115 && co.d.daysHeld === 1 && co.d.accruedInterest === expectedInterest && co.d.total === 29115 + expectedInterest, JSON.stringify(co.d));
check('the window end is shown', new Date(co.d.windowEndsAt) > new Date());
check("another customer cannot see it (404)", (await call('GET', `/emi/cooling-off/${a1.d.loan.id}`, tb)).s === 404);
check('a loan that has not been paid out has no quote (400)', (await call('GET', `/emi/cooling-off/${a2.d.loan.id}`, ta)).s === 400);
check('a stale amount is refused (409) with the new quote', await (async () => { const r = await call('POST', `/emi/cooling-off/${a1.d.loan.id}`, ta, { expectedAmount: 100 }); return r.s === 409 && r.d.quote.total === co.d.total; })());
check('no amount is refused (409)', (await call('POST', `/emi/cooling-off/${a1.d.loan.id}`, ta, {})).s === 409);
const both = await Promise.all([1, 2].map(() => call('POST', `/emi/cooling-off/${a1.d.loan.id}`, ta, { expectedAmount: co.d.total })));
check('double tap: exactly one success', both.map(r => r.s).sort().join() === '200,409', both.map(r => r.s).join());
const done = await Loan.findById(a1.d.loan.id);
check('loan closed as a cooling-off exit, with the amounts recorded', done.status === 'closed' && done.closureType === 'cooling_off' && done.foreclosure.amount === co.d.total && done.foreclosure.fee === 0);
check('all instalments waived', (await EMIPayment.find({ loanId: a1.d.loan.id })).every(e => e.status === 'WAIVED'));
check('payment recorded and customer told', (await Transaction.countDocuments({ loanId: a1.d.loan.id, referenceId: 'COOLING_OFF' })) === 1 && (await Notification.countDocuments({ userId: alice._id, title: 'Loan cancelled' })) === 1);
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'LOAN_COOLING_OFF_EXIT' })));
check('no second quote once closed (400)', (await call('GET', `/emi/cooling-off/${a1.d.loan.id}`, ta)).s === 400);

section('COOLING-OFF: WHEN IT DOES NOT APPLY');
const late = await Loan.create({ userId: alice._id, loanAmount: 30000, tenure: 3, interestRate: 5, monthlyEMI: 10500, status: 'disbursed', disbursementDate: day(-10), disbursedAmount: 29115, kfs: { coolingOffDays: 3, aprPercent: 48.5 } });
for (const n of [1, 2, 3]) await EMIPayment.create({ loanId: late._id, userId: alice._id, emiNumber: n, dueDate: day(20 * n), amount: 10500, principalAmount: 10000, interestAmount: 500, status: 'PENDING' });
const lateTry = await call('GET', `/emi/cooling-off/${late._id}`, ta);
check('after the window it is refused, and points to early closure', lateTry.s === 400 && /ended/.test(lateTry.d.error) && /early/.test(lateTry.d.error), lateTry.d.error);
const paid = await Loan.create({ userId: alice._id, loanAmount: 30000, tenure: 3, interestRate: 5, monthlyEMI: 10500, status: 'disbursed', disbursementDate: day(-1), disbursedAmount: 29115, kfs: { coolingOffDays: 3, aprPercent: 48.5 } });
for (const [n, st] of [[1, 'PAID'], [2, 'PENDING'], [3, 'PENDING']]) await EMIPayment.create({ loanId: paid._id, userId: alice._id, emiNumber: n, dueDate: day(20 * n), amount: 10500, principalAmount: 10000, interestAmount: 500, status: st });
check('once an instalment is paid it is refused (400)', (await call('GET', `/emi/cooling-off/${paid._id}`, ta)).s === 400);
const rule = await Loan.create({ userId: alice._id, loanAmount: 30000, tenure: 3, interestRate: 5, monthlyEMI: 10500, status: 'disbursed', disbursementDate: day(-1), disbursedAmount: 29115, kfs: { coolingOffDays: 3, aprPercent: 48.5 } });
await EMIPayment.create({ loanId: rule._id, userId: alice._id, emiNumber: 1, dueDate: day(20), amount: 10500, principalAmount: 10000, interestAmount: 500, status: 'PENDING' });
await put({ coolingOffDays: 0 });
check('switching the policy off later does not remove the right promised in an existing offer', (await call('GET', `/emi/cooling-off/${rule._id}`, ta)).s === 200);
const bobs = await applyFull(tb, { bankDetails: { accountHolder: 'Bob T', accountNumber: '9988776655', ifscCode: 'SBIN0001234' } });
check('new offers then carry no cooling-off period', bobs.s === 201 && bobs.d.loan.kfs.coolingOffDays === 0, JSON.stringify(bobs.d));
const approved = await call('POST', `/admin/loans/${bobs.d.loan.id}/approve`, admin);
const bobAgreement = await call('GET', `/compliance/agreement/${bobs.d.loan.id}`, tb);
check('and their agreement leaves the cooling-off section out', approved.s === 200 && bobAgreement.s === 200 && !bobAgreement.d.text.includes('COOLING-OFF') && bobAgreement.d.text.includes('3. EARLY CLOSURE'), JSON.stringify(bobAgreement.d).slice(0, 200));
await put({ coolingOffDays: 3 });

const repaidSeed = await Loan.create({ userId: bob._id, loanAmount: 10000, tenure: 2, interestRate: 0, monthlyEMI: 5000, status: 'disbursed', disbursementDate: day(-40) });
section('CLOSURE LETTER');
const open = await call('GET', `/loans/${rule._id}/closure-letter`, ta);
check('not available while the loan is open (400)', open.s === 400);
const html = await call('GET', `/loans/${a1.d.loan.id}/closure-letter`, ta);
check('closed loan: a letter naming the lender, borrower and how it ended', html.s === 200 && typeof html.d === 'string' && html.d.includes('Laxmi India Finance Ltd.') && html.d.includes('Alice T') && html.d.includes('cancelled within the cooling-off period') && html.d.includes('no amount is outstanding'));
check('lender registration and grievance details are on it', html.d.includes('N-14.01234') && html.d.includes('Asha Rao'));
check("another customer cannot get it (404)", (await call('GET', `/loans/${a1.d.loan.id}/closure-letter`, tb)).s === 404);
check('an admin can', (await call('GET', `/loans/${a1.d.loan.id}/closure-letter`, admin)).s === 200);
check('no login -> 401', (await call('GET', `/loans/${a1.d.loan.id}/closure-letter`, null)).s === 401);
section('ACCOUNT STATEMENT');
const pendingLoan = await Loan.create({ userId: alice._id, loanAmount: 5000, tenure: 1, interestRate: 0, monthlyEMI: 5000, status: 'approved' });
const open2 = await call('GET', `/loans/${pendingLoan._id}/statement`, ta);
check('statement not available before payout (400)', open2.s === 400);
await EMIPayment.create({ loanId: repaidSeed._id, userId: bob._id, emiNumber: 1, dueDate: day(-10), amount: 5000, principalAmount: 5000, status: 'PAID', paidDate: day(-9), paidAmount: 5000 });
await EMIPayment.create({ loanId: repaidSeed._id, userId: bob._id, emiNumber: 2, dueDate: day(-1), amount: 5000, principalAmount: 5000, status: 'OVERDUE', penaltyApplied: 500 });
const stmt = await call('GET', `/loans/${repaidSeed._id}/statement`, tb);
check('owner gets a statement with paid, overdue and outstanding', stmt.s === 200 && stmt.d.includes('Loan account statement') && stmt.d.includes('Rs 5,000') && stmt.d.includes('1 overdue') && stmt.d.includes('Rs 5,500'), String(stmt.d).slice(0, 300));
check("another customer cannot get it (404)", (await call('GET', `/loans/${repaidSeed._id}/statement`, ta)).s === 404);
check('an admin can', (await call('GET', `/loans/${repaidSeed._id}/statement`, admin)).s === 200);
check('no login -> 401', (await call('GET', `/loans/${repaidSeed._id}/statement`, null)).s === 401);

await User.updateOne({ _id: alice._id }, { firstName: '<script>alert(1)</script>' });
const xss = await call('GET', `/loans/${a1.d.loan.id}/closure-letter`, ta);
check('names are escaped in the letter', !xss.d.includes('<script>alert') && xss.d.includes('&lt;script&gt;'));
const repaid = await Loan.create({ userId: bob._id, loanAmount: 10000, tenure: 1, interestRate: 0, monthlyEMI: 10000, status: 'closed', closureType: 'repaid', disbursementDate: day(-40), closedAt: day(-2) });
check('a fully repaid loan says so', (await call('GET', `/loans/${repaid._id}/closure-letter`, tb)).d.includes('All instalments were paid'));

await srv.stop();
await disconnect();
finish();
