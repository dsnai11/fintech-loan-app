import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import AuditLog from '../../src/models/AuditLog.js';
import { parseText, saveText, levelOf, categoryOf, search, normalize } from '../../src/services/employerService.js';
import { evaluate, DEFAULTS, validateRules, effectiveRules, decideLoan, SUGGESTED_PRODUCTS } from '../../src/services/decisionEngine.js';
import { setConfig } from '../../src/services/configService.js';

const DB = 'fintech-test-employers';
await connect(DB);
await Role.create([{ key: 'decview', label: 'V', description: 't', permissions: ['decisions.view'] }]);
const yearsAgo = n => new Date(Date.now() - n * 365.25 * 86400000);

section('READING THE LIST YOU PASTE');
const ok = parseText('Tata Consultancy Services, A\n  Local Traders Pvt Ltd ,c\n\nAcme Corp; B\n');
check('name, comma (or semicolon), A, B or C; blank lines ignored; lowercase grade accepted', ok.errors.length === 0 && ok.list.length === 3 && ok.list[1].name === 'Local Traders Pvt Ltd' && ok.list[1].category === 'C' && ok.list[2].category === 'B', JSON.stringify(ok));
const noGrade = parseText('Infosys\nWipro, A');
check('a line without a grade is an error, not a guess, and it says which line', noGrade.errors.length === 1 && /Line 1/.test(noGrade.errors[0]));
check('a grade other than A, B, C is an error', parseText('Foo, D').errors.length === 1);
check('the same employer twice (even spelled differently) is an error', parseText('Acme Corp, A\nACME CORP., B').errors.length === 1);
check('a name with no letters is an error', parseText('---, A').errors.length === 1);
check('names are compared without punctuation or capitals', normalize('  TCS Ltd. ') === normalize('tcs ltd'));

section('LOOKING AN EMPLOYER UP');
await saveText('Tata Consultancy Services, A\nAcme Corp, B\nLocal Traders Pvt Ltd, C\nTata Motors, A', 'test');
check('grade A reads as 3, B as 2, C as 1', levelOf('Tata Consultancy Services') === 3 && levelOf('acme corp.') === 2 && levelOf('LOCAL TRADERS PVT LTD') === 1);
check('an employer not on the list is 0, and so is a blank', levelOf('Unknown Co') === 0 && levelOf('') === 0 && levelOf(undefined) === 0);
check('only exact matches count (a part of a name does not)', levelOf('Tata') === 0);
check('the grade as a letter', categoryOf('Acme Corp') === 'B' && categoryOf('Nobody') === null);
check('suggestions start with what was typed, then contain it, names only', JSON.stringify(search('tata')) === JSON.stringify(['Tata Consultancy Services', 'Tata Motors']) && search('traders')[0] === 'Local Traders Pvt Ltd' && typeof search('acme')[0] === 'string');
check('one letter gives no suggestions', search('a').length === 0);

section('THE RULES CAN USE THE GRADE');
const clean = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 720, selfieStatus: 'passed', monthlyIncome: 50000, emi: 3000 };
const s = SUGGESTED_PRODUCTS.salaried;
check('the suggested salaried rules include "not on the list" and "category C"', s.custom.length === 2 && s.custom.every(c => c.field === 'employerCategory'));
const withRules = validateRules({ ...DEFAULTS, products: { salaried: { mode: 'auto', overrides: {}, custom: s.custom } } }).rules;
const eff = effectiveRules(withRules, 'salaried');
check('an employer on the list passes', evaluate(eff, { ...clean, employerName: 'Acme Corp', employerCategory: 2 }).outcome === 'APPROVE');
const unlisted = evaluate(eff, { ...clean, employerName: 'Unknown Co', employerCategory: 0 });
check('one not on the list goes to a person, with a reason', unlisted.outcome === 'REFER' && unlisted.checks.some(c => c.result === 'refer' && /not on your graded list/.test(c.detail)));
check('a grade C employer goes to a person', evaluate(eff, { ...clean, employerName: 'Local Traders Pvt Ltd', employerCategory: 1 }).outcome === 'REFER');
check('other products do not get those rules', evaluate(effectiveRules(withRules, 'personal'), { ...clean, employerName: 'Unknown Co', employerCategory: 0 }).outcome === 'APPROVE');
const info = evaluate(DEFAULTS, { ...clean, employerName: 'Acme Corp', employerCategory: 2 }).checks.find(c => c.code === 'EMPLOYER');
check('staff see the grade on the application, and it changes nothing by itself', info?.result === 'skip' && /category B/.test(info.detail) && evaluate(DEFAULTS, { ...clean, employerName: 'Unknown Co', employerCategory: 0 }).outcome === 'APPROVE');

