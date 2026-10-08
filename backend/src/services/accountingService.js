import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import ReferralReward from '../models/ReferralReward.js';
import LoyaltyAward from '../models/LoyaltyAward.js';
import { getConfig, setConfig } from './configService.js';
import { STATES } from './chargesEngine.js';
import { toCsv } from './regulatoryService.js';

// Books for the accounts team: vouchers for loans paid out, EMIs received, loans closed early or settled, and write-offs, as a
// CSV and as a Tally import file; the GST on fees; and payments made to individuals with any tax deducted.
//
// The ledger names are the company's own and are set on the Accounting page. How each item is booked (what is income, what
// is GST, what is passed on to an insurer) is a starting layout for the company's accountant to check: the accountant, not this
// software, decides the treatment. Dates are India dates.

const IST = 5.5 * 36e5;
export const LEDGER_DEFAULTS = {
  bank: 'Bank Account', loans: 'Loans and Advances', interest: 'Interest Income', fee: 'Processing and Other Fee Income', lateFee: 'Late Fee Income',
  gstOutput: 'GST Output', passThrough: 'Insurance and Stamp Duty Payable', closureIncome: 'Foreclosure Fee Income', writeOff: 'Bad Debts Written Off', settlementLoss: 'Settlement Waiver',
};
export const DEFAULTS = {
  ledgers: LEDGER_DEFAULTS,
  companyState: '',
  tds: { referral: 0, loyalty: 0, partner: 2 }, // percent. Whether any tax applies is for the company's tax adviser to confirm.
};
const clone = o => JSON.parse(JSON.stringify(o));

export function getSettings() {
  try {
    const saved = JSON.parse(getConfig('ACCOUNTING_SETTINGS', '') || '{}');
    return { ledgers: { ...LEDGER_DEFAULTS, ...(saved.ledgers || {}) }, companyState: saved.companyState || getConfig('COMPANY_STATE', ''), tds: { ...DEFAULTS.tds, ...(saved.tds || {}) } };
  } catch (e) {
    return clone(DEFAULTS);
  }
}

