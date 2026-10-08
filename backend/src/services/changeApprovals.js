import crypto from 'crypto';
import ChangeRequest from '../models/ChangeRequest.js';
import Offer from '../models/Offer.js';
import { getConfig, setConfig } from './configService.js';
import { getPolicy, savePolicy } from './pricingPolicy.js';
import { getHome, saveHome } from './homeContent.js';
import { getRules, saveRules } from './decisionEngine.js';
import { applyOfferChange, offerView } from './promoOffers.js';
import { audit } from './auditService.js';

// Two-person approval ("maker and checker") for the changes that reach customers: pricing, home-screen banners,
// offers and the decision rules. It is a switch per area (off until the super admin turns it on). When it is on, saving
// creates a request, and a different member of staff with the approval permission has to approve it before it goes live.
//
// Each target says: how to read what is live now (`current`), how to fingerprint it so a stale request is caught
// (`fingerprint`), how to apply an approved change (`save`), and how to describe it.

export const TARGETS = {
  PRICING: { label: 'Pricing', setting: 'pricing', current: () => getPolicy(), save: (c, by) => savePolicy(c, by), result: r => r.policy, action: () => 'PRICING_UPDATED', entity: () => ({ type: 'Config', id: 'PRICING_POLICY' }) },
  APP_HOME: { label: 'Offers and branding', setting: 'banners', current: () => getHome(), save: (c, by) => saveHome(c, by), result: r => r.home, action: () => 'APP_HOME_UPDATED', entity: () => ({ type: 'Config', id: 'APP_HOME' }) },
  DECISION_RULES: { label: 'Decision rules', setting: 'decisions', current: () => getRules(), save: (c, by) => saveRules(c, by), result: r => r.rules, action: () => 'DECISION_RULES_UPDATED', entity: () => ({ type: 'Config', id: 'DECISION_RULES' }) },
  // An offer: the request carries { op: 'create' | 'update' | 'delete', id, data }
  OFFER: {
    label: 'Offers tab',
    setting: 'offers',
    current: async ref => (ref ? offerView(await Offer.findById(ref).lean()) : null),
    fingerprint: o => (o ? { updatedAt: o.updatedAt, status: o.status } : 'none'),
    save: (c, by) => applyOfferChange(c, by),
    result: r => r.offer || { deleted: true },
    action: p => ({ create: 'OFFER_CREATED', update: 'OFFER_UPDATED', delete: 'OFFER_DELETED' }[p.op]),
    entity: (p, ref) => ({ type: 'Offer', id: ref || 'new' }),
    describe: (before, p) => (p.op === 'delete' ? [`Delete the offer "${before?.title || ''}"`] : p.op === 'create' ? [`New offer: "${p.data.title}"`, `Status: ${p.data.status}`, `Shown to: ${p.data.audience}`] : describeChange(pick(before), pick(p.data))),
  },
};

const pick = o => (o ? { title: o.title, summary: o.summary, details: o.details, terms: o.terms, badge: o.badge, status: o.status, audience: o.audience, theme: o.theme, couponCode: o.couponCode, startsAt: o.startsAt, endsAt: o.endsAt, featured: o.featured, cta: o.cta } : {});

export function approvalSettings() {
  try {
    const s = JSON.parse(getConfig('CHANGE_APPROVALS', '') || '{}');
    return { pricing: s.pricing === true, banners: s.banners === true, offers: s.offers === true, decisions: s.decisions === true };
  } catch (e) {
    return { pricing: false, banners: false, offers: false, decisions: false };
  }
}

export async function saveApprovalSettings(input, by) {
  const s = { pricing: input?.pricing === true, banners: input?.banners === true, offers: input?.offers === true, decisions: input?.decisions === true };
  await setConfig('CHANGE_APPROVALS', JSON.stringify(s), { group: 'app', updatedBy: by });
  return s;
}

export const approvalRequired = target => approvalSettings()[TARGETS[target].setting] === true;

const stable = v => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const hash = v => crypto.createHash('sha1').update(stable(v)).digest('hex');
const fingerprint = (t, before) => hash(t.fingerprint ? t.fingerprint(before) : before);

