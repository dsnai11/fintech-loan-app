import http from 'http';
import crypto from 'crypto';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import KycMedia from '../../src/models/KycMedia.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-face-match';
await connect(DB);

// A stand-in for Amazon Rekognition's CompareFaces
let answer = { status: 200, body: { FaceMatches: [{ Similarity: 97.4 }], UnmatchedFaces: [] } };
const seen = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    seen.push({ headers: req.headers, body: body ? JSON.parse(body) : {} });
    res.statusCode = answer.status;
    res.setHeader('Content-Type', 'application/x-amz-json-1.1');
    res.end(JSON.stringify(answer.body));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}/`;

function jpeg(w = 480, h = 640, kb = 20) {
  const pad = crypto.randomBytes(kb * 1024);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([(pad.length + 2) >> 8, (pad.length + 2) & 255]), pad]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), com, sof, Buffer.from([0xff, 0xd9])]).toString('base64');
}
const KEYS = { AWS_ACCESS_KEY_ID: 'AKIATESTTESTTEST', AWS_SECRET_ACCESS_KEY: 'secretsecret', AWS_REGION: 'ap-south-1', AWS_REKOGNITION_ENDPOINT: MOCK };
const on = await startServer(DB, KEYS);
const off = await startServer(DB, {});
const manual = await startServer(DB, { ...KEYS, FACE_MATCH_AUTO: 'false' });
const callOn = client(on.base), callOff = client(off.base), callManual = client(manual.base);
const { token: admin } = await makeAdmin();

let n = 0;
// A customer who has already taken a selfie that passed the blink check
const customer = async (selfieOver = {}) => {
  n++;
  const user = await User.create({ firstName: `F${n}`, lastName: 'M', email: `fm${n}@x.in`, phone: `94${String(n).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, selfie: { status: 'passed', capturedAt: new Date(), method: 'blink_on_device', ...selfieOver } });
  const data = Buffer.from(jpeg(), 'base64');
  await KycMedia.create({ userId: user._id, kind: 'selfie_before', data, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length, width: 480, height: 640 });
  return { user, token: await tokenFor(user) };
};
const card = (c, call) => call('POST', '/onboarding/aadhaar-card', c.token, { photo: jpeg(1200, 800, 40) });
const status = async c => (await User.findById(c.user._id)).aadhaarCard;

section('WITH NO FACE-MATCH KEYS, A PERSON DECIDES (NOTHING IS MADE UP)');
const c0 = await customer();
seen.length = 0;
const r0 = await card(c0, callOff);
check('the card photo is accepted and waits for a person', r0.s === 200 && r0.d.aadhaarCard.status === 'review' && r0.d.aadhaarCard.automatic === false, JSON.stringify(r0.d));
check('no outside service was called', seen.length === 0);
const ints = await callOff('GET', '/admin/integrations', admin);
const fmOff = (ints.d.integrations || ints.d).find(i => i.id === 'face_match');
check('the portal says plainly that a person compares the photos', fmOff && fmOff.status.mode === 'staff', JSON.stringify(fmOff));

section('WITH THE KEYS, A GOOD MATCH PASSES BY MACHINE');
const c1 = await customer();
seen.length = 0;
answer = { status: 200, body: { FaceMatches: [{ Similarity: 97.4 }], UnmatchedFaces: [] } };
const r1 = await card(c1, callOn);
check('a high similarity passes at once', r1.s === 200 && r1.d.aadhaarCard.status === 'passed' && r1.d.aadhaarCard.automatic === true && r1.d.steps.aadhaarCard === true, JSON.stringify(r1.d));
check('the request went to the right action, signed, with both pictures', seen.length === 1 && seen[0].headers['x-amz-target'] === 'RekognitionService.CompareFaces' && /^AWS4-HMAC-SHA256 Credential=AKIATESTTESTTEST\/\d{8}\/ap-south-1\/rekognition\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/.test(seen[0].headers.authorization) && seen[0].body.SourceImage.Bytes && seen[0].body.TargetImage.Bytes);
check('the secret key never leaves the server', !JSON.stringify(seen[0]).includes('secretsecret'));
const a1 = await status(c1);
check('the score and who decided are recorded', a1.faceMatch.similarity === 97.4 && a1.faceMatch.result === 'match' && a1.reviewedBy === 'automatic face match');
check('the decision is in the audit log', (await AuditLog.countDocuments({ action: 'FACE_MATCH_PASSED', entityId: String(c1.user._id) })) === 1);

