// Checks that need no paid provider: spelling-tolerant name matching, Aadhaar masking, and free public look-ups for IFSC and pincode.
// The look-ups only ever send the bank code or the pincode (never a person's details), time out quickly, and are remembered for a day.
// When a look-up cannot be reached the answer is "unknown" (never a guess), and the caller carries on as before.

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'shree', 'smt', 'sri', 'dr', 'late', 'kumari', 'km', 'sh']);
const clean = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t && !HONORIFICS.has(t));

// Jaro-Winkler similarity of two words, 0 to 1
function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j <= Math.min(b.length - 1, i + range); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) { if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; } }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0; while (p < 4 && a[p] && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

// How well two words agree: equal, an initial standing for the word ("R" for "Rahul"), or close spelling ("Mohd" / "Mohammed")
const tokenScore = (x, y) => {
  if (x === y) return 1;
  if ((x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))) return 0.9;
  const s = jaroWinkler(x, y);
  return s >= 0.88 ? s : 0;
};

// Compares two names written differently (order, initials, spelling, titles). Returns { score 0-100, verdict }.
//   match    - the same person, to the level a person would accept
//   review   - close, but a staff member should look
//   mismatch - different
export function nameMatch(a, b) {
  const x = clean(a), y = clean(b);
  if (!x.length || !y.length) return { score: 0, verdict: 'mismatch', reason: 'a name is missing' };
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  const used = new Set();
  let total = 0, strong = 0;
  for (const t of small) {
    let best = 0, at = -1;
    big.forEach((u, i) => { if (used.has(i)) return; const s = tokenScore(t, u); if (s > best) { best = s; at = i; } });
    if (at >= 0) { used.add(at); total += best; if (t.length > 1 && best >= 0.88) strong++; }
  }
  // the shorter name must be fully covered; a longer name with extra words (a middle or father's name) is fine
  let score = Math.round((total / small.length) * 100);
  if (small.length > 1 && strong === 0) score = Math.min(score, 50); // initials alone cannot prove a match
  if (small.length === 1 && small[0].length === 1) score = Math.min(score, 40);
  const verdict = score >= 85 ? 'match' : score >= 65 ? 'review' : 'mismatch';
  return { score, verdict };
}

// Shows only the last 4 digits of an Aadhaar number: "XXXX XXXX 1234". Also masks Aadhaar-shaped numbers inside free text.
export function maskAadhaar(value) {
  const text = String(value ?? '');
  if (/^[\d\s-]+$/.test(text) && text.replace(/\D/g, '').length === 12) return `XXXX XXXX ${text.replace(/\D/g, '').slice(-4)}`;
  return text.replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, 'XXXX XXXX $3');
}

const DAY = 24 * 60 * 60 * 1000;
const cache = new Map();
const remembered = (key, make) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  return make().then(value => {
    if (value) { cache.set(key, { at: Date.now(), value }); if (cache.size > 5000) cache.delete(cache.keys().next().value); }
    return value;
  });
};

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
  if (r.status === 404) return { notFound: true };
  if (!r.ok) return null;
  return r.json();
}

export const ifscShape = code => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(code || '').toUpperCase());

// Bank and branch for an IFSC code (the public, free IFSC list). null when it could not be reached.
export async function lookupIfsc(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!ifscShape(c)) return { found: false, reason: 'format' };
  const out = await remembered(`ifsc:${c}`, async () => {
    try {
      const d = await getJson(`https://ifsc.razorpay.com/${c}`);
      if (!d) return null;
      if (d.notFound) return { found: false, reason: 'not_listed' };
      return { found: true, ifsc: c, bank: d.BANK || '', branch: d.BRANCH || '', city: d.CITY || '', state: d.STATE || '', upi: !!d.UPI, imps: !!d.IMPS, neft: !!d.NEFT };
    } catch { return null; }
  });
  return out || { found: null, reason: 'unreachable' };
}

// Place for a 6-digit pincode (India Post's free list). found null when it could not be reached.
export async function lookupPincode(pin) {
  const p = String(pin || '').trim();
  if (!/^[1-9]\d{5}$/.test(p)) return { found: false, reason: 'format' };
  const out = await remembered(`pin:${p}`, async () => {
    try {
      const d = await getJson(`https://api.postalpincode.in/pincode/${p}`);
      const entry = Array.isArray(d) ? d[0] : null;
      if (!entry) return null;
      if (entry.Status !== 'Success' || !entry.PostOffice?.length) return { found: false, reason: 'not_listed' };
      const po = entry.PostOffice[0];
      return { found: true, pincode: p, state: po.State || '', district: po.District || '', city: po.Block && po.Block !== 'NA' ? po.Block : po.District || '', areas: entry.PostOffice.slice(0, 10).map(o => o.Name) };
    } catch { return null; }
  });
  return out || { found: null, reason: 'unreachable' };
}

// Does the pincode belong to the state the customer wrote? true / false, or null when we cannot tell.
export async function pincodeMatchesState(pin, state) {
  const r = await lookupPincode(pin);
  if (r.found !== true || !state) return null;
  const n = s => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
  const a = n(r.state), b = n(state);
  return a === b || a.includes(b) || b.includes(a);
}

export default { nameMatch, maskAadhaar, lookupIfsc, lookupPincode, pincodeMatchesState, ifscShape };
