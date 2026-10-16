import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// Reads a bank statement PDF the customer uploads, without any outside service, and turns it into a list of
// transactions for the same income analysis the Account Aggregator route uses.
//
// Banks lay their statements out differently, so this reads the common shape: a date, a description, then amounts and a
// running balance. Whether a row is money in or out is worked out from the balance (it went up, or it went down), which is
// more reliable than the column it sits in. It also looks for signs the PDF was changed after the bank made it:
// the program that made it, a later edit date, and a running balance that does not add up.
//
// An uploaded PDF is weaker proof than the Account Aggregator, so anything suspicious is passed on as a flag for a person.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// A date at the start of a row: 05/03/2026, 05-03-26, 05 Mar 2026, 05-Mar-2026
const DATE_AT_START = /^\s*(\d{1,2})[\/\-. ]\s*(\d{1,2}|[A-Za-z]{3})[\/\-. ]\s*(\d{2,4})\b/;
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:,\d{2,3})*|\d+)\.\d{2}(?!\d)(\s*(?:Cr|Dr|CR|DR))?/g;
const EDITORS = /photoshop|illustrator|canva|microsoft.*word|microsoft.*excel|libreoffice|openoffice|ilovepdf|smallpdf|sejda|pdfescape|pdf-?xchange|nitro|foxit.*(edit|phantom)|wps|pdffiller|pdfsam|inkscape|gimp|affinity|acrobat pro.*edit/i;

const IN_WORDS = /salary|\bcr\b|credit|deposit|refund|interest|\bby\b|received|reversal|cashback/i;
const OUT_WORDS = /\bdr\b|debit|withdraw|\batm\b|\bupi\b|\bpos\b|\bemi\b|\bach\b|\bnach\b|charges|purchase|\bto\b|paid|payment|\bchq\b|cheque/i;

function toDate(d, m, y) {
  let month = /^\d+$/.test(m) ? Number(m) - 1 : MONTHS[String(m).toLowerCase()];
  let year = Number(y);
  if (year < 100) year += 2000;
  const day = Number(d);
  if (month === undefined || !(month >= 0 && month <= 11) || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month ? date : null;
}
const num = s => Number(String(s).replace(/,/g, ''));

// Splits the text into rows: a line that starts with a date begins a new row; lines under it are more of the description.
function rowsOf(text) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (DATE_AT_START.test(line)) rows.push(line);
    else if (rows.length && !/^(page|opening|closing|statement|account|total|balance brought|date\b)/i.test(line) && rows[rows.length - 1].length < 400) rows[rows.length - 1] += ' ' + line;
  }
  return rows;
}

// Turns the text of a statement into { transactions, rows, directionKnown, breaks }
export function parseStatementText(text) {
  const parsed = [];
  for (const row of rowsOf(text)) {
    const m = row.match(DATE_AT_START);
    const date = toDate(m[1], m[2], m[3]);
    if (!date) continue;
    const rest = row.slice(m[0].length);
    // A second date (value date) right after the first is not part of the description
    const body = rest.replace(DATE_AT_START, '');
    const amounts = [...body.matchAll(AMOUNT)].map(a => ({ v: num(a[0].replace(/\s*(Cr|Dr)$/i, '')), mark: (a[2] || '').trim().toLowerCase(), at: a.index }));
    if (amounts.length < 2) continue;
    const balance = amounts[amounts.length - 1];
    const moved = amounts.slice(0, -1).filter(a => a.v > 0);
    if (moved.length !== 1) continue; // two non-zero amounts, or none: cannot tell which is the transaction
    const narration = body.slice(0, moved[0].at).replace(/[\s|]+$/, '').trim();
    parsed.push({ date, amount: moved[0].v, balance: balance.v, narration: narration.slice(0, 200), hint: moved[0].mark || (balance.mark === 'dr' ? '' : '') });
  }
  if (!parsed.length) return { transactions: [], rows: 0, directionKnown: 0, breaks: 0 };

  // Statements may run oldest to newest, or the other way round. Pick the order in which the balances make sense.
  const score = list => { let ok = 0; for (let i = 1; i < list.length; i++) { const d = Math.round((list[i].balance - list[i - 1].balance) * 100) / 100; if (Math.abs(Math.abs(d) - list[i].amount) < 0.011) ok++; } return ok; };
  const ordered = score(parsed) >= score([...parsed].reverse()) ? parsed : [...parsed].reverse();

  const transactions = [];
  let directionKnown = 0, breaks = 0;
  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i];
    let type = null;
    if (i > 0) {
      const d = Math.round((t.balance - ordered[i - 1].balance) * 100) / 100;
      if (Math.abs(d - t.amount) < 0.011) type = 'CREDIT';
      else if (Math.abs(d + t.amount) < 0.011) type = 'DEBIT';
      else breaks++;
    }
    // No usable balance to go by (the first row, or a row whose balance does not fit): use a Cr/Dr mark, then the wording
    if (!type && t.hint) type = t.hint === 'cr' ? 'CREDIT' : t.hint === 'dr' ? 'DEBIT' : null;
    if (!type) type = IN_WORDS.test(t.narration) ? 'CREDIT' : OUT_WORDS.test(t.narration) ? 'DEBIT' : null;
    if (type) { directionKnown++; transactions.push({ date: t.date.toISOString().slice(0, 10), amount: t.amount, type, narration: t.narration, balance: t.balance }); }
  }
  return { transactions, rows: ordered.length, directionKnown, breaks };
}

