import crypto from 'crypto';

// Checks on the selfie the app sends. The app watches the customer's eyes through the phone camera and asks them
// to blink twice. It sends what it saw (the eye-open reading over time) with a photo before and after the
// blinks. The server cannot see the eyes itself, so it checks that the reading is the shape of real blinks, that
// it fits the one-time challenge it issued, that the photos are real JPEGs and differ from each other, and then
// keeps the photos so staff can look at them. A certified liveness provider can replace this later.

export const REQUIRED_BLINKS = 2;
const MIN_FRAME_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;

const OPEN_AT = 0.6; // both eyes on average at least this open
const CLOSED_AT = 0.3; // at most this open counts as closed

// Reads the width and height out of a JPEG without decoding it.
export function jpegInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { ok: false };
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { ok: true, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { ok: false };
}

export function readFrame(b64, label) {
  const raw = String(b64 ?? '').replace(/^data:image\/jpeg;base64,/, '');
  if (!raw || !/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) return { error: `The ${label} photo is missing` };
  const data = Buffer.from(raw, 'base64');
  if (data.length < MIN_FRAME_BYTES) return { error: `The ${label} photo is too small to be a clear photo` };
  if (data.length > MAX_FRAME_BYTES) return { error: `The ${label} photo is too large` };
  const info = jpegInfo(data);
  if (!info.ok) return { error: `The ${label} photo is not a JPEG picture` };
  if (info.width < 240 || info.height < 240 || info.width > 6000 || info.height > 6000) return { error: `The ${label} photo is the wrong size` };
  return { data, width: info.width, height: info.height, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

// samples: [[milliseconds, leftEyeOpen, rightEyeOpen], ...] with the eye readings between 0 (shut) and 1 (open).
export function analyseBlinks(samples, required = REQUIRED_BLINKS) {
  const reasons = [];
  if (!Array.isArray(samples) || samples.length < 8 || samples.length > 600) return { ok: false, blinks: 0, reasons: ['We did not get enough of a video to see you blink'] };
  const s = [];
  for (const row of samples) {
    if (!Array.isArray(row) || row.length < 3) return { ok: false, blinks: 0, reasons: ['The blink check could not be read'] };
    const [t, l, r] = row.map(Number);
    if (![t, l, r].every(Number.isFinite) || l < 0 || l > 1 || r < 0 || r > 1) return { ok: false, blinks: 0, reasons: ['The blink check could not be read'] };
    s.push({ t, e: (l + r) / 2 });
  }
  for (let i = 1; i < s.length; i++) {
    if (s[i].t <= s[i - 1].t) return { ok: false, blinks: 0, reasons: ['The blink check could not be read'] };
    if (s[i].t - s[i - 1].t > 2500) reasons.push('The camera lost sight of your face for too long');
  }
  const duration = s[s.length - 1].t - s[0].t;
  if (duration < 1500) reasons.push('The check was too short');
  if (duration > 25000) reasons.push('The check took too long');
  if (s[0].e < OPEN_AT) reasons.push('Your eyes should be open when the check starts');
  if (s[s.length - 1].e < OPEN_AT) reasons.push('Your eyes should be open when the check ends');
  const closedShare = s.filter(x => x.e <= CLOSED_AT).length / s.length;
  if (closedShare > 0.5) reasons.push('Your eyes were shut for most of the check');

  // A blink is eyes open, then closed, then open again, with the eyes shut for no more than about a second.
  let blinks = 0;
  let closedSince = null;
  for (const x of s) {
    if (x.e <= CLOSED_AT) { if (closedSince === null) closedSince = x.t; }
    else if (x.e >= OPEN_AT && closedSince !== null) {
      if (x.t - closedSince <= 1500) blinks++;
      closedSince = null;
    }
  }
  if (blinks < required) reasons.push(`We saw ${blinks} blink${blinks === 1 ? '' : 's'}, and need ${required}`);
  if (blinks > 12) reasons.push('That was too many blinks to be a normal check');
  return { ok: reasons.length === 0, blinks, durationMs: duration, reasons };
}

export default { analyseBlinks, readFrame, jpegInfo, REQUIRED_BLINKS };
