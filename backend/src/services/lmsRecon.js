import EMIPayment from '../models/EMIPayment.js';
import LoanReceipt from '../models/LoanReceipt.js';
import Transaction from '../models/Transaction.js';

// Matches a bank or payment-provider settlement file against what is in our books.
//
// The file is CSV with a header row. We look for a reference column (reference, UTR, transaction id, payment id), an amount
// column, and optionally a date column. Each of our payments is found by its reference. The result lists what matched, what has
// a different amount, what the bank has that we do not (money to find a home for), and what we booked that the bank does not show
// (to chase). Nothing is changed by running it.

const DAY = 864e5;
const round2 = n => Math.round((n || 0) * 100) / 100;
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const REF = ['reference', 'ref', 'utr', 'utrnumber', 'utrno', 'transactionid', 'txnid', 'txnref', 'paymentid', 'rrn', 'orderid', 'id', 'referenceno', 'referencenumber'];
const AMT = ['amount', 'amt', 'credit', 'creditamount', 'netamount', 'settledamount', 'settlementamount', 'depositamount', 'paidamount'];
const DATE = ['date', 'valuedate', 'transactiondate', 'txndate', 'settlementdate', 'postingdate', 'createdat', 'paidat'];

// A small CSV reader: commas, double quotes, quoted commas
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}
const money = v => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : NaN; };
const when = v => { const d = new Date(String(v ?? '').trim()); if (!Number.isNaN(d.getTime())) return d; const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(String(v ?? '').trim()); if (m) { const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); const d2 = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]))); return Number.isNaN(d2.getTime()) ? null : d2; } return null; };

export function readFile(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: 'The file needs a header row and at least one line' };
  const head = rows[0].map(norm);
  const find = names => head.findIndex(h => names.includes(h));
  const ri = find(REF), ai = find(AMT), di = find(DATE);
  if (ri < 0) return { error: 'There is no reference column. Name one of the columns reference, UTR, transaction id or payment id.' };
  if (ai < 0) return { error: 'There is no amount column. Name one of the columns amount, credit or settled amount.' };
  const lines = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const ref = String(r[ri] ?? '').trim(), amount = money(r[ai]);
    if (!ref && !Number.isFinite(amount)) continue;
    lines.push({ line: i + 2, reference: ref, amount, date: di >= 0 ? when(r[di]) : null });
  }
  return { lines, hasDates: di >= 0 };
}

// Everything we booked as money in by reference. Where one payment appears in several places, the receipt wins, then the transaction, then the instalments.
async function booked(from, to) {
  const map = new Map();
  const put = (ref, rec, rank) => { const k = norm(ref); if (!k) return; const cur = map.get(k); if (!cur || rank < cur.rank) map.set(k, { ...rec, rank, reference: String(ref) }); };
  const window = from && to ? { $gte: from, $lte: to } : null;
  const emis = await EMIPayment.aggregate([{ $match: { status: 'PAID', ...(window ? { paidDate: window } : {}), $or: [{ transactionId: { $nin: [null, ''] } }, { paymentId: { $nin: [null, ''] } }] } }, { $group: { _id: { $ifNull: ['$transactionId', '$paymentId'] }, amount: { $sum: { $ifNull: ['$paidAmount', '$amount'] } }, date: { $max: '$paidDate' }, loanId: { $first: '$loanId' }, gateway: { $first: '$paymentGateway' } } }]);
  for (const e of emis) put(e._id, { amount: e.amount, date: e.date, loanId: String(e.loanId), source: 'instalments', gateway: e.gateway }, 3);
  const tx = await Transaction.find({ type: 'EMI_PAYMENT', status: 'COMPLETED', referenceId: { $nin: [null, ''] }, ...(window ? { createdAt: window } : {}) }).select('referenceId amount createdAt loanId paymentGateway').lean();
  for (const t of tx) put(t.referenceId, { amount: t.amount, date: t.createdAt, loanId: String(t.loanId), source: 'transactions', gateway: t.paymentGateway }, 2);
  const rec = await LoanReceipt.find({ status: 'posted', ...(window ? { valueDate: window } : {}) }).select('receiptNo reference amount valueDate loanId mode').lean();
  for (const r of rec) { put(r.reference || r.receiptNo, { amount: r.amount, date: r.valueDate, loanId: String(r.loanId), source: 'receipts', gateway: 'MANUAL', mode: r.mode }, 1); }
  return map;
}

export async function reconcile(text, { tolerance = 0.5 } = {}) {
  const file = readFile(text);
  if (file.error) return { ok: false, status: 400, error: file.error };
  if (file.lines.length > 20000) return { ok: false, status: 400, error: 'The file has too many lines (20,000 at most). Split it by month.' };
  const dates = file.lines.map(l => l.date).filter(Boolean);
  // The file's own period, and a few days either side when looking for our records (a payment is booked before the bank settles it)
  const from = dates.length ? new Date(Math.min(...dates)) : null, to = dates.length ? new Date(Math.max(...dates) + DAY) : null;
  const books = await booked(from ? new Date(from - 3 * DAY) : null, to ? new Date(+to + 3 * DAY) : null);
  const matched = [], mismatched = [], notInBooks = [], bad = [], seen = new Set(), dup = [];
  for (const l of file.lines) {
    if (!l.reference || !Number.isFinite(l.amount)) { bad.push(l); continue; }
    const k = norm(l.reference);
    if (seen.has(k)) { dup.push(l); continue; }
    seen.add(k);
    const b = books.get(k);
    if (!b) { notInBooks.push(l); continue; }
    if (Math.abs(b.amount - l.amount) <= tolerance) matched.push({ ...l, loanId: b.loanId, booked: b.amount });
    else mismatched.push({ ...l, loanId: b.loanId, booked: b.amount, difference: round2(l.amount - b.amount) });
  }
  // What we booked in the same period that the file does not show. Money taken by hand in cash is not expected in a bank file, so it is left out.
  const notInFile = [];
  if (from) for (const [k, b] of books) if (!seen.has(k) && b.gateway !== 'MANUAL' && b.date && b.date >= from && b.date <= to) notInFile.push({ reference: b.reference, amount: b.amount, date: b.date, loanId: b.loanId });
  const sum = list => round2(list.reduce((a, x) => a + (x.amount || 0), 0));
  const cap = list => list.slice(0, 500);
  return {
    ok: true,
    summary: { lines: file.lines.length, matched: matched.length, matchedAmount: sum(matched), amountDiffers: mismatched.length, notInBooks: notInBooks.length, notInBooksAmount: sum(notInBooks), notInFile: notInFile.length, notInFileAmount: sum(notInFile), unreadable: bad.length, repeated: dup.length, from, to, comparedBooksForPeriod: !!from },
    matched: cap(matched), amountDiffers: cap(mismatched), notInBooks: cap(notInBooks), notInFile: cap(notInFile), unreadable: cap(bad), repeated: cap(dup),
    note: file.hasDates ? undefined : 'The file has no date column, so what we booked that the bank does not show could not be worked out.',
  };
}

export default { reconcile, parseCsv, readFile };
