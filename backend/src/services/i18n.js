import crypto from 'crypto';
import { getConfig, setConfig } from './configService.js';
import { LANGUAGES, LANGUAGE_CODES, BUILTIN, SOURCE } from '../i18n/catalogue.js';
import { readFileSync } from 'node:fs';

const extracted = JSON.parse(readFileSync(new URL('../i18n/sourceStrings.json', import.meta.url), 'utf8'));

// The translations the app downloads. Built-in lines come from the catalogue; anything staff change on the portal is
// saved on top of them (configuration key APP_STRINGS) and wins.

export const ALL_SOURCE = [...new Set([...SOURCE, ...extracted])];
const MAX_LEN = 600;

function overrides() {
  try { return JSON.parse(getConfig('APP_STRINGS', '') || '{}'); } catch (e) { return {}; }
}

export const isLanguage = code => LANGUAGE_CODES.includes(code);

export function stringsFor(lang) {
  if (!isLanguage(lang) || lang === 'en') return {};
  return { ...(BUILTIN[lang] || {}), ...(overrides()[lang] || {}) };
}

export function stringsVersion(lang) {
  return crypto.createHash('sha1').update(JSON.stringify(stringsFor(lang))).digest('hex').slice(0, 10);
}

// For the portal: every English line with its built-in and edited translation
export function editorRows(lang) {
  const ov = overrides()[lang] || {};
  const built = BUILTIN[lang] || {};
  return ALL_SOURCE.map(en => ({ en, builtin: built[en] || '', value: ov[en] ?? '' }));
}

export async function saveOverrides(lang, changes, by) {
  if (!isLanguage(lang) || lang === 'en') return { ok: false, error: 'Choose a language other than English' };
  if (!changes || typeof changes !== 'object') return { ok: false, error: 'Send the translations as an object' };
  const all = overrides();
  const mine = { ...(all[lang] || {}) };
  const known = new Set(ALL_SOURCE);
  for (const [en, raw] of Object.entries(changes)) {
    if (!known.has(en)) return { ok: false, error: `"${en.slice(0, 40)}" is not a line in the app` };
    const v = String(raw ?? '').trim();
    if (v.length > MAX_LEN) return { ok: false, error: `A translation is too long (max ${MAX_LEN} characters)` };
    if (v) mine[en] = v; else delete mine[en];
  }
  all[lang] = mine;
  await setConfig('APP_STRINGS', JSON.stringify(all), { group: 'app', updatedBy: by });
  return { ok: true, count: Object.keys(mine).length };
}

export const languageList = codes => LANGUAGES.filter(l => codes.includes(l.code));

export default { stringsFor, stringsVersion, editorRows, saveOverrides, isLanguage, languageList, ALL_SOURCE };
