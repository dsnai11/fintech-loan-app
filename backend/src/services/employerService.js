import { getConfig, setConfig } from './configService.js';

// The employers the company has graded, for the salaried products. Staff keep the list in the portal; each employer has a category:
//   A = strongest (for example large listed companies, government, well-known groups)
//   B = standard
//   C = weaker or newer
// How an employer is graded is the credit policy of the company, not something this code decides. An employer that is not on the list
// has no category, and the lender's rules decide what that means. Customers can type any employer; the list only helps them pick and
// lets the rules read the category.

export const CATEGORIES = ['A', 'B', 'C'];
export const LEVEL = { A: 3, B: 2, C: 1 }; // what the rules see: 3, 2, 1, or 0 when not on the list
const MAX = 3000;

export const normalize = name => String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function getList() {
  try {
    const raw = getConfig('EMPLOYER_LIST', '');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(e => e && e.name && CATEGORIES.includes(e.category)) : [];
  } catch (e) {
    return [];
  }
}

// Staff can paste lines like "Infosys, A" or "Local Traders Pvt Ltd, C". A line without a category is a mistake, not a guess.
export function parseText(text) {
  const errors = [];
  const out = [];
  const seen = new Set();
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const m = t.match(/^(.*?)[,;\t]\s*([A-Ca-c])\s*$/);
    if (!m || !m[1].trim()) { errors.push(`Line ${i + 1} ("${t.slice(0, 40)}"): write the employer, a comma, then A, B or C`); return; }
    const name = m[1].trim().slice(0, 80);
    const key = normalize(name);
    if (!key) { errors.push(`Line ${i + 1}: the employer name has no letters or numbers`); return; }
    if (seen.has(key)) { errors.push(`Line ${i + 1}: "${name}" is on the list twice`); return; }
    seen.add(key);
    out.push({ name, category: m[2].toUpperCase() });
  });
  if (out.length > MAX) errors.push(`The list can hold up to ${MAX} employers`);
  return { errors, list: out.slice(0, MAX) };
}

export async function saveText(text, by) {
  const { errors, list } = parseText(text);
  if (errors.length) return { ok: false, errors: errors.slice(0, 10) };
  await setConfig('EMPLOYER_LIST', JSON.stringify(list), { group: 'decisions', updatedBy: by });
  return { ok: true, list };
}

export const toText = list => list.map(e => `${e.name}, ${e.category}`).join('\n');

// 3, 2, 1 or 0 (not on the list), from the employer name a customer gave
export function levelOf(company) {
  const key = normalize(company);
  if (!key) return 0;
  const hit = getList().find(e => normalize(e.name) === key);
  return hit ? LEVEL[hit.category] : 0;
}
export const categoryOf = company => {
  const key = normalize(company);
  return key ? getList().find(e => normalize(e.name) === key)?.category || null : null;
};

// Names only, for the customer's suggestions: starts-with first, then contains
export function search(q, limit = 8) {
  const key = normalize(q);
  if (key.length < 2) return [];
  const list = getList();
  const starts = list.filter(e => normalize(e.name).startsWith(key));
  const has = list.filter(e => !normalize(e.name).startsWith(key) && normalize(e.name).includes(key));
  return [...starts, ...has].slice(0, limit).map(e => e.name);
}

export default { getList, parseText, saveText, toText, levelOf, categoryOf, search, normalize, CATEGORIES, LEVEL };
