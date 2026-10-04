import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';

const DB = 'fintech-test-staff';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin, user: adminUser } = await makeAdmin();

const hire = async (role, n, extra = {}) => {
  const r = await call('POST', '/admin/staff', admin, { firstName: role, lastName: 'Person', email: `${role}${n}@lifc.in`, phone: `98000000${n}`, role, ...extra });
  return r;
};

section('STAFF DIRECTORY');
const roles = await call('GET', '/admin/staff/roles', admin);
check('roles are listed with what each can do', roles.s === 200 && roles.d.roles.some(r => r.key === 'finance' && r.can.includes('loans.disburse')) && !roles.d.roles.some(r => r.key === 'super_admin'));
const bad = await call('POST', '/admin/staff', admin, { firstName: 'A', lastName: 'B', email: 'x@lifc.in', phone: '9800000999', role: 'wizard' });
check('unknown role refused (400)', bad.s === 400);
check('super_admin cannot be handed out (400)', (await call('POST', '/admin/staff', admin, { firstName: 'A', lastName: 'B', email: 'x@lifc.in', phone: '9800000999', role: 'super_admin' })).s === 400);
const credit = await hire('credit_officer', 1);
check('staff created with a one-time link and no password shown', credit.s === 201 && /reset-password\.html\?token=/.test(credit.d.link) && !/"password"/i.test(JSON.stringify(credit.d)), JSON.stringify(credit.d));
check('duplicate email refused (409)', (await hire('credit_officer', 1)).s === 409);
const finance = await hire('finance', 2);
const agent = await hire('collections_agent', 3);
const agent2 = await hire('collections_agent', 4);
const manager = await hire('collections_manager', 5);
const auditor = await hire('auditor', 6);
const list = await call('GET', '/admin/staff', admin);
check('directory lists everyone including the main admin', list.s === 200 && list.d.staff.length === 7 && list.d.staff.some(s => s.role === 'super_admin'));

const as = async s => tokenFor(await User.findById(s.d.staff.id), true);
const [tCredit, tFinance, tAgent, tAgent2, tManager, tAuditor] = await Promise.all([credit, finance, agent, agent2, manager, auditor].map(as));

section('TWO-FACTOR IS REQUIRED FOR STAFF');
const blocked = await call('GET', '/admin/customers?q=ab', tCredit);
check('staff without 2FA are told to set it up (403)', blocked.s === 403 && blocked.d.code === '2FA_SETUP_REQUIRED', JSON.stringify(blocked.d));
check('but they can reach the 2FA setup', (await call('GET', '/auth/2fa/status', tCredit)).s === 200);
await User.updateMany({ role: { $ne: 'customer' } }, { twoFactorEnabled: true });
check('with 2FA on they get in', (await call('GET', '/admin/customers?q=ab', tCredit)).s === 200);

