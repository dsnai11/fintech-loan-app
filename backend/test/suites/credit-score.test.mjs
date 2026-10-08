import { check, section, connect, disconnect, startServer, finish, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import AuditLog from '../../src/models/AuditLog.js';
import { bandOf, tipsFor } from '../../src/services/creditScoreService.js';

const DB = 'fintech-test-credit-score';
await connect(DB);
const srv = await startServer(DB);
const prod = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION' });
const call = client(srv.base), callProd = client(prod.base);

section('BANDS AND TIPS');
check('bands follow the score', bandOf(780).key === 'excellent' && bandOf(700).key === 'good' && bandOf(600).key === 'fair' && bandOf(500).key === 'poor' && bandOf(null) === null);
const none = { overdue: 0, paidLate: 0, onTimePercent: null };
check('an overdue EMI is the first tip', tipsFor({ score: 700, record: { ...none, overdue: 1 }, report: null })[0].id === 'overdue');
check('late payments suggest auto-debit', tipsFor({ score: 700, record: { ...none, paidLate: 2 }, report: null }).some(t => t.id === 'late' && /auto-debit/.test(t.text)));
check('many enquiries and loans are called out from the bureau report', ['enquiries', 'active', 'dpd'].every(id => tipsFor({ score: 700, record: none, report: { enquiries90: 4, activeLoans: 5, maxDpd: 20 } }).some(t => t.id === id)));
check('no score: invites a check', tipsFor({ score: null, record: none, report: null })[0].id === 'check');
check('a high score gets encouragement', tipsFor({ score: 780, record: none, report: null }).some(t => t.id === 'great'));

section('THE CUSTOMER');
const user = await User.create({ firstName: 'Sco', lastName: 'Re', email: 'score@x.in', phone: '9400000555', password: 'x12345678', kycStatus: 'approved', panNumber: 'ABCDE1234F' });
const tok = await tokenFor(user);
const s0 = await call('GET', '/credit-score', tok);
check('before any check there is no score, and the page invites one', s0.s === 200 && s0.d.score === null && s0.d.canRefresh === true && s0.d.tips[0].id === 'check');
check('a login is needed (401)', (await call('GET', '/credit-score', null)).s === 401);
const noConsent = await call('POST', '/credit-score/refresh', tok, {});
check('the first check needs permission (400)', noConsent.s === 400 && noConsent.d.code === 'CONSENT_REQUIRED');
const r = await call('POST', '/credit-score/refresh', tok, { consent: true });
check('with permission the score arrives, marked as a test in test mode', r.s === 200 && r.d.score >= 550 && r.d.score <= 800 && r.d.test === true && !!r.d.band && r.d.history.length === 1, JSON.stringify(r.d).slice(0, 200));
check('the permission was recorded and audited', !!(await User.findById(user._id)).bureauConsentAt && (await AuditLog.countDocuments({ action: 'CREDIT_SCORE_VIEWED' })) === 1);
const again = await call('POST', '/credit-score/refresh', tok, { consent: true });
check('checking again straight away is refused (429)', again.s === 429 && again.d.code === 'TOO_SOON');
const s1 = await call('GET', '/credit-score', tok);
check('the page says when the next check is possible', s1.d.canRefresh === false && !!s1.d.nextRefreshAt);
await User.updateOne({ _id: user._id }, { creditScoreAt: day(-40) });
check('after 30 days it can be checked again, and history grows', (await call('POST', '/credit-score/refresh', tok, {})).d.history.length === 2);

section('REPAYMENT RECORD');
const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status: 'disbursed' });
await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: 1, dueDate: day(-40), paidDate: day(-39.9), amount: 10200, status: 'PAID' });
await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: 2, dueDate: day(-20), paidDate: day(-15), amount: 10200, status: 'PAID' });
await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: 3, dueDate: day(-3), amount: 10200, status: 'OVERDUE' });
const f = (await call('GET', '/credit-score', tok)).d;
check('on-time percentage, late payments and overdue are counted from our own records', f.factors.onTimePercent === 50 && f.factors.paidLate === 1 && f.factors.overdue === 1, JSON.stringify(f.factors));
check('the tips follow', f.tips.some(t => t.id === 'overdue') && f.tips.some(t => t.id === 'late'));
await User.updateOne({ _id: user._id }, { bureauReport: { enquiries90: 6, maxDpd: 45, activeLoans: 2, at: new Date() } });
const f2 = (await call('GET', '/credit-score', tok)).d;
check('bureau report details show when there are some', f2.factors.enquiries90 === 6 && f2.factors.maxDpd === 45 && f2.tips.some(t => t.id === 'enquiries'));

section('PRODUCTION WITHOUT A BUREAU');
const p = await User.create({ firstName: 'P', lastName: 'R', email: 'pr@x.in', phone: '9400000556', password: 'x12345678', panNumber: 'ABCDE9999F' });
const pt = await tokenFor(p);
const pr = await callProd('POST', '/credit-score/refresh', pt, { consent: true });
check('no score is invented (503)', pr.s === 503 && pr.d.code === 'UNAVAILABLE' && (await User.findById(p._id)).creditScore === undefined);

await disconnect();
finish();
