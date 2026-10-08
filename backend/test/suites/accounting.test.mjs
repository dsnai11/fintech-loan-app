import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import Transaction from '../../src/models/Transaction.js';
import ReferralReward from '../../src/models/ReferralReward.js';
import Referral from '../../src/models/Referral.js';
import AuditLog from '../../src/models/AuditLog.js';
import { vouchers, vouchersCsv, tallyXml, gstReport, paymentsToIndividuals, saveSettings, validateSettings } from '../../src/services/accountingService.js';

const DB = 'fintech-test-accounting';
await connect(DB);
await Role.create([{ key: 'finuser', label: 'Finance', description: 't', permissions: ['reports.view'] }, { key: 'nobody', label: 'Nobody', description: 't', permissions: ['loans.view'] }]);

const from = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
const to = new Date(Date.now() + 1 * 864e5).toISOString().slice(0, 10);
const opts = { from, to };

const u = await User.create({ firstName: 'Acc', lastName: 'Ount', email: 'acc@x.in', phone: '9100000001', password: 'x12345678', panNumber: 'ABCDE1234F' });
const u2 = await User.create({ firstName: 'Friend', lastName: 'Of', email: 'fr@x.in', phone: '9100000002', password: 'x12345678', panNumber: 'FGHIJ5678K' });

section('A LOAN PAID OUT');
const kfs = { chargeState: 'Gujarat', charges: [{ name: 'File charge', charge: 600, gst: 108, total: 708, gstMode: 'extra' }, { name: 'Group personal accident cover', charge: 1500, gst: 0, total: 1500, gstMode: 'none' }] };
const loan = await Loan.create({ userId: u._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10300, status: 'disbursed', disbursementDate: day(-10), kfs, disbursalDetails: { disbursedAmount: 30000 - 708 - 1500 } });
for (let i = 1; i <= 3; i++) await EMIPayment.create({ loanId: loan._id, userId: u._id, emiNumber: i, dueDate: day(-10 + 30 * i), amount: 10300, principalAmount: 10000, interestAmount: 300, status: i === 1 ? 'PAID' : 'PENDING', paidDate: i === 1 ? day(-2) : undefined, paidAmount: i === 1 ? 10300 + 100 : undefined, penaltyApplied: i === 1 ? 100 : 0, paymentId: i === 1 ? 'pay_1' : undefined });
const v = await vouchers(opts);
const disb = v.find(x => x.number.startsWith('DISB-'));
check('a payout voucher is made, with the fee, the GST and the insurance kept apart', !!disb && disb.lines.find(l => l.ledger === 'Loans and Advances').debit === 30000 && disb.lines.find(l => l.ledger === 'Bank Account').credit === 27792 && disb.lines.find(l => l.ledger === 'GST Output').credit === 108 && disb.lines.find(l => l.ledger === 'Insurance and Stamp Duty Payable').credit === 1500, JSON.stringify(disb));
const bal = x => Math.abs(x.lines.reduce((a, l) => a + l.debit - l.credit, 0)) < 0.01;
check('every voucher balances', v.length >= 2 && v.every(bal), JSON.stringify(v.filter(x => !bal(x))));
const rec = v.find(x => x.number.startsWith('EMI-'));
check('an EMI receipt splits into principal, interest and late fee', rec.lines.find(l => l.ledger === 'Bank Account').debit === 10400 && rec.lines.find(l => l.ledger === 'Loans and Advances').credit === 10000 && rec.lines.find(l => l.ledger === 'Interest Income').credit === 300 && rec.lines.find(l => l.ledger === 'Late Fee Income').credit === 100);
check('vouchers outside the dates are left out', (await vouchers({ from: '2020-01-01', to: '2020-01-31' })).length === 0);

section('CLOSED AND WRITTEN OFF');
const f = await Loan.create({ userId: u._id, loanAmount: 20000, tenure: 2, interestRate: 15, monthlyEMI: 10500, status: 'closed', closedAt: day(-1), closureType: 'foreclosure', foreclosure: { date: day(-1), principal: 10000, accruedInterest: 150, fee: 200, amount: 10350 }, disbursementDate: day(-60) });
await Transaction.create({ loanId: f._id, userId: u._id, type: 'EMI_PAYMENT', amount: 10350, status: 'COMPLETED', paymentGateway: 'SANDBOX', referenceId: 'FORECLOSURE', metadata: { completedAt: new Date() } });
const w = await Loan.create({ userId: u._id, loanAmount: 15000, tenure: 3, interestRate: 15, monthlyEMI: 5200, status: 'written_off', writtenOffAt: day(-3), writtenOffAmount: 9000, disbursementDate: day(-90) });
const v2 = await vouchers(opts);
const close = v2.find(x => x.number.startsWith('CLOSE-'));
check('an early closure splits into principal, interest and closing fee', close && close.lines.find(l => l.ledger === 'Loans and Advances').credit === 10000 && close.lines.find(l => l.ledger === 'Foreclosure Fee Income').credit === 200 && bal(close), JSON.stringify(close));
const wo = v2.find(x => x.number.startsWith('WO-'));
check('a write-off moves the balance to bad debts', wo && wo.lines[0].ledger === 'Bad Debts Written Off' && wo.lines[0].debit === 9000 && bal(wo));

