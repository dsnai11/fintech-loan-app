import crypto from 'crypto';

// Time-based one-time passwords (RFC 6238), the codes shown by Google Authenticator, Authy, 1Password etc.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/=+$/, '')) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export function totp(secret, atMs = Date.now(), { step = 30, digits = 6 } = {}) {
  const counter = Math.floor(atMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 15;
  const bin = ((h[offset] & 127) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// Accepts the current 30-second code and the one either side (for clock drift). Returns the matching
// time step, so the caller can refuse to accept the same code twice, or null if it does not match.
export function verifyTotp(secret, code, atMs = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const nowStep = Math.floor(atMs / 1000 / 30);
  for (const delta of [0, -1, 1]) {
    const expected = totp(secret, (nowStep + delta) * 30 * 1000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return nowStep + delta;
  }
  return null;
}

export const otpauthUrl = (email, secret) => `otpauth://totp/LIFC:${encodeURIComponent(email)}?secret=${secret}&issuer=LIFC&digits=6&period=30`;

// The secret has to be readable by the server, so it is encrypted at rest. Set TWO_FACTOR_KEY to keep
// codes working if JWT_SECRET is ever rotated.
const key = () => crypto.createHash('sha256').update(`2fa|${process.env.TWO_FACTOR_KEY || process.env.JWT_SECRET}`).digest();

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${enc.toString('hex')}`;
}

export function decryptSecret(blob) {
  const [iv, tag, enc] = String(blob).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(enc, 'hex')), d.final()]).toString('utf8');
}

export default { generateSecret, totp, verifyTotp, otpauthUrl, encryptSecret, decryptSecret, base32Encode, base32Decode };
