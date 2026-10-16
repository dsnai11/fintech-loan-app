import crypto from 'crypto';
import User from '../models/User.js';
import KycMedia from '../models/KycMedia.js';
import AmlAlert from '../models/AmlAlert.js';
import { getConfig } from './configService.js';
import { audit } from './auditService.js';

// Compares the face on the customer's Aadhaar card photo with their selfie, by machine.
//
// The provider is Amazon Rekognition (CompareFaces). It is used only when its keys are set in the portal. With no keys the
// check cannot run, and the photos go to a person at the company, exactly as before. Nothing is ever invented.
//
// What the machine decides, from the similarity score (0 to 100):
//   at or above the "pass" mark         -> accepted, if the selfie itself passed its live check and nothing else looks wrong
//   below the "reject" mark             -> the customer is asked for a clearer card photo (twice at most, then a person looks)
//   anywhere between, or any doubt      -> a person looks
// The marks are settings (compliance and risk must confirm them), not rules baked into the code.

const BY_MACHINE = 'automatic face match';
const REGION = () => getConfig('AWS_REGION') || 'ap-south-1';
const endpoint = () => getConfig('AWS_REKOGNITION_ENDPOINT') || `https://rekognition.${REGION()}.amazonaws.com/`;
export const keysSet = () => !!(getConfig('AWS_ACCESS_KEY_ID') && getConfig('AWS_SECRET_ACCESS_KEY'));
const num = (k, d) => { const raw = String(getConfig(k) ?? '').trim(); const v = Number(raw); return raw !== '' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : d; };
export const marks = () => ({ pass: num('FACE_MATCH_PASS_AT', 90), reject: num('FACE_MATCH_REJECT_BELOW', 50), maxAutoRejects: 2 });
export const automaticOn = () => keysSet() && getConfig('FACE_MATCH_AUTO') !== 'false';

export function modeNow() {
  if (keysSet() && getConfig('FACE_MATCH_AUTO') === 'false') return { mode: 'off', note: 'Switched off in settings. A person compares every card photo with the selfie.' };
  if (keysSet()) return { mode: 'live', provider: 'aws_rekognition', note: `The face on the card is compared with the selfie automatically. Pass at ${marks().pass}% or more, ask for a clearer photo below ${marks().reject}%, and a person looks at anything in between.` };
  return { mode: 'staff', note: 'No face-matching service is connected, so a person at the company compares every card photo with the selfie. Add the AWS keys to switch on the automatic check.' };
}

// AWS request signing (Signature Version 4), done by hand so no extra package is needed
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function sign(url, body, target) {
  const u = new URL(url);
  const region = REGION();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers = { 'content-type': 'application/x-amz-json-1.1', host: u.host, 'x-amz-date': amzDate, 'x-amz-target': target };
  const names = Object.keys(headers).sort();
  const canonical = ['POST', u.pathname || '/', '', names.map(n => `${n}:${headers[n]}\n`).join(''), names.join(';'), sha(body)].join('\n');
  const scope = `${day}/${region}/rekognition/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + getConfig('AWS_SECRET_ACCESS_KEY'), day), region), 'rekognition'), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  const out = { 'Content-Type': headers['content-type'], 'X-Amz-Date': amzDate, 'X-Amz-Target': target, Authorization: `AWS4-HMAC-SHA256 Credential=${getConfig('AWS_ACCESS_KEY_ID')}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
  if (getConfig('AWS_SESSION_TOKEN')) out['X-Amz-Security-Token'] = getConfig('AWS_SESSION_TOKEN');
  return out;
}