section('A REAL APPLICATION');
await setConfig('DECISION_RULES', JSON.stringify(withRules), { group: 'decisions' });
let n = 0;
const apply = async company => {
  n++;
  const u = await User.create({ firstName: `E${n}`, lastName: 'M', email: `emp${n}@x.in`, phone: `98200000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: yearsAgo(32), selfie: { status: 'passed' }, creditScore: 720, employment: { status: 'Employed', company, monthlyIncome: 50000 } });
  const loan = await Loan.create({ userId: u._id, loanAmount: 10000, tenure: 6, status: 'submitted', productKey: 'salaried', monthlyEMI: 1800 });
  await decideLoan(loan, u);
  return Loan.findById(loan._id);
};
const good = await apply('Tata Consultancy Services');
const bad = await apply('Some Unlisted Firm');
check('a listed employer is approved by the system on the salaried product', good.status === 'approved' && good.decision.applied === true, JSON.stringify(good.decision?.outcome));
check('an unlisted employer waits for a person', bad.status === 'submitted' && bad.decision.outcome === 'REFER');

section('THE PAGES');
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const put = await call('PUT', '/admin/employers', admin, { text: 'Zenith Industries, A\nZed Retail, B' });
check('staff can save the list', put.s === 200 && put.d.count === 2, JSON.stringify(put.d));
const got = await call('GET', '/admin/employers', admin);
check('and read it back with counts', got.s === 200 && got.d.counts.A === 1 && got.d.counts.B === 1 && got.d.counts.total === 2 && /Zenith Industries, A/.test(got.d.text));
const badSave = await call('PUT', '/admin/employers', admin, { text: 'No grade here' });
check('a bad line is refused with the line number (400), and the list is unchanged', badSave.s === 400 && /Line 1/.test(badSave.d.error) && (await call('GET', '/admin/employers', admin)).d.counts.total === 2);
check('the change is in the audit log', !!(await AuditLog.findOne({ action: 'EMPLOYER_LIST_UPDATED' })));
const cust = await User.create({ firstName: 'Cu', lastName: 'St', email: 'cust-e@x.in', phone: '9829999999', password: 'x12345678', kycStatus: 'approved' });
const ct = await tokenFor(cust);
const sug = await call('GET', '/employers/search?q=ze', ct);
check('a customer gets suggestions as names only, no grades', sug.s === 200 && sug.d.names.length === 2 && sug.d.names.every(x => typeof x === 'string') && !JSON.stringify(sug.d).includes('"A"'), JSON.stringify(sug.d));
check('without signing in there are no suggestions (401)', (await call('GET', '/employers/search?q=ze', null)).s === 401);
check('a customer cannot read or change the list', [401, 403].includes((await call('GET', '/admin/employers', ct)).s) && [401, 403].includes((await call('PUT', '/admin/employers', ct, { text: 'X, A' })).s));
const viewer = await User.create({ firstName: 'Vi', lastName: 'Ew', email: 'viewer-e@x.in', phone: '9828888888', password: 'x12345678', role: 'decview', twoFactorEnabled: true });
const vt = await tokenFor(viewer);
check('a viewer can read the list but not change it (403)', (await call('GET', '/admin/employers', vt)).s === 200 && (await call('PUT', '/admin/employers', vt, { text: 'X, A' })).s === 403);

srv.stop();
await disconnect();
finish();