section('FILES');
const csv = vouchersCsv(v2);
check('the CSV has a header and a line per ledger entry', csv.split('\r\n')[0].startsWith('"Date"') && csv.split('\r\n').length === 1 + v2.reduce((a, x) => a + x.lines.length, 0));
const xml = tallyXml(v2);
check('the Tally file has a voucher per entry, debits negative', xml.startsWith('<?xml') && (xml.match(/<VOUCHER /g) || []).length === v2.length && xml.includes('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-30000</AMOUNT>'));
check('names are made safe for XML', tallyXml([{ date: '2026-01-01', type: 'Journal', number: 'X', narration: 'A & B <c>', lines: [{ ledger: 'L&L', debit: 1, credit: 0 }, { ledger: 'M', debit: 0, credit: 1 }] }]).includes('A &amp; B &lt;c&gt;'));

section('GST');
check('settings need a real state', validateSettings({ companyState: 'Atlantis' }).errors.length > 0 && validateSettings({ ledgers: { bank: 'A<B' } }).errors.length > 0 && validateSettings({ tds: { partner: 90 } }).errors.length > 0);
const noState = await gstReport(opts);
check('without the company state the GST total is still right but not split', noState.totals.gst === 108 && noState.totals.cgst === 0 && noState.totals.igst === 0 && noState.rows[0].taxable === 600);
await saveSettings({ companyState: 'Maharashtra' }, 'test');
const inter = await gstReport(opts);
check('a customer in another state is charged IGST', inter.totals.igst === 108 && inter.totals.cgst === 0);
await saveSettings({ companyState: 'Gujarat' }, 'test');
const intra = await gstReport(opts);
check('a customer in the company state is charged CGST and SGST', intra.totals.cgst === 54 && intra.totals.sgst === 54 && intra.totals.igst === 0);

section('PAYMENTS TO INDIVIDUALS');
const ref = await Referral.create({ referrerId: u2._id, refereeId: u._id, code: 'LIFCTEST', status: 'rewarded' });
await ReferralReward.create({ referralId: ref._id, userId: u2._id, role: 'referrer', amount: 500, status: 'paid', paidAt: new Date(), paidBy: 'fin', reference: 'UTR9' });
await saveSettings({ companyState: 'Gujarat', tds: { referral: 10, loyalty: 0, partner: 2 } }, 'test');
const pay = await paymentsToIndividuals(opts);
check('a paid reward is listed with the PAN and the tax at the set rate', pay.length === 1 && pay[0].pan === 'FGHIJ5678K' && pay[0].tds === 50 && pay[0].net === 450 && pay[0].kind === 'Referral reward', JSON.stringify(pay));

const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = async (role, k) => tokenFor(await User.create({ firstName: role, lastName: 'S', email: `${role}@lifc.in`, phone: `9710000${k}`, password: 'x12345678', role, twoFactorEnabled: true }), true);
const fin = await staff('finuser', 1), nobody = await staff('nobody', 2);

section('STAFF');
const page = await call('GET', `/admin/accounting?from=${from}&to=${to}`, fin);
check('finance sees the summary, the GST and the payments', page.s === 200 && page.d.summary.vouchers >= 4 && page.d.gst.totals.gst === 108 && page.d.payments.length === 1 && page.d.canEdit === false, JSON.stringify(page.d.summary));
check('someone without reports access cannot (403)', (await call('GET', '/admin/accounting', nobody)).s === 403);
check('finance cannot change the settings (403)', (await call('PUT', '/admin/accounting/settings', fin, { companyState: 'Gujarat' })).s === 403);
check('the super admin can', (await call('PUT', '/admin/accounting/settings', admin, { companyState: 'Gujarat', ledgers: { bank: 'HDFC Current A/c' } })).s === 200);
check('a bad state is refused (400)', (await call('PUT', '/admin/accounting/settings', admin, { companyState: 'Nowhere' })).s === 400);
const dl = await fetch(srv.base + `/admin/accounting/export/tally?from=${from}&to=${to}`, { headers: { Authorization: 'Bearer ' + fin } });
const body = await dl.text();
check('finance downloads the Tally file with the company ledger names', dl.status === 200 && /xml/.test(dl.headers.get('content-type')) && body.includes('HDFC Current A/c'));
check('every download is in the audit log', (await AuditLog.countDocuments({ action: 'ACCOUNTING_EXPORT' })) === 1);
check('an unknown file is a 404', (await fetch(srv.base + '/admin/accounting/export/other', { headers: { Authorization: 'Bearer ' + fin } })).status === 404);

await disconnect();
finish();
