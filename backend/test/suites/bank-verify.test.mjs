import http from 'http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-bank-verify';
await connect(DB);
await Role.create([{ key: 'kycviewer', label: 'KYC viewer', description: 't', permissions: ['kyc.view'] }]);

// A stand-in for Razorpay's account validation
let validation = { status: 'completed', results: { account_status: 'active', registered_name: 'ASHA RANI' } };
const asked = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    asked.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : {} });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/contacts') return res.end(JSON.stringify({ id: 'cont_1' }));
    if (req.url === '/v1/fund_accounts') return res.end(JSON.stringify({ id: 'fa_1' }));
    if (req.url === '/v1/fund_accounts/validations') return res.end(JSON.stringify({ id: 'fav_1', ...validation }));
    res.end('{}');
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}/v1`;

const srv = await startServer(DB, { REQUIRE_BANK_VERIFIED: 'true', REQUIRE_LOAN_AGREEMENT: 'false' });
const prod = await startServer(DB, { PAYMENT_MODE: 'PRODUCTION' });
const rzp = await startServer(DB, { BANK_VERIFY_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's', RAZORPAYX_ACCOUNT_NUMBER: '2323230000000000', RAZORPAY_API_BASE: MOCK });
const call = client(srv.base), callProd = client(prod.base), callRzp = client(rzp.base);
const { token: admin } = await makeAdmin();

let n = 0;
const customer = async () => {
  n++;
  const user = await User.create({ firstName: 'Asha', lastName: 'Rani', email: `bank${n}@x.in`, phone: `9500000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved' });
  return { user, token: await tokenFor(user) };
};
const save = (c, number, holder = 'Asha Rani', call_ = call) => call_('POST', '/kyc/bank', c.token, { accountNumber: number, ifscCode: 'SBIN0001234', accountHolder: holder });

section('TEST MODE');
const a = await customer();
const ok = await save(a, '123456789012');
check('an ordinary account passes, and the answer says it is a test', ok.s === 200 && ok.d.verified === true && ok.d.status === 'verified' && ok.d.mode === 'test', JSON.stringify(ok.d));
const bad = await save(await customer(), '123456780000');
check('an account ending 0000 fails', bad.d.verified === false && bad.d.status === 'failed' && /not valid/.test(bad.d.note), JSON.stringify(bad.d));
const mism = await save(await customer(), '123456781111');
check('an account ending 1111 shows a different name', mism.d.status === 'name_mismatch' && mism.d.nameAtBank === 'RAMESH KUMAR');
check('the check is in the audit log', (await AuditLog.countDocuments({ action: 'BANK_VERIFICATION' })) === 3);

section('SAVING A DIFFERENT ACCOUNT CANCELS THE CHECK');
const u1 = await User.findById(a.user._id);
await User.updateOne({ _id: a.user._id }, { 'bankAccount.accountNumber': '999999999999' });
const after = await call('GET', `/admin/customers/${a.user._id}`, admin);
check('staff see the check no longer applies to the saved account', after.d.customer.bankVerification.status === 'verified' && after.d.customer.bankVerification.current === false);

section('PAYOUT NEEDS A VERIFIED ACCOUNT');
const b = await customer();
await save(b, '123456781111');
const loan = await Loan.create({ userId: b.user._id, loanAmount: 10000, tenure: 3, interestRate: 15, monthlyEMI: 3500, status: 'approved', approvedBy: 'someone@lifc.in' });
const blocked = await call('POST', `/admin/loans/${loan._id}/disburse`, admin, {});
check('an unverified account blocks the payout (409)', blocked.s === 409 && blocked.d.code === 'BANK_NOT_VERIFIED', JSON.stringify(blocked.d));
const viewer = await tokenFor(await User.create({ firstName: 'K', lastName: 'V', email: 'kv@lifc.in', phone: '9710000077', password: 'x12345678', role: 'kycviewer', twoFactorEnabled: true }), true);
check('someone who can only look cannot verify by hand (403)', (await call('POST', `/admin/customers/${b.user._id}/bank-verification`, viewer, { note: 'x' })).s === 403);
check('a note is needed (400)', (await call('POST', `/admin/customers/${b.user._id}/bank-verification`, admin, {})).s === 400);
const manual = await call('POST', `/admin/customers/${b.user._id}/bank-verification`, admin, { note: 'Checked the cancelled cheque' });
check('staff verify by hand, with a note', manual.s === 200 && manual.d.bankVerification.status === 'verified' && manual.d.bankVerification.mode === 'manual' && manual.d.bankVerification.current === true);
const go = await call('POST', `/admin/loans/${loan._id}/disburse`, admin, {});
check('then the payout goes ahead', go.s === 200, JSON.stringify(go.d));
check('the manual check is in the audit log', (await AuditLog.countDocuments({ action: 'BANK_VERIFIED_MANUALLY' })) === 1);
check('asking again within a minute is refused (429)', (await call('POST', '/kyc/bank/verify', b.token, {})).s === 429);
await User.updateOne({ _id: b.user._id }, { 'bankVerification.at': new Date(Date.now() - 120000) });
const re = await call('POST', '/kyc/bank/verify', b.token, {});
check('after a minute the customer can run the check again (and the test answer replaces the manual one)', re.s === 200 && re.d.status === 'name_mismatch');

section('PRODUCTION WITHOUT A PROVIDER');
const p = await customer();
const pr = await save(p, '123456789012', 'Asha Rani', callProd);
check('the account is saved but not verified, and nothing is invented', pr.s === 200 && pr.d.verified === false && pr.d.status === 'unverified' && pr.d.mode === 'unavailable', JSON.stringify(pr.d));

section('RAZORPAY');
const r = await customer();
const rv = await save(r, '123456789012', 'Asha Rani', callRzp);
check('the three calls are made, with the account details', rv.d.status === 'verified' && asked.map(x => x.url).join() === '/v1/contacts,/v1/fund_accounts,/v1/fund_accounts/validations' && asked[1].body.bank_account.account_number === '123456789012' && asked[2].body.amount === 100 && asked[2].body.account_number === '2323230000000000');
check('the name from the bank is kept', (await User.findById(r.user._id)).bankVerification.nameAtBank === 'ASHA RANI');
validation = { status: 'completed', results: { account_status: 'active', registered_name: 'SURESH GUPTA' } };
check('a different name at the bank is flagged', (await save(await customer(), '123456789013', 'Asha Rani', callRzp)).d.status === 'name_mismatch');
validation = { status: 'failed', results: { account_status: 'invalid', registered_name: null } };
check('an invalid account fails', (await save(await customer(), '123456789014', 'Asha Rani', callRzp)).d.status === 'failed');
validation = { status: 'completed', results: { account_status: 'active', registered_name: null } };
check('when the bank gives no name the account counts as verified, without a name', (await save(await customer(), '123456789015', 'Asha Rani', callRzp)).d.status === 'verified');

mock.close();
await disconnect();
finish();
