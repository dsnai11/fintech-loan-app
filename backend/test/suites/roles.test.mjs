import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';

const DB = 'fintech-test-roles';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const hire = (role, n) => call('POST', '/admin/staff', admin, { firstName: role, lastName: 'P', email: `${role}${n}@lifc.in`, phone: `97100000${n}`, role });
const tok = async s => tokenFor(await User.findById(s.d.staff.id), true);

section('ROLES ARE STORED AND EDITABLE');
const list = await call('GET', '/admin/roles', admin);
check('roles and the permission list come from the server', list.s === 200 && list.d.permissions.length >= 20 && list.d.roles.some(r => r.key === 'finance' && r.builtin && r.permissions.includes('loans.disburse')), JSON.stringify(list.d).slice(0, 200));
check('the super admin role is locked', list.d.roles.find(r => r.key === 'super_admin').locked === true);
check('super admin role cannot be edited (403)', (await call('PUT', '/admin/roles/super_admin', admin, { permissions: [] })).s === 403);
check('unknown permission refused (400)', (await call('PUT', '/admin/roles/finance', admin, { permissions: ['loans.view', 'make.coffee'] })).s === 400);
check('roles.manage cannot be handed to a role (400)', (await call('PUT', '/admin/roles/finance', admin, { permissions: ['roles.manage'] })).s === 400);

const fin = await hire('finance', 1);
const credit = await hire('credit_officer', 2);
const [tFin, tCredit] = await Promise.all([tok(fin), tok(credit)]);
await User.updateMany({ role: { $ne: 'customer' } }, { twoFactorEnabled: true });
const cust = await User.create({ firstName: 'C', lastName: 'U', email: 'cu@x.in', phone: '9222222222', password: 'x12345678', kycStatus: 'approved' });
const l1 = await Loan.create({ userId: cust._id, loanAmount: 5000, tenure: 1, interestRate: 0, monthlyEMI: 5000, status: 'submitted' });
check('finance cannot approve loans to begin with (403)', (await call('POST', `/admin/loans/${l1._id}/approve`, tFin, {})).s === 403);
const grant = await call('PUT', '/admin/roles/finance', admin, { permissions: ['loans.view', 'loans.approve', 'loans.disburse', 'customers.view'] });
check('super admin gives finance the right to approve', grant.s === 200);
check('it takes effect straight away, with no new sign-in', (await call('POST', `/admin/loans/${l1._id}/approve`, tFin, {})).s === 200);
const take = await call('PUT', '/admin/roles/finance', admin, { permissions: ['customers.view'] });
check('and taking it away works the same way', take.s === 200 && (await call('GET', '/admin/loans', tFin)).s === 403);
check('a role can be put back to its original permissions', (await call('POST', '/admin/roles/finance/reset', admin)).s === 200 && (await call('GET', '/admin/loans', tFin)).s === 200);
check('non-super staff cannot see or edit roles (403)', (await call('GET', '/admin/roles', tCredit)).s === 403 && (await call('PUT', '/admin/roles/credit_officer', tCredit, { permissions: ['loans.view', 'staff.manage'] })).s === 403);

section('CUSTOM ROLES');
check('a name is required (400)', (await call('POST', '/admin/roles', admin, { label: '  ', permissions: [] })).s === 400);
const mk = await call('POST', '/admin/roles', admin, { label: 'Pricing manager', description: 'Sets rates', permissions: ['pricing.view', 'pricing.edit', 'customers.view'] });
check('super admin creates "Pricing manager"', mk.s === 201 && mk.d.role.key === 'pricing_manager' && mk.d.role.builtin === false, JSON.stringify(mk.d));
check('same name again (409)', (await call('POST', '/admin/roles', admin, { label: 'Pricing manager', permissions: [] })).s === 409);
const pm = await hire('pricing_manager', 3);
check('the new role can be given to staff', pm.s === 201 && pm.d.staff.role === 'pricing_manager' && pm.d.staff.roleLabel === 'Pricing manager', JSON.stringify(pm.d));
await User.updateMany({ role: { $ne: 'customer' } }, { twoFactorEnabled: true });
const tPm = await tok(pm);
check('they appear in /admin/me with their permissions', (await call('GET', '/admin/me', tPm)).d.permissions.includes('pricing.edit'));

