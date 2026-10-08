import crypto from 'crypto';
import ChangeRequest from '../models/ChangeRequest.js';
import { getConfig, setConfig } from './configService.js';
import { getPolicy, savePolicy } from './pricingPolicy.js';
import { getHome, saveHome } from './homeContent.js';
import { audit } from './auditService.js';

// Two-person approval ("maker and checker") for the changes that reach customers: pricing and home-screen banners.
// It is a switch per area (off until the super admin turns it on). When it is on, saving creates a request, and a
// different member of staff with the approval permission has to approve it before it goes live.

export const TARGETS = {
  PRICING: { label: 'Pricing', setting: 'pricing', current: () => getPolicy(), save: (c, by) => savePolicy(c, by), result: r => r.policy, action: 'PRICING_UPDATED', entity: 'PRICING_POLICY' },
  APP_HOME: { label: 'Offers and branding', setting: 'banners', current: () => getHome(), save: (c, by) => saveHome(c, by), result: r => r.home, action: 'APP_HOME_UPDATED', entity: 'APP_HOME' },
};

export function approvalSettings() {
  try {
    const s = JSON.parse(getConfig('CHANGE_APPROVALS', '') || '{}');
    return { pricing: s.pricing === true, banners: s.banners === true };
  } catch (e) {
    return { pricing: false, banners: false };
  }
}

export async function saveApprovalSettings(input, by) {
  const s = { pricing: input?.pricing === true, banners: input?.banners === true };
  await setConfig('CHANGE_APPROVALS', JSON.stringify(s), { group: 'app', updatedBy: by });
  return s;
}

export const approvalRequired = target => approvalSettings()[TARGETS[target].setting] === true;

const stable = v => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const hash = v => crypto.createHash('sha1').update(stable(v)).digest('hex');

// A short, readable list of what changes, like "annualRatePercent: 15 -> 14".
function flat(o, prefix = '', out = {}) {
  if (Array.isArray(o)) {
    out[prefix] = `${o.length} item${o.length === 1 ? '' : 's'}`;
    o.forEach((x, i) => flat(x, `${prefix}[${i}]`, out));
    return out;
  }
  if (o && typeof o === 'object') {
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
export async function propose(target, candidate, user, req) {
  const before = TARGETS[target].current();
  const open = await ChangeRequest.findOne({ target, status: 'pending', requestedBy: user.email });
  if (open) {
    open.status = 'withdrawn';
    open.decidedAt = new Date();
    open.note = 'Replaced by a newer proposal';
    await open.save();
  }
  const doc = await ChangeRequest.create({ target, summary: describeChange(before, candidate), proposed: candidate, baseHash: hash(before), requestedBy: user.email });
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

  const before = t.current();
  if (hash(before) !== doc.baseHash) return { status: 409, error: `${t.label} was changed after this was proposed. Ask ${doc.requestedBy} to propose it again from the current version.` };
  const saved = await t.save(doc.proposed, `${doc.requestedBy} (approved by ${user.email})`);
  if (!saved.ok) return { status: saved.status || 400, error: saved.errors[0], errors: saved.errors };
  doc.status = 'approved';
  doc.decidedBy = user.email;
  doc.decidedAt = new Date();
  if (note) doc.note = String(note).slice(0, 300);
  await doc.save();
  await audit(user, t.action, { type: 'Config', id: t.entity }, { before, after: t.result(saved), proposedBy: doc.requestedBy, approvedBy: user.email }, req);
  await audit(user, 'CHANGE_APPROVED', { type: 'ChangeRequest', id: doc._id }, { target: doc.target, requestedBy: doc.requestedBy }, req);
  return { status: 200, doc };
}

export default { TARGETS, approvalSettings, saveApprovalSettings, approvalRequired, propose, decide, describeChange };
