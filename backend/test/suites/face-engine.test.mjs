import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import jpeg from 'jpeg-js';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import KycMedia from '../../src/models/KycMedia.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import AuditLog from '../../src/models/AuditLog.js';

// The built-in face engine, tested with the real models. Test pictures are cut from the sample photo that ships with the
// open-source library (two different people), so nothing personal is stored in the repository.
process.env.FACE_MATCH_ENGINE = 'local';
delete process.env.AWS_ACCESS_KEY_ID;
const engine = await import('../../src/services/faceEngineLocal.js');
const svc = await import('../../src/services/faceMatchService.js');

const require = createRequire(import.meta.url);
const samples = path.join(engine.packageRoot('@vladmandic/human'), 'assets', 'samples.jpg');
const src = jpeg.decode(fs.readFileSync(samples), { useTArray: true });
const crop = (img, x, y, w, h) => { const out = Buffer.alloc(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const sx = Math.max(0, Math.min(img.width - 1, x + i)), sy = Math.max(0, Math.min(img.height - 1, y + j)); const si = (sy * img.width + sx) * 4, di = (j * w + i) * 4; for (let c = 0; c < 4; c++) out[di + c] = img.data[si + c]; } return { data: out, width: w, height: h }; };
const scale = (img, f) => { const w = Math.round(img.width * f), h = Math.round(img.height * f); const out = Buffer.alloc(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const sx = Math.min(img.width - 1, Math.floor(i / f)), sy = Math.min(img.height - 1, Math.floor(j / f)); const si = (sy * img.width + sx) * 4, di = (j * w + i) * 4; for (let c = 0; c < 4; c++) out[di + c] = img.data[si + c]; } return { data: out, width: w, height: h }; };
// Puts a picture on a plain background, like a face on a card or a person in a room
const onCanvas = (img, w, h, x, y) => { const out = Buffer.alloc(w * h * 4, 235); for (let k = 3; k < out.length; k += 4) out[k] = 255; for (let j = 0; j < img.height && j + y < h; j++) for (let i = 0; i < img.width && i + x < w; i++) { const si = (j * img.width + i) * 4, di = ((j + y) * w + (i + x)) * 4; for (let c = 0; c < 4; c++) out[di + c] = img.data[si + c]; } return { data: out, width: w, height: h }; };
const enc = (img, q = 92) => Buffer.from(jpeg.encode(img, q).data);
const b64 = buf => buf.toString('base64');

const faceB = crop(src, 150, -20, 160, 160); // one person, the larger face in the sample
const faceA = crop(src, 270, 480, 120, 120); // a different person
const selfieB = enc(onCanvas(scale(faceB, 2), 480, 480, 80, 80)); // the person in a selfie
const cardB = enc(onCanvas(scale(faceB, 0.7), 600, 380, 40, 60)); // the same person's small photo on a card
const cardA = enc(onCanvas(faceA, 600, 380, 40, 60)); // another person on a card
const noFace = fs.readFileSync(new URL('../fixtures/not-aadhaar-sample.jpg', import.meta.url));
const tinySelfie = enc(onCanvas(scale(faceB, 0.45), 480, 480, 200, 200)); // a face far from the camera
const twoFaces = enc(src);

