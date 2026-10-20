import { getPolicy } from './pricingPolicy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => `Rs ${(Math.round((n || 0) * 100) / 100).toLocaleString('en-IN')}`;
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const MODE = { CASH: 'Cash', UPI: 'UPI', NEFT: 'Bank transfer', CHEQUE: 'Cheque', CARD: 'Card', OTHER: 'Other' };
const TYPE = { payment: 'Payment receipt', prepayment: 'Part-prepayment receipt', foreclosure: 'Early closure receipt' };

// A receipt for money a staff member recorded against a loan
export function renderReceipt(receipt, loan, user) {
  const inst = getPolicy().institution;
  const name = user ? `${user.firstName} ${user.lastName}` : '';
  const rows = (receipt.allocations || []).map(a => `<tr><td>Instalment ${esc(a.emiNumber)}</td><td class="r">${esc(inr(a.amount))}</td><td class="r">${a.penalty ? esc(inr(a.penalty)) : '-'}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(receipt.receiptNo)}</title>
<style>
 body{font-family:Arial,sans-serif;max-width:640px;margin:30px auto;padding:0 22px;color:#111;line-height:1.5}
 h1{font-size:20px;margin:18px 0 4px} .muted{color:#555;font-size:13px}
 table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px} td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left} .r{text-align:right}
 .big{font-size:24px;font-weight:bold;margin:8px 0}
 .rev{border:2px solid #b91c1c;color:#b91c1c;padding:8px;margin:12px 0;font-weight:bold}
</style></head><body>
<div><strong>${esc(inst.lenderName)}</strong></div>
<div class="muted">${inst.registrationNumber ? `Registration no. ${esc(inst.registrationNumber)}<br>` : ''}${inst.address ? esc(inst.address) : ''}</div>
<h1>${esc(TYPE[receipt.type] || 'Receipt')}</h1>
<div class="muted">Receipt no. ${esc(receipt.receiptNo)} &middot; ${esc(fmtDate(receipt.valueDate))}</div>
${receipt.status === 'reversed' ? `<div class="rev">REVERSED on ${esc(fmtDate(receipt.reversal?.at))}: ${esc(receipt.reversal?.reason)}</div>` : ''}
<p>Received from <strong>${esc(name)}</strong> against loan <strong>${esc(loan._id)}</strong>.</p>
<div class="big">${esc(inr(receipt.amount))}</div>
<table>
<tr><td>Mode</td><td>${esc(MODE[receipt.mode] || receipt.mode)}</td></tr>
${receipt.reference ? `<tr><td>Reference</td><td>${esc(receipt.reference)}</td></tr>` : ''}
${receipt.advanceAfter ? `<tr><td>Held on the loan in advance</td><td>${esc(inr(receipt.advanceAfter))}</td></tr>` : ''}
</table>
${rows ? `<table><tr><th>Applied to</th><th class="r">Instalment</th><th class="r">Late fee</th></tr>${rows}</table>` : ''}
${receipt.prepayment && receipt.type === 'prepayment' ? `<p>Principal reduced by ${esc(inr(receipt.prepayment.principalReduced))}${receipt.prepayment.fee ? ` (fee ${esc(inr(receipt.prepayment.fee))})` : ''}. New instalment ${esc(inr(receipt.prepayment.emiAfter))}, ${esc(receipt.prepayment.instalmentsAfter)} instalments left.</p>` : ''}
<p class="muted">Recorded by ${esc(receipt.postedBy)}. This is a computer-generated receipt.</p>
</body></html>`;
}

export default { renderReceipt };