section('ROLES LIMIT WHAT PEOPLE CAN DO');
const cust = await User.create({ firstName: 'Cu', lastName: 'Stomer', email: 'cu@x.in', phone: '9111111111', password: 'x12345678', kycStatus: 'approved', bankAccount: { accountNumber: '1234567890', ifscCode: 'SBIN0001234', accountHolder: 'Cu Stomer', bankName: 'SBI' } });
const loan = await Loan.create({ userId: cust._id, loanAmount: 10000, tenure: 1, interestRate: 0, monthlyEMI: 10000, status: 'submitted' });
check('credit officer can approve a loan', (await call('POST', `/admin/loans/${loan._id}/approve`, tCredit, {})).s === 200);
check('credit officer cannot release the payout (403)', (await call('POST', `/admin/loans/${loan._id}/disburse`, tCredit)).s === 403);
check('credit officer cannot change pricing (403)', (await call('PUT', '/admin/pricing', tCredit, { annualRatePercent: 10 })).s === 403);
check('credit officer can read pricing', (await call('GET', '/admin/pricing', tCredit)).s === 200);
check('credit officer cannot see compliance audit (403)', (await call('GET', '/admin/compliance/audit', tCredit)).s === 403);
check('credit officer cannot manage staff (403)', (await call('GET', '/admin/staff', tCredit)).s === 403);
check('auditor can read loans and audit', (await call('GET', '/admin/loans', tAuditor)).s === 200 && (await call('GET', '/admin/compliance/audit', tAuditor)).s === 200);
check('auditor cannot approve anything (403)', (await call('POST', `/admin/loans/${loan._id}/approve`, tAuditor, {})).s === 403);
check('collections agent cannot read config (403)', (await call('GET', '/admin/config', tAgent)).s === 403);
check('a customer is not staff (403)', (await call('GET', '/admin/loans', await tokenFor(cust))).s === 403);
check('finance can release the payout', (await call('POST', `/admin/loans/${loan._id}/disburse`, tFinance)).s === 200);
check('an unlisted admin route is super-admin only', (await call('GET', '/admin/builds', tFinance)).s === 403);
check('super admin still does everything', (await call('GET', '/admin/staff', admin)).s === 200 && (await call('GET', '/admin/loans', admin)).s === 200);

section('FOUR-EYES: THE APPROVER CANNOT RELEASE THE MONEY');
const l2 = await Loan.create({ userId: cust._id, loanAmount: 8000, tenure: 1, interestRate: 0, monthlyEMI: 8000, status: 'submitted' });
check('off by default: super admin approves and releases', (await call('POST', `/admin/loans/${l2._id}/approve`, admin, {})).s === 200 && (await call('POST', `/admin/loans/${l2._id}/disburse`, admin)).s === 200);
check('switch it on', (await call('PUT', '/admin/pricing', admin, { controls: { fourEyesDisbursal: true } })).s === 200);
const l3 = await Loan.create({ userId: cust._id, loanAmount: 7000, tenure: 1, interestRate: 0, monthlyEMI: 7000, status: 'submitted' });
await call('POST', `/admin/loans/${l3._id}/approve`, admin, {});
const same = await call('POST', `/admin/loans/${l3._id}/disburse`, admin);
check('the approver is stopped (403, FOUR_EYES)', same.s === 403 && same.d.code === 'FOUR_EYES', JSON.stringify(same.d));
check('the other legacy payout route is stopped too', (await call('POST', `/payments/disburse/${l3._id}`, admin)).s === 403);
check('someone else can release it', (await call('POST', `/admin/loans/${l3._id}/disburse`, tFinance)).s === 200);

