import crypto from 'crypto';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import KycMedia from '../../src/models/KycMedia.js';
import LivenessChallenge from '../../src/models/LivenessChallenge.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import AuditLog from '../../src/models/AuditLog.js';
import { analyseBlinks, jpegInfo } from '../../src/services/livenessService.js';

const DB = 'fintech-test-setup';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_ONBOARDING: 'true' });
const base = srv.base;
const call = client(base);
const { token: admin } = await makeAdmin();

// A stand-in for a camera photo: the header the server reads (size and dimensions), padded to a realistic size.
function jpeg(w = 480, h = 640, kb = 20) {
  const pad = crypto.randomBytes(kb * 1024);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([(pad.length + 2) >> 8, (pad.length + 2) & 255]), pad]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), com, sof, Buffer.from([0xff, 0xd9])]).toString('base64');
}
// What the camera saw of the eyes: open (0.9) with a short dip to 0.1 at each blink time.
function timeline({ blinks = [1500, 3500], total = 6000, step = 100, closedFor = 200, startClosed = false, alwaysClosed = false } = {}) {
  const rows = [];
  for (let t = 0; t <= total; t += step) {
    const closed = alwaysClosed || (startClosed && t < 400) || blinks.some(b => t >= b && t < b + closedFor);
    rows.push([t, closed ? 0.1 : 0.9, closed ? 0.12 : 0.88]);
  }
  return rows;
}
let n = 0;
const mk = async (over = {}) => {
  n++;
  const u = await User.create({ firstName: `Cust${n}`, lastName: 'S', email: `s${n}@x.in`, phone: `93${String(n).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, ...over });
  return { u, tok: await tokenFor(u), n };
};
// Asks for a challenge, and makes it look as if the customer has had time to blink.
async function challenge(c) {
  const r = await call('POST', '/onboarding/selfie/challenge', c.tok);
  await LivenessChallenge.updateOne({ _id: r.d.challengeId }, { issuedAt: new Date(Date.now() - 20000) });
  return r.d.challengeId;
}
const selfie = (c, body) => call('POST', '/onboarding/selfie', c.tok, body);
const good = async c => ({ challengeId: await challenge(c), before: jpeg(), after: jpeg(), blink: { samples: timeline() } });
const origin = base.replace(/\/api$/, '');
// The customer verifies with DigiLocker (test mode): opens the stand-in page and allows.
async function kycFor(c, name) {
  const st = await call('POST', '/kyc/digilocker/start', c.tok);
  const url = origin + new URL(st.d.url).pathname;
  const u = await User.findById(c.u._id);
  await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: name || `${u.firstName} ${u.lastName}`, dob: '1992-04-12', gender: 'Male', last4: String(c.n).padStart(4, '0'), pan: '', street: '12 MG Road, Ashok Nagar', city: 'Jaipur', state: 'Rajasthan', zip: '302001', action: 'allow' }) });
}
const profile = { gender: 'Male', dateOfBirth: '1992-04-12', address: { street: '12 MG Road, Ashok Nagar', city: 'Jaipur', state: 'Rajasthan', zipCode: '302001' }, employment: { status: 'Employed', company: 'Acme', monthlyIncome: 45000 } };

section('THE BLINK CHECK ON ITS OWN');
check('two clean blinks pass', analyseBlinks(timeline()).ok && analyseBlinks(timeline()).blinks === 2);
check('one blink is not enough', !analyseBlinks(timeline({ blinks: [2000] })).ok && analyseBlinks(timeline({ blinks: [2000] })).blinks === 1);
check('no blinking at all fails', !analyseBlinks(timeline({ blinks: [] })).ok);
check('eyes shut the whole time fails', !analyseBlinks(timeline({ alwaysClosed: true })).ok);
check('eyes must be open at the start', !analyseBlinks(timeline({ startClosed: true })).ok);
check('three blinks is fine', analyseBlinks(timeline({ blinks: [1000, 2500, 4000] })).ok);
check('a blink that lasts over a second and a half does not count', analyseBlinks(timeline({ blinks: [1000, 3000], closedFor: 1700 })).blinks === 0);
check('too short a video fails', !analyseBlinks(timeline({ total: 900, blinks: [300, 600] })).ok);
check('too few readings fails', !analyseBlinks(timeline().slice(0, 5)).ok);
check('readings out of order fail', !analyseBlinks([...timeline().slice(0, 20), [50, 0.9, 0.9]]).ok);
check('readings outside 0 to 1 fail', !analyseBlinks(timeline().map((r, i) => (i === 3 ? [r[0], 7, 0.9] : r))).ok);
check('rubbish fails without crashing', !analyseBlinks('hello').ok && !analyseBlinks(null).ok && !analyseBlinks([[1], [2]]).ok);
check('a JPEG header is read for its size', jpegInfo(Buffer.from(jpeg(480, 640), 'base64')).width === 480 && jpegInfo(Buffer.from(jpeg(480, 640), 'base64')).height === 640 && !jpegInfo(Buffer.from('hello world')).ok);

section('PERSONAL DETAILS');
const c1 = await mk();
const st0 = await call('GET', '/onboarding/status', c1.tok);
check('a new account has nothing set up yet', st0.s === 200 && !st0.d.steps.profile && !st0.d.steps.selfie && !st0.d.steps.bank && !st0.d.steps.complete);
check('no login -> 401', (await call('GET', '/onboarding/status', null)).s === 401);
const bad = (over) => call('PUT', '/onboarding/profile', c1.tok, { ...profile, ...over });
check('a gender is required (400)', (await bad({ gender: 'x' })).s === 400);
check('under 18 is refused (400)', (await bad({ dateOfBirth: new Date(Date.now() - 16 * 365.25 * 864e5).toISOString() })).s === 400);
check('a bad date of birth is refused (400)', (await bad({ dateOfBirth: 'soon' })).s === 400);
check('a short address is refused (400)', (await bad({ address: { ...profile.address, street: 'x' } })).s === 400);
check('a bad PIN code is refused (400)', (await bad({ address: { ...profile.address, zipCode: '12ab' } })).s === 400);
check('an unknown state is refused (400)', (await bad({ address: { ...profile.address, state: 'Narnia' } })).s === 400);
check('an employed person must give an income (400)', (await bad({ employment: { status: 'Employed', monthlyIncome: 0 } })).s === 400);
check('a student need not', (await bad({ employment: { status: 'Student' } })).s === 200);
const saved = await call('PUT', '/onboarding/profile', c1.tok, profile);
check('valid details are saved', saved.s === 200 && saved.d.steps.profile === true, JSON.stringify(saved.d));
const u1 = await User.findById(c1.u._id);
check('and stored where the rest of the system reads them', u1.address.city === 'Jaipur' && u1.address.zipCode === '302001' && u1.employment.monthlyIncome === 45000 && u1.gender === 'Male' && new Date(u1.dateOfBirth).getFullYear() === 1992);

section('THE SELFIE: ASKING AND ANSWERING');
const ch = await call('POST', '/onboarding/selfie/challenge', c1.tok);
check('a challenge asks for two blinks and runs out', ch.s === 200 && ch.d.blinks === 2 && ch.d.expiresInSeconds === 180 && !!ch.d.challengeId);
check('a made-up challenge is refused (400)', (await selfie(c1, { challengeId: 'nonsense', before: jpeg(), after: jpeg(), blink: { samples: timeline() } })).s === 400);
const ok = await selfie(c1, await good(c1));
check('two blinks and two photos are accepted', ok.s === 200 && ok.d.selfie.status === 'passed' && ok.d.steps.selfie === true, JSON.stringify(ok.d));
const u2 = await User.findById(c1.u._id);
check('the result is kept on the account with the number of blinks', u2.selfie.status === 'passed' && u2.selfie.blinks === 2 && u2.selfie.method === 'blink_on_device');
check('both photos are stored', (await KycMedia.countDocuments({ userId: c1.u._id })) === 2);
check('the photos are not on the user record', !JSON.stringify(u2.toObject()).includes('/9j/') && !('data' in (await KycMedia.findOne({ userId: c1.u._id })).toObject()));
const own = await fetch(base + '/onboarding/selfie/image', { headers: { Authorization: `Bearer ${c1.tok}` } });
check('the customer can see their own photo', own.status === 200 && own.headers.get('content-type') === 'image/jpeg' && (await own.arrayBuffer()).byteLength > 8000);
check('it is not cached', /no-store/.test(own.headers.get('cache-control') || ''));
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'SELFIE_CAPTURED', actor: c1.u.email })));

section('THE SELFIE: THINGS THAT MUST FAIL');
const c2 = await mk();
const reuse = await good(c2);
check('the first try passes', (await selfie(c2, reuse)).s === 200);
check('the same challenge cannot be used again (400)', (await selfie(c2, reuse)).d.code === 'CHALLENGE_EXPIRED');
const c3 = await mk();
const body3 = await good(c3);
check("one customer cannot use another's challenge (400)", (await selfie(c3, { ...body3, challengeId: await challenge(c2) })).d.code === 'CHALLENGE_EXPIRED');
const c4 = await mk();
const exp = await challenge(c4);
await LivenessChallenge.updateOne({ _id: exp }, { expiresAt: new Date(Date.now() - 1000) });
check('an expired challenge is refused (400)', (await selfie(c4, { challengeId: exp, before: jpeg(), after: jpeg(), blink: { samples: timeline() } })).d.code === 'CHALLENGE_EXPIRED');
const f = async (c, over) => selfie(c, { ...(await good(c)), ...over });
const c5 = await mk();
check('only one blink fails (422)', (await f(c5, { blink: { samples: timeline({ blinks: [2000] }) } })).d.code === 'LIVENESS_FAILED');
check('no blink fails with a reason the customer can act on', /blink/.test((await f(c5, { blink: { samples: timeline({ blinks: [] }) } })).d.error));
const same = jpeg();
check('the same picture twice fails (422)', (await f(c5, { before: same, after: same })).d.code === 'PHOTO_INVALID');
check('something that is not a JPEG fails (422)', (await f(c5, { after: Buffer.from('x'.repeat(20000)).toString('base64') })).d.code === 'PHOTO_INVALID');
const c6 = await mk();
check('a tiny photo fails (422)', (await f(c6, { before: jpeg(480, 640, 1) })).d.code === 'PHOTO_INVALID');
check('a photo that is too small in pixels fails (422)', (await f(c6, { before: jpeg(100, 100, 20) })).d.code === 'PHOTO_INVALID');
check('a missing photo fails (422)', (await f(c6, { after: undefined })).s === 422);
const c7 = await mk();
const quick = await call('POST', '/onboarding/selfie/challenge', c7.tok);
check('a check that claims more time than has passed since the challenge fails (422)', (await selfie(c7, { challengeId: quick.d.challengeId, before: jpeg(), after: jpeg(), blink: { samples: timeline({ total: 12000, blinks: [2000, 6000] }) } })).d.code === 'LIVENESS_FAILED');
check('a failed attempt left no photos or status behind', (await KycMedia.countDocuments({ userId: c7.u._id })) === 0 && !(await User.findById(c7.u._id)).selfie);
check('failed attempts are in the audit log', !!(await AuditLog.findOne({ action: 'SELFIE_REJECTED', actor: c5.u.email })));
const c8 = await mk();
let last;
for (let i = 0; i < 7; i++) last = await f(c8, { blink: { samples: timeline({ blinks: [] }) } });
check('after six attempts in an hour the customer is slowed down (429)', last.s === 429);

section('RETAKING, AND THE SAME PHOTO ON TWO ACCOUNTS');
const before1 = (await KycMedia.find({ userId: c1.u._id })).map(m => m.sha256);
check('a retake replaces the old photos', (await selfie(c1, await good(c1))).s === 200 && (await KycMedia.countDocuments({ userId: c1.u._id })) === 2 && !(await KycMedia.find({ userId: c1.u._id })).some(m => before1.includes(m.sha256)));
const c9 = await mk(), c10 = await mk();
const shared = jpeg();
const g9 = await good(c9);
check('the first account with a photo passes', (await selfie(c9, { ...g9, before: shared })).d.selfie.status === 'passed');
const g10 = await good(c10);
const r10 = await selfie(c10, { ...g10, before: shared });
check('the same photo on a second account is accepted but held for staff to look at', r10.s === 200 && r10.d.selfie.status === 'review', JSON.stringify(r10.d));
check('and an alert is raised for it', !!(await AmlAlert.findOne({ rule: 'DUPLICATE_SELFIE', userId: c10.u._id })));

section('STAFF LOOKING AT THE PHOTO');
const hire = async (role, num) => (await call('POST', '/admin/staff', admin, { firstName: role, lastName: 'S', email: `${role}${num}@lifc.in`, phone: `96300000${num}`, role })).d.staff;
const kyc = await hire('kyc_reviewer', 1);
const coll = await hire('collections_agent', 2);
await User.updateMany({ role: { $nin: [null, 'customer'] } }, { twoFactorEnabled: true });
const [tKyc, tColl] = await Promise.all([kyc, coll].map(async s => tokenFor(await User.findById(s.id), true)));
const img = async (tok, id, frame = 'before') => fetch(`${base}/admin/customers/${id}/selfie?frame=${frame}`, { headers: { Authorization: `Bearer ${tok}` } });
check('a KYC reviewer can see the photo', (await img(tKyc, c10.u._id)).status === 200 && (await img(tKyc, c10.u._id, 'after')).status === 200);
check('a collections agent cannot (403)', (await img(tColl, c10.u._id)).status === 403);
check("a customer cannot see someone else's photo (403)", (await img(c1.tok, c10.u._id)).status === 403);
check('a customer with no photo gets 404', (await img(admin, c7.u._id)).status === 404);
check('each view is in the audit log', !!(await AuditLog.findOne({ action: 'SELFIE_VIEWED', actor: kyc.email })));
const ov = (await call('GET', `/admin/customers/${c10.u._id}`, admin)).d.customer;
check('the customer page shows the photo status, setup steps and personal details', ov.selfie.status === 'review' && ov.selfie.flag === 'same_photo_on_another_account' && 'setup' in ov && 'employment' in ov);
const ovc1 = (await call('GET', `/admin/customers/${c1.u._id}`, admin)).d.customer;
check('and the address and income', ovc1.address.city === 'Jaipur' && ovc1.employment.monthlyIncome === 45000 && ovc1.gender === 'Male');
check('accepting needs a reviewer who can decide (agents cannot, 403)', (await call('POST', `/admin/customers/${c10.u._id}/selfie-decision`, tColl, { decision: 'accept' })).s === 403);
check('rejecting needs a reason (400)', (await call('POST', `/admin/customers/${c10.u._id}/selfie-decision`, tKyc, { decision: 'reject' })).s === 400);
check('a reviewer accepts', (await call('POST', `/admin/customers/${c10.u._id}/selfie-decision`, tKyc, { decision: 'accept', note: 'Different person, same stock photo ruled out' })).d.selfie.status === 'passed');
check('or sends the customer back to retake', (await call('POST', `/admin/customers/${c9.u._id}/selfie-decision`, tKyc, { decision: 'reject', note: 'Photo is too dark' })).d.selfie.status === 'rejected');
check('a rejected photo means the step is not done any more', (await call('GET', '/onboarding/status', c9.tok)).d.steps.selfie === false);
check('and the customer can retake it', (await selfie(c9, await good(c9))).d.selfie.status === 'passed');

section('BANK ACCOUNT AT SET-UP, AND NEEDING IT ALL BEFORE A LOAN');
const apply = c => call('POST', '/loans/apply-full', c.tok, { loanAmount: 10000, tenure: 3, purpose: 'Personal', planType: '3_emi', bankDetails: { accountHolder: 'Cust', accountNumber: `7770000${c.n}`, ifscCode: 'SBIN0001234' } });
const blocked = await apply(c1);
check('with the bank still missing a loan cannot be applied for (403)', blocked.s === 403 && blocked.d.code === 'ONBOARDING_INCOMPLETE', JSON.stringify(blocked.d));
check('the status shows what is still missing', (await call('GET', '/onboarding/status', c1.tok)).d.steps.bank === false && (await call('GET', '/onboarding/status', c1.tok)).d.steps.kyc === false);
const bank = await call('POST', '/kyc/bank', c1.tok, { accountNumber: '123456789012', ifscCode: 'SBIN0001234', accountHolder: 'Cust1 S' });
check('the bank account is saved', bank.s === 200 && bank.d.bank.accountNumber.endsWith('9012') && bank.d.bank.accountNumber.startsWith('X'));
check('with KYC still missing, the account is not complete', (await call('GET', '/onboarding/status', c1.tok)).d.steps.complete === false);
await kycFor(c1);
const done = await call('GET', '/onboarding/status', c1.tok);
check('now everything is done', done.d.steps.kyc && done.d.steps.profile && done.d.steps.selfie && done.d.steps.bank && done.d.steps.complete);
check('the app is told too, along with the phone and terms steps', (await call('GET', '/auth/onboarding', c1.tok)).d.setup.complete === true);
check('and a loan can be applied for', (await apply(c1)).s === 201);
const half = await mk();
await call('PUT', '/onboarding/profile', half.tok, profile);
check('a customer with only some steps done cannot apply (403)', (await apply(half)).d.code === 'ONBOARDING_INCOMPLETE');

await srv.stop();
await disconnect();
finish();