section('A DOUBTFUL OR POOR MATCH');
const c2 = await customer();
answer = { status: 200, body: { FaceMatches: [{ Similarity: 72 }], UnmatchedFaces: [] } };
const r2 = await card(c2, callOn);
check('a score in the middle goes to a person', r2.d.aadhaarCard.status === 'review' && (await status(c2)).faceMatch.result === 'unsure');
const c3 = await customer();
answer = { status: 200, body: { FaceMatches: [{ Similarity: 12 }], UnmatchedFaces: [] } };
const r3 = await card(c3, callOn);
check('a very low score asks for a clearer photo, and says why', r3.d.aadhaarCard.status === 'rejected' && /does not look like/.test(r3.d.message) && r3.d.steps.aadhaarCard === false, JSON.stringify(r3.d));
check('the customer can see the reason in their status', (await callOn('GET', '/onboarding/status', c3.token)).d.aadhaarCard.reviewNote.includes('clearer photo'));
await card(c3, callOn);
check('after two automatic refusals the third try goes to a person, not a third refusal', (await card(c3, callOn)).d.aadhaarCard.status === 'review' && (await AmlAlert.countDocuments({ rule: 'FACE_MISMATCH', userId: c3.user._id })) === 1);
const c4 = await customer();
answer = { status: 200, body: { FaceMatches: [], UnmatchedFaces: [{}] } };
const r4 = await card(c4, callOn);
check('no face found on the card asks for a better photo', r4.d.aadhaarCard.status === 'rejected' && /could not see your face on the Aadhaar card/.test(r4.d.message));
const c5 = await customer();
answer = { status: 400, body: { __type: 'com.amazon.coral.service#InvalidParameterException', message: 'There are no faces in the image. Should be at least 1.' } };
check('a picture with no face is handled without crashing', (await card(c5, callOn)).s === 200);

section('WHEN THE OUTSIDE SERVICE FAILS, THE CUSTOMER IS NOT BLAMED');
const c6 = await customer();
answer = { status: 500, body: { __type: 'InternalServerError', message: 'down' } };
const r6 = await card(c6, callOn);
check('a service error sends it to a person', r6.s === 200 && r6.d.aadhaarCard.status === 'review' && (await status(c6)).faceMatch.result === 'service_error');

section('NO MACHINE PASS WHEN SOMETHING ELSE LOOKS WRONG');
const c7 = await customer({ status: 'review', flag: 'no_blink_check' });
answer = { status: 200, body: { FaceMatches: [{ Similarity: 99 }], UnmatchedFaces: [] } };
const r7 = await card(c7, callOn);
check('a great match is not enough when the selfie itself has not passed its live check', r7.d.aadhaarCard.status === 'review' && (await status(c7)).faceMatch.result === 'match_but_flagged');
const c8 = await customer();
const sameCardPhoto = jpeg(1200, 800, 40);
await callOn('POST', '/onboarding/aadhaar-card', c8.token, { photo: sameCardPhoto });
const c9 = await customer();
await callOn('POST', '/onboarding/aadhaar-card', c9.token, { photo: sameCardPhoto });
check('a card photo that is on another account never passes by machine', (await status(c9)).status === 'review' && (await status(c9)).faceMatch.result === 'match_but_flagged');

section('SWITCHED OFF IN SETTINGS');
const c10 = await customer();
seen.length = 0;
answer = { status: 200, body: { FaceMatches: [{ Similarity: 99 }], UnmatchedFaces: [] } };
const r10 = await card(c10, callManual);
check('with the automatic check off, a person decides even when keys are set', r10.d.aadhaarCard.status === 'review' && seen.length === 0);

section('RETAKING THE SELFIE COMPARES AGAIN');
const c11 = await customer();
answer = { status: 200, body: { FaceMatches: [{ Similarity: 96 }], UnmatchedFaces: [] } };
await card(c11, callOn);
check('it passed', (await status(c11)).status === 'passed');
seen.length = 0;
answer = { status: 200, body: { FaceMatches: [{ Similarity: 20 }], UnmatchedFaces: [] } };
const up = await callOn('POST', '/onboarding/selfie/upload', c11.token, { photo: jpeg() });
check('a new selfie on a card that passed is compared again (the old result no longer stands)', up.s === 200 && seen.length === 1 && (await status(c11)).status !== 'passed');

section('A PERSON HAS THE LAST WORD');
const c12 = await customer();
answer = { status: 200, body: { FaceMatches: [{ Similarity: 72 }], UnmatchedFaces: [] } };
await card(c12, callOn);
const dec = await callOn('POST', `/admin/customers/${c12.user._id}/aadhaar-decision`, admin, { decision: 'accept', note: 'Looked at both, same person' });
check('a reviewer can accept what the machine was unsure about', dec.d.aadhaarCard.status === 'passed');
seen.length = 0;
await callOn('POST', '/onboarding/aadhaar-card', c12.token, { photo: jpeg(1200, 800, 40) }).catch(() => {});
check('the staff view shows the score', (await callOn('GET', `/admin/customers/${c12.user._id}`, admin)).d.customer.aadhaarCard.faceMatch !== undefined);

for (const s of [on, off, manual]) await s.stop();
mock.close();
await disconnect();
finish();
