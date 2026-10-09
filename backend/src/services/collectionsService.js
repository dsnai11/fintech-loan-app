import { mapLimit } from './concurrency.js';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import CollectionNote from '../models/CollectionNote.js';
import { penaltyFor } from './foreclosureService.js';
import { notify } from './notificationService.js';

const DAY = 24 * 60 * 60 * 1000;
const inr = n => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

export const STAGES = ['REMINDER', 'FOLLOW_UP', 'ESCALATED', 'FINAL_NOTICE', 'DEFAULT_CANDIDATE'];
export const STAGE_LABEL = {
  REMINDER: 'Reminder',
  FOLLOW_UP: 'Follow-up',
  ESCALATED: 'Escalated',
  FINAL_NOTICE: 'Final notice',
  DEFAULT_CANDIDATE: 'Default candidate',
  DEFAULTED: 'Defaulted',
};

export function stageFor(days) {
  if (days <= 0) return null;
  if (days <= 7) return 'REMINDER';
  if (days <= 30) return 'FOLLOW_UP';
  if (days <= 60) return 'ESCALATED';
  if (days <= 89) return 'FINAL_NOTICE';
  return 'DEFAULT_CANDIDATE';
}

// Loans in collection = disbursed/defaulted loans with at least one unpaid EMI past its due date.
export async function buildQueue({ now = new Date(), loanId } = {}) {
  // Start from the unpaid EMIs past their due date (indexed), then load only those loans. Looking at every running
  // loan first would read the whole book on every page view.
  const emiFilter = { status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] }, dueDate: { $lt: now } };
  if (loanId) emiFilter.loanId = loanId;
  const emis = await EMIPayment.find(emiFilter).sort({ emiNumber: 1 });
  if (!emis.length) return [];
  const loans = await Loan.find({ _id: { $in: [...new Set(emis.map(e => String(e.loanId)))] }, status: { $in: ['disbursed', 'defaulted'] } }).populate('userId', 'firstName lastName email phone address.state');
  if (!loans.length) return [];

  const byLoan = new Map();
  for (const e of emis) {
    const k = String(e.loanId);
    if (!byLoan.has(k)) byLoan.set(k, []);
    byLoan.get(k).push(e);
  }

  const notes = await CollectionNote.find({ loanId: { $in: [...byLoan.keys()] } }).sort({ createdAt: -1 });
  const lastNote = new Map();
  const lastPromise = new Map();
  for (const n of notes) {
    const k = String(n.loanId);
    if (!lastNote.has(k)) lastNote.set(k, n);
    if (n.type === 'PROMISE_TO_PAY' && !lastPromise.has(k)) lastPromise.set(k, n);
  }

  const items = [];
  for (const loan of loans) {
    const k = String(loan._id);
    const overdue = byLoan.get(k);
    if (!overdue) continue;
    const daysOverdue = Math.floor((now - overdue[0].dueDate) / DAY);
    const stage = loan.status === 'defaulted' ? 'DEFAULTED' : stageFor(daysOverdue);
    if (!stage) continue; // due earlier today: not a day late yet, so no case
    const rows = overdue.map(e => ({ emi: e, penalty: penaltyFor(e, now) }));
    const amountDue = rows.reduce((a, r) => a + r.emi.amount + r.penalty, 0);
    const p = lastPromise.get(k);
    const n = lastNote.get(k);
    items.push({
      loan,
      rows,
      loanId: k,
      customer: loan.userId ? `${loan.userId.firstName} ${loan.userId.lastName}` : 'Unknown',
      phone: loan.userId?.phone,
      email: loan.userId?.email,
      loanAmount: loan.loanAmount,
      status: loan.status,
      overdueEmis: overdue.length,
      amountDue,
      daysOverdue,
      stage,
      lastAction: n ? { type: n.type, at: n.createdAt, by: n.createdBy } : null,
      promise: p
        ? { date: p.promiseDate, amount: p.promiseAmount, broken: !!p.promiseDate && p.promiseDate < new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
        : null,
    });
  }
  return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

const noticeText = (stage, days, due) => ({
  FOLLOW_UP: `Your EMI is ${days} days overdue. Please pay ${inr(due)} in the app to avoid further late fees.`,
  ESCALATED: `Your account is ${days} days overdue (${inr(due)} due). Your case has been passed to our collections team. Please pay now or contact us.`,
  FINAL_NOTICE: `Final notice: your account is ${days} days overdue (${inr(due)} due). Please pay immediately. If it stays unpaid the loan may be classified as defaulted and recovery action may follow.`,
  DEFAULT_CANDIDATE: `Your loan is ${days} days overdue (${inr(due)} due) and is being reviewed for default classification. Please contact us today.`,
}[stage]);

// Daily job. Moves loans between stages and tells the customer once per stage change.
// It never marks a loan defaulted or written off - those stay manual admin decisions.
export async function runEscalations(now = new Date()) {
  const queue = await buildQueue({ now });
  let escalated = 0;

  const toMove = queue.filter(item => item.status === 'disbursed' && item.stage && item.stage !== item.loan.collectionStage);
  await mapLimit(toMove, 10, async item => {
    await Loan.updateOne({ _id: item.loan._id }, { collectionStage: item.stage, collectionStageSince: now });
    await CollectionNote.create({
      loanId: item.loan._id,
      userId: item.loan.userId._id,
      type: 'ESCALATION',
      stage: item.stage,
      text: `Moved to "${STAGE_LABEL[item.stage]}" (${item.daysOverdue} days overdue, ${inr(item.amountDue)} due)`,
    });
    const text = noticeText(item.stage, item.daysOverdue, item.amountDue);
    if (text) {
      await notify(
        item.loan.userId._id,
        { type: 'COLLECTION_NOTICE', title: STAGE_LABEL[item.stage] === 'Final notice' ? 'Final notice' : 'Overdue payment', message: text, loanId: item.loan._id },
        { email: true, sms: true }
      );
    }
    escalated++;
  });

  // Customers who caught up: clear the stage so a later miss escalates afresh.
  const inQueue = new Set(queue.map(q => q.loanId));
  const stale = await Loan.find({ status: 'disbursed', collectionStage: { $exists: true, $ne: null } }).select('_id');
  const cleared = stale.filter(l => !inQueue.has(String(l._id)));
  if (cleared.length) {
    await Loan.updateMany({ _id: { $in: cleared.map(l => l._id) } }, { $unset: { collectionStage: '', collectionStageSince: '' } });
  }
  return { inCollections: queue.length, escalated, cleared: cleared.length };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

const LETTERS = {
  REMINDER: { title: 'Payment reminder', body: 'We noticed that the instalment(s) below on your loan are overdue. If you have already paid, please ignore this letter. Otherwise, please make the payment at the earliest through the LIFC app.' },
  FOLLOW_UP: { title: 'Payment reminder', body: 'The instalment(s) below on your loan remain unpaid. Late fees continue to apply. Please pay at the earliest through the LIFC app, or contact us if you are facing difficulty.' },
  ESCALATED: { title: 'Notice of overdue payment', body: 'Despite earlier reminders, the instalment(s) below remain unpaid and your account has been referred to our collections team. Please pay the total amount due immediately or contact us to discuss your situation.' },
  FINAL_NOTICE: { title: 'Final notice of overdue payment', body: 'This is a final notice. The instalment(s) below remain unpaid. If payment is not received promptly, the loan may be classified as defaulted and further recovery action may be taken as permitted by law and your loan agreement.' },
  DEFAULT_CANDIDATE: { title: 'Notice of overdue payment', body: 'The instalment(s) below are more than 90 days overdue and your loan is under review for default classification. Please contact us immediately to settle or to discuss a repayment arrangement.' },
  DEFAULTED: { title: 'Notice of default', body: 'Your loan has been classified as defaulted because the instalment(s) below remain unpaid. Please contact us immediately to settle the outstanding amount.' },
};

export function renderLetter(item, now = new Date()) {
  const L = LETTERS[item.stage] || LETTERS.REMINDER;
  const rows = item.rows
    .map(r => `<tr><td>${r.emi.emiNumber}</td><td>${fmtDate(r.emi.dueDate)}</td><td>${inr(r.emi.amount)}</td><td>${inr(r.penalty)}</td><td>${inr(r.emi.amount + r.penalty)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(L.title)} - ${esc(item.customer)}</title>
<style>
 body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111;line-height:1.5}
 h1{font-size:20px;margin:24px 0 4px} .muted{color:#555;font-size:13px}
 table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px} th,td{border:1px solid #bbb;padding:6px 8px;text-align:right} th:first-child,td:first-child{text-align:left}
 .total{font-weight:bold;font-size:16px} .draft{margin-top:40px;padding:10px;border:1px dashed #999;font-size:12px;color:#555}
 @media print{.draft{display:none}}
</style></head><body>
<div><strong>Laxmi India Finance Ltd.</strong></div>
<div class="muted">Date: ${fmtDate(now)} &nbsp;|&nbsp; Loan reference: ${esc(item.loanId)}</div>
<p>To,<br><strong>${esc(item.customer)}</strong><br>${esc(item.phone || '')}${item.email ? '<br>' + esc(item.email) : ''}</p>
<h1>${esc(L.title)}</h1>
<p>Dear ${esc(item.customer)},</p>
<p>${esc(L.body)}</p>
<table><thead><tr><th>EMI #</th><th>Due date</th><th>EMI</th><th>Late fee</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<p class="total">Total amount due: ${inr(item.amountDue)} (oldest instalment ${item.daysOverdue} days overdue)</p>
<p>Yours sincerely,<br>Collections Team<br>Laxmi India Finance Ltd.</p>
<div class="draft">System-generated draft. Have it reviewed against your loan agreement and applicable regulations before it is sent to a customer.</div>
</body></html>`;
}

export default { buildQueue, runEscalations, renderLetter, stageFor, STAGES, STAGE_LABEL };
