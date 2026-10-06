// Draws a loan's repayment schedule (every instalment and whether it has been paid) from the
// /api/emi/schedule/:loanId response. Used by the customer portal and the staff loan screen.
(function () {
  var LABEL = { PAID: 'Paid', PENDING: 'Upcoming', OVERDUE: 'Overdue', FAILED: 'Payment failed', WAIVED: 'Waived' };
  var COLOR = { PAID: ['#047857', '#d1fae5'], PENDING: ['#475569', '#e2e8f0'], OVERDUE: ['#b91c1c', '#fee2e2'], FAILED: ['#b45309', '#fef3c7'], WAIVED: ['#475569', '#e2e8f0'] };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
  function date(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }

  function render(data) {
    var emis = (data && data.emis) || [];
    if (!emis.length) return '<div style="padding:12px;color:#64748b;font-size:13px">The repayment schedule appears once the loan has been paid out.</div>';
    var counted = emis.filter(function (e) { return e.status !== 'WAIVED'; });
    var paid = counted.filter(function (e) { return e.status === 'PAID'; });
    var paidSum = paid.reduce(function (t, e) { return t + (e.paidAmount || e.amount || 0); }, 0);
    var next = counted.filter(function (e) { return e.status !== 'PAID'; })[0];
    var pct = counted.length ? Math.round((paid.length / counted.length) * 100) : 0;

    var rows = emis.map(function (e) {
      var c = COLOR[e.status] || COLOR.PENDING;
      return '<tr><td>' + esc(e.emiNumber) + '</td><td>' + date(e.dueDate) + '</td><td style="text-align:right">' + money(e.amount) + '</td>' +
        '<td style="text-align:right">' + (e.penaltyApplied ? money(e.penaltyApplied) : '-') + '</td>' +
        '<td><span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;color:' + c[0] + ';background:' + c[1] + '">' + esc(LABEL[e.status] || e.status) + '</span></td>' +
        '<td>' + (e.status === 'PAID' ? date(e.paidDate) : '-') + '</td><td style="text-align:right">' + (e.status === 'PAID' ? money(e.paidAmount || e.amount) : '-') + '</td></tr>';
    }).join('');

    return '<div style="padding:12px 4px">' +
      '<div style="font-size:13px;margin-bottom:6px"><strong>' + paid.length + ' of ' + counted.length + ' instalments paid</strong> &middot; ' + money(paidSum) + ' paid so far' +
      (next ? ' &middot; next due ' + date(next.dueDate) : ' &middot; nothing left to pay') + '</div>' +
      '<div style="height:8px;background:#e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:' + pct + '%;background:#047857"></div></div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px"><thead><tr>' +
      ['#', 'Due date', 'Instalment', 'Late fee', 'Status', 'Paid on', 'Paid'].map(function (h, i) { return '<th style="text-align:' + (i === 2 || i === 3 || i === 6 ? 'right' : 'left') + ';padding:6px 8px;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  window.EmiTable = { render: render };
})();
