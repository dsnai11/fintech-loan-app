import { getConfig, setConfig } from './configService.js';

// The charges engine decides which fees a loan carries (file charge, document charge, insurance, stamping...)
// from rules the lender writes: a fixed amount or a percentage of the loan, with GST on top, included, or none,
// limited to certain states, loan amounts, tenures or plans. When it is switched on it replaces the single
// processing fee on the Pricing page. Everything it charges is deducted from the loan when it is paid out, and
// is part of the yearly cost (APR) the customer is shown.

export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh',
  'Chandigarh', 'Puducherry', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep',
];

// The first two digits of a PIN code say which state it is in for these four states. Elsewhere the state has to
// be given, so a rule for any other state only applies when the customer's state is known.
const PIN_PREFIX = [['30', '34', 'Rajasthan'], ['36', '39', 'Gujarat'], ['45', '48', 'Madhya Pradesh'], ['49', '49', 'Chhattisgarh']];
export function stateFromPincode(pin) {
  const p = String(pin ?? '').trim();
  if (!/^\d{6}$/.test(p)) return '';
  const head = p.slice(0, 2);
  const hit = PIN_PREFIX.find(([from, to]) => head >= from && head <= to);
  return hit ? hit[2] : '';
}

export const DEFAULTS = { enabled: false, charges: [] };
const clone = o => JSON.parse(JSON.stringify(o));

