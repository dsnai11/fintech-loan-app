import crypto from 'crypto';

// Encryption at rest for the most sensitive files we keep (selfies and Aadhaar card photos).
//
// With DATA_ENCRYPTION_KEY set (32 random bytes, as 64 hex characters or base64), every new file is stored as
//   "EKM1" + a fresh random number (12 bytes) + a seal (16 bytes) + the scrambled bytes
// using AES-256-GCM, which also notices if anyone changes the stored bytes. Without the key, files are stored as they are,
// exactly as before. Files stored before the key was set stay readable. THE KEY MUST BE KEPT SAFELY OUTSIDE THE DATABASE (and
// backed up): without it the encrypted files cannot be read by anyone, including us.
const MAGIC = Buffer.from('EKM1');

function keyFrom(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (buf.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, or 44 characters of base64');
  return buf;
}
const current = () => keyFrom(process.env.DATA_ENCRYPTION_KEY);
export const encryptionOn = () => { try { return !!current(); } catch { return false; } };

export function encryptBuffer(plain) {
  const key = current();
  if (!key || !Buffer.isBuffer(plain)) return plain;
  if (plain.length >= 4 && plain.subarray(0, 4).equals(MAGIC)) return plain; // already sealed
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decryptBuffer(stored) {
  if (!Buffer.isBuffer(stored) || stored.length < 4 + 12 + 16 || !stored.subarray(0, 4).equals(MAGIC)) return stored; // stored before encryption was switched on
  const key = current();
  if (!key) throw new Error('This file is encrypted but DATA_ENCRYPTION_KEY is not set');
  const iv = stored.subarray(4, 16), tag = stored.subarray(16, 32), body = stored.subarray(32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

export const isEncrypted = b => Buffer.isBuffer(b) && b.length >= 32 && b.subarray(0, 4).equals(MAGIC);
export default { encryptBuffer, decryptBuffer, encryptionOn, isEncrypted };
