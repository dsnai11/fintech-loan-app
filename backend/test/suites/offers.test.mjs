import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import AuditLog from '../../src/models/AuditLog.js';
import { computeOffer, DEFAULTS } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-offers';
await connect(DB);
const srv = await startServer(DB, { OFFER_LIMIT: 'true', REQUIRE_PHONE_VERIFIED: 'true' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const yearsAgo = n => new Date(Date.now() - n * 365.25 * 86400000);
let seq = 0;
const mk = async (over = {}) => {
  seq++;
  const u = await User.create({ firstName: `Cust${seq}`, lastName: 'O', email: `o${seq}@x.in`, phone: `94${String(seq).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: yearsAgo(32), panNumber: `ABCPE${String(1000 + seq)}F`, ...over });
  return { u, tok: await tokenFor(u), n: seq };
};
const withScore = (score, extra = {}) => mk({ creditScore: score, creditScoreAt: new Date(), creditScoreSource: 'sandbox', ...extra });
const check_ = (c, consent = true) => call('POST', '/loans/check-eligibility', c.tok, consent ? { consent: true } : {});
const apply = (c, amount) => call('POST', '/loans/apply-full', c.tok, { loanAmount: amount, tenure: 3, purpose: 'Personal', planType: '3_emi', bankDetails: { accountHolder: 'O', accountNumber: `55500000${c.n}`, ifscCode: 'SBIN0001234' } });

section('THE OFFER, WORKED OUT');
const f = over => ({ age: 32, defaultedLoans: 0, openLoans: 0, repeatCustomer: false, bureauScore: 0, ...over });
const pol = { minAmount: 1000, maxAmount: 500000 };
const off = o => computeOffer(DEFAULTS, f(o), pol);
check('no credit score: the no-score offer (Rs 30,000)', off({}).amount === 30000 && off({}).status === 'OFFER');
check('score 800 -> 1,00,000, 720 -> 60,000, 660 -> 40,000', off({ bureauScore: 800 }).amount === 100000 && off({ bureauScore: 720 }).amount === 60000 && off({ bureauScore: 660 }).amount === 40000);
check('score under 650: a small offer that a person reviews', off({ bureauScore: 600 }).amount === 10000 && off({ bureauScore: 600 }).status === 'REVIEW');
check('a repeat customer is offered at least the repeat limit', off({ bureauScore: 660, repeatCustomer: true }).amount === 100000);
check('under the youngest age, or an earlier default: no offer, with a plain reason', off({ age: 16 }).status === 'DECLINED' && off({ defaultedLoans: 1 }).status === 'DECLINED' && /age/.test(off({ age: 16 }).reason));
check('the offer never goes above the product maximum', computeOffer(DEFAULTS, f({ bureauScore: 800 }), { minAmount: 1000, maxAmount: 50000 }).amount === 50000);
check('and is rounded down', computeOffer({ ...DEFAULTS, offer: { ...DEFAULTS.offer, noScoreLimit: 30750 } }, f(), pol).amount === 30000);

section('CREDIT CHECK WITH CONSENT');
const c1 = await mk();
check('a customer is asked for permission before the credit check (400)', (await check_(c1, false)).d.code === 'CONSENT_REQUIRED');
check('no login -> 401', (await call('POST', '/loans/check-eligibility', null, {})).s === 401);
const r1 = await check_(c1);
check('with permission the check runs and an offer comes back', r1.s === 200 && ['OFFER', 'REVIEW'].includes(r1.d.offer.status) && r1.d.offer.amount >= 10000 && r1.d.offer.creditCheck === 'sandbox' && r1.d.minAmount === 1000, JSON.stringify(r1.d));
check('the score itself is not shown to the customer', !JSON.stringify(r1.d).match(/"score"/) && !('creditScore' in r1.d));
const u1 = await User.findById(c1.u._id);
check('the permission and the score are recorded', !!u1.bureauConsentAt && u1.creditScore >= 550 && u1.creditScore <= 800 && u1.creditScoreSource === 'sandbox');
check('both are in the audit log', !!(await AuditLog.findOne({ action: 'CREDIT_CHECK_CONSENT', actor: c1.u.email })) && !!(await AuditLog.findOne({ action: 'ELIGIBILITY_CHECKED', actor: c1.u.email })));
check('asking again does not need permission again', (await check_(c1, false)).s === 200);
const noPhone = await mk({ phoneVerified: false });
check('an unverified phone cannot be checked (403)', (await check_(noPhone)).d.code === 'PHONE_NOT_VERIFIED');
const stored = await call('GET', '/loans/my-offer', c1.tok);
check('the offer is kept for the app to show', stored.s === 200 && stored.d.offer.amount === r1.d.offer.amount && stored.d.maxAmount === 500000);
await User.updateOne({ _id: c1.u._id }, { 'offer.expiresAt': new Date(Date.now() - 1000) });
check('an expired offer is not shown', (await call('GET', '/loans/my-offer', c1.tok)).d.offer === null);

section('THE OFFER IS THE MOST THEY CAN APPLY FOR');
const c2 = await withScore(660);
await check_(c2);
check('the offer for score 660 is Rs 40,000', (await call('GET', '/loans/my-offer', c2.tok)).d.offer.amount === 40000);
const tooMuch = await apply(c2, 50000);
check('applying for more is refused, and says what the offer is (400)', tooMuch.s === 400 && tooMuch.d.code === 'ABOVE_LIMIT' && /40,000/.test(tooMuch.d.error), JSON.stringify(tooMuch.d));
check('the quote screen is capped the same way (400)', (await call('GET', '/pricing/quote?amount=50000&plan=3_emi', c2.tok)).s === 400 && (await call('GET', '/pricing/quote?amount=40000&plan=3_emi', c2.tok)).s === 200);
check('applying for the offered amount works', (await apply(c2, 40000)).s === 201);

const c3 = await withScore(720);
check('a customer who skipped the check still gets a limit worked out when they apply', (await apply(c3, 70000)).s === 400 && (await apply(c3, 60000)).s === 201);

section('NO OFFER');
const young = await mk({ dateOfBirth: yearsAgo(16) });
const rd = await check_(young);
check('too young: declined with a plain reason and no amount', rd.d.offer.status === 'DECLINED' && rd.d.offer.amount === 0 && /age/.test(rd.d.offer.reason));
const rj = await apply(young, 5000);
check('and cannot apply (403)', rj.s === 403 && rj.d.code === 'NOT_ELIGIBLE');
const bad = await mk();
await Loan.create({ userId: bad.u._id, loanAmount: 5000, tenure: 3, interestRate: 0, monthlyEMI: 2000, status: 'written_off' });
check('an earlier written-off loan is declined', (await check_(bad)).d.offer.status === 'DECLINED');

section('REPEAT CUSTOMERS AND LOW SCORES');
const rep = await withScore(660);
await Loan.create({ userId: rep.u._id, loanAmount: 20000, tenure: 3, interestRate: 0, monthlyEMI: 7000, status: 'closed', closureType: 'repaid' });
check('a customer who repaid a loan gets the higher limit', (await check_(rep)).d.offer.amount === 100000);
const low = await withScore(600);
const rl = await check_(low);
check('a low score gets a small offer marked for review', rl.d.offer.status === 'REVIEW' && rl.d.offer.amount === 10000);

section('CHANGING THE RULES CHANGES THE OFFERS');
const rules = (await call('GET', '/admin/decisions/rules', admin)).d.rules;
const bad1 = await call('PUT', '/admin/decisions/rules', admin, { offer: { ...rules.offer, scoreLimits: [{ min: 750, limit: 30000 }, { min: 650, limit: 90000 }] } });
check('a lower score cannot be offered more than a higher one (400)', bad1.s === 400);
const upd = await call('PUT', '/admin/decisions/rules', admin, { offer: { ...rules.offer, scoreLimits: [{ min: 750, limit: 100000 }, { min: 700, limit: 60000 }, { min: 650, limit: 45500 }] } });
check('offer lines can be edited', upd.s === 200 && upd.d.rules.offer.scoreLimits[2].limit === 45500);
check('offers worked out before the change are not trusted any more', (await call('GET', '/loans/my-offer', c2.tok)).d.offer === null);
check('and the next check gives the new amount, rounded down to the nearest 1,000', (await check_(c2)).d.offer.amount === 45000);

await srv.stop();

section('IN PRODUCTION WITH NO CREDIT BUREAU');
const prod = await startServer(DB, { OFFER_LIMIT: 'true', REQUIRE_PHONE_VERIFIED: 'true', PAYMENT_MODE: 'PRODUCTION' });
const pcall = client(prod.base);
const p1 = await mk();
const pr = await pcall('POST', '/loans/check-eligibility', p1.tok, { consent: true });
check('no test score is invented: the offer is the no-score offer and says no credit check was done', pr.s === 200 && pr.d.offer.amount === 30000 && pr.d.offer.creditCheck === 'none', JSON.stringify(pr.d));
check('and no score was saved', !(await User.findById(p1.u._id)).creditScore);
await prod.stop();

await disconnect();
finish();