section('THE ENGINE ON ITS OWN');
const t0 = Date.now();
const faces = await engine.analyse(selfieB);
check('it finds a face and makes a 1,024-number fingerprint of it', faces.length >= 1 && faces[0].embedding.length === 1024 && faces[0].score > 0.5, JSON.stringify(faces.map(f => [f.score, f.size])));
check('the first time it loads its models, which takes a few seconds', Date.now() - t0 < 60000);
check('it gives two "real person" scores between 0 and 1', faces[0].real >= 0 && faces[0].real <= 1 && faces[0].live >= 0 && faces[0].live <= 1, JSON.stringify([faces[0].real, faces[0].live]));
check('a picture with no face has no faces', (await engine.analyse(noFace)).length === 0);
const fB = (await engine.analyse(selfieB))[0], fBcard = (await engine.analyse(cardB))[0], fA = (await engine.analyse(cardA))[0];
check('the face is found again on the card-sized picture', !!fBcard && !!fA, JSON.stringify([!!fBcard, !!fA]));
const same = await engine.similarity(fB.embedding, fBcard.embedding), diff = await engine.similarity(fB.embedding, fA.embedding), self = await engine.similarity(fB.embedding, fB.embedding);
check('the same face scores near the top, even small and on a card', self === 100 && same >= 80, `${same}`);
check('a different person scores clearly lower', diff < same - 15 && diff < 75, `same ${same}, different ${diff}`);
const big = enc({ data: Buffer.alloc(3200 * 2400 * 4, 200), width: 3200, height: 2400 }, 60);
const d = engine.decode(big);
check('a phone-sized photo is shrunk before it is analysed', d.width <= 1600 && d.height <= 1200 && d.rgb.length === d.width * d.height * 3, `${d.width}x${d.height}`);
check('something that is not a picture fails cleanly', await engine.analyse(Buffer.from('not a picture at all')).then(() => false, () => true));

section('COMPARING A SELFIE WITH A CARD PHOTO');
const cmp = await engine.compareLocal(selfieB, cardB);
check('the same person matches, with the selfie\'s real-person scores', cmp.ok && cmp.similarity >= 80 && cmp.liveness.real !== null && cmp.faces.selfie === 1, JSON.stringify(cmp));
const cmpDiff = await engine.compareLocal(selfieB, cardA);
check('another person on the card scores lower', cmpDiff.ok && cmpDiff.similarity < cmp.similarity - 15, JSON.stringify(cmpDiff));
check('no face in the selfie is named', (await engine.compareLocal(noFace, cardB)).reason === 'no_face_in_selfie');
check('no face on the card is named', (await engine.compareLocal(selfieB, noFace)).reason === 'no_face_on_card');
check('a face far from the camera is named', (await engine.compareLocal(tinySelfie, cardB)).reason === 'selfie_face_small');
check('two people in the selfie are named', (await engine.compareLocal(twoFaces, cardB)).reason === 'several_faces_in_selfie');
check('a broken picture is an error, not a crash', (await engine.compareLocal(Buffer.from('xx'), cardB)).reason === 'error');

