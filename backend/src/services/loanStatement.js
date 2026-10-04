import { getPolicy } from './pricingPolicy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

// Figures for one loan, kept apart from the HTML so they can be tested and reused.
export function statementFigures(loan, emis) {
  const live = emis.filter(e => e.status !== 'WAIVED');
  const paid = live.filter(e => e.status === 'PAID');
  const open = live.filter(e => e.status !== 'PAID');
  const sum = (list, f) => list.reduce((t, e) => t + (f(e) || 0), 0);
  const today = new Date();
  const overdue = open.filter(e => new Date(e.dueDate) < today);
  return {
    totalPaid: sum(paid, e => e.paidAmount ?? e.amount),
    lateFeesPaid: sum(paid, e => e.penaltyApplied),
    principalOutstanding: sum(open, e => e.principalAmount),
    instalmentsOutstanding: sum(open, e => e.amount),
    lateFeesDue: sum(open, e => e.penaltyApplied),
    paidCount: paid.length,
    openCount: open.length,
    overdueCount: overdue.length,
    nextDue: open.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] || null,
  };
}

export function renderStatement(loan, user, emis) {
  const inst = getPolicy().institution;
  const f = statementFigures(loan, emis);
  const name = `${user.firstName} ${user.lastName}`;
  const net = loan.disbursalDetails?.disbursedAmount;
  const rows = emis.map(e => `<tr>
<td>${esc(e.emiNumber)}</td><td>${esc(fmtDate(e.dueDate))}</td><td class="n">${esc(inr(e.amount))}</td>
<td class="n">${e.penaltyApplied ? esc(inr(e.penaltyApplied)) : '-'}</td><td>${esc(e.status)}</td>
<td>${esc(fmtDate(e.paidDate))}</td><td class="n">${e.paidAmount ? esc(inr(e.paidAmount)) : '-'}</td></tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Loan statement - ${esc(name)}</title>
<style>
 body{font-family:system-ui,Segoe UI,sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#111;line-height:1.5}
 h1{font-size:21px;margin:22px 0 4px} .muted{color:#555;font-size:13px}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 24px;margin:14px 0;font-size:14px}
 .grid b{display:block;font-size:12px;color:#555;font-weight:600}
 .wrap{overflow-x:auto} table{border-collapse:collapse;width:100%;font-size:13px;min-width:560px}
 th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left} th{background:#f3f4f6} .n{text-align:right}
 .sum{background:#f3f4f6;padding:12px 16px;border-radius:8px;margin:14px 0;font-size:14px}
 .draft{margin-top:30px;padding:10px;border:1px dashed #999;font-size:12px;color:#555}
 @media print{.draft{display:none}}
</style></head><body>
<div><strong>${esc(inst.lenderName)}</strong></div>
<div class="muted">${inst.registrationNumber ? `Registration no. ${esc(inst.registrationNumber)}<br>` : ''}${inst.address ? esc(inst.address) : ''}</div>
<h1>Loan account statement</h1>
<div class="muted">Generated on ${esc(fmtDate(new Date()))}</div>
<div class="grid">
 <div><b>Borrower</b>${esc(name)}</div>
 <div><b>Loan reference</b>${esc(loan._id)}</div>
 <div><b>Status</b>${esc(loan.status)}</div>
 <div><b>Loan amount</b>${esc(inr(loan.loanAmount))}</div>
 <div><b>Amount paid to your bank</b>${net ? esc(inr(net)) : '-'}</div>
 <div><b>Paid out on</b>${esc(fmtDate(loan.disbursementDate))}</div>
 <div><b>Instalment</b>${esc(inr(loan.monthlyEMI))}</div>
 <div><b>Tenure</b>${esc(loan.tenure)} month(s)</div>
 ${loan.kfs?.aprPercent ? `<div><b>APR (all costs)</b>${esc(loan.kfs.aprPercent)}%</div>` : ''}
</div>
<div class="sum">
 Paid so far: <strong>${esc(inr(f.totalPaid))}</strong> in ${f.paidCount} instalment(s)${f.lateFeesPaid ? `, including ${esc(inr(f.lateFeesPaid))} late fees` : ''}.<br>
 ${f.openCount ? `Still to pay: <strong>${esc(inr(f.instalmentsOutstanding + f.lateFeesDue))}</strong> in ${f.openCount} instalment(s), of which principal ${esc(inr(f.principalOutstanding))}${f.overdueCount ? `. <strong>${f.overdueCount} overdue.</strong>` : ''}${f.nextDue ? ` Next due ${esc(fmtDate(f.nextDue.dueDate))}.` : ''}` : 'Nothing is outstanding.'}
</div>
<div class="wrap"><table>
<thead><tr><th>#</th><th>Due date</th><th class="n">Instalment</th><th class="n">Late fee</th><th>Status</th><th>Paid on</th><th class="n">Paid</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">The schedule is created once the loan is paid out.</td></tr>'}</tbody></table></div>
<p class="muted">${[inst.supportEmail, inst.supportPhone].filter(Boolean).map(esc).join(' | ')}</p>
<div class="draft">System-generated statement. It is not a legal document until the NBFC's compliance team approves the format.</div>
</body></html>`;
}

export default { renderStatement, statementFigures };
