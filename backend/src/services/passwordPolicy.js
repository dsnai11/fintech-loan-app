import bcryptjs from 'bcryptjs';

// How passwords are stored and what is accepted.
//  - Stored only as a bcrypt hash (never the password). The work factor is 12 by default: each guess costs an attacker that much
//    more. Hashes made at a lower factor are upgraded the next time the person signs in.
//  - Accepted: 8 to 72 bytes (bcrypt reads only the first 72 bytes, so a longer password would be silently cut), not one of the
//    commonly used passwords, not a run like 12345678 or aaaaaaaa, and not something built from the person's own details.
export const BCRYPT_COST = Math.min(14, Math.max(10, Number(process.env.BCRYPT_COST) || 12));

export const hashPassword = plain => bcryptjs.hash(plain, BCRYPT_COST);
export const needsRehash = hash => {
  try { return bcryptjs.getRounds(String(hash)) < BCRYPT_COST; } catch { return false; }
};

const COMMON = new Set(`password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword p@ssword1 pass1234 pass@123 password@123 password@1234 admin123 admin@123 admin1234
12345678 123456789 1234567890 11111111 00000000 87654321 12341234 12121212 11223344 1q2w3e4r 1qaz2wsx qwertyui qwerty123 qwerty1234 qwertyuiop asdfghjk asdf1234 zxcvbnm1 abc12345 abcd1234 abcdefgh
iloveyou letmein1 welcome1 welcome123 welcome@123 monkey123 dragon123 football1 baseball1 sunshine1 princess1 trustno1 changeme changeme1 test1234 test@123 testtest user1234 login123 india123 india@123 india1234
mumbai123 delhi123 shiv1234 ram12345 krishna1 ganesh123 om123456 jaishreeram mypassword my@12345 qazwsxedc samsung1 iphone123 google123 whatsapp1 flipkart1 paytm123 lifc1234 lifc@123 laxmi123 loan1234`.split(/\s+/));

const run = s => {
  if (s.length < 6) return false;
  let up = true, down = true;
  for (let i = 1; i < s.length; i++) { const d = s.charCodeAt(i) - s.charCodeAt(i - 1); if (d !== 1) up = false; if (d !== -1) down = false; }
  return up || down;
};

// Returns a plain-words problem, or null when the password is fine. `who` is optional: { email, phone, firstName, lastName }.
export function passwordProblem(password, who = {}) {
  if (typeof password !== 'string' || !password) return 'Enter a password';
  if (password.length < 8) return 'Use at least 8 characters';
  if (Buffer.byteLength(password) > 72) return 'Use at most 72 characters';
  const p = password.toLowerCase();
  if (COMMON.has(p) || COMMON.has(p.replace(/[^a-z0-9]/g, ''))) return 'That password is one of the most common ones. Choose something harder to guess.';
  if (/^(.)\1+$/.test(password) || run(p) || new Set(p).size < 4) return 'That password is too simple (a repeated character or a straight run). Choose something harder to guess.';
  if (!/[a-z]/i.test(password) && !/\d/.test(password) && password.length < 12) return 'Mix letters and numbers, or use a longer phrase.';
  if (!(/[a-z]/i.test(password) && /\d/.test(password)) && password.length < 12) return 'Use both letters and numbers, or a longer phrase of 12 characters or more.';
  const letters = p.replace(/[^a-z]/g, ''), digits = p.replace(/\D/g, '');
  const local = String(who.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (local.length >= 4 && p.replace(/[^a-z0-9]/g, '') === local) return 'The password should not be your email address.';
  const phone = String(who.phone || '').replace(/\D/g, '');
  if (phone.length >= 8 && digits.length >= 8 && (digits === phone || digits === phone.slice(-10))) return 'The password should not be your phone number.';
  for (const name of [who.firstName, who.lastName]) {
    const n = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (n.length >= 4 && letters === n) return 'The password should not be just your name with some numbers.';
  }
  return null;
}

export default { passwordProblem, hashPassword, needsRehash, BCRYPT_COST };