// The whole check. Returns { ok: true, transactions, bank, flags } or { ok: false, reason, message }.
export async function readStatementPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1000) return { ok: false, reason: 'too_small', message: 'This file is too small to be a bank statement.' };
  if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') return { ok: false, reason: 'not_pdf', message: 'Please upload the statement as a PDF file.' };
  let data;
  try {
    // A fresh copy: the PDF reader looks at the whole memory block behind a Buffer, which can be shared with other data
    data = await pdfParse(Uint8Array.from(buffer), { max: 60 });
  } catch (e) {
    const locked = /password/i.test(e.message || '') || /Encrypt/i.test(e.message || '');
    return { ok: false, reason: locked ? 'locked' : 'unreadable', message: locked ? 'This PDF is password protected. Please download it again without a password, or share your statements through the bank link instead.' : 'We could not read this PDF. Please download the statement again from your bank.' };
  }
  const parsed = parseStatementText(data.text);
  if (parsed.transactions.length < 5) return { ok: false, reason: 'no_transactions', message: 'We could not find a list of transactions in this PDF. Please upload the full account statement from your bank, not a screenshot or a summary.' };

  const flags = [];
  const info = data.info || {};
  const maker = `${info.Producer || ''} ${info.Creator || ''}`.trim();
  if (EDITORS.test(maker)) flags.push(`made or saved with an editing program (${maker.slice(0, 60)}), not by a bank`);
  const created = Date.parse(String(info.CreationDate || '').replace(/^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?.*/, (m, y, mo, d, h = '00', mi = '00', s = '00') => `${y}-${mo}-${d}T${h}:${mi}:${s}Z`));
  const modified = Date.parse(String(info.ModDate || '').replace(/^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?.*/, (m, y, mo, d, h = '00', mi = '00', s = '00') => `${y}-${mo}-${d}T${h}:${mi}:${s}Z`));
  if (Number.isFinite(created) && Number.isFinite(modified) && modified - created > 36e5 * 24) flags.push('changed more than a day after it was created');
  if (parsed.breaks / Math.max(1, parsed.rows - 1) > 0.1) flags.push(`the running balance does not add up on ${parsed.breaks} of ${parsed.rows} rows`);
  const days = parsed.transactions.map(t => Date.parse(t.date));
  if (Date.now() - Math.max(...days) > 100 * 864e5) flags.push('the latest entry is more than 3 months old');
  return { ok: true, transactions: parsed.transactions, rows: parsed.rows, flags, bank: (data.text.match(/\b(HDFC|ICICI|State Bank of India|SBI|Axis|Kotak|Punjab National|PNB|Bank of Baroda|Canara|Union Bank|IDFC|Yes Bank|IndusInd|Federal Bank|Bandhan|RBL|IDBI)\b[^\n]{0,20}/i) || [''])[0].replace(/\s+/g, ' ').trim().slice(0, 40) };
}

export default { readStatementPdf, parseStatementText };