export function getChargesConfig() {
  let stored = null;
  try {
    const raw = getConfig('CHARGES_POLICY', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* defaults */ }
  return { ...clone(DEFAULTS), ...(stored && typeof stored === 'object' ? stored : {}) };
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function numOrNull(v, min, max, label, errors, { int = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) { errors.push(`${label} must be ${int ? 'a whole number ' : 'a number '}between ${min} and ${max}`); return null; }
  return n;
}

export function validateCharges(candidate, planKeys = ['one_time', '3_emi', '6_emi']) {
  const errors = [];
  const out = { enabled: candidate?.enabled === true, charges: [] };
  const list = Array.isArray(candidate?.charges) ? candidate.charges : [];
  if (list.length > 60) errors.push('Too many charges (up to 60)');
  const seen = new Set();
  list.slice(0, 60).forEach((c, i) => {
    const label = `Charge ${i + 1}`;
    const name = String(c?.name ?? '').trim();
    if (!name) { errors.push(`${label} needs a name`); return; }
    if (name.length > 60) errors.push(`${label}: the name is too long (up to 60 characters)`);
    let id = slug(c.id || name) || `charge_${i + 1}`;
    while (seen.has(id)) id += '_x';
    seen.add(id);
    const basis = c.basis === 'percent' ? 'percent' : c.basis === 'fixed' ? 'fixed' : (errors.push(`${name}: choose a fixed amount or a percentage`), 'fixed');
    const amount = Number(c.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > (basis === 'percent' ? 20 : 1000000)) errors.push(`${name}: the ${basis === 'percent' ? 'percentage must be between 0 and 20' : 'amount must be between 0 and 10,00,000'}`);
    const gst = ['none', 'extra', 'included'].includes(c.gst) ? c.gst : (errors.push(`${name}: choose how GST applies`), 'none');
    const cond = c.conditions || {};
    const states = Array.isArray(cond.states) ? [...new Set(cond.states.map(String))] : [];
    const badState = states.find(s => !STATES.includes(s));
    if (badState) errors.push(`${name}: "${badState}" is not a state in the list`);
    const plans = Array.isArray(cond.plans) ? [...new Set(cond.plans.map(String))] : [];
    if (plans.some(p => p !== 'standard' && !planKeys.includes(p))) errors.push(`${name}: unknown repayment plan`);
    const amountMin = numOrNull(cond.amountMin, 0, 1e8, `${name}: smallest loan`, errors, { int: true });
    const amountMax = numOrNull(cond.amountMax, 0, 1e8, `${name}: largest loan`, errors, { int: true });
    const tenureMin = numOrNull(cond.tenureMin, 1, 120, `${name}: shortest tenure`, errors, { int: true });
    const tenureMax = numOrNull(cond.tenureMax, 1, 120, `${name}: longest tenure`, errors, { int: true });
    if (amountMin !== null && amountMax !== null && amountMin > amountMax) errors.push(`${name}: the smallest loan is above the largest`);
    if (tenureMin !== null && tenureMax !== null && tenureMin > tenureMax) errors.push(`${name}: the shortest tenure is above the longest`);
    out.charges.push({
      id, name, enabled: c.enabled !== false, basis, amount: Number.isFinite(amount) ? amount : 0, gst,
      optional: c.optional === true,
      group: slug(c.group) || '',
      conditions: { states, plans, amountMin, amountMax, tenureMin, tenureMax },
      note: String(c.note ?? '').trim().slice(0, 300),
    });
  });
  return { errors, config: out };
}

export async function saveCharges(candidate, updatedBy, planKeys) {
  const { errors, config } = validateCharges(candidate, planKeys);
  if (errors.length) return { ok: false, errors };
  await setConfig('CHARGES_POLICY', JSON.stringify(config), { group: 'pricing', updatedBy });
  return { ok: true, config };
}

// ── Working out the charges for one loan ────────────────────────────────────────────────────────

function matches(c, ctx) {
  const k = c.conditions;
  if (!c.enabled) return false;
  if (k.states.length && !k.states.includes(ctx.state)) return false;
  if (k.amountMin !== null && ctx.amount < k.amountMin) return false;
  if (k.amountMax !== null && ctx.amount > k.amountMax) return false;
  if (k.tenureMin !== null && ctx.tenureMonths < k.tenureMin) return false;
  if (k.tenureMax !== null && ctx.tenureMonths > k.tenureMax) return false;
  if (k.plans.length && !k.plans.includes(ctx.planType || 'standard')) return false;
  return true;
}

const specificity = c => (c.conditions.states.length ? 1 : 0) + (c.conditions.plans.length ? 1 : 0) + (c.conditions.amountMin !== null || c.conditions.amountMax !== null ? 1 : 0) + (c.conditions.tenureMin !== null || c.conditions.tenureMax !== null ? 1 : 0);

// Charges that apply to this loan. Within a group only the most specific match is charged (a Gujarat file
// charge replaces the general one).
export function applicable(config, ctx) {
  const hit = config.charges.filter(c => matches(c, ctx));
  const best = new Map();
  const loose = [];
  for (const c of hit) {
    if (!c.group) { loose.push(c); continue; }
    const cur = best.get(c.group);
    if (!cur || specificity(c) >= specificity(cur)) best.set(c.group, c);
  }
  return [...loose, ...best.values()];
}

// The rupee lines for a loan: one per charge, with its GST. `selected` are the add-ons the customer chose.
export function chargeLines(config, ctx, gstPercent, selected = []) {
  const pick = new Set(selected);
  const lines = [];
  const addOns = [];
  for (const c of applicable(config, ctx)) {
    const base = c.basis === 'percent' ? Math.round((ctx.amount * c.amount) / 100) : Math.round(c.amount);
    let gst = 0;
    let total = base;
    if (c.gst === 'extra') { gst = Math.round((base * gstPercent) / 100); total = base + gst; }
    else if (c.gst === 'included') { gst = Math.round((base * gstPercent) / (100 + gstPercent)); }
    const line = { id: c.id, name: c.name, optional: c.optional, gstMode: c.gst, basis: c.basis, rate: c.amount, charge: total - gst, gst, total };
    if (c.optional && !pick.has(c.id)) addOns.push(line);
    else lines.push(line);
  }
  return { lines, addOns };
}

// ── Starter set taken from the lender's BRE sheet (personal loan rows only) ─────────────────────────

export const BRE_PRESET = [
  { name: 'File charge', group: 'file_charge', basis: 'percent', amount: 2, gst: 'extra', conditions: {}, note: 'BRE sheet: personal loan, all states, 2% plus GST.' },
  { name: 'File charge (Gujarat)', group: 'file_charge', basis: 'percent', amount: 2.5, gst: 'extra', conditions: { states: ['Gujarat'] }, note: 'BRE sheet: Gujarat, 2.5% plus GST. Replaces the general file charge there.' },
  { name: 'Document verification', group: 'doc_verification', basis: 'fixed', amount: 300, gst: 'included', conditions: { amountMax: 200000 }, note: 'BRE sheet: up to Rs 2,00,000, Rs 300 including GST.' },
  { name: 'Document verification', group: 'doc_verification', basis: 'percent', amount: 0.2, gst: 'included', conditions: { amountMin: 200001, amountMax: 500000 }, note: 'BRE sheet: Rs 2,00,001 to 5,00,000, 0.20% including GST.' },
  { name: 'Document verification', group: 'doc_verification', basis: 'fixed', amount: 1000, gst: 'included', conditions: { amountMin: 500001 }, note: 'BRE sheet: above Rs 5,00,000, Rs 1,000 including GST.' },
  { name: 'Group personal accident cover', basis: 'fixed', amount: 1500, gst: 'none', conditions: {}, note: 'BRE sheet: Rs 1,500, no GST. Insurance usually has to be the customer\'s choice; confirm with compliance before leaving this as compulsory.' },
  { name: 'Wellness (insurance)', basis: 'fixed', amount: 1314, gst: 'none', conditions: {}, note: 'BRE sheet: Rs 1,314, no GST. Insurance usually has to be the customer\'s choice; confirm with compliance before leaving this as compulsory.' },
  { name: 'Stamping charge', basis: 'percent', amount: 0.325, gst: 'none', conditions: { states: ['Rajasthan'] }, note: 'BRE sheet, Rajasthan only. The sheet gives both 0.325% and 0.0033, so confirm the rate.' },
];

export default { getChargesConfig, validateCharges, saveCharges, applicable, chargeLines, stateFromPincode, STATES, BRE_PRESET };
