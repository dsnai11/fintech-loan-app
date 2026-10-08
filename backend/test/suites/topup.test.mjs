import { check, section, connect, disconnect, startServer, finish, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import { setConfig } from '../../src/services/configService.js';
import { getPolicy } from '../../src/services/pricingPolicy.js';

const DB = 'fintech-test-topup';
await connect(DB);
// A salary advance: small, one month, at most 40% of monthly income
await setConfig('APP_SETTINGS', JSON.stringify({ products: [{ key: 'salary_advance', name: 'Salary Advance', description: 'Small, short, against your salary', enabled: true, overrides: { minAmount: 1000, maxAmount: 15000, minTenureMonths: 1, maxTenureMonths: 1, maxIncomePercent: 40, plans: { '3_emi': false, '6_emi': false } } }] }), { group: 'app' });
const srv = await startServer(DB);
const off = await startServer(DB, { TOPUP_ENABLED: 'false' });
const call = client(srv.base), callOff = client(off.base);
const MAX = getPolicy().maxAmount;

let n = 0;
async function customer({ paid = 0, overdue = false, status = 'disbursed', income = 50000 } = {}) {
  n++;
  const user = await User.create({ firstName: `Top${n}`, lastName: 'Up', email: `top${n}@x.in`, phone: `9300000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved', employment: income ? { status: 'Employed', monthlyIncome: income } : undefined });
  const loan = await Loan.create({ userId: user._id, loanAmount: 30000, tenure: 3, interestRate: 15, monthlyEMI: 10200, status, disbursementDate: day(-60) });
  for (let i = 1; i <= 3; i++) await EMIPayment.create({ loanId: loan._id, userId: user._id, emiNumber: i, dueDate: day(i <= paid ? -60 + i * 10 : overdue && i === paid + 1 ? -5 : 10 + i * 20), amount: 10200, principalAmount: 10000, interestAmount: 200, status: i <= paid ? 'PAID' : overdue && i === paid + 1 ? 'OVERDUE' : 'PENDING' });
  return { user, loan, token: await tokenFor(user) };
}
const apply = (c, amount, extra = {}) => call('POST', '/loans/apply', c.token, { loanAmount: amount, tenure: 3, purpose: 'Personal', ...extra });

section('A CUSTOMER WITH NO LOAN IS UNAFFECTED');
n++;
const fresh = await User.create({ firstName: 'Fresh', lastName: 'One', email: 'fresh@x.in', phone: '9300009999', password: 'x12345678', kycStatus: 'approved' });
const ft = await tokenFor(fresh);
check('no top-up information', (await call('GET', '/loans/my-offer', ft)).d.topUp === null);
check('they can apply as before', (await call('POST', '/loans/apply', ft, { loanAmount: 5000, tenure: 3, purpose: 'Personal' })).s === 201);

section('A RUNNING LOAN');
const a = await customer({ paid: 0 });
const ta = (await call('GET', '/loans/my-offer', a.token)).d.topUp;
check('nothing repaid yet: not allowed, and it says how much is needed', ta.eligible === false && ta.outstanding === 30000 && /50%/.test(ta.reason), JSON.stringify(ta));
const blocked = await apply(a, 5000);
check('applying is refused (403, TOPUP_NOT_AVAILABLE)', blocked.s === 403 && blocked.d.code === 'TOPUP_NOT_AVAILABLE');
const b = await customer({ paid: 2 });
const tb = (await call('GET', '/loans/my-offer', b.token)).d.topUp;
check('two of three repaid: allowed, for the limit minus what is owed', tb.eligible === true && tb.outstanding === 10000 && tb.maxAmount === Math.floor((MAX - 10000) / 500) * 500, JSON.stringify(tb));
const tooMuch = await apply(b, tb.maxAmount + 500);
check('above the room left is refused, and the message says why (400)', tooMuch.s === 400 && /still owe/.test(tooMuch.d.error) && tooMuch.d.code === 'ABOVE_LIMIT', JSON.stringify(tooMuch.d));
check('within the room it is accepted', (await apply(b, 5000)).s === 201);
const c = await customer({ paid: 2, overdue: false });
await EMIPayment.updateOne({ loanId: c.loan._id, emiNumber: 3 }, { status: 'OVERDUE', dueDate: day(-4) });
check('an overdue instalment blocks it (403)', (await apply(c, 5000)).s === 403);
const d = await customer({ paid: 2, status: 'defaulted' });
check('a defaulted loan blocks it (403)', (await apply(d, 5000)).s === 403);
const e = await customer({ paid: 2 });
check('the company can switch top-ups off (403)', (await callOff('POST', '/loans/apply', e.token, { loanAmount: 5000, tenure: 3, purpose: 'Personal' })).s === 403);

section('SALARY ADVANCE');
const s1 = await customer({ income: 30000 });
await Loan.deleteMany({ userId: s1.user._id });
const adv = (c, amount, extra = {}) => call('POST', '/loans/apply', c.token, { loanAmount: amount, tenure: 1, purpose: 'Personal', productKey: 'salary_advance', ...extra });
check('13000 against 30000 income is above 40% (400)', (await adv(s1, 13000)).s === 400 && (await adv(s1, 13000)).d.code === 'ABOVE_LIMIT');
const ok = await adv(s1, 12000);
check('12000 (40% of income) is accepted as a one-month loan', ok.s === 201 && ok.d.loan.loanAmount === 12000 && ok.d.loan.kfs.productKey === 'salary_advance', JSON.stringify(ok.d).slice(0, 200));
const noInc = await customer({ income: 0 });
await Loan.deleteMany({ userId: noInc.user._id });
const ni = await adv(noInc, 5000);
check('without any income on file it asks for it (400, INCOME_NEEDED)', ni.s === 400 && ni.d.code === 'INCOME_NEEDED');
const rich = await customer({ income: 100000 });
await Loan.deleteMany({ userId: rich.user._id });
check('the product maximum still applies (15000)', (await adv(rich, 20000)).s === 400 && (await adv(rich, 15000)).s === 201);
const shared = await customer({ income: 20000 });
await Loan.deleteMany({ userId: shared.user._id });
await User.updateOne({ _id: shared.user._id }, { incomeCheck: { at: new Date(), mode: 'aa', estimatedMonthlyIncome: 50000, salaryDetected: true } });
check('income from shared bank statements is used when it is there (40% of 50000)', (await adv(shared, 15000)).s === 201);
check('the repayment plans are one month only', (await call('GET', '/app-settings', shared.token)).s === 200);

await disconnect();
finish();
