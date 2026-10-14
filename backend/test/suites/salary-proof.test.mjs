import crypto from 'crypto';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Role from '../../src/models/Role.js';
import AuditLog from '../../src/models/AuditLog.js';
import Notification from '../../src/models/Notification.js';
import SalarySlip from '../../src/models/SalarySlip.js';
import SalarySlipFile from '../../src/models/SalarySlipFile.js';
import { incomeBasis } from '../../src/services/aaService.js';
import { proofOf } from '../../src/services/salaryProofService.js';
import { validateRules, DEFAULTS } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-salary-proof';
await connect(DB);
await Role.create([{ key: 'kycview', label: 'V', description: 't', permissions: ['kyc.view'] }]);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const DAY = 864e5;

// A small valid-looking JPEG: the real header bytes, then filler that makes each one different
const jpeg = (tag, size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.createHash('sha256').update(tag).digest(), Buffer.alloc(size, 7)]).toString('base64');
let n = 0;
const mk = async (over = {}) => { n++; const u = await User.create({ firstName: `Sal${n}`, lastName: 'Ary', email: `sal${n}@x.in`, phone: `98400000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, employment: { status: 'Employed', monthlyIncome: 40000, company: 'Acme Corp', salaryDay: 28 }, ...over }); return { u, t: await tokenFor(u) }; };
const send = (c, body) => call('POST', '/salary-proof', c.t, { monthlyIncome: 30000, employer: 'Acme Corp', images: [{ data: jpeg('a' + Math.random()) }], ...body });

section('SENDING A SLIP');
const c1 = await mk();
const st0 = (await call('GET', '/salary-proof/status', c1.t)).d;
check('at first nothing is verified and the customer can upload', st0.verified === false && st0.canUpload === true && st0.latest === null);
check('with no photo it is refused', (await send(c1, { images: [] })).s === 400);
check('more than 3 photos is refused', (await send(c1, { images: [1, 2, 3, 4].map(i => ({ data: jpeg('m' + i) })) })).s === 400);
check('an income of 500 is refused', (await send(c1, { monthlyIncome: 500 })).s === 400);
check('a file that is not a picture is refused', (await send(c1, { images: [{ data: Buffer.from('this is a text file').toString('base64') }] })).s === 400);
check('a photo that is too large is refused', (await send(c1, { images: [{ data: jpeg('big', 1300000) }] })).s === 400);
check('the same photo twice is refused', (await send(c1, { images: [{ data: jpeg('dup') }, { data: jpeg('dup') }] })).s === 400);
const old = new Date(Date.now() - 200 * DAY), fut = new Date(Date.now() + 90 * DAY);
const ym = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
check('a slip from 6 months ago is refused', (await send(c1, { slipMonth: ym(old) })).s === 400);
check('a slip from a month that has not come is refused', (await send(c1, { slipMonth: ym(fut) })).s === 400);
check('a badly written month is refused', (await send(c1, { slipMonth: 'last month' })).s === 400);
const ok = await send(c1, { slipMonth: ym(new Date()), images: [{ data: jpeg('c1-1') }, { data: `data:image/jpeg;base64,${jpeg('c1-2')}` }] });
check('a good slip with 2 photos is accepted (201); a "data:" prefix is fine', ok.s === 201, JSON.stringify(ok.d));
const slip = await SalarySlip.findOne({ userId: c1.u._id });
check('it is saved as pending, with the photos kept apart and set to be deleted by the database', slip.status === 'pending' && slip.images === 2 && (await SalarySlipFile.countDocuments({ slipId: slip._id })) === 2 && (await SalarySlipFile.findOne({ slipId: slip._id })).deleteAt > new Date(Date.now() + 40 * DAY));
check('a second slip while one is being checked is refused (409)', (await send(c1, {})).s === 409);
check('the customer sees it is pending', (await call('GET', '/salary-proof/status', c1.t)).d.latest.status === 'pending' && (await call('GET', '/salary-proof/status', c1.t)).d.canUpload === false);
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'SALARY_SLIP_SENT' })));
check('sign-in is needed', (await call('POST', '/salary-proof', null, {})).s === 401);

section('STAFF CHECK IT');
const c2 = await mk({ employment: { status: 'Employed', monthlyIncome: 25000, company: 'Other Co', salaryDay: 5 } });
await send(c2, { images: [{ data: jpeg('c1-1') }] }); // the same photo another customer already sent
const q = await call('GET', '/admin/salary-proof', admin);
check('staff see the waiting slips with the claim next to what the customer declared', q.s === 200 && q.d.slips.length === 2 && q.d.slips[0].claimedIncome === 30000 && q.d.slips[0].declaredIncome === 40000 && q.d.slips[0].declaredEmployer === 'Acme Corp', JSON.stringify(q.d.slips[0]));
check('a photo that another customer already sent is flagged', q.d.slips.find(s => s.customer.startsWith('Sal2')).duplicate === true && q.d.slips.find(s => s.customer.startsWith('Sal1')).duplicate === false);
const id1 = q.d.slips.find(s => s.customer.startsWith('Sal1')).id;
const photo = await fetch(`${srv.base}/admin/salary-proof/${id1}/photo/0`, { headers: { Authorization: `Bearer ${admin}` } });
const bytes = Buffer.from(await photo.arrayBuffer());
check('staff can open a photo, it is the picture that was sent, and it is never cached', photo.status === 200 && photo.headers.get('content-type') === 'image/jpeg' && bytes[0] === 0xff && /no-store/.test(photo.headers.get('cache-control')));
check('opening it is logged', !!(await AuditLog.findOne({ action: 'SALARY_SLIP_VIEWED' })));
check('a missing photo is a 404', (await fetch(`${srv.base}/admin/salary-proof/${id1}/photo/9`, { headers: { Authorization: `Bearer ${admin}` } })).status === 404);
const viewer = await User.create({ firstName: 'Vi', lastName: 'Ew', email: 'kyc-viewer@x.in', phone: '9840099999', password: 'x12345678', role: 'kycview', twoFactorEnabled: true });
const vt = await tokenFor(viewer);
check('a viewer can look but not decide (403)', (await call('GET', '/admin/salary-proof', vt)).s === 200 && (await call('PUT', `/admin/salary-proof/${id1}`, vt, { decision: 'approve', verifiedIncome: 30000 })).s === 403);
check('a customer cannot open the queue', [401, 403].includes((await call('GET', '/admin/salary-proof', c1.t)).s));

section('APPROVING');
check('confirming more than the customer claimed is refused (400)', (await call('PUT', `/admin/salary-proof/${id1}`, admin, { decision: 'approve', verifiedIncome: 45000 })).s === 400);
check('a missing income is refused', (await call('PUT', `/admin/salary-proof/${id1}`, admin, { decision: 'approve' })).s === 400);
check('an unknown decision is refused', (await call('PUT', `/admin/salary-proof/${id1}`, admin, { decision: 'maybe' })).s === 400);
const appr = await call('PUT', `/admin/salary-proof/${id1}`, admin, { decision: 'approve', verifiedIncome: 28000, verifiedEmployer: 'Acme Corporation' });
check('confirming a salary works', appr.s === 200, JSON.stringify(appr.d));
const u1 = await User.findById(c1.u._id);
check('the customer now has proof for about 90 days, at the income staff confirmed', u1.salaryProof.income === 28000 && u1.salaryProof.employer === 'Acme Corporation' && Math.abs(new Date(u1.salaryProof.until) - (Date.now() + 90 * DAY)) < 60000);
check('the customer is told', !!(await Notification.findOne({ userId: c1.u._id, type: 'KYC_UPDATE', title: 'Salary confirmed' })));
check('the photos are set to be deleted about 30 days after the decision', (await SalarySlipFile.findOne({ slipId: slip._id })).deleteAt < new Date(Date.now() + 31 * DAY));
check('a slip cannot be decided twice (409)', (await call('PUT', `/admin/salary-proof/${id1}`, admin, { decision: 'reject', reason: 'oops' })).s === 409);
check('the customer sees it as verified', (await call('GET', '/salary-proof/status', c1.t)).d.verified === true && (await call('GET', '/salary-proof/status', c1.t)).d.income === 28000);
check('it is in the audit log with the confirmed income', !!(await AuditLog.findOne({ action: 'SALARY_SLIP_APPROVED' })));

section('REJECTING');
const id2 = q.d.slips.find(s => s.customer.startsWith('Sal2')).id;
check('rejecting without a reason is refused', (await call('PUT', `/admin/salary-proof/${id2}`, admin, { decision: 'reject' })).s === 400);
check('rejecting with a reason works', (await call('PUT', `/admin/salary-proof/${id2}`, admin, { decision: 'reject', reason: 'The photo is blurred' })).s === 200);
const s2 = (await call('GET', '/salary-proof/status', c2.t)).d;
check('the customer sees the reason and can try again', s2.verified === false && s2.latest.status === 'rejected' && s2.latest.reason === 'The photo is blurred' && s2.canUpload === true);
check('and they are told', !!(await Notification.findOne({ userId: c2.u._id, title: /could not confirm/ })));
check('a second try is accepted', (await send(c2, { images: [{ data: jpeg('c2-retry') }] })).s === 201);

section('WHERE IT FITS IN THE INCOME ORDER');
check('a checked slip is used instead of what the customer declared', incomeBasis(u1).source === 'salary slip' && incomeBasis(u1).amount === 28000);
const withStatements = { ...u1.toObject(), incomeCheck: { at: new Date(), estimatedMonthlyIncome: 33000 } };
check('bank statements, when there are some, come first', incomeBasis(withStatements).source === 'bank statements' && incomeBasis(withStatements).amount === 33000);
const expired = { ...u1.toObject(), salaryProof: { ...u1.salaryProof, until: new Date(Date.now() - 1000) } };
check('a slip that has run out no longer counts: back to what was declared', incomeBasis(expired).source === 'declared' && proofOf(expired) === null);
check('the rules can use it', validateRules({ ...DEFAULTS, custom: [{ name: 'No proof', field: 'salarySlipVerified', op: '=', value: false, result: 'refer' }, { name: 'Low proved salary', field: 'salaryProofIncome', op: '<', value: 20000, result: 'refer' }] }).errors.length === 0);

section('THE PAYDAY ADVANCE');
const setPayday = body => call('PUT', '/admin/payday/settings', admin, { enabled: true, minAmount: 1000, maxAmount: 25000, maxIncomePercent: 50, feePercent: 4, minDaysToPayday: 5, repayDaysAfterSalary: 1, requireSalaried: true, requireVerifiedIncome: true, acceptSalarySlip: true, slipMaxAmount: 5000, ...body });
check('the payday settings accept the new fields', (await setPayday({})).s === 200);
check('a bad slip limit is refused', (await setPayday({ slipMaxAmount: -5 })).s === 400);
const e1 = (await call('GET', '/payday/status', c1.t)).d;
check('salary proved by a slip: eligible, but only up to the slip limit', e1.eligible === true && e1.incomeSource === 'salary slip' && e1.maxAmount === 5000 && e1.needsProof === false, JSON.stringify([e1.eligible, e1.incomeSource, e1.maxAmount]));
const c3 = await mk();
const e3 = (await call('GET', '/payday/status', c3.t)).d;
check('no proof at all: not eligible, told to share statements or upload a slip', e3.eligible === false && e3.needsProof === true && /salary slip/.test(e3.firstProblem), e3.firstProblem);
await setPayday({ acceptSalarySlip: false });
const e1b = (await call('GET', '/payday/status', c1.t)).d;
check('with slips switched off (for example once bank statements are connected) a slip is no longer enough', e1b.eligible === false && e1b.needsProof === true && /bank statements/.test(e1b.firstProblem));
await setPayday({ acceptSalarySlip: true, slipMaxAmount: 0 });
check('with no extra slip limit the usual income share applies (50% of 28,000)', (await call('GET', '/payday/status', c1.t)).d.maxAmount === 14000);
await setPayday({ requireVerifiedIncome: false });
check('with proof not required, a declared income is enough and the slip limit does not apply', (await call('GET', '/payday/status', c3.t)).d.eligible === true);
await SalarySlip.deleteMany({});

srv.stop();
await disconnect();
finish();