// Returns { ok: true, similarity, faceOnCard } or { ok: false, reason: 'no_face_in_selfie' | 'no_face_on_card' | 'error', detail }
export async function compareFaces(selfieBytes, cardBytes) {
  const body = JSON.stringify({
    SourceImage: { Bytes: selfieBytes.toString('base64') },
    TargetImage: { Bytes: cardBytes.toString('base64') },
    SimilarityThreshold: 0,
    QualityFilter: 'NONE',
  });
  const target = 'RekognitionService.CompareFaces';
  let r;
  try {
    r = await fetch(endpoint(), { method: 'POST', headers: sign(endpoint(), body, target), body, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { ok: false, reason: 'error', detail: e.message };
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const type = String(d.__type || '').split('#').pop();
    // Rekognition says "InvalidParameterException" when it cannot find a face in one of the pictures
    if (type === 'InvalidParameterException') return { ok: false, reason: /source/i.test(d.message || d.Message || '') ? 'no_face_in_selfie' : 'no_face_on_card', detail: d.message || d.Message };
    return { ok: false, reason: 'error', detail: `${r.status} ${type || ''} ${d.message || d.Message || ''}`.trim() };
  }
  const matches = Array.isArray(d.FaceMatches) ? d.FaceMatches : [];
  if (!matches.length) return { ok: false, reason: 'no_face_on_card', detail: 'No face found on the card photo' };
  const similarity = Math.max(...matches.map(m => Number(m.Similarity) || 0));
  return { ok: true, similarity: Math.round(similarity * 10) / 10 };
}

// Runs the comparison for one customer if both pictures are there. Safe to call after either upload.
export async function runFaceMatch(userId, req = null) {
  if (!automaticOn()) return { ran: false, reason: 'not_connected' };
  const user = await User.findById(userId);
  if (!user?.aadhaarCard || !user.selfie) return { ran: false, reason: 'waiting_for_other_photo' };
  // A person has already decided: leave it alone
  if (['passed', 'rejected'].includes(user.aadhaarCard.status) && user.aadhaarCard.reviewedBy && user.aadhaarCard.reviewedBy !== BY_MACHINE) return { ran: false, reason: 'already_decided' };
  const [selfie, card] = await Promise.all([
    KycMedia.findOne({ userId, kind: 'selfie_before' }).select('+data'),
    KycMedia.findOne({ userId, kind: 'aadhaar_card' }).select('+data'),
  ]);
  if (!selfie || !card) return { ran: false, reason: 'waiting_for_other_photo' };

  const res = await compareFaces(selfie.data, card.data);
  const m = marks();
  const prev = user.aadhaarCard;
  const rejects = prev.autoRejects || 0;
  const faceMatch = { mode: 'aws_rekognition', at: new Date(), similarity: res.ok ? res.similarity : null, passAt: m.pass, rejectBelow: m.reject, result: null };
  let status = 'review';
  let note = null;

  if (!res.ok && res.reason === 'error') {
    // The service failed: that is not the customer's fault, so a person looks
    faceMatch.result = 'service_error';
    faceMatch.detail = String(res.detail || '').slice(0, 200);
  } else if (!res.ok) {
    faceMatch.result = res.reason;
    if (rejects + 1 > m.maxAutoRejects) { /* third failure: a person looks */ }
    else {
      status = 'rejected';
      note = res.reason === 'no_face_on_card' ? 'We could not see your face on the Aadhaar card photo. Please send a clear, well-lit photo of the whole card.' : 'We could not see your face in the selfie. Please retake it.';
    }
  } else if (res.similarity >= m.pass) {
    // Passing by machine needs the selfie itself to have passed its live check, and no warning flag on either photo
    const clean = user.selfie.status === 'passed' && !user.aadhaarCard.flag && !user.selfie.flag;
    faceMatch.result = clean ? 'match' : 'match_but_flagged';
    if (clean) status = 'passed';
  } else if (res.similarity < m.reject) {
    faceMatch.result = 'no_match';
    if (rejects + 1 <= m.maxAutoRejects) {
      status = 'rejected';
      note = 'The face on the Aadhaar card does not look like the face in your selfie. Please send a clearer photo of the card, or retake your selfie in good light.';
    }
  } else {
    faceMatch.result = 'unsure';
  }

  const aadhaarCard = { ...prev, status, faceMatch, autoRejects: status === 'rejected' ? rejects + 1 : rejects };
  if (status === 'passed') { aadhaarCard.reviewedBy = BY_MACHINE; aadhaarCard.reviewedAt = new Date(); aadhaarCard.reviewNote = `Similarity ${res.similarity}%`; }
  if (status === 'rejected') { aadhaarCard.reviewedBy = BY_MACHINE; aadhaarCard.reviewedAt = new Date(); aadhaarCard.reviewNote = note; }
  await User.updateOne({ _id: userId }, { aadhaarCard });
  if (faceMatch.result === 'no_match' && status === 'review') {
    await AmlAlert.create({ rule: 'FACE_MISMATCH', severity: 'HIGH', userId, detail: `The face on the Aadhaar card did not match the selfie (${res.similarity}%) after ${rejects} earlier attempts.` });
  }
  await audit('system', status === 'passed' ? 'FACE_MATCH_PASSED' : status === 'rejected' ? 'FACE_MATCH_REJECTED' : 'FACE_MATCH_TO_REVIEW', { type: 'User', id: userId }, { result: faceMatch.result, similarity: faceMatch.similarity }, req);
  return { ran: true, status, result: faceMatch.result, similarity: faceMatch.similarity };
}

// The selfie was retaken: the earlier comparison no longer stands, so the card goes back to "to be checked" and is compared again.
export async function selfieChanged(userId, req = null) {
  const user = await User.findById(userId).select('aadhaarCard');
  if (!user?.aadhaarCard) return;
  const { reviewedBy, reviewedAt, reviewNote, faceMatch, ...rest } = user.aadhaarCard;
  await User.updateOne({ _id: userId }, { aadhaarCard: { ...rest, status: 'review' } });
  await runFaceMatch(userId, req).catch(() => {});
}

export default { selfieChanged, modeNow, compareFaces, runFaceMatch, marks, keysSet, automaticOn };