section('COLLECTIONS CASES: ONE OWNER AT A TIME');
const od = await Loan.create({ userId: cust._id, loanAmount: 6000, tenure: 2, interestRate: 0, monthlyEMI: 3000, status: 'disbursed', disbursementDate: day(-60) });
await EMIPayment.create({ loanId: od._id, userId: cust._id, emiNumber: 1, dueDate: day(-20), amount: 3000, principalAmount: 3000, status: 'OVERDUE' });
check('agent claims an unassigned case', (await call('POST', `/admin/collections/${od._id}/claim`, tAgent)).d.assignedTo === 'collections_agent3@lifc.in');
check('a second agent cannot claim it (409)', (await call('POST', `/admin/collections/${od._id}/claim`, tAgent2)).s === 409);
check('a second agent cannot add notes to it (409)', (await call('POST', `/admin/collections/${od._id}/notes`, tAgent2, { type: 'NOTE', text: 'hi' })).s === 409);
check('the owner can', (await call('POST', `/admin/collections/${od._id}/notes`, tAgent, { type: 'NOTE', text: 'called' })).s === 200);
const q = await call('GET', '/admin/collections/queue?mine=1', tAgent);
check('"my cases" shows it and shows the owner', q.d.items.length === 1 && q.d.items[0].assignedTo === 'collections_agent3@lifc.in');
check('"my cases" is empty for the other agent', (await call('GET', '/admin/collections/queue?mine=1', tAgent2)).d.items.length === 0);
check('an agent cannot reassign (403)', (await call('POST', `/admin/collections/${od._id}/assign`, tAgent, { to: 'collections_agent4@lifc.in' })).s === 403);
check('a manager reassigns it', (await call('POST', `/admin/collections/${od._id}/assign`, tManager, { to: 'collections_agent4@lifc.in' })).d.assignedTo === 'collections_agent4@lifc.in');
check('assigning to a non-collections person is refused (400)', (await call('POST', `/admin/collections/${od._id}/assign`, tManager, { to: 'finance2@lifc.in' })).s === 400);
check('a manager can add a note on anyone\'s case', (await call('POST', `/admin/collections/${od._id}/notes`, tManager, { type: 'NOTE', text: 'escalating' })).s === 200);
check('only the owner or a manager can release (403)', (await call('POST', `/admin/collections/${od._id}/release`, tAgent)).s === 403);
check('owner releases', (await call('POST', `/admin/collections/${od._id}/release`, tAgent2)).s === 200);
check('auditor can view the queue but not claim (403)', (await call('GET', '/admin/collections/queue', tAuditor)).s === 200 && (await call('POST', `/admin/collections/${od._id}/claim`, tAuditor)).s === 403);

section('ACCESS CAN BE CHANGED AND TAKEN AWAY AT ONCE');
check('promote an agent to manager', (await call('PUT', `/admin/staff/${agent.d.staff.id}`, admin, { role: 'collections_manager' })).s === 200);
check('their old session is signed out', (await call('GET', '/admin/collections/queue', tAgent)).s === 401);
const tAgentNew = await tokenFor(await User.findById(agent.d.staff.id), true);
check('a fresh sign-in has the new role', (await call('POST', `/admin/collections/${od._id}/assign`, tAgentNew, { to: null })).s === 200);
check('deactivate someone', (await call('PUT', `/admin/staff/${auditor.d.staff.id}`, admin, { status: 'inactive' })).s === 200);
check('they are locked out straight away', (await call('GET', '/admin/loans', tAuditor)).s === 401 || (await call('GET', '/admin/loans', tAuditor)).s === 403);
check('reset 2FA turns it off and signs them out', (await call('POST', `/admin/staff/${credit.d.staff.id}/reset-2fa`, admin)).s === 200 && (await User.findById(credit.d.staff.id)).twoFactorEnabled === false);
check('a fresh link can be issued', /reset-password/.test((await call('POST', `/admin/staff/${credit.d.staff.id}/reset-link`, admin)).d.link));
check('nobody can change their own access (403)', (await call('PUT', `/admin/staff/${manager.d.staff.id}`, tManager, { role: 'auditor' })).s === 403);
check('the main admin account cannot be edited here (403)', (await call('PUT', `/admin/staff/${adminUser._id}`, admin, { role: 'auditor' })).s === 403);
const trail = await call('GET', '/admin/compliance/audit?action=STAFF_UPDATED', admin);
check('every staff change is in the audit log by name', trail.d.entries.length >= 2 && trail.d.entries.every(e => e.actor === 'admin@lifc.in' && e.role === 'super_admin'));
const mine = await call('GET', '/admin/compliance/audit?action=COLLECTION_CASE_CLAIMED', admin);
check('staff actions are recorded under their own name and role', mine.d.entries.some(e => e.actor === 'collections_agent3@lifc.in' && e.role === 'collections_agent'), JSON.stringify(mine.d.entries[0]));

section('PAGING');
const pg = await call('GET', '/admin/loans?limit=2&page=1', admin);
check('loan list pages', pg.s === 200 && pg.d.loans.length === 2 && pg.d.pages >= 2 && pg.d.page === 1);

await srv.stop();
await disconnect();
finish();
