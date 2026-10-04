import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Notification from '../../src/models/Notification.js';

const DB = 'fintech-test-notifications';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const bank = n => ({ accountNumber: `10000000${n}`, ifscCode: 'SBIN0001234', accountHolder: `U${n}` });
const alice = await User.create({ firstName: 'Alice', lastName: 'A', email: 'alice@x.in', phone: '9100000001', password: 'x12345678', bankAccount: bank(1) });
const bob = await User.create({ firstName: 'Bob', lastName: 'B', email: 'bob@x.in', phone: '9100000002', password: 'x12345678', bankAccount: bank(2) });
const loan = await Loan.create({ userId: alice._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200 });
const rej = await Loan.create({ userId: bob._id, loanAmount: 5000, tenure: 3, interestRate: 15, monthlyEMI: 1700 });
const ta = await tokenFor(alice);
const tb = await tokenFor(bob);
const titles = async tok => (await call('GET', '/notifications', tok)).d.notifications.map(n => n.title);

section('EVENT NOTIFICATIONS');
await call('POST', `/admin/loans/${loan._id}/approve`, admin);
await call('POST', `/admin/loans/${rej._id}/reject`, admin, { reason: 'Low score' });
await call('POST', `/admin/loans/${loan._id}/disburse`, admin);
let a = await titles(ta);
check('approval and disbursement notify the customer', a.includes('Loan approved') && a.includes('Loan disbursed'), a.join());
check('rejection notifies the right customer', (await titles(tb)).join() === 'Loan application update');
check('approval message tells the customer to accept the agreement', (await Notification.findOne({ userId: alice._id, type: 'LOAN_APPROVED' })).message.includes('accept the loan agreement'));
await call('POST', `/emi/initiate/${loan._id}/1`, ta);

section('REMINDER JOB');
const emis = await EMIPayment.find({ loanId: loan._id }).sort({ emiNumber: 1 });
await EMIPayment.updateOne({ _id: emis[1]._id }, { dueDate: day(2) });
await EMIPayment.updateOne({ _id: emis[2]._id }, { dueDate: day(-5) });
const run1 = await call('POST', '/notifications/admin/run-reminders', admin);
check('one reminder and one overdue notice sent', run1.d.reminders === 1 && run1.d.overdueNotices === 1, JSON.stringify(run1.d));
const run2 = await call('POST', '/notifications/admin/run-reminders', admin);
check('second run sends nothing (each notice is sent once)', run2.d.reminders === 0 && run2.d.overdueNotices === 0, JSON.stringify(run2.d));
a = await titles(ta);
check('customer has all five notifications', a.length === 5 && ['EMI #3 overdue', 'EMI #2 due soon', 'EMI #1 received'].every(x => a.includes(x)), a.join());

section('INBOX');
const inbox = (await call('GET', '/notifications', ta)).d;
check('unread count matches', inbox.unread === 5);
check('customers only see their own', (await call('GET', '/notifications', tb)).d.notifications.length === 1);
await call('POST', `/notifications/${inbox.notifications[0]._id}/read`, ta);
check('mark one read', (await call('GET', '/notifications', ta)).d.unread === 4);
await call('POST', '/notifications/read-all', ta);
check('mark all read', (await call('GET', '/notifications', ta)).d.unread === 0);
const bobsId = (await call('GET', '/notifications', tb)).d.notifications[0]._id;
await call('POST', `/notifications/${bobsId}/read`, ta);
check("cannot mark someone else's notification as read", (await call('GET', '/notifications', tb)).d.unread === 1);
check('email is skipped, not failed, when not configured', (await Notification.findOne({ userId: alice._id })).channels.email === 'skipped');
check('no token -> 401', (await call('GET', '/notifications', null)).s === 401);
check('customer cannot run the reminder job (403)', (await call('POST', '/notifications/admin/run-reminders', ta)).s === 403);

await srv.stop();
await disconnect();
finish();
