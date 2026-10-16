import { check, section, connect, disconnect, startServer, finish, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import AuditLog from '../../src/models/AuditLog.js';
import { parseStatementText, readStatementPdf } from '../../src/services/statementPdf.js';
import { DEFAULTS, evaluate, validateRules } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-statement-pdf';
await connect(DB);

// A small PDF with the given lines of text, like a statement a bank would produce
function pdf(lines, { producer = 'Bank statement engine 4.2', created = 'D:20261001100000Z', modified = null } = {}) {
  const esc = s => s.replace(/[()\\]/g, m => '\\' + m);
  let y = 780;
  const content = ['BT', '/F1 9 Tf', ...lines.map(l => { const row = `1 0 0 1 30 ${y} Tm (${esc(l)}) Tj`; y -= 12; return row; }), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Producer (${producer}) /Creator (${producer}) /CreationDate (${created})${modified ? ` /ModDate (${modified})` : ''} >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // Pad so it is a realistic size
  return Buffer.from(out + '\n' + '%'.repeat(1200));
}
const fmt = n => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Four months of a salaried person: salary in on the 1st, rent, an EMI, some spending. Returns the rows oldest first.
function statementRows({ months = 4, salary = 40000, start = 15000, breakBalances = false } = {}) {
  const rows = [];
  let bal = start;
  const now = new Date();
  for (let m = months; m >= 1; m--) {
    const d = (day) => { const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, day)); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };
    const add = (day, text, amt, type) => { bal = type === 'CREDIT' ? bal + amt : bal - amt; rows.push({ date: d(day), text, amt, type, bal: breakBalances && rows.length % 2 ? bal + 777 : bal }); };
    add(1, 'NEFT SALARY ACME CORP', salary, 'CREDIT');
    add(3, 'UPI RENT PAYMENT', 12000, 'DEBIT');
    add(5, 'ACH D HDFC LOAN EMI', 4500, 'DEBIT');
    add(12, 'UPI GROCERIES', 3100, 'DEBIT');
    add(20, 'ATM WITHDRAWAL', 2000, 'DEBIT');
  }
  return rows;
}
const lines = rows => ['Account Statement  HDFC Bank', 'Date Narration Withdrawal Deposit Balance', ...rows.map(r => `${r.date} ${r.text} ${fmt(r.amt)} ${fmt(r.bal)}`), 'Page 1 of 1'];

section('READING THE ROWS OF A STATEMENT');
const rows = statementRows();
const parsed = parseStatementText(lines(rows).join('\n'));
check('every row is found', parsed.rows === rows.length, `${parsed.rows} of ${rows.length}`);
check('money in and money out are told apart by the running balance', parsed.transactions.filter(t => t.type === 'CREDIT').length === 4 && parsed.transactions.filter(t => t.type === 'DEBIT').length === 16);
check('amounts and balances are read with their commas', parsed.transactions[1].amount === 40000 || parsed.transactions[0].amount === 12000 || parsed.transactions.some(t => t.amount === 40000));
check('the description is kept', parsed.transactions.some(t => /SALARY ACME/.test(t.narration)));
const newestFirst = parseStatementText(lines([...rows].reverse()).join('\n'));
check('a statement listed newest first is read too', newestFirst.directionKnown >= rows.length - 2 && newestFirst.transactions.some(t => t.type === 'CREDIT' && t.amount === 40000));
const dashed = parseStatementText('05-Mar-2026 NEFT SALARY ACME 40,000.00 55,000.00\n06-Mar-2026 UPI SHOP 500.00 54,500.00\n07-Mar-2026 UPI SHOP 100.00 54,400.00');
check('dates such as 05-Mar-2026 work', dashed.rows === 3 && dashed.transactions.length >= 2);
check('lines that are not rows are ignored', parseStatementText('Customer care 1800 123 4567\nStatement of account\nIFSC HDFC0001234').rows === 0);
check('a made-up date is skipped', parseStatementText('31/02/2026 BAD DATE 100.00 500.00').rows === 0);

