import { getPolicy } from './pricingPolicy.js';

// Printable documents for one live or closed loan: the statement of account, the repayment schedule, and the interest
// certificate for a financial year. They are built from the loan account view (see lmsService.accountView).
// Have compliance approve the wording before they are given to customers.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => `Rs ${(Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmt = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-');

const STYLE = `<style>
 body{font-family:Arial,sans-serif;max-width:860px;margin:30px auto;padding:0 22px;color:#111;line-height:1.5;font-size:14px}
 h1{font-size:20px;margin:18px 0 4px} h2{font-size:15px;margin:22px 0 6px} .muted{color:#555;font-size:13px}
 table{border-collapse:collapse;width:100%;margin:8px 0 14px;font-size:13px} td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top} th{background:#f3f4f6}
 .r{text-align:right} .kv td{border:0;padding:3px 14px 3px 0} .draft{margin-top:34px;padding:10px;border:1px dashed #999;font-size:12px;color:#555}
 @media print{.draft{display:none}}
</style>`;

function head(v, title) {
  const inst = getPolicy().institution;
  const c = v.customer || {};
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} - ${esc(c.name)}</title>${STYLE}</head><body>
<div><strong>${esc(inst.lenderName)}</strong></div>
<div class="muted">${inst.registrationNumber ? `Registration no. ${esc(inst.registrationNumber)}<br>` : ''}${inst.address ? esc(inst.address) : ''}</div>
<h1>${esc(title)}</h1>
<div class="muted">Printed on ${esc(fmt(new Date()))}</div>
<table class="kv"><tr><td>Customer</td><td><b>${esc(c.name)}</b>${c.phone ? ', ' + esc(c.phone) : ''}</td></tr>
<tr><td>Loan reference</td><td>${esc(v.loan.id)}</td></tr>
<tr><td>Loan amount</td><td>${esc(inr(v.loan.amount))}, ${esc(v.loan.tenure)} instalments, ${esc(v.loan.rate)}% a year</td></tr>
<tr><td>Paid out on</td><td>${esc(fmt(v.loan.disbursedAt))}</td></tr></table>`;
}
const tail = `<div class="draft">System-generated. Have the wording approved by the NBFC's compliance team before it is given to customers.</div></body></html>`;

export function renderSchedule(v) {
  const rows = v.schedule.map(s => `<tr><td>${esc(s.emiNumber)}</td><td>${esc(fmt(s.dueDate))}</td><td class="r">${esc(inr(s.principal))}</td><td class="r">${esc(inr(s.interest))}</td><td class="r">${esc(inr(s.amount))}</td><td>${esc(s.status.toLowerCase())}${s.paidDate ? ' on ' + esc(fmt(s.paidDate)) : ''}</td></tr>`).join('');
  return `${head(v, 'Repayment schedule')}<table><tr><th>#</th><th>Due date</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Instalment</th><th>Status</th></tr>${rows}</table>${tail}`;
}

export function renderStatementOfAccount(v) {
  const f = v.figures;
  const tx = v.transactions.map(t => `<tr><td>${esc(fmt(t.date))}</td><td>${esc(t.kind)}</td><td>${esc(t.text)}</td><td class="r">${t.debit ? esc(inr(t.debit)) : ''}</td><td class="r">${t.credit ? esc(inr(t.credit)) : ''}</td></tr>`).join('');
  const sched = v.schedule.map(s => `<tr><td>${esc(s.emiNumber)}</td><td>${esc(fmt(s.dueDate))}</td><td class="r">${esc(inr(s.amount))}</td><td class="r">${s.lateFee ? esc(inr(s.lateFee)) : '-'}</td><td>${esc(s.status.toLowerCase())}</td></tr>`).join('');
  return `${head(v, 'Statement of account')}
<h2>Where the loan stands</h2>
<table class="kv"><tr><td>Principal outstanding</td><td><b>${esc(inr(f.principalOutstanding))}</b></td></tr>
<tr><td>Overdue now</td><td>${esc(inr(f.overdueAmount))}${f.dpd ? ` (${esc(f.dpd)} days past due)` : ''}</td></tr>
<tr><td>Paid so far</td><td>${esc(inr(f.totalPaid))} (${esc(f.paidEmis)} of ${esc(f.totalEmis)} instalments)</td></tr>
${f.advanceBalance ? `<tr><td>Held in advance</td><td>${esc(inr(f.advanceBalance))}</td></tr>` : ''}
<tr><td>Status</td><td>${esc(v.loan.status === 'closed' ? 'Closed' : v.loan.status === 'defaulted' ? 'In default' : 'Live')}</td></tr></table>
<h2>Transactions</h2><table><tr><th>Date</th><th>What</th><th>Details</th><th class="r">Out</th><th class="r">In</th></tr>${tx}</table>
<h2>Instalments</h2><table><tr><th>#</th><th>Due</th><th class="r">Amount</th><th class="r">Late fee</th><th>Status</th></tr>${sched}</table>${tail}`;
}

// fyStart is the calendar year the financial year begins in: 2025 means 1 April 2025 to 31 March 2026
export function renderInterestCertificate(v, fyStart) {
  const from = new Date(Date.UTC(fyStart, 3, 1)), to = new Date(Date.UTC(fyStart + 1, 3, 1));
  const paid = v.schedule.filter(s => s.status === 'PAID' && s.paidDate);
  const inFy = paid.filter(s => new Date(s.paidDate) >= from && new Date(s.paidDate) < to);
  const sum = (list, k) => list.reduce((a, s) => a + (s[k] || 0), 0);
  const principalPaidBefore = sum(paid.filter(s => new Date(s.paidDate) < to), 'principal');
  const outstanding = Math.max(0, v.loan.amount - principalPaidBefore);
  const rows = inFy.map(s => `<tr><td>${esc(fmt(s.paidDate))}</td><td>Instalment ${esc(s.emiNumber)}</td><td class="r">${esc(inr(s.principal))}</td><td class="r">${esc(inr(s.interest))}</td></tr>`).join('');
  return `${head(v, `Interest certificate, financial year ${fyStart}-${String(fyStart + 1).slice(2)}`)}
<p>This certifies the amounts paid on the loan above between <b>${esc(fmt(from))}</b> and <b>${esc(fmt(new Date(to - 864e5)))}</b>.</p>
<table class="kv"><tr><td>Interest paid in the year</td><td><b>${esc(inr(sum(inFy, 'interest')))}</b></td></tr>
<tr><td>Principal repaid in the year</td><td>${esc(inr(sum(inFy, 'principal')))}</td></tr>
<tr><td>Principal outstanding at the end of the year</td><td>${esc(inr(outstanding))}</td></tr></table>
${rows ? `<table><tr><th>Paid on</th><th>Instalment</th><th class="r">Principal</th><th class="r">Interest</th></tr>${rows}</table>` : '<p class="muted">No instalment was paid in this year.</p>'}
<p class="muted">The interest part of each instalment is as set out in the repayment schedule. Late fees are not interest and are not included.</p>${tail}`;
}

export default { renderSchedule, renderStatementOfAccount, renderInterestCertificate };
