import { getConfig, setConfig } from './configService.js';
import { getPolicy, computeQuote } from './pricingPolicy.js';

// What the web portal controls in the customer apps: switches, notices, a maintenance lock, a minimum app
// version, and the loan products customers can pick. The apps read this on start (GET /api/app-settings).
// Prices still live in the pricing policy; a product only overrides some of those numbers.

export const BASE_PRODUCT = 'personal';

export const DEFAULTS = {
  features: { emiCalculator: true, eligibilityCheck: true, support: true },
  banner: { enabled: false, level: 'info', text: '' },
  maintenance: { enabled: false, message: 'We are updating the app. Please try again in a little while.' },
  minAppVersion: '',
  // How the app protects itself on the customer's phone: a PIN, locking after the app was left, and signing out when idle
  security: { appLock: 'optional', lockAfterSeconds: 30, idleLogoutMinutes: 15 },
  baseProduct: { name: 'Personal Loan', description: 'Quick personal loan with the charges shown up front.' },
  products: [], // extra products: { key, name, description, enabled, overrides }
};

const clone = o => JSON.parse(JSON.stringify(o));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function overlay(base, input) {
  if (!isObj(input)) return base;
  for (const k of Object.keys(base)) {
    if (!(k in input) || k === 'products') continue;
    if (isObj(base[k])) base[k] = overlay(base[k], input[k]);
    else base[k] = input[k];
  }
  if (Array.isArray(input.products)) base.products = input.products;
  return base;
}

export function getSettings() {
  let stored = null;
  try {
    const raw = getConfig('APP_SETTINGS', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* defaults */ }
  return overlay(clone(DEFAULTS), stored);
}

// ── Products: the standard policy with some numbers changed ─────────────────────────────────────
const NUMERIC = {
  minAmount: [100, 10000000, true],
  maxAmount: [100, 10000000, true],
  annualRatePercent: [0, 60, false],
  processingFeePercent: [0, 20, false],
  minTenureMonths: [1, 60, true],
  maxTenureMonths: [1, 60, true],
  maxIncomePercent: [1, 100, true], // the most a customer may borrow, as a share of their monthly income (a salary advance)
};

// The pricing policy as it applies to one product. Returns null for an unknown or switched-off product.
export function policyFor(productKey, settings = getSettings(), base = getPolicy()) {
  if (!productKey || productKey === BASE_PRODUCT) return Object.assign(base, { productKey: BASE_PRODUCT, productName: settings.baseProduct.name });
  const product = settings.products.find(p => p.key === productKey && p.enabled);
  if (!product) return null;
  const p = clone(base);
  const o = product.overrides || {};
  for (const k of Object.keys(NUMERIC)) if (o[k] !== undefined && o[k] !== null && o[k] !== '') p[k] = Number(o[k]);
  if (o.plans) for (const [pk, on] of Object.entries(o.plans)) if (p.plans[pk] && typeof on === 'boolean') p.plans[pk].enabled = on && p.plans[pk].enabled;
  if (p.offerAmount > p.maxAmount) p.offerAmount = p.maxAmount;
  if (p.offerAmount < p.minAmount) p.offerAmount = p.minAmount;
  p.productKey = product.key;
  p.productName = product.name;
  return p;
}

const text = (v, max, name, errors, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) errors.push(`${name} is required`);
  if (s.length > max) errors.push(`${name} is too long (max ${max} characters)`);
  return s.slice(0, max);
};

const versionOk = v => /^\d+(\.\d+){0,2}$/.test(v);

