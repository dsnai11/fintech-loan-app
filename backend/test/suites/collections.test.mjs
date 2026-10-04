import { check, connect, disconnect, startServer, day, finish, makeAdmin } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Notification from '../../src/models/Notification.js';
import CollectionNote from '../../src/models/CollectionNote.js';
import { generateToken } from '../../src/middleware/auth.js';

const DB = 'fintech-test-collections';
await connect(DB);
const srv = await startServer(DB);
const B = srv.base;

const mkUser = (first, i) => User.create({ firstName: first, lastName: 'T', email: `u${i}@x.in`, phone: `99999999${10 + i}`, password: 'x12345678' });
const names = ['Rita', 'Sam', 'Tara', '<script>alert(1)</script>', 'Vik', 'Wendy'];
const users = []; for (let i = 0; i < 6; i++) users.push(await mkUser(names[i], i));
const mkLoan = u => Loan.create({ userId: u._id, loanAmount: 24000, tenure: 3, interestRate: 15, monthlyEMI: 10000, status: 'disbursed', disbursementDate: day(-200), disbursedAmount: 24000 });
const loans = []; for (const u of users) loans.push(await mkLoan(u));
const emi = (l, u, n, due, status = 'OVERDUE') => EMIPayment.create({ loanId: l._id, userId: u._id, emiNumber: n, dueDate: due, amount: 10000, principalAmount: 8000, interestAmount: 2000, status });
await emi(loans[0], users[0], 1, day(-5));
await emi(loans[1], users[1], 1, day(-20));
await emi(loans[2], users[2], 1, day(-45));
await emi(loans[3], users[3], 1, day(-75));
await emi(loans[4], users[4], 1, day(-100)); await emi(loans[4], users[4], 2, day(-70));
await emi(loans[5], users[5], 1, day(30), 'PENDING');           // nothing overdue

const admin = (await makeAdmin()).token;
const cust = generateToken(String(users[4]._id), users[4].email);
const call = async (m, p, tok = admin, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: m === 'POST' ? JSON.stringify(body || {}) : undefined });
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = text; }
  return { s: r.status, d };
};
const id = i => String(loans[i]._id);

console.log('QUEUE');
let q = (await call('GET', '/admin/collections/queue')).d;
const stageOf = i => q.items.find(x => x.loanId === id(i))?.stage;
check('5 loans in queue (not the current one)', q.total === 5, q.total);
check('stages 5d/20d/45d/75d/100d', [0,1,2,3,4].map(stageOf).join() === 'REMINDER,FOLLOW_UP,ESCALATED,FINAL_NOTICE,DEFAULT_CANDIDATE', [0,1,2,3,4].map(stageOf).join());
check('sorted worst first', q.items[0].daysOverdue === 100 && q.items[4].daysOverdue === 5);
const l5 = q.items.find(x => x.loanId === id(4));
check('100d loan owes 21400 (10800 + 10600)', l5.amountDue === 21400 && l5.overdueEmis === 2, l5.amountDue);
check('5d loan owes 10500 (min Rs500 fee)', q.items.find(x => x.loanId === id(0)).amountDue === 10500);
check('filter by stage', (await call('GET', '/admin/collections/queue?stage=ESCALATED')).d.items.length === 1);
check('bad stage -> 400', (await call('GET', '/admin/collections/queue?stage=NOPE')).s === 400);
check('no hidden internals in queue items', !('loan' in q.items[0]) && !('rows' in q.items[0]));

console.log('ESCALATION JOB');
let r1 = (await call('POST', '/admin/collections/run-escalations')).d;
check('first run escalates 5', r1.escalated === 5, JSON.stringify(r1));
check('second run is a no-op', (await call('POST', '/admin/collections/run-escalations')).d.escalated === 0);
check('5 ESCALATION notes', (await CollectionNote.countDocuments({ type: 'ESCALATION' })) === 5);
const notifTitles = async u => (await Notification.find({ userId: u._id })).map(n => n.title);
check('reminder-stage customer not messaged', (await notifTitles(users[0])).length === 0);
check('final-notice customer messaged once', (await notifTitles(users[3])).join() === 'Final notice');
check('escalated stage saved on loan', (await Loan.findById(id(2))).collectionStage === 'ESCALATED');
await EMIPayment.updateOne({ loanId: loans[1]._id }, { status: 'PAID' });
const r3 = (await call('POST', '/admin/collections/run-escalations')).d;
check('customer who paid is cleared', r3.cleared === 1 && !(await Loan.findById(id(1))).collectionStage, JSON.stringify(r3));

