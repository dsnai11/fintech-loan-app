import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import CollectionNote from '../../src/models/CollectionNote.js';
import AmlAlert from '../../src/models/AmlAlert.js';

const DB = 'fintech-test-customers';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const mk = (first, email, phone, extra = {}) => User.create({ firstName: first, lastName: 'Tester', email, phone, password: 'x12345678', ...extra });
const asha = await mk('Asha', 'asha@x.in', '9000000011', { panNumber: 'ABCDE1234F', bankAccount: { accountHolder: 'Asha Tester', accountNumber: '123456789012', ifscCode: 'SBIN0001234' } });
const ravi = await mk('Ravi', 'ravi@x.in', '9000000012');
const ta = await tokenFor(asha);

const loan = await Loan.create({ userId: asha._id, loanAmount: 20000, tenure: 2, interestRate: 0, monthlyEMI: 10000, status: 'disbursed', disbursementDate: day(-40) });
await AmlAlert.create({ rule: 'LARGE_LOAN', severity: 'MEDIUM', userId: asha._id, loanId: loan._id, detail: 'test' });

section('CUSTOMER SEARCH');
check('needs 2+ characters (400)', (await call('GET', '/admin/customers?q=a', admin)).s === 400);
const byName = await call('GET', '/admin/customers?q=asha', admin);
check('finds by name', byName.s === 200 && byName.d.customers.length === 1 && byName.d.customers[0].email === 'asha@x.in');
check('finds by phone', (await call('GET', '/admin/customers?q=9000000012', admin)).d.customers[0]?.name === 'Ravi Tester');
check('regex characters are treated as text', (await call('GET', '/admin/customers?q=.*', admin)).d.customers.length === 0);
check('customers cannot search (403)', (await call('GET', '/admin/customers?q=asha', ta)).s === 403);
check('no login -> 401', (await call('GET', '/admin/customers?q=asha', null)).s === 401);

section('CUSTOMER OVERVIEW');
const ov = await call('GET', `/admin/customers/${asha._id}`, admin);
check('overview has profile, loans and alerts', ov.s === 200 && ov.d.loans.length === 1 && ov.d.alerts.length === 1 && ov.d.summary.openAlerts === 1 && ov.d.summary.totalBorrowed === 20000);
check('PAN and bank account are masked', ov.d.customer.pan === '******234F' && ov.d.customer.bankAccount.number === '********9012' && !JSON.stringify(ov.d).includes('123456789012'));
check('no password or 2FA secret in the response', !/password|twoFactorSecret/i.test(JSON.stringify(ov.d)));
check('bad id (400)', (await call('GET', '/admin/customers/xyz', admin)).s === 400);
check('unknown customer (404)', (await call('GET', '/admin/customers/64b000000000000000000000', admin)).s === 404);

section('PROMISES TO PAY');
const e1 = await EMIPayment.create({ loanId: loan._id, userId: asha._id, emiNumber: 1, dueDate: day(-10), amount: 10000, principalAmount: 10000, status: 'OVERDUE' });
await CollectionNote.create({ loanId: loan._id, userId: asha._id, type: 'PROMISE_TO_PAY', promiseDate: day(-2), promiseAmount: 10000, createdBy: 'admin@lifc.in' });
let p = await call('GET', '/admin/collections/promises/list', admin);
check('a missed promise is BROKEN', p.s === 200 && p.d.promises[0]?.status === 'BROKEN' && p.d.counts.BROKEN === 1, JSON.stringify(p.d));
await CollectionNote.create({ loanId: loan._id, userId: asha._id, type: 'PROMISE_TO_PAY', promiseDate: day(3), promiseAmount: 10000, createdBy: 'admin@lifc.in' });
p = await call('GET', '/admin/collections/promises/list', admin);
check('the newest promise counts, and it is UPCOMING', p.d.promises.length === 1 && p.d.promises[0].status === 'UPCOMING');
await EMIPayment.updateOne({ _id: e1._id }, { status: 'PAID', paidDate: new Date(), paidAmount: 10000 });
p = await call('GET', '/admin/collections/promises/list', admin);
check('once the EMI is paid the promise is KEPT', p.d.promises[0].status === 'KEPT');
check('customers cannot read promises (403)', (await call('GET', '/admin/collections/promises/list', ta)).s === 403);

section('STATEMENT LINK FOR THE APP');
const link = await call('POST', `/loans/${loan._id}/statement-link`, ta);
check('owner gets a short-lived link', link.s === 200 && link.d.path.startsWith('/api/loans/statement-view?t='));
const view = await call('GET', link.d.path.replace('/api', ''), null);
check('the link opens the statement without a login header', view.s === 200 && String(view.d).includes('Loan account statement'));
check('a tampered link is refused (401)', (await call('GET', link.d.path.replace('/api', '') + 'x', null)).s === 401);
const tb = await tokenFor(ravi);
check("another customer cannot get a link (404)", (await call('POST', `/loans/${loan._id}/statement-link`, tb)).s === 404);
check('a login token is not accepted as a link', (await call('GET', `/loans/statement-view?t=${ta}`, null)).s === 401);
const open = await Loan.create({ userId: asha._id, loanAmount: 5000, tenure: 1, interestRate: 0, monthlyEMI: 5000, status: 'approved' });
check('no link before payout (400)', (await call('POST', `/loans/${open._id}/statement-link`, ta)).s === 400);

await srv.stop();
await disconnect();
finish();
