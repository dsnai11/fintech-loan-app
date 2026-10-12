import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import AuditLog from '../../src/models/AuditLog.js';
import { setConfig, loadAllConfig } from '../../src/services/configService.js';
import { evaluate, effectiveRules, validateRules, DEFAULTS, getRules, decideLoan, SUGGESTED_PRODUCTS } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-product-rules';
await connect(DB);
await Role.create([{ key: 'decview', label: 'V', description: 't', permissions: ['decisions.view'] }]);

const yearsAgo = n => new Date(Date.now() - n * 365.25 * 86400000);
const clean = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 620, selfieStatus: 'passed', monthlyIncome: 0, emi: 0 };

section('A PRODUCT WITH NO RULES OF ITS OWN FOLLOWS THE SHARED ONES');
const shared = { ...DEFAULTS, mode: 'shadow' };
const same = effectiveRules(shared, 'personal');
check('same mode and same values', same.mode === 'shadow' && same.bureau.autoMinScore === 650 && same.amount.firstLoanAutoMax === 25000);
check('an unknown product also follows them', effectiveRules(shared, 'something_new').bureau.autoMinScore === 650);

section('ONE PRODUCT CAN DIFFER');
const withPayday = { ...DEFAULTS, products: { payday: { mode: 'auto', overrides: { bureau: { autoMinScore: 600 }, amount: { firstLoanAutoMax: 25000 } }, custom: [] } } };
const pe = effectiveRules(withPayday, 'payday');
check('payday uses its own score line and its own mode', pe.bureau.autoMinScore === 600 && pe.mode === 'auto' && pe.bureau.rejectBelow === null);
check('the other fields of that section are kept (not wiped)', pe.bureau.requireScore === false && pe.age.min === 21);
check('personal is untouched', effectiveRules(withPayday, 'personal').bureau.autoMinScore === 650 && effectiveRules(withPayday, 'personal').mode === 'shadow');
check('the same applicant (score 620): clean for payday, a person decides for personal', evaluate(pe, clean).outcome === 'APPROVE' && evaluate(effectiveRules(withPayday, 'personal'), clean).outcome === 'REFER');
check('shared rules were not changed by computing the product ones', withPayday.bureau.autoMinScore === 650);

section('SETTINGS ARE CHECKED PER PRODUCT');
const bad = validateRules({ ...DEFAULTS, products: { payday: { mode: 'auto', overrides: { bureau: { autoMinScore: 1000 } } } } });
check('a score of 1000 is refused, and the message names the product', bad.errors.length > 0 && bad.errors[0].includes('payday'), bad.errors.join('|'));
const badOrder = validateRules({ ...DEFAULTS, products: { personal: { overrides: { bureau: { autoMinScore: 600, rejectBelow: 650 } } } } });
check('a reject score above the clean score is refused for that product', badOrder.errors.some(e => e.includes('reject score')));
check('an unknown mode is refused', validateRules({ ...DEFAULTS, products: { payday: { mode: 'yolo' } } }).errors.some(e => e.includes('mode')));
const good = validateRules({ ...DEFAULTS, products: { 'Salaried Loan': { mode: 'shadow', overrides: { foir: { enabled: true, maxPercent: 55 }, notASection: { x: 1 }, bureau: { notAField: 3, autoMinScore: 700 } } } } });
check('a good entry is kept, under a tidy key, with only real fields', good.errors.length === 0 && good.rules.products.salaried_loan?.overrides.foir.maxPercent === 55 && good.rules.products.salaried_loan.overrides.bureau.autoMinScore === 700 && !('notASection' in good.rules.products.salaried_loan.overrides) && !('notAField' in good.rules.products.salaried_loan.overrides.bureau), JSON.stringify(good.rules.products));
check('the suggested starting values are themselves valid', Object.entries(SUGGESTED_PRODUCTS).every(([k, s]) => validateRules({ ...DEFAULTS, products: { [k]: s } }).errors.length === 0), Object.entries(SUGGESTED_PRODUCTS).map(([k, s]) => validateRules({ ...DEFAULTS, products: { [k]: s } }).errors.join('|')).join(' ; '));

section('RULES OF YOUR OWN CAN BE FOR CERTAIN PRODUCTS');
const scoped = validateRules({ ...DEFAULTS, custom: [{ name: 'Big payday', field: 'amount', op: '>', value: 5000, result: 'refer', products: 'payday' }, { name: 'Everyone', field: 'amount', op: '>', value: 90000, result: 'refer' }] });
check('a rule can name its products, and without any it applies to all', scoped.errors.length === 0 && scoped.rules.custom[0].products[0] === 'payday' && !scoped.rules.custom[1].products);
const pay = evaluate(effectiveRules(scoped.rules, 'payday'), clean);
const per = evaluate(effectiveRules(scoped.rules, 'personal'), clean);
check('it fires for payday only', pay.checks.find(c => c.code === 'CUSTOM_big_payday').result === 'refer' && !per.checks.some(c => c.code === 'CUSTOM_big_payday'));
check('the rule for everyone is on both', pay.checks.some(c => c.code === 'CUSTOM_everyone') && per.checks.some(c => c.code === 'CUSTOM_everyone'));
const own = validateRules({ ...DEFAULTS, products: { payday: { overrides: {}, custom: [{ name: 'Payday only', field: 'openLoans', op: '>', value: 1, result: 'reject' }] } } });
check('a product can have rules that belong only to it', own.errors.length === 0 && effectiveRules(own.rules, 'payday').custom.length === 1 && effectiveRules(own.rules, 'personal').custom.length === 0);