console.log('NOTES / PROMISES');
check('empty note -> 400', (await call('POST', `/admin/collections/${id(2)}/notes`, admin, { type: 'NOTE', text: ' ' })).s === 400);
check('bad type -> 400', (await call('POST', `/admin/collections/${id(2)}/notes`, admin, { type: 'WRITE_OFF', text: 'x' })).s === 400);
check('promise needs date -> 400', (await call('POST', `/admin/collections/${id(2)}/notes`, admin, { type: 'PROMISE_TO_PAY' })).s === 400);
check('negative promise amount -> 400', (await call('POST', `/admin/collections/${id(2)}/notes`, admin, { type: 'PROMISE_TO_PAY', promiseDate: day(2), promiseAmount: -5 })).s === 400);
check('call note ok', (await call('POST', `/admin/collections/${id(2)}/notes`, admin, { type: 'CALL', text: 'Spoke to customer' })).s === 200);
await call('POST', `/admin/collections/${id(2)}/notes`, admin, { type: 'PROMISE_TO_PAY', promiseDate: day(-1), promiseAmount: 10500 });
q = (await call('GET', '/admin/collections/queue')).d;
const l3 = q.items.find(x => x.loanId === id(2));
check('past promise flagged broken', l3.promise?.broken === true && l3.lastAction.type === 'PROMISE_TO_PAY', JSON.stringify(l3.promise));
const detail = (await call('GET', `/admin/collections/${id(4)}`)).d;
check('detail: flags + timeline', detail.canMarkDefaulted === true && detail.canWriteOff === false && detail.notes.length >= 1 && detail.overdue.length === 2);
check('detail of loan with no overdue -> 404', (await call('GET', `/admin/collections/${id(5)}`)).s === 404);
check('bad id -> 400', (await call('GET', '/admin/collections/not-an-id')).s === 400);

console.log('LETTER');
const L = await call('GET', `/admin/collections/${id(4)}/letter`);
check('letter is html with amount and heading', typeof L.d === 'string' && L.d.includes('Rs 21,400') && L.d.includes('Notice of overdue payment'));
const L4 = await call('GET', `/admin/collections/${id(3)}/letter`);
check('name is html-escaped in letter', typeof L4.d === 'string' && !L4.d.includes('<script>alert') && L4.d.includes('&lt;script&gt;'));
check('letter generation logged', (await CollectionNote.countDocuments({ type: 'LETTER' })) === 2);

console.log('DEFAULT / WRITE-OFF / RECOVERY');
check('75d loan cannot be defaulted', (await call('POST', `/admin/collections/${id(3)}/default`)).s === 400);
check('write-off of non-defaulted -> 400', (await call('POST', `/admin/collections/${id(4)}/write-off`, admin, { reason: 'x' })).s === 400);
const dres = await call('POST', `/admin/collections/${id(4)}/default`);
check('100d loan defaulted', dres.s === 200 && (await Loan.findById(id(4))).status === 'defaulted', JSON.stringify(dres.d));
check('second default -> 400', (await call('POST', `/admin/collections/${id(4)}/default`)).s === 400);
check('customer told about default', (await notifTitles(users[4])).includes('Loan classified as defaulted'));
check('defaulted loan still in queue as DEFAULTED', (await call('GET', '/admin/collections/queue?stage=DEFAULTED')).d.items.length === 1);
check('write-off needs reason', (await call('POST', `/admin/collections/${id(4)}/write-off`, admin, {})).s === 400);
const w = await call('POST', `/admin/collections/${id(4)}/write-off`, admin, { reason: 'Untraceable' });
check('write-off records 16000', w.s === 200 && w.d.writtenOffAmount === 16000, JSON.stringify(w.d));
check('loan is written_off', (await Loan.findById(id(4))).status === 'written_off');
check('written-off loan leaves the queue', (await call('GET', '/admin/collections/queue')).d.items.every(i => i.loanId !== id(4)));
check('recovery on non-written-off -> 400', (await call('POST', `/admin/collections/${id(3)}/recovery`, admin, { amount: 100 })).s === 400);
check('negative recovery -> 400', (await call('POST', `/admin/collections/${id(4)}/recovery`, admin, { amount: -1 })).s === 400);
await call('POST', `/admin/collections/${id(4)}/recovery`, admin, { amount: 3000, note: 'cash' });
const rec = await call('POST', `/admin/collections/${id(4)}/recovery`, admin, { amount: 2000 });
check('recoveries accumulate to 5000', rec.d.recoveredAmount === 5000, JSON.stringify(rec.d));
const pay = await call('POST', `/emi/initiate/${id(4)}/1`, cust);
check('customer cannot pay written-off loan (409)', pay.s === 409, JSON.stringify(pay));
const before = (await Notification.find({ userId: users[4]._id })).length;
await call('POST', '/notifications/admin/run-reminders');
check('reminder job skips written-off loan', (await Notification.find({ userId: users[4]._id })).length === before);

console.log('REPORTS');
const rep = (await call('GET', '/admin/reports/summary')).d;
check('written-off figures', rep.risk.writtenOffLoans === 1 && rep.risk.writtenOffAmount === 16000 && rep.risk.recoveredAfterWriteOff === 5000, JSON.stringify(rep.risk));
check('default rate counts written-off (1 of 6 = 16.7)', rep.risk.defaultRate90 === 16.7, rep.risk.defaultRate90);
check('written-off EMIs not in overdue amount', rep.risk.overdueAmount === 10000 + 10000 + 10000, rep.risk.overdueAmount);

console.log('AUTH');
check('customer token -> 403', (await call('GET', '/admin/collections/queue', cust)).s === 403);
check('bad token -> 401', (await call('GET', '/admin/collections/queue', 'bad')).s === 401);

await srv.stop();
await disconnect();
finish();