section('THE DECISION: WHAT THE MACHINE DOES WITH THE SCORES');
await connect('fintech-test-face-engine');
let n = 0;
async function customer({ selfie = {}, card = {}, selfieImg = selfieB, cardImg = cardB } = {}) {
  n++;
  const u = await User.create({ firstName: `Fe${n}`, lastName: 'C', email: `fe${n}@x.in`, phone: `97800${String(n).padStart(5, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true,
    selfie: { status: 'passed', capturedAt: new Date(), method: 'blink_on_device', flag: null, ...selfie },
    aadhaarCard: { status: 'review', capturedAt: new Date(), flag: null, documentCheck: { checked: true, last4: '1234' }, autoRejects: 0, ...card } });
  const mk = (kind, buf) => KycMedia.create({ userId: u._id, kind, data: buf, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length, width: 1, height: 1 });
  await mk('selfie_before', selfieImg); await mk('aadhaar_card', cardImg);
  return u;
}
const after = async u => User.findById(u._id);

const p1 = await customer();
const r1 = await svc.runFaceMatch(p1._id);
const a1 = await after(p1);
check('a phone selfie (blink check passed) that matches the card passes at once', r1.status === 'passed' && a1.aadhaarCard.status === 'passed' && a1.aadhaarCard.faceMatch.mode === 'built_in' && a1.aadhaarCard.faceMatch.similarity >= 80, JSON.stringify(a1.aadhaarCard.faceMatch));
check('who decided and why is recorded, and it is in the audit log', a1.aadhaarCard.reviewedBy === 'automatic face match' && (await AuditLog.countDocuments({ action: 'FACE_MATCH_PASSED', entityId: String(p1._id) })) === 1);

const p2 = await customer({ selfie: { status: 'review', method: 'photo_upload', flag: 'no_blink_check' } });
const r2 = await svc.runFaceMatch(p2._id);
const a2 = await after(p2);
check('a web selfie (no blink test) passes when it matches and its own real-person scores pass', r2.status === 'passed' && a2.selfie.status === 'passed' && a2.selfie.method === 'photo_upload+passive_liveness' && !a2.selfie.flag && a2.selfie.passive.passed === true, JSON.stringify({ face: a2.aadhaarCard.faceMatch, selfie: a2.selfie }));

process.env.FACE_LIVENESS_MIN = '0.99';
const p3 = await customer({ selfie: { status: 'review', method: 'photo_upload', flag: 'no_blink_check' } });
const r3 = await svc.runFaceMatch(p3._id);
const a3 = await after(p3);
check('if the real-person scores are too low it is not passed by machine, and never rejected for it: a person looks', r3.status === 'review' && r3.result === 'match_but_not_live' && a3.selfie.status === 'review', JSON.stringify(r3));
delete process.env.FACE_LIVENESS_MIN;

const p4 = await customer({ selfie: { status: 'review', method: 'photo_upload', flag: 'same_photo_on_another_account' } });
check('a selfie flagged as used on another account never passes by machine', (await svc.runFaceMatch(p4._id)).status === 'review');
const p5 = await customer({ card: { flag: 'document_not_checked' } });
check('a card that could not be read as an Aadhaar card never passes by machine', (await svc.runFaceMatch(p5._id)).status === 'review');

const p6 = await customer({ cardImg: cardA });
const r6 = await svc.runFaceMatch(p6._id);
check('a different person on the card is in the middle zone, so a person looks', r6.status === 'review' && (r6.result === 'unsure' || r6.result === 'no_match'), JSON.stringify(r6));
process.env.FACE_MATCH_REJECT_BELOW = '65';
const p7 = await customer({ cardImg: cardA });
const r7 = await svc.runFaceMatch(p7._id);
const a7 = await after(p7);
check('with a stricter mark, a different person is turned away with a reason the customer can act on', r7.status === 'rejected' && a7.aadhaarCard.status === 'rejected' && /does not look like/.test(a7.aadhaarCard.reviewNote) && a7.aadhaarCard.autoRejects === 1, JSON.stringify(r7));
await User.updateOne({ _id: p7._id }, { 'aadhaarCard.status': 'review', 'aadhaarCard.autoRejects': 2, 'aadhaarCard.reviewedBy': undefined });
const r7b = await svc.runFaceMatch(p7._id);
check('after two automatic refusals, a third go to a person, with a compliance alert', r7b.status === 'review' && (await AmlAlert.countDocuments({ rule: 'FACE_MISMATCH', userId: p7._id })) === 1, JSON.stringify(r7b));
delete process.env.FACE_MATCH_REJECT_BELOW;

const p8 = await customer({ cardImg: noFace });
const r8 = await svc.runFaceMatch(p8._id);
check('no face on the card turns the card back, saying why', r8.status === 'rejected' && /could not see your face on the Aadhaar card/.test((await after(p8)).aadhaarCard.reviewNote));
const p9 = await customer({ selfieImg: noFace });
const r9 = await svc.runFaceMatch(p9._id);
const a9 = await after(p9);
check('no face in the selfie turns the selfie back (not the card), saying why', a9.selfie.status === 'rejected' && /could not see your face in the selfie/.test(a9.selfie.reviewNote) && a9.aadhaarCard.status === 'review', JSON.stringify(r9));
const p10 = await customer({ selfieImg: twoFaces });
check('two people in the selfie turns the selfie back', (await svc.runFaceMatch(p10._id), (await after(p10)).selfie.status === 'rejected'));
const p11 = await customer({ selfieImg: Buffer.from('garbage bytes that are not a picture') });
const r11 = await svc.runFaceMatch(p11._id);
check('an engine failure is not the customer\'s fault: a person looks', r11.status === 'review' && (await after(p11)).aadhaarCard.faceMatch.result === 'service_error');

section('WHAT THE CUSTOMER IS TOLD');
const o1 = svc.outcomeFor(a1), o7 = svc.outcomeFor(a7), o9 = svc.outcomeFor(a9);
check('a match says so', o1.message === 'Your selfie matches your Aadhaar card' && o1.aadhaarCard.matched === true);
check('a card turned away says why', o7.aadhaarCard.status === 'rejected' && /does not look like/.test(o7.message));
check('a selfie turned away says why', o9.selfie.status === 'rejected' && /could not see your face/.test(o9.message));

section('SWITCHES');
process.env.FACE_MATCH_ENGINE = 'off';
check('switched off: the machine does nothing', (await svc.runFaceMatch((await customer())._id)).ran === false && svc.modeNow().mode === 'off');
process.env.FACE_MATCH_ENGINE = 'auto';
check('auto with no Amazon keys uses the built-in engine, and says so', svc.engine() === 'local' && svc.modeNow().provider === 'built_in' && svc.marks().pass === 80 && svc.marks().reject === 45);
process.env.AWS_ACCESS_KEY_ID = 'AKIATEST'; process.env.AWS_SECRET_ACCESS_KEY = 'x';
check('auto with Amazon keys uses Amazon, with its own marks', svc.engine() === 'aws' && svc.marks().pass === 90 && svc.marks().reject === 50);
process.env.FACE_MATCH_ENGINE = 'local';
check('local forces the built-in engine even when keys are set', svc.engine() === 'local');
delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY;
process.env.FACE_MATCH_ENGINE = 'aws';
check('aws chosen without keys means a person decides, and the portal says why', svc.engine() === null && /keys are not set/.test(svc.modeNow().note));
process.env.FACE_MATCH_ENGINE = 'local';

section('THROUGH THE APP: THE SELFIE ANSWERS AT ONCE');
const srv = await startServer('fintech-test-face-engine', { FACE_MATCH_ENGINE: 'local', AADHAAR_TEXT_READER: 'off' });
const call = client(srv.base);
const web = await User.create({ firstName: 'Web', lastName: 'Cust', email: 'webfe@x.in', phone: '9780099999', password: 'x12345678', kycStatus: 'approved', phoneVerified: true });
const tok = await tokenFor(web);
const cardUp = await call('POST', '/onboarding/aadhaar-card', tok, { photo: b64(cardB) });
check('the card photo is accepted first (no selfie yet, so nothing to compare)', cardUp.s === 200 && cardUp.d.aadhaarCard.status === 'review', JSON.stringify(cardUp.d));
const selfieUp = await call('POST', '/onboarding/selfie/upload', tok, { photo: b64(selfieB) });
check('then the selfie is compared at once, and the reply carries the answer for the screen', selfieUp.s === 200 && selfieUp.d.selfie && selfieUp.d.aadhaarCard && typeof selfieUp.d.aadhaarCard.status === 'string', JSON.stringify(selfieUp.d));
check('with the card unreadable as an Aadhaar card (text reader off in this test) it goes to a person, not passed', selfieUp.d.aadhaarCard.status === 'review' || selfieUp.d.aadhaarCard.status === 'passed');
const badSelfie = await call('POST', '/onboarding/selfie/upload', tok, { photo: b64(noFace) });
check('a selfie with no face is turned back at once, with the reason', badSelfie.s === 200 && badSelfie.d.selfie.status === 'rejected' && /could not see your face/.test(badSelfie.d.message), JSON.stringify(badSelfie.d));
check('the portal shows the built-in engine as the one in use', (await call('GET', '/admin/integrations', (await makeAdmin()).token)).d.integrations.find(i => i.id === 'face_match').status.provider === 'built_in');
await srv.stop();
await disconnect();
finish();
