import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Role from '../../src/models/Role.js';
import ChangeRequest from '../../src/models/ChangeRequest.js';

const DB = 'fintech-test-approvals';
await connect(DB);
await Role.create([
  { key: 'marketer', label: 'Marketer', description: 't', permissions: ['banners.edit', 'pricing.view', 'pricing.edit'] },
  { key: 'approver', label: 'Approver', description: 't', permissions: ['changes.approve', 'banners.edit', 'pricing.view', 'pricing.edit'] },
  { key: 'viewer', label: 'Viewer', description: 't', permissions: ['pricing.view'] },
]);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const staff = (role, n) => User.create({ firstName: role, lastName: 'S', email: `${role}${n}@lifc.in`, phone: `97000000${n}`, password: 'x12345678', role, twoFactorEnabled: true });
const [marketer, approver, viewer] = await Promise.all([staff('marketer', 1), staff('approver', 2), staff('viewer', 3)]);
const [tm, ta, tv] = await Promise.all([tokenFor(marketer, true), tokenFor(approver, true), tokenFor(viewer, true)]);
const banner = title => ({ banners: [{ id: 'x1', title, cta: { text: '', action: 'none' } }] });

section('RULE IS OFF BY DEFAULT');
const direct = await call('PUT', '/app-home/admin', tm, banner('Direct'));
check('with the rule off, a banner change goes straight live', direct.s === 200 && !direct.d.pending && direct.d.home.banners[0].title === 'Direct', JSON.stringify(direct.d).slice(0, 200));

section('SWITCHING THE RULE ON');
check('only the super admin can switch it (403)', (await call('PUT', '/admin/approvals/settings', ta, { banners: true, pricing: true })).s === 403);
const on = await call('PUT', '/admin/approvals/settings', admin, { banners: true, pricing: true });
check('super admin switches it on', on.s === 200 && on.d.settings.banners && on.d.settings.pricing);

section('A BANNER CHANGE NEEDS A SECOND PERSON');
const prop = await call('PUT', '/app-home/admin', tm, banner('Needs approval'));
check('saving now sends it for approval (202)', prop.s === 202 && prop.d.pending === true && prop.d.requestId, JSON.stringify(prop.d).slice(0, 200));
check('customers still see the old content', (await call('GET', '/app-home/admin', admin)).d.home.banners[0].title === 'Direct');
check('an invalid proposal is refused up front (400)', (await call('PUT', '/app-home/admin', tm, { banners: [{ title: '' }] })).s === 400);
const list = await call('GET', '/admin/approvals', ta);
const mine = list.d.requests.find(r => r.status === 'pending');
check('the approver sees the request with a readable summary', list.d.canApprove && mine && mine.requestedBy === 'marketer1@lifc.in' && mine.summary.length > 0, JSON.stringify(list.d).slice(0, 300));
check('a person without the permission sees only their own', (await call('GET', '/admin/approvals', tv)).d.requests.length === 0 && (await call('GET', '/admin/approvals', tm)).d.requests.length === 1);
check('the proposer cannot approve their own change (403)', (await call('POST', `/admin/approvals/${mine.id}/approve`, tm, {})).s === 403);
check('a role without the permission cannot approve (403)', (await call('POST', `/admin/approvals/${mine.id}/approve`, tv, {})).s === 403);
check('rejecting without a reason is refused', (await call('POST', `/admin/approvals/${mine.id}/reject`, admin, {})).s === 400, 'a reason is needed to reject');
const ok = await call('POST', `/admin/approvals/${mine.id}/approve`, ta, {});
check('a second person approves and it goes live', ok.s === 200 && (await call('GET', '/app-home/admin', admin)).d.home.banners[0].title === 'Needs approval', JSON.stringify(ok.d));
check('approving twice is refused (409)', (await call('POST', `/admin/approvals/${mine.id}/approve`, ta, {})).s === 409);

section('REJECT, WITHDRAW AND STALE REQUESTS');
const p2 = (await call('PUT', '/app-home/admin', tm, banner('Second try'))).d.requestId;
check('rejecting needs a reason (400)', (await call('POST', `/admin/approvals/${p2}/reject`, ta, {})).s === 400);
check('rejected with a reason', (await call('POST', `/admin/approvals/${p2}/reject`, ta, { note: 'Wording not approved' })).d.request.status === 'rejected');
const p3 = (await call('PUT', '/app-home/admin', tm, banner('Third try'))).d.requestId;
check('only the proposer can withdraw (403)', (await call('POST', `/admin/approvals/${p3}/withdraw`, ta, {})).s === 403);
check('the proposer withdraws', (await call('POST', `/admin/approvals/${p3}/withdraw`, tm, {})).d.request.status === 'withdrawn');
const p4 = (await call('PUT', '/app-home/admin', tm, banner('Fourth'))).d.requestId;
const p5 = (await call('PUT', '/app-home/admin', tm, banner('Fifth'))).d.requestId;
check('a new proposal replaces the proposer\'s older open one', (await ChangeRequest.findById(p4)).status === 'withdrawn' && (await ChangeRequest.findById(p5)).status === 'pending');
await ChangeRequest.updateOne({ _id: p5 }, { baseHash: 'old' });
const stale = await call('POST', `/admin/approvals/${p5}/approve`, ta, {});
check('a request made against an older version cannot be approved (409)', stale.s === 409 && /changed after/.test(stale.d.error), JSON.stringify(stale.d));

section('PRICING USES THE SAME RULE');
const pp = await call('PUT', '/admin/pricing', tm, { annualRatePercent: 14 });
check('a pricing change is held for approval (202)', pp.s === 202 && pp.d.pending && pp.d.policy.annualRatePercent === 15, JSON.stringify(pp.d).slice(0, 200));
check('the rate is unchanged until approved', (await call('GET', '/pricing', null)).d.policy.annualRatePercent === 15);
const pid = pp.d.requestId;
const line = (await call('GET', '/admin/approvals', ta)).d.requests.find(r => r.id === pid).summary.join('|');
check('the summary names the changed number', /annualRatePercent: 15 -> 14/.test(line), line);
check('approval applies it', (await call('POST', `/admin/approvals/${pid}/approve`, ta, {})).s === 200 && (await call('GET', '/pricing', null)).d.policy.annualRatePercent === 14);
check('a viewer still cannot change pricing (403)', (await call('PUT', '/admin/pricing', tv, { annualRatePercent: 12 })).s === 403);

section('AUDIT TRAIL');
const audit = JSON.stringify((await call('GET', '/admin/compliance/audit?limit=100', admin)).d);
check('proposals, approvals, rejections and the rule change are all logged', ['CHANGE_PROPOSED', 'CHANGE_APPROVED', 'CHANGE_REJECTED', 'CHANGE_WITHDRAWN', 'CHANGE_APPROVAL_RULE_SET', 'PRICING_UPDATED', 'APP_HOME_UPDATED'].every(a => audit.includes(a)));
check('the audit entry for the live change names who proposed and who approved', audit.includes('proposedBy') && audit.includes('approvedBy'));

await srv.stop();
await disconnect();
finish();