export function validateSettings(input) {
  const errors = [];
  const out = { ledgers: {}, tds: {}, companyState: String(input?.companyState ?? '').trim() };
  for (const k of Object.keys(LEDGER_DEFAULTS)) {
    const v = String(input?.ledgers?.[k] ?? LEDGER_DEFAULTS[k]).trim();
    if (!v || v.length > 80 || /[<>&"]/.test(v)) errors.push(`The ledger name for "${k}" must be 1 to 80 characters and cannot contain < > & or quotes`);
    out.ledgers[k] = v;
  }
  if (out.companyState && !STATES.includes(out.companyState)) errors.push('Choose the company\'s state from the list');
  for (const k of Object.keys(DEFAULTS.tds)) {
    const n = Number(input?.tds?.[k] ?? DEFAULTS.tds[k]);
    if (!Number.isFinite(n) || n < 0 || n > 30) errors.push(`The tax percentage for ${k} must be between 0 and 30`);
    out.tds[k] = n;
  }
  return { errors, settings: out };
}

export async function saveSettings(input, by) {
  const { errors, settings } = validateSettings(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('ACCOUNTING_SETTINGS', JSON.stringify(settings), { group: 'app', updatedBy: by });
  return { ok: true, settings };
}

const istDate = d => new Date(+new Date(d) + IST).toISOString().slice(0, 10);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const PASS_THROUGH = /insurance|accident|wellness|stamp/i;

export function period(from, to) {
  const now = new Date();
  const start = from ? new Date(`${from}T00:00:00+05:30`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) - IST);
  const end = to ? new Date(`${to}T23:59:59.999+05:30`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST - 1);
  return { start, end };
}

// ── The entries ────────────────────────────────────────────────────────────────────────────────
// Each voucher: { date, type, number, narration, loanId, customer, lines: [{ ledger, debit, credit }] } that balances.
export async function vouchers({ from, to } = {}) {
  const { start, end } = period(from, to);
  const L = getSettings().ledgers;
  const out = [];

  const loans = await Loan.find({ $or: [{ disbursementDate: { $gte: start, $lte: end } }, { closedAt: { $gte: start, $lte: end } }, { writtenOffAt: { $gte: start, $lte: end } }] }).lean();
  const users = Object.fromEntries((await User.find({ _id: { $in: loans.map(l => l.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  const who = l => users[String(l.userId)] || '';
  const tag = id => String(id).slice(-6).toUpperCase();

  for (const l of loans.filter(x => x.disbursementDate && x.disbursementDate >= start && x.disbursementDate <= end)) {
    const k = l.kfs || {};
    const charges = Array.isArray(k.charges) && k.charges.length ? k.charges : (k.processingFee != null ? [{ name: 'Processing fee', charge: k.processingFee, gst: k.gst || 0, total: (k.processingFee || 0) + (k.gst || 0) }] : []);
    const pass = charges.filter(c => PASS_THROUGH.test(c.name)).reduce((a, c) => a + c.total, 0);
    const fee = charges.filter(c => !PASS_THROUGH.test(c.name)).reduce((a, c) => a + c.charge, 0);
    const gst = charges.filter(c => !PASS_THROUGH.test(c.name)).reduce((a, c) => a + c.gst, 0);
    const net = r2(l.disbursalDetails?.disbursedAmount ?? (l.loanAmount - pass - fee - gst));
    const lines = [{ ledger: L.loans, debit: r2(l.loanAmount), credit: 0 }, { ledger: L.bank, debit: 0, credit: net }];
    if (fee) lines.push({ ledger: L.fee, debit: 0, credit: r2(fee) });
    if (gst) lines.push({ ledger: L.gstOutput, debit: 0, credit: r2(gst) });
    if (pass) lines.push({ ledger: L.passThrough, debit: 0, credit: r2(pass) });
    const credits = lines.reduce((a, x) => a + x.credit, 0);
    if (Math.abs(credits - l.loanAmount) > 0.5) lines.push({ ledger: L.fee, debit: 0, credit: r2(l.loanAmount - credits) }); // anything unexplained goes to fee income, so the voucher balances
    out.push({ date: istDate(l.disbursementDate), type: 'Journal', number: `DISB-${tag(l._id)}`, narration: `Loan paid out to ${who(l)}`, loanId: String(l._id), customer: who(l), lines });
  }

  const emis = await EMIPayment.find({ status: 'PAID', paidDate: { $gte: start, $lte: end }, paymentId: { $not: /^(foreclosure|settlement)/ } }).lean();
  const names2 = Object.fromEntries((await User.find({ _id: { $in: emis.map(e => e.userId) } }).select('firstName lastName').lean()).map(u => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  for (const e of emis) {
    if (/^foreclosure_/.test(String(e.paymentId || ''))) continue;
    const paid = r2(e.paidAmount ?? e.amount + (e.penaltyApplied || 0));
    const late = Math.min(r2(e.penaltyApplied || 0), paid);
    const principal = Math.min(r2(e.principalAmount ?? 0), r2(paid - late));
    const interest = r2(paid - late - principal);
    const lines = [{ ledger: L.bank, debit: paid, credit: 0 }];
    if (principal) lines.push({ ledger: L.loans, debit: 0, credit: principal });
    if (interest) lines.push({ ledger: L.interest, debit: 0, credit: interest });
    if (late) lines.push({ ledger: L.lateFee, debit: 0, credit: late });
    out.push({ date: istDate(e.paidDate), type: 'Receipt', number: `EMI-${tag(e.loanId)}-${e.emiNumber}`, narration: `EMI ${e.emiNumber} received from ${names2[String(e.userId)] || ''}`, loanId: String(e.loanId), customer: names2[String(e.userId)] || '', lines });
  }

  // Loans closed early or settled: the money received against the loan
  for (const l of loans.filter(x => x.status === 'closed' && x.closedAt >= start && x.closedAt <= end && ['foreclosure', 'settlement'].includes(x.closureType))) {
    const txn = await Transaction.findOne({ loanId: l._id, type: 'EMI_PAYMENT', status: 'COMPLETED', 'metadata.completedAt': { $exists: true } }).sort({ createdAt: -1 }).lean();
    const received = r2(txn?.amount ?? 0);
    if (!received) continue;
    const lines = [{ ledger: L.bank, debit: received, credit: 0 }];
    if (l.closureType === 'foreclosure') {
      const f = l.foreclosure || {};
      const fee = r2(f.fee || 0), interest = r2(f.accruedInterest || 0);
      const overdue = r2(received - (f.principal || 0) - interest - fee);
      if (f.principal) lines.push({ ledger: L.loans, debit: 0, credit: r2(f.principal) });
      if (interest) lines.push({ ledger: L.interest, debit: 0, credit: interest });
      if (fee) lines.push({ ledger: L.closureIncome, debit: 0, credit: fee });
      if (overdue > 0.5) lines.push({ ledger: L.interest, debit: 0, credit: overdue });
    } else {
      lines.push({ ledger: L.loans, debit: 0, credit: received });
    }
    out.push({ date: istDate(l.closedAt), type: 'Receipt', number: `CLOSE-${tag(l._id)}`, narration: `Loan ${l.closureType === 'settlement' ? 'settled' : 'closed early'} by ${who(l)}`, loanId: String(l._id), customer: who(l), lines });
  }

  for (const l of loans.filter(x => x.status === 'written_off' && x.writtenOffAt >= start && x.writtenOffAt <= end)) {
    const amt = r2(l.writtenOffAmount || 0);
    if (amt) out.push({ date: istDate(l.writtenOffAt), type: 'Journal', number: `WO-${tag(l._id)}`, narration: `Loan written off: ${who(l)}`, loanId: String(l._id), customer: who(l), lines: [{ ledger: L.writeOff, debit: amt, credit: 0 }, { ledger: L.loans, debit: 0, credit: amt }] });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export function vouchersCsv(list) {
  const header = ['Date', 'Voucher type', 'Voucher number', 'Ledger', 'Debit', 'Credit', 'Narration', 'Loan', 'Customer'];
  const rows = [];
  for (const v of list) for (const l of v.lines) rows.push([v.date, v.type, v.number, l.ledger, l.debit || '', l.credit || '', v.narration, v.loanId, v.customer]);
  return toCsv(header, rows);
}

const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
// Tally import file: a debit has a negative amount and ISDEEMEDPOSITIVE Yes; a credit is positive
export function tallyXml(list) {
  const msgs = list.map(v => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${xml(v.type)}" ACTION="Create"><DATE>${v.date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>${xml(v.type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(v.number)}</VOUCHERNUMBER><NARRATION>${xml(v.narration)}</NARRATION>${v.lines.map(l => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${l.debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${l.debit ? -l.debit : l.credit}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('')}</VOUCHER></TALLYMESSAGE>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${msgs}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

// ── GST on fees ────────────────────────────────────────────────────────────────────────────────
export async function gstReport({ from, to } = {}) {
  const { start, end } = period(from, to);
  const home = getSettings().companyState;
  const loans = await Loan.find({ disbursementDate: { $gte: start, $lte: end } }).select('kfs loanAmount disbursementDate').lean();
  const rows = new Map();
  for (const l of loans) {
    const k = l.kfs || {};
    const charges = Array.isArray(k.charges) && k.charges.length ? k.charges : (k.processingFee != null ? [{ name: 'Processing fee', charge: k.processingFee, gst: k.gst || 0, gstMode: 'extra' }] : []);
    const state = k.chargeState || 'Not known';
    const r = rows.get(state) || { state, loans: 0, taxable: 0, gst: 0, cgst: 0, sgst: 0, igst: 0 };
    r.loans++;
    for (const c of charges.filter(x => !PASS_THROUGH.test(x.name))) {
      r.taxable += c.charge; r.gst += c.gst;
      if (!home) continue;
      if (state === home) { r.cgst += c.gst / 2; r.sgst += c.gst / 2; } else r.igst += c.gst;
    }
    rows.set(state, r);
  }
  const list = [...rows.values()].map(r => ({ ...r, taxable: r2(r.taxable), gst: r2(r.gst), cgst: r2(r.cgst), sgst: r2(r.sgst), igst: r2(r.igst) })).sort((a, b) => b.gst - a.gst);
  return { companyState: home, rows: list, totals: { loans: list.reduce((a, r) => a + r.loans, 0), taxable: r2(list.reduce((a, r) => a + r.taxable, 0)), gst: r2(list.reduce((a, r) => a + r.gst, 0)), cgst: r2(list.reduce((a, r) => a + r.cgst, 0)), sgst: r2(list.reduce((a, r) => a + r.sgst, 0)), igst: r2(list.reduce((a, r) => a + r.igst, 0)) } };
}

export async function gstCsv(opts) {
  const g = await gstReport(opts);
  return toCsv(['Customer state (place of supply)', 'Loans', 'Taxable value', 'GST', 'CGST', 'SGST', 'IGST'], [...g.rows.map(r => [r.state, r.loans, r.taxable, r.gst, r.cgst, r.sgst, r.igst]), ['TOTAL', g.totals.loans, g.totals.taxable, g.totals.gst, g.totals.cgst, g.totals.sgst, g.totals.igst]]);
}

// ── Payments to individuals, with tax deducted ──────────────────────────────────────────────────
export async function paymentsToIndividuals({ from, to } = {}) {
  const { start, end } = period(from, to);
  const t = getSettings().tds;
  const rows = [];
  const refs = await ReferralReward.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).lean();
  const loy = await LoyaltyAward.find({ status: 'paid', paidAt: { $gte: start, $lte: end }, cashback: { $gt: 0 } }).lean();
  const users = Object.fromEntries((await User.find({ _id: { $in: [...refs.map(r => r.userId), ...loy.map(r => r.userId)] } }).select('firstName lastName panNumber').lean()).map(u => [String(u._id), u]));
  const add = (kind, rate, userId, amount, paidAt, reference) => {
    const u = users[String(userId)] || {};
    const tds = r2((amount * rate) / 100);
    rows.push({ kind, date: istDate(paidAt), name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), pan: u.panNumber || '', amount: r2(amount), rate, tds, net: r2(amount - tds), reference: reference || '' });
  };
  for (const r of refs) add('Referral reward', t.referral, r.userId, r.amount, r.paidAt, r.reference);
  for (const r of loy) add('On-time reward', t.loyalty, r.userId, r.cashback, r.paidAt, r.paidReference);
  try {
    const { partnerPayouts } = await import('./partnerService.js');
    for (const p of await partnerPayouts(start, end)) rows.push({ kind: 'Partner commission', date: istDate(p.paidAt), name: p.name, pan: p.pan, amount: r2(p.gross), rate: p.tdsPercent, tds: r2(p.tds), net: r2(p.net), reference: p.reference || '' });
  } catch (e) { /* partners are optional */ }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function tdsCsv(opts) {
  const rows = await paymentsToIndividuals(opts);
  return toCsv(['Date', 'Kind', 'Name', 'PAN', 'Amount paid', 'Tax rate %', 'Tax deducted', 'Net paid', 'Reference'], rows.map(r => [r.date, r.kind, r.name, r.pan, r.amount, r.rate, r.tds, r.net, r.reference]));
}

export async function summary(opts) {
  const v = await vouchers(opts);
  const g = await gstReport(opts);
  const p = await paymentsToIndividuals(opts);
  const L = getSettings().ledgers;
  const disbursed = r2(v.filter(x => x.number.startsWith('DISB-')).reduce((a, x) => a + x.lines.filter(l => l.ledger === L.loans).reduce((s, l) => s + l.debit, 0), 0));
  const received = r2(v.filter(x => x.type === 'Receipt').reduce((a, x) => a + x.lines.filter(l => l.ledger === L.bank).reduce((s, l) => s + l.debit, 0), 0));
  const byType = {};
  for (const x of v) { const k = x.number.split('-')[0]; byType[k] = (byType[k] || 0) + 1; }
  return { vouchers: v.length, byType, disbursed, received, gst: g.totals, payments: { count: p.length, amount: r2(p.reduce((a, x) => a + x.amount, 0)), tds: r2(p.reduce((a, x) => a + x.tds, 0)) } };
}

export default { getSettings, saveSettings, validateSettings, vouchers, vouchersCsv, tallyXml, gstReport, gstCsv, paymentsToIndividuals, tdsCsv, summary, period };
