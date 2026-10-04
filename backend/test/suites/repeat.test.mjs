import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import AmlAlert from '../../src/models/AmlAlert.js';

const DB = 'fintech-test-repeat';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const n = (first, i, extra = {}) => User.create({ firstName: first, lastName: 'R', email: `r${i}@x.in`, phone: `96000000${10 + i}`, password: 'x12345678', kycStatus: 'approved', ...extra });
const bank = i => ({ accountHolder: 'R', accountNumber: `55500000${i}`, ifscCode: 'SBIN0001234' });
const apply = (tok, amount, i) => call('POST', '/loans/apply-full', tok, { loanAmount: amount, tenure: 12, purpose: 'Personal', planType: 'standard', bankDetails: bank(i) });
const closed = (u, amount, extra = {}) => Loan.create({ userId: u._id, loanAmount: amount, tenure: 3, interestRate: 15, monthlyEMI: amount / 3, status: 'closed', closureType: 'repaid', ...extra });

const loyal = await n('Loyal', 1);
const fresh = await n('Fresh', 2);
const bad = await n('Bad', 3);
const busy = await n('Busy', 4);
const flagged = await n('Flagged', 5);
const quick = await n('Quick', 6);
const [tl, tf, tb, ty, tg, tq] = await Promise.all([loyal, fresh, bad, busy, flagged, quick].map(u => tokenFor(u)));
await closed(loyal, 40000);
await closed(bad, 40000); await Loan.create({ userId: bad._id, loanAmount: 9000, tenure: 3, interestRate: 15, monthlyEMI: 3000, status: 'written_off' });
await closed(busy, 40000); await Loan.create({ userId: busy._id, loanAmount: 9000, tenure: 3, interestRate: 15, monthlyEMI: 3000, status: 'disbursed' });
await closed(flagged, 40000); await AmlAlert.create({ rule: 'LARGE_LOAN', severity: 'MEDIUM', userId: flagged._id, detail: 't' });
await closed(quick, 40000, { closureType: 'cooling_off' });

section('SWITCHED OFF BY DEFAULT');
const off = await call('GET', '/loans/repeat-offer', tl);
check('nothing changes until the NBFC switches it on', off.s === 200 && off.d.enabled === false && off.d.eligible === false && off.d.maxAmount === 500000, JSON.stringify(off.d));

section('NBFC SETS THE RULES');
const bad1 = await call('PUT', '/admin/pricing', admin, { repeat: { enabled: true, maxLoanAmount: -5 } });
check('bad numbers are refused (400)', bad1.s === 400);
const on = await call('PUT', '/admin/pricing', admin, { maxAmount: 50000, repeat: { enabled: true, maxLoanAmount: 100000, stepUpPercent: 100, minClosedLoans: 1 } });
check('rules saved', on.s === 200, JSON.stringify(on.d));

section('WHO QUALIFIES');
const o1 = (await call('GET', '/loans/repeat-offer', tl)).d;
check('repaid customer is offered a step-up of 100% on 40,000 -> 80,000', o1.eligible && o1.offerAmount === 80000 && o1.maxAmount === 80000, JSON.stringify(o1));
const o2 = (await call('GET', '/loans/repeat-offer', tf)).d;
check('a first-timer keeps the standard limit and is told how to unlock more', !o2.eligible && o2.maxAmount === 50000 && /Repay 1 loan/.test(o2.reason), JSON.stringify(o2));
check('a written-off loan disqualifies', (await call('GET', '/loans/repeat-offer', tb)).d.eligible === false);
check('an open loan disqualifies', /current loan/.test((await call('GET', '/loans/repeat-offer', ty)).d.reason));
check('an open AML alert disqualifies', (await call('GET', '/loans/repeat-offer', tg)).d.eligible === false);
check('cancelling in the cooling-off window does not count as repayment', (await call('GET', '/loans/repeat-offer', tq)).d.eligible === false);
check('no login -> 401', (await call('GET', '/loans/repeat-offer', null)).s === 401);

section('THE LIMIT IS ENFORCED');
check('first-timer cannot borrow 70,000 (400)', (await apply(tf, 70000, 2)).s === 400);
check('first-timer can borrow 50,000', (await apply(tf, 50000, 2)).s === 201);
check('repaid customer cannot go past their offer (400)', (await apply(tl, 90000, 1)).s === 400);
const q = await call('GET', '/pricing/quote?amount=70000&tenure=12', tl);
check('their quote for 70,000 works while signed in', q.s === 200, JSON.stringify(q.d));
check('the same quote without login is refused (400)', (await call('GET', '/pricing/quote?amount=70000&tenure=12', null)).s === 400);
check('repaid customer can borrow 70,000', (await apply(tl, 70000, 1)).s === 201);

await srv.stop();
await disconnect();
finish();
