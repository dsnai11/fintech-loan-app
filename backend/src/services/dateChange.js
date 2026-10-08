import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import MandateDebit from '../models/MandateDebit.js';
import ReminderLog from '../models/ReminderLog.js';
import { getConfig } from './configService.js';
import { audit } from './auditService.js';
import { notify } from './notificationService.js';

// Moving the due date of the remaining EMIs to a day that suits the customer (usually salary day).
// Allowed when the loan is active, nothing is overdue, the first instalment moves by no more than a set number of days,
// and the customer has not used up their changes. The amounts do not change. No fee is charged; if the company wants one,
// that is a policy decision to be added with the compliance team.

const DAY = 864e5;
const UNPAID = ['PENDING', 'OVERDUE', 'FAILED'];
export const limits = () => ({
  maxChanges: Math.max(0, Number(getConfig('DATE_CHANGE_MAX', '1')) || 0),
  maxShiftDays: Math.max(1, Number(getConfig('DATE_CHANGE_MAX_SHIFT_DAYS', '15')) || 15),
});
const fail = (status, error) => ({ ok: false, status, error });
const dateText = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const at = (year, month, day, like) => { const d = new Date(like); d.setUTCFullYear(year, month, day); return d; };

// The date the next instalment would move to, the closest date with the chosen day of the month
export function nearestOnDay(current, day) {
  const c = new Date(current);
  const options = [-1, 0, 1].map(m => at(c.getUTCFullYear(), c.getUTCMonth() + m, day, c));
  return options.sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0];
}

export async function eligibility(loan, now = new Date()) {
  const lim = limits();
  const used = (loan.dateChanges || []).length;
  if (loan.status !== 'disbursed') return { allowed: false, reason: 'Only an active loan can have its due date changed.' };
  if (used >= lim.maxChanges) return { allowed: false, reason: lim.maxChanges === 0 ? 'Changing the due date is not available.' : 'You have already changed the due date.' };
  const unpaid = await EMIPayment.find({ loanId: loan._id, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
  if (!unpaid.length) return { allowed: false, reason: 'There is nothing left to pay on this loan.' };
  if (unpaid.some(e => e.dueDate < now)) return { allowed: false, reason: 'Pay the overdue instalment first. After that you can change the due date.' };
  return { allowed: true, currentDay: new Date(unpaid[0].dueDate).getUTCDate(), nextDue: unpaid[0].dueDate, maxShiftDays: lim.maxShiftDays, changesLeft: lim.maxChanges - used, remaining: unpaid.length };
}

export async function changeDueDay(loan, day, by, now = new Date()) {
  const d = Number(day);
  if (!Number.isInteger(d) || d < 1 || d > 28) return fail(400, 'Choose a day between 1 and 28.');
  const el = await eligibility(loan, now);
  if (!el.allowed) return fail(409, el.reason);
  const unpaid = await EMIPayment.find({ loanId: loan._id, status: { $in: UNPAID } }).sort({ emiNumber: 1 });
  const first = unpaid[0];
  const target = nearestOnDay(first.dueDate, d);
  const shift = Math.round((target - new Date(first.dueDate)) / DAY);
  if (shift === 0) return fail(409, 'Your instalments are already due on that day.');
  if (Math.abs(shift) > el.maxShiftDays) return fail(409, `The next instalment can move by at most ${el.maxShiftDays} days. Day ${d} is ${Math.abs(shift)} days ${shift > 0 ? 'later' : 'earlier'}.`);
  if (target <= now) return fail(409, 'That date has already passed. Choose a later day.');

  for (let i = 0; i < unpaid.length; i++) {
    const due = at(target.getUTCFullYear(), target.getUTCMonth() + i, d, target);
    await EMIPayment.updateOne({ _id: unpaid[i]._id }, { dueDate: due, $unset: { 'metadata.reminderSent': 1, 'metadata.notificationSent': 1 } });
  }
  await Loan.updateOne({ _id: loan._id }, { $push: { dateChanges: { at: now, fromDay: el.currentDay, toDay: d, shiftDays: shift, by } }, nextEmiDate: target });
  // Reminders and auto-debit notices are worked out again from the new dates
  await ReminderLog.deleteMany({ emiId: { $in: unpaid.map(e => e._id) } });
  await MandateDebit.deleteMany({ loanId: loan._id, status: 'notified' });
  await audit({ email: by, role: 'customer' }, 'EMI_DATE_CHANGED', { type: 'Loan', id: loan._id }, { fromDay: el.currentDay, toDay: d, shiftDays: shift, emis: unpaid.length }, null);
  await notify(loan.userId, { type: 'EMI_REMINDER', title: 'Your due date has changed', message: `Your remaining EMIs are now due on day ${d} of each month. The next one is on ${dateText(target)}. The amounts have not changed.`, loanId: loan._id }, { sms: true });
  return { ok: true, nextDue: target, day: d, shiftDays: shift, emis: unpaid.length };
}

export default { eligibility, changeDueDay, nearestOnDay, limits };