section('PRICES AND CONTROLS ARE SEPARATE PERMISSIONS');
const view = await call('GET', '/admin/pricing', tPm);
check('they can read pricing', view.s === 200);
const rate = await call('PUT', '/admin/pricing', tPm, { annualRatePercent: 14 });
check('they can change the interest rate', rate.s === 200 && rate.d.policy.annualRatePercent === 14, JSON.stringify(rate.d));
const ctl = await call('PUT', '/admin/pricing', tPm, { controls: { fourEyesDisbursal: true } });
check('but not the internal controls (403)', ctl.s === 403 && ctl.d.needs === 'controls.edit', JSON.stringify(ctl.d));
const whole = await call('PUT', '/admin/pricing', tPm, view.d.policy);
check('sending the whole unchanged form is fine', whole.s === 200);
check('credit officer can read but not change pricing (403)', (await call('GET', '/admin/pricing', tCredit)).s === 200 && (await call('PUT', '/admin/pricing', tCredit, { annualRatePercent: 9 })).s === 403);
check('give the role control rights', (await call('PUT', '/admin/roles/pricing_manager', admin, { permissions: ['pricing.view', 'pricing.edit', 'controls.edit', 'customers.view'] })).s === 200);
check('now they can switch four-eyes on', (await call('PUT', '/admin/pricing', tPm, { controls: { fourEyesDisbursal: true } })).s === 200);
await call('PUT', '/admin/pricing', admin, { controls: { fourEyesDisbursal: false } });

section('DELEGATING STAFF MANAGEMENT SAFELY');
check('give credit officers the right to manage staff', (await call('PUT', '/admin/roles/credit_officer', admin, { permissions: ['loans.view', 'loans.approve', 'customers.view', 'staff.manage'] })).s === 200);
check('they can open the staff directory', (await call('GET', '/admin/staff', tCredit)).s === 200);
await call('POST', '/admin/roles', admin, { label: 'Loan viewer', permissions: ['loans.view'] });
const offered = await call('GET', '/admin/staff/roles', tCredit);
check('but are only offered roles no stronger than their own', offered.d.roles.some(r => r.key === 'loan_viewer') && !offered.d.roles.some(r => r.key === 'finance'), JSON.stringify(offered.d.roles.map(r => r.key)));
const strong = await call('POST', '/admin/staff', tCredit, { firstName: 'X', lastName: 'Y', email: 'x@lifc.in', phone: '9710000099', role: 'finance' });
check('they cannot create a stronger role (403)', strong.s === 403);
const weak = await call('POST', '/admin/staff', tCredit, { firstName: 'X', lastName: 'Y', email: 'x@lifc.in', phone: '9710000099', role: 'loan_viewer' });
check('they can create a weaker one', weak.s === 201);
check('they cannot touch someone who outranks them (403)', (await call('PUT', `/admin/staff/${pm.d.staff.id}`, tCredit, { status: 'inactive' })).s === 403);
check('and cannot reach role editing (403)', (await call('POST', '/admin/roles', tCredit, { label: 'Sneaky', permissions: ['loans.view'] })).s === 403);

section('DELETING ROLES');
check('a role in use cannot be deleted (409)', (await call('DELETE', '/admin/roles/pricing_manager', admin)).s === 409);
check('built-in roles cannot be deleted (400)', (await call('DELETE', '/admin/roles/finance', admin)).s === 400);
await call('PUT', `/admin/staff/${pm.d.staff.id}`, admin, { role: 'auditor' });
check('an unused custom role can be deleted', (await call('DELETE', '/admin/roles/pricing_manager', admin)).s === 200);

section('EVERY CHANGE IS AUDITED');
const a = await call('GET', '/admin/compliance/audit?limit=200', admin);
const actions = a.d.entries.map(e => e.action);
check('role created, updated, reset and deleted are all in the log', ['ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_RESET', 'ROLE_DELETED'].every(x => actions.includes(x)));
check('the log says what was added and removed', a.d.entries.some(e => e.action === 'ROLE_UPDATED' && Array.isArray(e.details.added) && e.details.added.includes('loans.approve')));

await srv.stop();
await disconnect();
finish();
