import crypto from 'crypto';
import User from '../models/User.js';
import { getRules, computeOffer, gatherUserFacts } from './decisionEngine.js';
import { checkCredit } from './bureauService.js';

// A customer's loan offer: how much they can borrow, worked out after a credit check and the decision rules.
// The app shows it, and it is the most they can apply for. It stays valid for a set number of days, and is
// worked out again if the rules change.

export const offerLimitOn = () => process.env.OFFER_LIMIT !== 'false';

const keyOf = rules => crypto.createHash('sha1').update(JSON.stringify({ o: rules.offer, a: rules.age, h: rules.history, b: rules.bureau })).digest('hex').slice(0, 12);

export function activeOffer(user) {
  const o = user?.offer;
  if (!o || !o.expiresAt || new Date(o.expiresAt) <= new Date()) return null;
  if (o.rulesKey !== keyOf(getRules())) return null;
  return o;
}

// What the customer is allowed to see of their offer.
export const publicOffer = o => o && ({ status: o.status, amount: o.amount, reason: o.reason || null, expiresAt: o.expiresAt, creditCheck: o.source || 'none' });

// Works the offer out and saves it. With `pullCredit` the credit bureau is asked for the customer's score first.
export async function makeOffer(user, policy, { pullCredit = false } = {}) {
  const rules = getRules();
  if (pullCredit) {
    const c = await checkCredit(user);
    if (c.score) { user.creditScore = c.score; user.creditScoreSource = c.source; }
  }
  const result = computeOffer(rules, await gatherUserFacts(user), policy);
  const record = {
    ...result,
    source: user.creditScore > 0 ? user.creditScoreSource || 'bureau' : 'none',
    computedAt: new Date(),
    expiresAt: new Date(Date.now() + rules.offer.validDays * 86400000),
    rulesKey: keyOf(rules),
  };
  await User.updateOne({ _id: user._id }, { offer: record });
  user.offer = record;
  return record;
}

// The most this customer can ask for right now, and why not if they cannot. Works out an offer if there is none.
export async function offerCap(user, policy) {
  if (!offerLimitOn()) return { cap: Infinity, offer: null };
  const offer = activeOffer(user) || (await makeOffer(user, policy));
  return { cap: offer.status === 'DECLINED' ? 0 : offer.amount, offer };
}

export default { makeOffer, activeOffer, publicOffer, offerCap, offerLimitOn };