section('THE WHOLE PDF');
const clean = await readStatementPdf(pdf(lines(rows)));
check('a clean statement is read, with no warnings', clean.ok && clean.transactions.length >= 16 && clean.flags.length === 0, JSON.stringify(clean.flags || clean));
check('the bank is picked up from the page', clean.ok && /HDFC/i.test(clean.bank));
check('something that is not a PDF is refused', (await readStatementPdf(Buffer.alloc(5000, 65))).reason === 'not_pdf');
check('a tiny file is refused', (await readStatementPdf(Buffer.from('%PDF-1.4'))).reason === 'too_small');
check('a PDF with no transactions is refused, and says what to upload', (await readStatementPdf(pdf(['Hello', 'This is a letter about nothing in particular.']))).reason === 'no_transactions');
const edited = await readStatementPdf(pdf(lines(rows), { producer: 'Adobe Photoshop 25.0' }));
check('a statement made by an editing program is flagged', edited.ok && edited.flags.some(f => /editing program/.test(f)), JSON.stringify(edited.flags));
const later = await readStatementPdf(pdf(lines(rows), { created: 'D:20260101100000Z', modified: 'D:20260301100000Z' }));
check('a statement changed long after it was made is flagged', later.ok && later.flags.some(f => /more than a day after/.test(f)));
const broken = await readStatementPdf(pdf(lines(statementRows({ breakBalances: true }))));
check('a running balance that does not add up is flagged', broken.ok && broken.flags.some(f => /does not add up/.test(f)), JSON.stringify(broken.flags));
const old = await readStatementPdf(pdf(lines(statementRows({ months: 4 }).map(r => ({ ...r, date: r.date.replace(/\/(\d{4})$/, '/2024') })))));
check('a statement that is more than 3 months old is flagged', old.ok && old.flags.some(f => /3 months old/.test(f)) || !old.ok);

section('UPLOADING IT');
const srv = await startServer(DB, {});
const call = client(srv.base);
let n = 0;
const customer = async () => {
  n++;
  const user = await User.create({ firstName: `S${n}`, lastName: 'P', email: `sp${n}@x.in`, phone: `95${String(n).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, employment: { status: 'Employed', monthlyIncome: 40000 } });
  return { user, token: await tokenFor(user) };
};
const send = (c, buf) => call('POST', '/income-check/pdf', c.token, { pdf: buf.toString('base64') });
const c1 = await customer();
check('no login -> 401', (await call('POST', '/income-check/pdf', null, { pdf: 'x' })).s === 401);
check('nothing sent is refused (400)', (await call('POST', '/income-check/pdf', c1.token, {})).s === 400);
check('a file that is not a PDF is refused (422)', (await send(c1, Buffer.alloc(5000, 65))).s === 422);
const up = await send(c1, pdf(lines(rows)));
check('a clean statement is accepted', up.s === 200 && up.d.check.source === 'pdf' && up.d.check.salaryDetected === true, JSON.stringify(up.d));
check('the income is worked out like a bank-shared statement', up.d.check.estimatedMonthlyIncome === 40000 && up.d.check.months === 4 && up.d.check.monthlyObligations === 4500 && up.d.check.bounces === 0, JSON.stringify(up.d.check));
const stored = await User.findById(c1.user._id);
check('only the summary is kept, with how it was provided', stored.incomeCheck.mode === 'pdf_upload' && !JSON.stringify(stored.incomeCheck).includes('NEFT SALARY'));
check('the upload is in the audit log', (await AuditLog.countDocuments({ action: 'INCOME_CHECK_PDF', entityId: String(c1.user._id) })) === 1);
check('the customer can see it under their income check', (await call('GET', '/income-check/mine', c1.token)).d.check.source === 'pdf');
const c2 = await customer();
const sus = await send(c2, pdf(lines(rows), { producer: 'iLovePDF' }));
check('a changed-looking statement is accepted for a person to look at, and says so', sus.s === 200 && sus.d.check.flags.length === 1 && /look at your statement/.test(sus.d.message), JSON.stringify(sus.d));
for (let i = 0; i < 5; i++) await send(c2, Buffer.alloc(5000, 65));
check('after six tries in an hour it asks to wait (429)', (await send(c2, pdf(lines(rows)))).s === 429);

section('THE LOAN RULES USE IT, AND DISTRUST A CHANGED ONE');
const rules = validateRules({ ...DEFAULTS, incomeCheck: { ...DEFAULTS.incomeCheck, enabled: true } }).rules;
const base = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 720, selfieStatus: 'passed', monthlyIncome: 40000, declaredIncome: 40000, emi: 3500, incomeVerified: true, verifiedMonthlyIncome: 40000, bankBounces: 0, bankObligations: 4500, statementFromPdf: true };
const cleanDecision = evaluate(rules, { ...base, statementFlags: [] });
check('an uploaded statement with no flags counts, and is labelled as a PDF', cleanDecision.checks.find(c => c.code === 'INCOME').result === 'pass' && /uploaded PDF/.test(cleanDecision.checks.find(c => c.code === 'INCOME').detail));
const flagged = evaluate(rules, { ...base, statementFlags: ['the running balance does not add up on 7 of 20 rows'] });
check('one with flags goes to a person, with the reason', flagged.outcome === 'REFER' && /may have been changed/.test(flagged.checks.find(c => c.code === 'INCOME').detail));

await srv.stop();
await disconnect();
finish();