// A short, readable list of what changes, like "annualRatePercent: 15 -> 14".
function flat(o, prefix = '', out = {}) {
  if (Array.isArray(o)) {
    out[prefix] = `${o.length} item${o.length === 1 ? '' : 's'}`;
    o.forEach((x, i) => flat(x, `${prefix}[${i}]`, out));
    return out;
  }
  if (o && typeof o === 'object' && !(o instanceof Date)) {
    for (const k of Object.keys(o)) flat(o[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = o;
  return out;
}

export function describeChange(before, after) {
  const a = flat(before), b = flat(after), lines = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (stable(a[k]) !== stable(b[k]) && !/\[\d+\]/.test(k)) lines.push(`${k}: ${a[k] === undefined ? '(new)' : a[k]} -> ${b[k] === undefined ? '(removed)' : b[k]}`);
  }
  if (!lines.length) lines.push('Detailed changes (see the proposed content)');
  return lines.slice(0, 25);
}

// Stores a validated change for approval. `candidate` has already been checked by the caller.
// `ref` is the thing being changed when the target is many things (an offer's id).
export async function propose(target, candidate, user, req, ref = null) {
  const t = TARGETS[target];
  const before = await t.current(ref);
  // A person's newer proposal for the same thing replaces their older open one
  const sameThing = ref ? { target, status: 'pending', requestedBy: user.email, ref: String(ref) } : target === 'OFFER' ? null : { target, status: 'pending', requestedBy: user.email };
  const open = sameThing ? await ChangeRequest.findOne(sameThing) : null;
  if (open) {
    open.status = 'withdrawn';
    open.decidedAt = new Date();
    open.note = 'Replaced by a newer proposal';
    await open.save();
  }
  const summary = t.describe ? t.describe(before, candidate) : describeChange(before, candidate);
  const doc = await ChangeRequest.create({ target, ref: ref ? String(ref) : undefined, summary, proposed: candidate, baseHash: fingerprint(t, before), requestedBy: user.email });
  await audit(user, 'CHANGE_PROPOSED', { type: 'ChangeRequest', id: doc._id }, { target, summary: doc.summary }, req);
  return doc;
}

export async function decide(id, decision, note, user, req) {
  const doc = await ChangeRequest.findById(id);
  if (!doc) return { status: 404, error: 'Request not found' };
  if (doc.status !== 'pending') return { status: 409, error: `This request was already ${doc.status}` };
  const t = TARGETS[doc.target];

  if (decision === 'withdraw') {
    if (doc.requestedBy !== user.email) return { status: 403, error: 'Only the person who proposed it can withdraw it' };
    doc.status = 'withdrawn';
    doc.decidedBy = user.email;
    doc.decidedAt = new Date();
    await doc.save();
    await audit(user, 'CHANGE_WITHDRAWN', { type: 'ChangeRequest', id: doc._id }, { target: doc.target }, req);
    return { status: 200, doc };
  }

  if (doc.requestedBy.toLowerCase() === String(user.email).toLowerCase()) return { status: 403, error: 'A change has to be approved by someone other than the person who proposed it' };

  if (decision === 'reject') {
    if (!String(note || '').trim()) return { status: 400, error: 'Say why, so they know what to fix' };
    doc.status = 'rejected';
    doc.decidedBy = user.email;
    doc.decidedAt = new Date();
    doc.note = String(note).trim().slice(0, 300);
    await doc.save();
    await audit(user, 'CHANGE_REJECTED', { type: 'ChangeRequest', id: doc._id }, { target: doc.target, note: doc.note, requestedBy: doc.requestedBy }, req);
    return { status: 200, doc };
  }

  const before = await t.current(doc.ref);
  if (fingerprint(t, before) !== doc.baseHash) return { status: 409, error: `${t.label} was changed after this was proposed. Ask ${doc.requestedBy} to propose it again from the current version.` };
  const saved = await t.save(doc.proposed, `${doc.requestedBy} (approved by ${user.email})`);
  if (!saved.ok) return { status: saved.status || 400, error: saved.errors[0], errors: saved.errors };
  doc.status = 'approved';
  doc.decidedBy = user.email;
  doc.decidedAt = new Date();
  if (note) doc.note = String(note).slice(0, 300);
  await doc.save();
  const entity = t.entity(doc.proposed, doc.ref || saved.offer?.id);
  await audit(user, t.action(doc.proposed), entity, { before, after: t.result(saved), proposedBy: doc.requestedBy, approvedBy: user.email }, req);
  await audit(user, 'CHANGE_APPROVED', { type: 'ChangeRequest', id: doc._id }, { target: doc.target, requestedBy: doc.requestedBy }, req);
  return { status: 200, doc };
}

export default { TARGETS, approvalSettings, saveApprovalSettings, approvalRequired, propose, decide, describeChange };