export function validateSettings(candidate) {
  const errors = [];
  const s = clone(candidate);
  const out = clone(DEFAULTS);

  for (const k of Object.keys(out.features)) out.features[k] = s.features?.[k] === true || s.features?.[k] === 'true';
  out.banner.enabled = s.banner?.enabled === true;
  out.banner.level = ['info', 'warning'].includes(s.banner?.level) ? s.banner.level : 'info';
  out.banner.text = text(s.banner?.text, 240, 'Banner text', errors);
  if (out.banner.enabled && !out.banner.text) errors.push('Write the banner text, or switch the banner off');

  out.maintenance.enabled = s.maintenance?.enabled === true;
  out.maintenance.message = text(s.maintenance?.message, 240, 'Maintenance message', errors, true);

  out.minAppVersion = String(s.minAppVersion ?? '').trim();
  if (out.minAppVersion && !versionOk(out.minAppVersion)) errors.push('Minimum app version must look like 1.2.0');

  const sec = s.security || {};
  out.security.appLock = ['off', 'optional', 'required'].includes(sec.appLock) ? sec.appLock : DEFAULTS.security.appLock;
  const secNum = (v, def, min, max, label) => {
    const n = v === undefined || v === null || v === '' ? def : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number between ${min} and ${max}`); return def; }
    return n;
  };
  out.security.lockAfterSeconds = secNum(sec.lockAfterSeconds, DEFAULTS.security.lockAfterSeconds, 0, 3600, 'Seconds before the app locks');
  out.security.idleLogoutMinutes = secNum(sec.idleLogoutMinutes, DEFAULTS.security.idleLogoutMinutes, 0, 240, 'Minutes before signing out');

  out.baseProduct.name = text(s.baseProduct?.name, 60, 'Main product name', errors, true);
  out.baseProduct.description = text(s.baseProduct?.description, 200, 'Main product description', errors);

  const seen = new Set([BASE_PRODUCT]);
  const base = getPolicy();
  out.products = [];
  for (const [i, raw] of (Array.isArray(s.products) ? s.products : []).entries()) {
    const label = `Product ${i + 1}`;
    const key = String(raw?.key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || String(raw?.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    if (!key) { errors.push(`${label} needs a name`); continue; }
    if (seen.has(key)) { errors.push(`${label}: another product already uses the name "${key}"`); continue; }
    seen.add(key);
    const name = text(raw.name, 60, `${label} name`, errors, true);
    const p = { key, name, description: text(raw.description, 200, `${label} description`, errors), enabled: raw.enabled !== false, overrides: {} };
    for (const [k, [min, max, int]] of Object.entries(NUMERIC)) {
      const v = raw.overrides?.[k];
      if (v === undefined || v === null || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) errors.push(`${name}: ${k} must be ${int ? 'a whole number ' : ''}between ${min} and ${max}`);
      else p.overrides[k] = n;
    }
    p.overrides.plans = {};
    for (const pk of Object.keys(base.plans)) if (typeof raw.overrides?.plans?.[pk] === 'boolean') p.overrides.plans[pk] = raw.overrides.plans[pk];
    out.products.push(p);
  }

  if (!errors.length) {
    for (const p of out.products) {
      const o = p.overrides;
      const min = o.minAmount ?? base.minAmount, max = o.maxAmount ?? base.maxAmount;
      if (min > max) errors.push(`${p.name}: smallest loan is above the largest loan`);
      if ((o.minTenureMonths ?? base.minTenureMonths) > (o.maxTenureMonths ?? base.maxTenureMonths)) errors.push(`${p.name}: shortest tenure is above the longest`);
    }
  }
  if (!errors.length && base.maxAprPercent != null) {
    const settings = { ...out };
    for (const p of out.products.filter(x => x.enabled)) {
      const pol = policyFor(p.key, settings, getPolicy());
      for (const [pk, plan] of Object.entries(pol.plans)) {
        if (!plan.enabled) continue;
        const q = computeQuote(pol, { amount: pol.offerAmount, planType: pk });
        if (q.aprPercent > base.maxAprPercent) errors.push(`${p.name}, ${q.label}: APR ${q.aprPercent}% is above your ceiling of ${base.maxAprPercent}%`);
      }
    }
  }
  return { errors, settings: out };
}

export async function saveSettings(candidate, updatedBy) {
  const { errors, settings } = validateSettings(candidate);
  if (errors.length) return { ok: false, errors };
  await setConfig('APP_SETTINGS', JSON.stringify(settings), { group: 'app', updatedBy });
  return { ok: true, settings };
}

// What the apps get: no internal fields, and each product with the numbers customers will meet.
export function publicSettings() {
  const s = getSettings();
  const base = getPolicy();
  const products = [{ key: BASE_PRODUCT, name: s.baseProduct.name, description: s.baseProduct.description, enabled: true }, ...s.products.filter(p => p.enabled)]
    .map(p => {
      const pol = policyFor(p.key, s, getPolicy());
      return pol && { key: p.key, name: p.name, description: p.description, minAmount: pol.minAmount, maxAmount: pol.maxAmount, annualRatePercent: pol.annualRatePercent, processingFeePercent: pol.processingFeePercent, offerAmount: pol.offerAmount };
    })
    .filter(Boolean);
  return {
    features: s.features,
    banner: s.banner.enabled ? s.banner : { enabled: false },
    maintenance: s.maintenance,
    minAppVersion: s.minAppVersion,
    security: s.security,
    products,
    support: { email: base.institution.supportEmail, phone: base.institution.supportPhone },
  };
}

export default { getSettings, saveSettings, validateSettings, policyFor, publicSettings, BASE_PRODUCT, DEFAULTS };
