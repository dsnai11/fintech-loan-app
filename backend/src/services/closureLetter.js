import { getPolicy } from './pricingPolicy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => `Rs ${Math.round(n || 0).toLocaleString('en-IN')}`;
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

const HOW = {
  repaid: () => 'All instalments were paid and the loan was closed in full.',
  foreclosure: loan => `The loan was closed early on ${fmtDate(loan.foreclosure?.date || loan.closedAt)} after the customer paid the full settlement amount.`,
  cooling_off: loan => `The loan was cancelled within the cooling-off period on ${fmtDate(loan.foreclosure?.date || loan.closedAt)} after the customer returned the amount received with interest for the days held.`,
};

export function renderClosureLetter(loan, user) {
  const inst = getPolicy().institution;
  const closed = loan.closedAt || loan.updatedAt;
  const how = (HOW[loan.closureType] || HOW.repaid)(loan);
  const name = `${user.firstName} ${user.lastName}`;
  const contact = [
    inst.supportEmail && `Support: ${inst.supportEmail}`,
    inst.supportPhone,
    inst.grievanceOfficerName && `Grievance officer: ${[inst.grievanceOfficerName, inst.grievanceOfficerEmail, inst.grievanceOfficerPhone].filter(Boolean).join(', ')}`,
  ].filter(Boolean).map(esc).join(' | ');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Loan closure letter - ${esc(name)}</title>
<style>
 body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111;line-height:1.55}
 h1{font-size:21px;margin:26px 0 6px} .muted{color:#555;font-size:13px}
 table{border-collapse:collapse;margin:14px 0;font-size:14px} td{padding:5px 14px 5px 0}
 .draft{margin-top:44px;padding:10px;border:1px dashed #999;font-size:12px;color:#555}
 @media print{.draft{display:none}}
</style></head><body>
<div><strong>${esc(inst.lenderName)}</strong></div>
<div class="muted">${inst.registrationNumber ? `Registration no. ${esc(inst.registrationNumber)}<br>` : ''}${inst.address ? esc(inst.address) : ''}</div>
<h1>Loan closure letter and no-dues certificate</h1>
<div class="muted">Date: ${esc(fmtDate(new Date()))}</div>
<p>To,<br><strong>${esc(name)}</strong></p>
<p>This is to confirm that the loan described below has been closed and that <strong>no amount is outstanding</strong> against it.</p>
<table>
<tr><td>Loan reference</td><td>${esc(loan._id)}</td></tr>
<tr><td>Loan amount</td><td>${esc(inr(loan.loanAmount))}</td></tr>
<tr><td>Paid out on</td><td>${loan.disbursementDate ? esc(fmtDate(loan.disbursementDate)) : '-'}</td></tr>
<tr><td>Closed on</td><td>${esc(fmtDate(closed))}</td></tr>
</table>
<p>${esc(how)}</p>
<p>Yours sincerely,<br>${esc(inst.lenderName)}</p>
<p class="muted">${contact}</p>
<div class="draft">System-generated. Have the wording approved by the NBFC's compliance team before it is relied on.</div>
</body></html>`;
}

export default { renderClosureLetter };
