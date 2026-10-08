import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import Partner from '../../src/models/Partner.js';
import PartnerLead from '../../src/models/PartnerLead.js';
import PartnerCommission from '../../src/models/PartnerCommission.js';
import { paymentsToIndividuals } from '../../src/services/accountingService.js';

const DB = 'fintech-test-partners';
await connect(DB);
await Role.create([{ key: 'refviewer', label: 'Viewer', description: 't', permissions: ['referrals.view'] }]);
const srv = await startServer(DB, { REQUIRE_LOAN_AGREEMENT: 'false', REQUIRE_KYC_FOR_APPROVAL: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const viewer = await tokenFor(await User.create({ firstName: 'V', lastName: 'W', email: 'pv@lifc.in', phone: '9600000099', password: 'x12345678', role: 'refviewer', twoFactorEnabled: true }), true);

section('ADDING A PARTNER');
check('a viewer cannot add one (403)', (await call('POST', '/admin/partners', viewer, { name: 'A', email: 'a@x.in', commissionPercent: 1 })).s === 403);
check('a missing name or a silly commission is refused (400)', (await call('POST', '/admin/partners', admin, { name: '', email: 'a@x.in', commissionPercent: 1 })).s === 400 && (await call('POST', '/admin/partners', admin, { name: 'A', email: 'a@x.in', commissionPercent: 50 })).s === 400);
const made = await call('POST', '/admin/partners', admin, { name: 'Ravi Agency', email: 'ravi@agency.in', phone: '9876543210', panNumber: 'abcde1234f', commissionPercent: 1 });
check('it is added, with a code and a one-time password', made.s === 201 && /^AGT[A-Z2-9]{6}$/.test(made.d.partner.code) && made.d.temporaryPassword.length >= 10, JSON.stringify(made.d));
check('the password is stored only as a hash', !(JSON.stringify(await Partner.findOne({ email: 'ravi@agency.in' }).select('+passwordHash').lean())).includes(made.d.temporaryPassword));
check('the same email twice is refused (409)', (await call('POST', '/admin/partners', admin, { name: 'Ravi 2', email: 'ravi@agency.in', commissionPercent: 1 })).s === 409);
const code = made.d.partner.code, temp = made.d.temporaryPassword;

section('THE PARTNER SIGNS IN');
check('a wrong password is refused (400)', (await call('POST', '/partner/login', null, { email: 'ravi@agency.in', password: 'wrong-password' })).s === 400);
const li = await call('POST', '/partner/login', null, { email: 'ravi@agency.in', password: temp });
check('the right one signs in, and must be changed first', li.s === 200 && !!li.d.token && li.d.mustChangePassword === true);
const ptok = li.d.token;
check('a partner token is not a customer or staff login (401/403)', [401, 403].includes((await call('GET', '/admin/partners', ptok)).s) && [401, 403].includes((await call('GET', '/loans', ptok)).s));
check('a staff token does not open the partner page (401)', (await call('GET', '/partner/me', admin)).s === 401);
check('a short new password is refused (400)', (await call('POST', '/partner/change-password', ptok, { current: temp, next: 'short' })).s === 400);
check('a wrong current password is refused (400)', (await call('POST', '/partner/change-password', ptok, { current: 'nope', next: 'a-long-new-password' })).s === 400);
check('the password is changed', (await call('POST', '/partner/change-password', ptok, { current: temp, next: 'a-long-new-password' })).s === 200);
check('the old session ends', (await call('GET', '/partner/me', ptok)).s === 401);
const ptok2 = (await call('POST', '/partner/login', null, { email: 'ravi@agency.in', password: 'a-long-new-password' })).d.token;
check('signing in with the new password works, and nothing more is forced', (await call('GET', '/partner/me', ptok2)).d.profile.mustChangePassword === false);
for (let i = 0; i < 5; i++) await call('POST', '/partner/login', null, { email: 'ghost@x.in', password: 'bad-password-1' });
check('repeated wrong guesses lock the email (429)', (await call('POST', '/partner/login', null, { email: 'ghost@x.in', password: 'bad-password-1' })).s === 429);

section('CUSTOMERS SIGN UP WITH THE CODE');
const signup = (n, extra = {}) => call('POST', '/auth/signup', null, { firstName: `Cust${n}`, lastName: 'Lead', email: `lead${n}@x.in`, phone: `98700000${String(n).padStart(2, '0')}`, password: 'password123', confirmPassword: 'password123', ...extra });
check('a made-up agent code is refused (400)', (await signup(1, { referralCode: 'AGTZZZZZZ' })).s === 400);
const s2 = await signup(2, { referralCode: ` ${code.toLowerCase()} ` });
check('a good code (spaces and capitals do not matter) links the customer', s2.s === 201 && (await PartnerLead.countDocuments()) === 1);
const lead = await User.findOne({ email: 'lead2@x.in' });
check('the customer is recorded as coming from the partner', lead.acquisition.source === 'partner' && lead.acquisition.campaign === code);
await signup(3, { referralCode: code });
const me = await call('GET', '/partner/me', ptok2);
check('the partner sees two customers, with shortened names and hidden phones', me.d.counts.customers === 2 && me.d.leads.every(l => /^Cust\d L\.$/.test(l.name) && /X/.test(l.phone)) && me.d.leads[0].stage === 'signed_up', JSON.stringify(me.d.leads));
check('no contact details leak', !JSON.stringify(me.d).includes('lead2@x.in') && !JSON.stringify(me.d).includes('9870000002'));

section('COMMISSION ON THE FIRST LOAN');
const apply = async (u, amount) => {
  const loan = await Loan.create({ userId: u._id, loanAmount: amount, tenure: 3, interestRate: 15, monthlyEMI: amount / 3 + 300, status: 'approved', approvalDate: new Date(), disbursalDetails: { disbursedAmount: amount } });
  await User.updateOne({ _id: u._id }, { kycStatus: 'approved', bankAccount: { accountNumber: '123456789012', ifscCode: 'SBIN0001234', accountHolder: 'X Y' } });
  const r = await call('POST', `/admin/loans/${loan._id}/disburse`, admin, {});
  return { loan, r };
};
const first = await apply(lead, 30000);
check('paying out the loan earns the partner 1%', first.r.s === 200 && (await PartnerCommission.findOne({ loanId: first.loan._id })).gross === 300, JSON.stringify(first.r.d));
const second = await apply(lead, 20000);
check('a second loan from the same customer earns nothing more', second.r.s === 200 && (await PartnerCommission.countDocuments({ userId: lead._id })) === 1);
const m2 = await call('GET', '/partner/me', ptok2);
check('the partner sees the commission and the customer\'s progress', m2.d.money.due === 300 && m2.d.counts.disbursed === 1 && m2.d.leads.find(l => l.name === 'Cust2 L.').stage === 'disbursed');

section('PAYING AND CANCELLING');
const list = await call('GET', '/admin/partners/commissions?status=due', viewer);
check('staff see what is to be paid, with the PAN', list.s === 200 && list.d.commissions.length === 1 && list.d.commissions[0].pan === 'ABCDE1234F');
const cid = list.d.commissions[0].id;
check('a viewer cannot pay (403)', (await call('POST', `/admin/partners/commissions/${cid}/paid`, viewer, { reference: 'UTR1' })).s === 403);
check('a reference is needed (400)', (await call('POST', `/admin/partners/commissions/${cid}/paid`, admin, {})).s === 400);
const paid = await call('POST', `/admin/partners/commissions/${cid}/paid`, admin, { reference: 'UTR777' });
check('paying deducts the tax at the set rate (2%): 300 less 6 is 294', paid.s === 200 && paid.d.gross === 300 && paid.d.tds === 6 && paid.d.net === 294, JSON.stringify(paid.d));
check('it cannot be paid twice (409)', (await call('POST', `/admin/partners/commissions/${cid}/paid`, admin, { reference: 'UTR777' })).s === 409);
const pay = await paymentsToIndividuals({ from: new Date(Date.now() - 864e5).toISOString().slice(0, 10), to: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
check('the accounts team see it with the PAN and the tax', pay.some(p => p.kind === 'Partner commission' && p.pan === 'ABCDE1234F' && p.tds === 6 && p.net === 294), JSON.stringify(pay));

const l4 = await User.create({ firstName: 'Cool', lastName: 'Off', email: 'cool@x.in', phone: '9870000077', password: 'x12345678' });
const part = await Partner.findOne({ code });
await PartnerLead.create({ partnerId: part._id, userId: l4._id, code });
const cooled = await apply(l4, 12000);
const pc = await PartnerCommission.findOne({ loanId: cooled.loan._id });
check('a new commission is due', pc.status === 'due' && pc.gross === 120);
const quote = await call('GET', `/emi/cooling-off/${cooled.loan._id}`, await tokenFor(l4));
const cancel = await call('POST', `/emi/cooling-off/${cooled.loan._id}`, await tokenFor(l4), { expectedAmount: quote.d.total });
check('the customer cancels in the cooling-off period and the commission is cancelled', cancel.s === 200 && (await PartnerCommission.findById(pc._id)).status === 'void', JSON.stringify(cancel.d));
const l5 = await User.create({ firstName: 'Void', lastName: 'Me', email: 'void@x.in', phone: '9870000078', password: 'x12345678' });
await PartnerLead.create({ partnerId: part._id, userId: l5._id, code });
const v5 = await apply(l5, 10000);
const vc = await PartnerCommission.findOne({ loanId: v5.loan._id });
check('staff can cancel one, with a reason', (await call('POST', `/admin/partners/commissions/${vc._id}/void`, admin, {})).s === 400 && (await call('POST', `/admin/partners/commissions/${vc._id}/void`, admin, { reason: 'Customer was not new' })).d.status === 'void');

section('BLOCKING');
check('staff change the commission', (await call('PUT', `/admin/partners/${part._id}`, admin, { commissionPercent: 2 })).s === 200 && (await Partner.findById(part._id)).commissionPercent === 2);
check('a silly commission is refused (400)', (await call('PUT', `/admin/partners/${part._id}`, admin, { commissionPercent: 20 })).s === 400);
check('staff block the partner', (await call('PUT', `/admin/partners/${part._id}`, admin, { status: 'blocked' })).s === 200);
check('a blocked partner cannot sign in (400)', (await call('POST', '/partner/login', null, { email: 'ravi@agency.in', password: 'a-long-new-password' })).s === 400);
check('their open session ends (401)', (await call('GET', '/partner/me', ptok2)).s === 401);
check('their code no longer works for new customers (400)', (await signup(9, { referralCode: code })).s === 400);
const reset = await call('POST', `/admin/partners/${part._id}/reset-password`, admin, {});
check('staff can issue a new password (shown once)', reset.s === 200 && reset.d.temporaryPassword.length >= 10);

await disconnect();
finish();
