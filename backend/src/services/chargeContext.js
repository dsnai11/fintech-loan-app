import { STATES, stateFromPincode } from './chargesEngine.js';

// What the charges engine needs to know about the customer: which state they are in (so state-specific charges
// apply) and which optional add-ons they chose.

export const parseOptional = v => {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  return [...new Set(list.map(s => String(s).trim()).filter(Boolean))].slice(0, 20);
};

// An explicit state wins. Otherwise the state comes from the PIN code (given, or saved on the customer's profile).
export function contextFor(user, { state, pincode, optional } = {}) {
  const given = String(state ?? '').trim();
  const pin = pincode || user?.address?.zipCode || '';
  return { state: STATES.includes(given) ? given : stateFromPincode(pin), optional: parseOptional(optional) };
}

export default { contextFor, parseOptional };
