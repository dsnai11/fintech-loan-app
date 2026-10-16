import { createRequire } from 'module';
import path from 'path';
import { getConfig } from './configService.js';
import { keysSet, readTextWithRekognition } from './faceMatchService.js';

// Is this photo an Aadhaar card? Checked before the photo is accepted.
//
// The text on the photo is read by a text reader (Amazon Rekognition when its keys are set, otherwise a reader that runs
// on our own server). A photo counts as an Aadhaar card when it shows a valid 12-digit Aadhaar number (the last digit is a
// check digit, so a made-up number fails) together with words that appear on the card. We keep only the last 4 digits of
// the number, never the whole number.
//
// If the text reader itself breaks, nothing is decided here: the photo goes to a person, and says so.

// Verhoeff check-digit algorithm, used by UIDAI for Aadhaar numbers
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function verhoeffValid(num) {
  const s = String(num);
  if (!/^\d+$/.test(s)) return false;
  let c = 0;
  [...s].reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; });
  return c === 0;
}
// Used by tests: the check digit that makes an 11-digit start into a valid 12-digit number
export function verhoeffCheckDigit(start) {
  const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  let c = 0;
  [...String(start)].reverse().forEach((ch, i) => { c = D[c][P[(i + 1) % 8][Number(ch)]]; });
  return INV[c];
}

// Words found on the card, in English and Hindi
const WORDS = [/aadhaar|aadhar|adhaar/i, /आधार/, /uidai/i, /unique\s+identification/i, /government\s+of\s+india/i, /भारत\s*सरकार/, /mera\s+aadhaar/i, /आम\s+आदमी/, /\bdob\b|date\s+of\s+birth|year\s+of\s+birth|जन्म/i];

// Pulls the Aadhaar number out of the text. Returns { number, valid } or null. The card prints it as "1234 5678 9012".
export function findAadhaarNumber(text) {
  const s = String(text || '');
  const grouped = [...s.matchAll(/(?<!\d)([2-9]\d{3})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/g)].map(m => m[1] + m[2] + m[3]);
  const valid = grouped.find(verhoeffValid);
  if (valid) return { number: valid, valid: true };
  return grouped.length ? { number: grouped[0], valid: false } : null;
}

// Decides from the text. Returns { ok, reason, last4, words }.
export function judgeText(text) {
  const t = String(text || '');
  const found = findAadhaarNumber(t);
  const words = WORDS.filter(r => r.test(t)).length;
  if (!t.trim()) return { ok: false, reason: 'no_text', words: 0 };
  if (found?.valid && words >= 1) return { ok: true, last4: found.number.slice(-4), words };
  if (found?.valid) return { ok: false, reason: 'number_without_card_words', words, last4: found.number.slice(-4) };
  if (found && !found.valid) return { ok: false, reason: 'number_not_valid', words };
  return { ok: false, reason: words >= 2 ? 'number_not_readable' : 'not_an_aadhaar_card', words };
}

// --- the text readers ---
let worker = null;
async function localRead(buf) {
  const require = createRequire(import.meta.url);
  if (!worker) {
    const { createWorker } = await import('tesseract.js');
    let langPath;
    try { langPath = path.dirname(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')); } catch { langPath = undefined; }
    worker = await createWorker('eng', 1, { ...(langPath ? { langPath, gzip: true } : {}), cachePath: path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'lifc-ocr'), logger: () => {} });
  }
  const { data } = await worker.recognize(buf);
  return data.text || '';
}
export const readerName = () => (keysSet() ? 'aws_rekognition' : 'local');

// Returns { text } or { error }
export async function readCard(buf) {
  if (process.env.AADHAAR_TEXT_READER === 'off') return { error: 'reader switched off' };
  try {
    if (keysSet()) {
      const r = await readTextWithRekognition(buf);
      if (r.ok) return { text: r.text };
      // fall through to the local reader if the outside service failed
    }
    return { text: await Promise.race([localRead(buf), new Promise((_, rej) => setTimeout(() => rej(new Error('text reader timed out')), 45000))]) };
  } catch (e) {
    worker = null;
    return { error: e.message };
  }
}

// What the customer is told when the photo is turned away
export const MESSAGES = {
  not_an_aadhaar_card: 'This does not look like an Aadhaar card. Please send a photo of your Aadhaar card.',
  no_text: 'We could not read anything on this photo. Please send a clear, well-lit photo of your Aadhaar card.',
  number_not_valid: 'We could not read a valid Aadhaar number on this photo. Please send a clearer photo with all 12 digits in view.',
  number_not_readable: 'We could not read the Aadhaar number on this photo. Please send a clearer photo with all 12 digits in view.',
  number_without_card_words: 'This does not look like an Aadhaar card. Please send a photo of the whole card.',
};

export default { verhoeffValid, findAadhaarNumber, judgeText, readCard, MESSAGES };
