import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Notification from '../../src/models/Notification.js';
import CollectionNote from '../../src/models/CollectionNote.js';
import Mandate from '../../src/models/Mandate.js';
import ReminderLog from '../../src/models/ReminderLog.js';
import Settlement from '../../src/models/Settlement.js';
import Transaction from '../../src/models/Transaction.js';
import { DEFAULTS, validateSettings, saveSettings, getSettings, runReminders, render, inQuietHours, createOffer } from '../../src/services/collectionsAutomation.js';

const DB = 'fintech-test-reminders';
await connect(DB);
await Role.create([{ key: 'colviewer', label: 'Viewer', description: 't', permissions: ['collections.view'] }, { key: 'colmanager', label: 'Manager', description: 't', permissions: ['collections.view', 'collections.manage'] }]);

// 11:00 in India (05:30 UTC) on a fixed day, so the quiet hours never get in the way
const noon = (offset = 0) => new Date(Date.UTC(2026, 5, 10 + offset, 5, 30));
const dueOn = (offset) => new Date(Date.UTC(2026, 5, 10 + offset, 5, 30));
let n = 0;
async function customer(daysAgoDue, { loans = 1 } = {}) {
  n++;
  const user = await User.create({ firstName: `Rem${n}`, lastName: 'Inder', email: `rem${n}@x.in`, phone: `9600000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved' });
  const made = [];
  for (let k = 0; k < loans; k++) {
    const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status: 'disbursed' });
    for (let i = 1; i <= 3; i++) await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: i, dueDate: dueOn(-daysAgoDue + (i - 1) * 30), amount: 10200, principalAmount: 10000, interestAmount: 200, status: i === 1 && daysAgoDue > 0 ? 'OVERDUE' : 'PENDING' });
    made.push(loan);
  }
  return { user, loan: made[0], loans: made };
}

section('SETTINGS');
check('the defaults are valid', validateSettings(DEFAULTS).errors.length === 0);
check('two steps on the same day are refused', validateSettings({ ...DEFAULTS, steps: [{ ...DEFAULTS.steps[0], offset: 1 }, { ...DEFAULTS.steps[1], offset: 1 }] }).errors.some(e => /same day/.test(e)));
check('an overlong message is refused', validateSettings({ ...DEFAULTS, steps: [{ ...DEFAULTS.steps[0], message: 'x'.repeat(400) }] }).errors.length > 0);
check('a silly hour is refused', validateSettings({ ...DEFAULTS, quietStart: 30 }).errors.length > 0);
check('quiet hours that cross midnight work (9 pm to 8 am)', inQuietHours(new Date(Date.UTC(2026, 5, 10, 16, 30)), DEFAULTS) && inQuietHours(new Date(Date.UTC(2026, 5, 10, 1, 0)), DEFAULTS) && !inQuietHours(noon(), DEFAULTS));
check('message placeholders are filled', render('Hi {name}, {amount} due {date}, {days} days', { name: 'Asha', amount: 'Rs 1,000', date: '5 Jun', days: 3 }) === 'Hi Asha, Rs 1,000 due 5 Jun, 3 days');

section('NOTHING HAPPENS WHILE IT IS OFF');
const a = await customer(2);
check('off by default', (await runReminders(noon())).off === true && (await Notification.countDocuments()) === 0);

section('SENDING');
check('it saves', (await saveSettings({ ...DEFAULTS, enabled: true }, 'test')).ok && getSettings().enabled);
check('during quiet hours nothing goes out', (await runReminders(new Date(Date.UTC(2026, 5, 10, 17, 30)))).quiet === true && (await ReminderLog.countDocuments()) === 0);
const r1 = await runReminders(noon());
check('two days overdue: the day-after step goes out once', r1.sent === 1 && (await ReminderLog.findOne({ userId: a.user._id })).stepId === 'after1', JSON.stringify(r1));
const note = await Notification.findOne({ userId: a.user._id });
check('the customer gets an in-app overdue notice with their name and the amount', note.type === 'EMI_OVERDUE' && /Rem1/.test(note.message) && /Rs 10,7/.test(note.message), note?.message);
check('running again sends nothing more', (await runReminders(noon())).sent === 0 && (await Notification.countDocuments({ userId: a.user._id })) === 1);
const r2 = await runReminders(noon(2));
check('two days later the next step (3 days) goes out, and the old one is not repeated', r2.sent === 1 && (await ReminderLog.countDocuments({ userId: a.user._id })) === 2);

section('POLITENESS');
const capped = await customer(2, { loans: 2 });
const r3 = await runReminders(noon(10));
check('a customer with two loans gets two a day at most (limit 2 by default), no more', (await ReminderLog.countDocuments({ userId: capped.user._id })) === 2 && r3.capped === 0, JSON.stringify(r3));
await saveSettings({ ...DEFAULTS, enabled: true, dailyCap: 1 }, 'test');
const c2 = await customer(2, { loans: 2 });
const r4 = await runReminders(noon(20));
check('with a daily limit of 1 the second is held back', (await ReminderLog.countDocuments({ userId: c2.user._id })) === 1 && r4.capped >= 1, JSON.stringify(r4));
await saveSettings({ ...DEFAULTS, enabled: true }, 'test');

const promised = await customer(2);
await CollectionNote.create({ loanId: promised.loan._id, userId: promised.user._id, type: 'PROMISE_TO_PAY', promiseDate: noon(31), promiseAmount: 10200, createdBy: 'agent' });
const r5 = await runReminders(noon(30));
check('while a promise to pay is running the customer is left alone', (await ReminderLog.countDocuments({ userId: promised.user._id })) === 0 && r5.held >= 1, JSON.stringify(r5));
const r6 = await runReminders(noon(32));
check('once the promise date has passed the reminders resume', (await ReminderLog.countDocuments({ userId: promised.user._id })) === 1, JSON.stringify(r6));

const auto = await customer(-1); // due tomorrow
await Mandate.create({ userId: auto.user._id, loanId: auto.loan._id, provider: 'sandbox', method: 'upi', status: 'active', maxAmount: 12000 });
const plain = await customer(-1);
const rr = await runReminders(noon(0));
const autoLogs = await ReminderLog.countDocuments({ userId: auto.user._id }), plainLogs = await ReminderLog.countDocuments({ userId: plain.user._id });
check('a customer on auto-debit is not sent the days-before reminders; another customer is', autoLogs === 0 && plainLogs === 1, `${autoLogs} ${plainLogs} ${JSON.stringify(rr)}`);

section('WHATSAPP');
await saveSettings({ ...DEFAULTS, enabled: true, steps: DEFAULTS.steps.map(s => ({ ...s, whatsapp: true })) }, 'test');
const w = await customer(1);
await runReminders(noon(50));
const wl = await ReminderLog.findOne({ userId: w.user._id });
check('in test mode WhatsApp is recorded, not sent', wl.results.whatsapp === 'test', JSON.stringify(wl?.results));

section('SETTLEMENT OFFERS');
const off = await createOffer({ loanId: a.loan._id, waiverPercent: 20 }, 'agent@lifc.in');
check('switched off by default', off.ok === false && off.status === 409);
await saveSettings({ ...DEFAULTS, enabled: true, settlement: { enabled: true, minDaysOverdue: 60, maxWaiverPercent: 25, validDays: 7 } }, 'test');
const s1 = await customer(0);
await EMIPayment.updateMany({ loanId: s1.loan._id }, { dueDate: day(-70), status: 'OVERDUE' });
const early = await customer(0);
await EMIPayment.updateMany({ loanId: early.loan._id }, { dueDate: day(-10), status: 'OVERDUE' });
check('too early is refused', (await createOffer({ loanId: early.loan._id, waiverPercent: 20 }, 'agent')).status === 409);

const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const viewer = await staff('colviewer', 1), manager = await staff('colmanager', 2);
check('a viewer can read the page data', (await call('GET', '/admin/reminders', viewer)).s === 200);
check('a viewer cannot change anything (403)', (await call('PUT', '/admin/reminders/settings', viewer, DEFAULTS)).s === 403 && (await call('POST', '/admin/reminders/settlements', viewer, { loanId: String(s1.loan._id), waiverPercent: 10 })).s === 403);
const elig = await call('GET', '/admin/reminders/eligible', viewer);
check('the eligible list has the 70-day loan and not the 10-day one', elig.d.items.some(i => i.loanId === String(s1.loan._id)) && !elig.d.items.some(i => i.loanId === String(early.loan._id)), JSON.stringify(elig.d).slice(0, 200));
check('a waiver over the limit needs settings access (403)', (await call('POST', '/admin/reminders/settlements', manager, { loanId: String(s1.loan._id), waiverPercent: 40 })).s === 403);
const made = await call('POST', '/admin/reminders/settlements', manager, { loanId: String(s1.loan._id), waiverPercent: 20, note: 'Lost job' });
const full = made.d.offer.originalDue;
check('an offer is made at 20% off what is owed in full', made.s === 201 && made.d.offer.amount === Math.round(full * 0.8) && full > 30000, JSON.stringify(made.d));
check('a second open offer is refused (409)', (await call('POST', '/admin/reminders/settlements', manager, { loanId: String(s1.loan._id), waiverPercent: 10 })).s === 409);
check('the super admin may go over the limit on another loan', (await call('POST', '/admin/reminders/settlements', admin, { loanId: String((await (async () => { const x = await customer(0); await EMIPayment.updateMany({ loanId: x.loan._id }, { dueDate: day(-80), status: 'OVERDUE' }); return x.loan; })())._id), waiverPercent: 50 })).s === 201);
check('the customer is told', (await Notification.countDocuments({ userId: s1.user._id, type: 'SETTLEMENT' })) === 1);

const tok = await tokenFor(s1.user);
const mine = await call('GET', '/settlements/mine', tok);
check('the customer sees the offer', mine.d.offers.length === 1 && mine.d.offers[0].amount === made.d.offer.amount);
const stranger = await tokenFor((await customer(0)).user);
check('someone else cannot accept it (404)', (await call('POST', `/settlements/${made.d.offer._id}/accept`, stranger)).s === 404);
check('paying before they accept is refused', (await call('POST', `/admin/reminders/settlements/${made.d.offer._id}/paid`, manager, { amount: made.d.offer.amount, reference: 'UTR1' })).s === 409);
check('the customer accepts', (await call('POST', `/settlements/${made.d.offer._id}/accept`, tok)).d.offer.status === 'accepted');
check('accepting twice is refused (409)', (await call('POST', `/settlements/${made.d.offer._id}/accept`, tok)).s === 409);
check('too little money is refused (400)', (await call('POST', `/admin/reminders/settlements/${made.d.offer._id}/paid`, manager, { amount: 1000, reference: 'UTR1' })).s === 400);
check('a reference is needed (400)', (await call('POST', `/admin/reminders/settlements/${made.d.offer._id}/paid`, manager, { amount: made.d.offer.amount })).s === 400);
const paid = await call('POST', `/admin/reminders/settlements/${made.d.offer._id}/paid`, manager, { amount: made.d.offer.amount, reference: 'UTR123456' });
const closed = await Loan.findById(s1.loan._id);
check('paying closes the loan as settled', paid.s === 200 && closed.status === 'closed' && closed.closureType === 'settlement');
check('what is left of the schedule is waived', (await EMIPayment.countDocuments({ loanId: s1.loan._id, status: 'WAIVED' })) === 3);
check('the payment is recorded', (await Transaction.countDocuments({ loanId: s1.loan._id, referenceId: 'SETTLEMENT-UTR123456', paymentGateway: 'MANUAL' })) === 1 && (await CollectionNote.countDocuments({ loanId: s1.loan._id, type: 'RECOVERY' })) === 1);
check('it cannot be paid twice (409)', (await call('POST', `/admin/reminders/settlements/${made.d.offer._id}/paid`, manager, { amount: made.d.offer.amount, reference: 'UTR9' })).s === 409);
const bureau = await fetch(srv.base + '/admin/regulatory/export/bureau', { headers: { Authorization: 'Bearer ' + admin } });
check('the bureau file shows it as settled', (await bureau.text()).includes('"SETTLED"'));

const x = await customer(0);
await EMIPayment.updateMany({ loanId: x.loan._id }, { dueDate: day(-90), status: 'OVERDUE' });
const o2 = await createOffer({ loanId: x.loan._id, waiverPercent: 10 }, 'agent');
await Settlement.updateOne({ _id: o2.offer._id }, { validUntil: day(-1) });
check('an offer past its date is gone for the customer', (await call('GET', '/settlements/mine', await tokenFor(x.user))).d.offers.length === 0 && (await Settlement.findById(o2.offer._id)).status === 'expired');
const o3 = await createOffer({ loanId: x.loan._id, waiverPercent: 10 }, 'agent');
check('staff can withdraw one', (await call('POST', `/admin/reminders/settlements/${o3.offer._id}/withdraw`, manager)).d.status === 'withdrawn');

await disconnect();
finish();
