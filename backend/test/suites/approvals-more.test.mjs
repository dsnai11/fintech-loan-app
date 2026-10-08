import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Role from '../../src/models/Role.js';
import Offer from '../../src/models/Offer.js';
import ChangeRequest from '../../src/models/ChangeRequest.js';

const DB = 'fintech-test-approvals-more';
await connect(DB);
await Role.create([
  { key: 'maker', label: 'Maker', description: 't', permissions: ['banners.edit', 'decisions.view', 'decisions.edit'] },
  { key: 'checker', label: 'Checker', description: 't', permissions: ['changes.approve', 'banners.edit', 'decisions.view', 'decisions.edit'] },
]);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const staff = (role, n) => User.create({ firstName: role, lastName: 'S', email: `${role}${n}@lifc.in`, phone: `97600000${n}`, password: 'x12345678', role, twoFactorEnabled: true });
const [maker, checker] = await Promise.all([staff('maker', 1), staff('checker', 2)]);
const [tm, tc] = await Promise.all([tokenFor(maker, true), tokenFor(checker, true)]);
const cust = await User.create({ firstName: 'Cu', lastName: 'St', email: 'cu@x.in', phone: '9660000001', password: 'x12345678', kycStatus: 'approved' });
const tcust = await tokenFor(cust);
const offer = (over = {}) => ({ title: 'Festival offer', summary: 'Quick loans', details: 'Details', status: 'published', cta: { text: 'Apply', action: 'apply' }, ...over });

section('THE TWO NEW SWITCHES');
check('the settings now have offers and decision rules', (await call('GET', '/admin/approvals', admin)).d.settings.offers === false && (await call('GET', '/admin/approvals', admin)).d.settings.decisions === false);
check('with the rule off, an offer goes straight live', (await call('POST', '/admin/offers', tm, offer({ title: 'Direct' }))).s === 201);
const on = await call('PUT', '/admin/approvals/settings', admin, { offers: true, decisions: true });
check('the super admin switches both on', on.s === 200 && on.d.settings.offers && on.d.settings.decisions && !on.d.settings.pricing);

section('DECISION RULES');
const rules = await call('PUT', '/admin/decisions/rules', tm, { mode: 'auto', velocity: { enabled: true, days: 30, referAt: 3, rejectAt: 5 } });
check('changing the rules is held for approval (202)', rules.s === 202 && rules.d.pending === true, JSON.stringify(rules.d).slice(0, 160));
check('the rules have not changed yet', (await call('GET', '/admin/decisions/rules', admin)).d.rules.mode === 'shadow');
check('an invalid proposal is refused up front (400)', (await call('PUT', '/admin/decisions/rules', tm, { velocity: { enabled: true, referAt: 9, rejectAt: 2 } })).s === 400);
const list = await call('GET', '/admin/approvals', tc);
const req1 = list.d.requests.find(r => r.target === 'DECISION_RULES');
check('the approver sees what would change, in words', !!req1 && req1.label === 'Decision rules' && req1.summary.some(l => /mode: shadow -> auto/.test(l)) && req1.summary.some(l => /velocity\.enabled/.test(l)), JSON.stringify(req1));
check('the proposer cannot approve it (403)', (await call('POST', `/admin/approvals/${req1.id}/approve`, tm, {})).s === 403);
check('another person approves and the rules change', (await call('POST', `/admin/approvals/${req1.id}/approve`, tc, {})).s === 200 && (await call('GET', '/admin/decisions/rules', admin)).d.rules.mode === 'auto');

section('OFFERS: DRAFTS ARE FREE, PUBLISHING NEEDS A SECOND PERSON');
const draft = await call('POST', '/admin/offers', tm, offer({ title: 'Work in progress', status: 'draft' }));
check('a draft saves straight away', draft.s === 201 && draft.d.offer.status === 'draft');
const held = await call('POST', '/admin/offers', tm, offer({ title: 'New festival offer' }));
check('a published new offer is held (202) and does not exist yet', held.s === 202 && held.d.pending && !(await Offer.findOne({ title: 'New festival offer' })), JSON.stringify(held.d));
check('customers see nothing yet', (await call('GET', '/offers', tcust)).d.offers.filter(o => o.title === 'New festival offer').length === 0);
const reqO = (await call('GET', '/admin/approvals', tc)).d.requests.find(r => r.target === 'OFFER' && r.status === 'pending');
check('the approver sees the offer, its status and audience', reqO.label === 'Offers tab' && reqO.summary.some(l => /New festival offer/.test(l)) && reqO.summary.some(l => /published/.test(l)), JSON.stringify(reqO.summary));
check('approving creates it and it is live', (await call('POST', `/admin/approvals/${reqO.id}/approve`, tc, {})).s === 200 && (await call('GET', '/offers', tcust)).d.offers.some(o => o.title === 'New festival offer'));
const made = await Offer.findOne({ title: 'New festival offer' });
check('the offer records who proposed and who approved', /maker1@lifc.in \(approved by checker2@lifc.in\)/.test(made.createdBy), made.createdBy);

section('OFFERS: CHANGING AND TAKING DOWN');
const edit = await call('PUT', `/admin/offers/${made._id}`, tm, { title: 'New festival offer v2' });
check('editing a live offer is held (202) and the old text stays', edit.s === 202 && (await Offer.findById(made._id)).title === 'New festival offer');
const reqE = (await call('GET', '/admin/approvals', tc)).d.requests.find(r => r.target === 'OFFER' && r.status === 'pending');
check('the summary shows the changed words', reqE.summary.some(l => /title: New festival offer -> New festival offer v2/.test(l)), JSON.stringify(reqE.summary));
const sneaky = await call('PUT', `/admin/offers/${made._id}`, admin, { status: 'draft' });
check('taking an offer down is never held, even with the rule on', sneaky.s === 200 && sneaky.d.offer.status === 'draft' && !(await call('GET', '/offers', tcust)).d.offers.some(o => o.title.startsWith('New festival')));
const stale = await call('POST', `/admin/approvals/${reqE.id}/approve`, tc, {});
check('a change proposed before someone took the offer down cannot be approved on stale information (409)', stale.s === 409 && /changed after/.test(stale.d.error), JSON.stringify(stale.d));
check('deleting is always immediate', (await call('DELETE', `/admin/offers/${made._id}`, tm)).s === 200 && !(await Offer.findById(made._id)));
const again = await call('POST', '/admin/offers', tm, offer({ title: 'Second offer' }));
await call('POST', '/admin/offers', tm, offer({ title: 'Second offer (newer)' }));
check('proposing a new offer does not cancel another new offer waiting for approval', (await ChangeRequest.countDocuments({ target: 'OFFER', status: 'pending', 'proposed.op': 'create' })) === 2 && again.s === 202);
const rejectId = (await ChangeRequest.findOne({ target: 'OFFER', status: 'pending', 'proposed.data.title': 'Second offer' }))._id;
check('a rejected offer is never created', (await call('POST', `/admin/approvals/${rejectId}/reject`, tc, { note: 'Wording not approved' })).s === 200 && !(await Offer.findOne({ title: 'Second offer' })));

section('AUDIT');
const audit = JSON.stringify((await call('GET', '/admin/compliance/audit?limit=200', admin)).d);
check('the live changes name who proposed and who approved', ['DECISION_RULES_UPDATED', 'OFFER_CREATED', 'proposedBy', 'approvedBy', 'CHANGE_REJECTED'].every(a => audit.includes(a)));

await srv.stop();
await disconnect();
finish();
