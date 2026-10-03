import nodemailer from 'nodemailer';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import { getConfig } from './configService.js';

let transporter;
function getTransporter() {
  const user = process.env.EMAIL_USER || getConfig('EMAIL_USER');
  const pass = process.env.EMAIL_PASSWORD || getConfig('EMAIL_PASSWORD');
  if (!user || !pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || getConfig('EMAIL_SERVICE') || 'gmail',
      auth: { user, pass },
    });
  }
  return { transporter, from: `LIFC <${user}>` };
}

async function sendEmail(user, title, message) {
  const t = getTransporter();
  if (!t || !user.email) return 'skipped';
  try {
    await t.transporter.sendMail({ from: t.from, to: user.email, subject: title, text: `Hi ${user.firstName},\n\n${message}\n\n- LIFC` });
    return 'sent';
  } catch (e) {
    console.error('Email failed:', e.message);
    return 'failed';
  }
}

async function sendSms(user, message) {
  const apiKey = getConfig('SMS_API_KEY');
  if (getConfig('SMS_PROVIDER') !== 'fast2sms' || !apiKey || !user.phone) return 'skipped';
  try {
    const senderId = getConfig('SMS_SENDER_ID', 'LIFINC');
    const r = await fetch(
      `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&sender_id=${senderId}&message=${encodeURIComponent(message)}&language=english&route=q&numbers=${user.phone}`
    ).then(x => x.json());
    return r?.return === true ? 'sent' : 'failed';
  } catch (e) {
    console.error('SMS failed:', e.message);
    return 'failed';
  }
}

// Never throws: a notification failure must not break loan or payment flows.
export async function notify(userId, { type, title, message, loanId }, { email = true, sms = false } = {}) {
  try {
    const user = await User.findById(userId).select('firstName email phone');
    if (!user) return null;
    const channels = {
      email: email ? await sendEmail(user, title, message) : 'skipped',
      sms: sms ? await sendSms(user, message) : 'skipped',
    };
    return await Notification.create({ userId, loanId, type, title, message, channels });
  } catch (e) {
    console.error('notify error:', e.message);
    return null;
  }
}

const inr = n => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const templates = {
  approved: loan => ({
    type: 'LOAN_APPROVED',
    title: 'Loan approved',
    message: `Your loan of ${inr(loan.loanAmount)} has been approved. It will be disbursed to your bank account shortly.`,
    loanId: loan._id,
  }),
  rejected: (loan, reason) => ({
    type: 'LOAN_REJECTED',
    title: 'Loan application update',
    message: `We could not approve your loan of ${inr(loan.loanAmount)}.${reason ? ` Reason: ${reason}.` : ''}`,
    loanId: loan._id,
  }),
  disbursed: loan => ({
    type: 'LOAN_DISBURSED',
    title: 'Loan disbursed',
    message: `${inr(loan.disbursedAmount || loan.loanAmount)} has been sent to your bank account. Your EMI schedule is now available in the app.`,
    loanId: loan._id,
  }),
  emiPaid: (emi, amount) => ({
    type: 'EMI_PAID',
    title: `EMI #${emi.emiNumber} received`,
    message: `We received ${inr(amount)} for EMI #${emi.emiNumber}. Thank you.`,
    loanId: emi.loanId,
  }),
  foreclosed: (loan, total) => ({
    type: 'LOAN_CLOSED',
    title: 'Loan closed early',
    message: `We received ${inr(total)} and your loan has been closed early. Remaining interest has been waived.`,
    loanId: loan._id,
  }),
  closed: loanId => ({
    type: 'LOAN_CLOSED',
    title: 'Loan fully repaid',
    message: 'Congratulations! You have paid all EMIs and your loan is now closed.',
    loanId,
  }),
};

// Daily job: remind for EMIs due within 3 days, notify once for overdue EMIs.
export async function sendEmiReminders() {
  const { checkAndMarkOverdue } = await import('./emiService.js');
  await checkAndMarkOverdue();

  const writtenOff = await Loan.find({ status: 'written_off' }).distinct('_id');
  const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const upcoming = await EMIPayment.find({ status: 'PENDING', loanId: { $nin: writtenOff }, dueDate: { $lte: soon }, 'metadata.reminderSent': { $ne: true } });
  for (const emi of upcoming) {
    await notify(
      emi.userId,
      {
        type: 'EMI_REMINDER',
        title: `EMI #${emi.emiNumber} due soon`,
        message: `Your EMI of ${inr(emi.amount)} is due on ${fmtDate(emi.dueDate)}. Pay in the app to avoid late fees.`,
        loanId: emi.loanId,
      },
      { email: true, sms: true }
    );
    await EMIPayment.updateOne({ _id: emi._id }, { 'metadata.reminderSent': true });
  }

  const overdue = await EMIPayment.find({ status: 'OVERDUE', loanId: { $nin: writtenOff }, 'metadata.notificationSent': { $ne: true } });
  for (const emi of overdue) {
    await notify(
      emi.userId,
      {
        type: 'EMI_OVERDUE',
        title: `EMI #${emi.emiNumber} overdue`,
        message: `Your EMI of ${inr(emi.amount)} was due on ${fmtDate(emi.dueDate)}. A late fee of ${inr(emi.penaltyApplied)} applies. Please pay now.`,
        loanId: emi.loanId,
      },
      { email: true, sms: true }
    );
    await EMIPayment.updateOne({ _id: emi._id }, { 'metadata.notificationSent': true });
  }
  return { reminders: upcoming.length, overdueNotices: overdue.length };
}

export function startScheduler() {
  const run = async () => {
    try {
      await sendEmiReminders();
      const { runEscalations } = await import('./collectionsService.js');
      await runEscalations();
    } catch (e) {
      console.error('Reminder/collections job failed:', e.message);
    }
  };
  setTimeout(run, 30 * 1000);
  setInterval(run, 6 * 60 * 60 * 1000);
}

export default { notify, templates, sendEmiReminders, startScheduler };