section('EACH LOAN IS DECIDED WITH ITS PRODUCT RULES');
await setConfig('DECISION_RULES', JSON.stringify(validateRules({ ...DEFAULTS, mode: 'shadow', products: { payday: { mode: 'auto', overrides: { bureau: { autoMinScore: 600 } } } } }).rules), { group: 'decisions' });
let n = 0;
const mkLoan = async productKey => {
  n++;
  const u = await User.create({ firstName: `P${n}`, lastName: 'R', email: `pr${n}@x.in`, phone: `97100000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: yearsAgo(32), selfie: { status: 'passed' }, creditScore: 620 });
  const loan = await Loan.create({ userId: u._id, loanAmount: 10000, tenure: 1, status: 'submitted', productKey });
  await decideLoan(loan, u);
  return Loan.findById(loan._id);
};
const lp = await mkLoan('payday');
const lq = await mkLoan('personal');
check('payday (own mode: automatic, score line 600) is approved by the system', lp.status === 'approved' && lp.decision.applied === true && lp.decision.mode === 'auto' && lp.decision.product === 'payday', JSON.stringify(lp.decision));
check('personal (shared mode: shadow, score line 650) is left for a person and records what it would do', lq.status === 'submitted' && lq.decision.applied === false && lq.decision.mode === 'shadow' && lq.decision.outcome === 'REFER');

const srv = await startServer(DB); // starts after the rules above are saved, so it loads them
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const fresh = async () => { await loadAllConfig(true); return getRules(); }; // the server wrote them; read them back

section('THE STAFF PAGES');
const list = await call('GET', '/admin/decisions/products', admin);
check('lists the main loan, payday and any set-up product, with each mode', list.s === 200 && ['personal', 'payday'].every(k => list.d.products.some(p => p.key === k)) && list.d.products.find(p => p.key === 'payday').mode === 'auto' && list.d.products.find(p => p.key === 'personal').mode === 'shadow', JSON.stringify(list.d.products));
const one = await call('GET', '/admin/decisions/products/payday', admin);
check('one product shows shared values, its own values and a suggestion', one.s === 200 && one.d.shared.bureau.autoMinScore === 650 && one.d.effective.bureau.autoMinScore === 600 && one.d.suggested?.overrides?.bureau?.autoMinScore === 600);
check('an unknown product is a 404', (await call('GET', '/admin/decisions/products/nope', admin)).s === 404);
const put = await call('PUT', '/admin/decisions/products/personal', admin, { mode: 'inherit', overrides: { bureau: { autoMinScore: 640 }, foir: { enabled: true, maxPercent: 45 } } });
check('saving a product works and is kept', put.s === 200 && (await fresh()).products.personal.overrides.foir.maxPercent === 45 && (await call('GET', '/admin/decisions/products/personal', admin)).d.effective.bureau.autoMinScore === 640, JSON.stringify(put.d));
check('payday kept its own values when personal was saved', (await fresh()).products.payday.overrides.bureau.autoMinScore === 600);
check('the change is in the audit log', !!(await AuditLog.findOne({ action: 'DECISION_RULES_UPDATED' }).sort({ seq: -1 })));
const refused = await call('PUT', '/admin/decisions/products/personal', admin, { overrides: { bureau: { autoMinScore: 2000 } } });
check('a bad value is refused with the product named (400)', refused.s === 400 && /personal/.test(refused.d.error), JSON.stringify(refused.d));
const reset = await call('PUT', '/admin/decisions/products/personal', admin, { reset: true });
check('"follow the shared rules" removes the product entry', reset.s === 200 && !(await fresh()).products.personal);
check('saving the shared rules from the Decisions page keeps every product entry', (await call('PUT', '/admin/decisions/rules', admin, { mode: 'shadow' })).s === 200 && !!(await fresh()).products.payday);

const tried = await call('POST', '/admin/decisions/test', admin, { productKey: 'payday', facts: { amount: 10000, age: 32, bureauScore: 620, kycApproved: true, phoneVerified: true } });
const triedP = await call('POST', '/admin/decisions/test', admin, { productKey: 'personal', facts: { amount: 10000, age: 32, bureauScore: 620, kycApproved: true, phoneVerified: true } });
check('"try an applicant" can be run as one product', tried.d.outcome === 'APPROVE' && triedP.d.outcome === 'REFER', `${tried.d.outcome} ${triedP.d.outcome}`);

const seen = await call('GET', '/admin/decisions?days=30&product=payday', admin);
check('recent decisions can be filtered to one product', seen.s === 200 && seen.d.recent.length === 1 && seen.d.recent[0].product === 'payday');
const unfiltered = await call('GET', '/admin/decisions?days=30', admin);
check('and each row says which product it was', unfiltered.d.recent.every(r => r.product));

const viewer = await User.create({ firstName: 'View', lastName: 'Only', email: 'viewer@x.in', phone: '9712345678', password: 'x12345678', role: 'decview', twoFactorEnabled: true });
const vt = await tokenFor(viewer);
check('a viewer can look at the product rules', (await call('GET', '/admin/decisions/products', vt)).s === 200);
check('but cannot change them (403)', (await call('PUT', '/admin/decisions/products/payday', vt, { mode: 'auto' })).s === 403);

srv.stop();
await disconnect();
finish();
