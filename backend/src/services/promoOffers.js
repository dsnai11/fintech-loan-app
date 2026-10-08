import User from '../models/User.js';
import Loan from '../models/Loan.js';
import Offer from '../models/Offer.js';
import Notification from '../models/Notification.js';
import { THEMES, ICONS, ACTIONS, AUDIENCES, getHome, audienceOf } from './homeContent.js';
import { pushToMany } from './pushService.js';
import { LANGUAGE_CODES } from '../i18n/catalogue.js';

// Offers for the Offers tab: what customers see, who sees it, and the notification that tells them about it.
// (The loan offer a customer gets after the credit check is a different thing: see offerService.js.)

const HEX = /^#[0-9a-fA-F]{6}$/;
const customerFilter = { role: { $in: [null, 'customer'] }, status: 'active', email: { $ne: (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase() } };
const MAX_OFFERS = 100;

const str = (v, max, name, errors, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) errors.push(`${name} is required`);
  if (s.length > max) errors.push(`${name} is too long (max ${max} characters)`);
  return s.slice(0, max);
};
const date = (v, name, errors) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) { errors.push(`${name} is not a valid date`); return null; }
  return d;
};
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

export function validateOffer(r) {
  const errors = [];
  r = r && typeof r === 'object' ? r : {};
  const o = {
    title: str(r.title, 60, 'Title', errors, true),
    summary: str(r.summary, 140, 'Short description', errors),
    details: str(r.details, 1500, 'Details', errors),
    terms: str(r.terms, 1500, 'Terms', errors),
    badge: str(r.badge, 20, 'Tag', errors),
    theme: pick(r.theme, THEMES, 'brand'),
    color1: '', color2: '',
    icon: pick(r.icon, ICONS, 'gift'),
    couponCode: String(r.couponCode ?? '').trim().toUpperCase(),
    cta: { text: str(r.cta?.text, 24, 'Button text', errors), action: pick(r.cta?.action, ACTIONS, 'none'), url: '' },
    audience: pick(r.audience, AUDIENCES, 'all'),
    startsAt: date(r.startsAt, 'Start', errors),
    endsAt: date(r.endsAt, 'End', errors),
    featured: r.featured === true,
    order: Number.isFinite(Number(r.order)) ? Math.max(-1000, Math.min(1000, Math.round(Number(r.order)))) : 0,
    status: r.status === 'published' ? 'published' : 'draft',
    notifyWhen: pick(r.notify?.when ?? r.notifyWhen, ['none', 'publish', 'manual'], 'none'),
    i18n: {},
  };
  if (o.couponCode && !/^[A-Z0-9_-]{3,20}$/.test(o.couponCode)) errors.push('The coupon code can have 3 to 20 letters, numbers, - or _');
  if (o.theme === 'custom') {
    for (const k of ['color1', 'color2']) {
      const v = String(r[k] ?? '').trim();
      if (!HEX.test(v)) errors.push('Pick both colours for the custom look');
      else o[k] = v.toUpperCase();
    }
  }
  if (o.cta.action !== 'none' && !o.cta.text) errors.push('Write the button text, or set the button to do nothing');
  if (o.cta.action === 'url') {
    const u = String(r.cta?.url ?? '').trim();
    if (!/^https:\/\/[^\s]{3,300}$/.test(u)) errors.push('The link must start with https://');
    else o.cta.url = u;
  }
  if (o.startsAt && o.endsAt && o.endsAt <= o.startsAt) errors.push('The end must be after the start');
  if (o.status === 'published' && !o.summary && !o.details) errors.push('Write a short description or details before publishing');
  for (const code of LANGUAGE_CODES.filter(x => x !== 'en')) {
    const t = r.i18n?.[code];
    if (!t || typeof t !== 'object') continue;
    const e = { title: str(t.title, 60, `Title (${code})`, errors), summary: str(t.summary, 140, `Short description (${code})`, errors), details: str(t.details, 1500, `Details (${code})`, errors), terms: str(t.terms, 1500, `Terms (${code})`, errors), cta: str(t.cta, 24, `Button text (${code})`, errors) };
    if (Object.values(e).some(Boolean)) o.i18n[code] = e;
  }
  return { errors, offer: o };
}

export const toDoc = o => {
  const { notifyWhen, ...rest } = o;
  return { ...rest, 'notify.when': notifyWhen };
};

export function stateOf(o, now = new Date()) {
  if (o.status !== 'published') return 'draft';
  if (o.startsAt && new Date(o.startsAt) > now) return 'scheduled';
  if (o.endsAt && new Date(o.endsAt) <= now) return 'ended';
  return 'live';
}
const isLive = (o, now) => stateOf(o, now) === 'live';

// What staff see for one offer
export const offerView = o => (!o ? null : {
  id: String(o._id), title: o.title, summary: o.summary, details: o.details, terms: o.terms, badge: o.badge, theme: o.theme, color1: o.color1, color2: o.color2, icon: o.icon, couponCode: o.couponCode,
  cta: o.cta, audience: o.audience, startsAt: o.startsAt || null, endsAt: o.endsAt || null, featured: o.featured, order: o.order, status: o.status, state: stateOf(o),
  notify: { when: o.notify?.when || 'none', sentAt: o.notify?.sentAt || null, recipients: o.notify?.recipients || 0, pushed: o.notify?.pushed || 0 },
  i18n: o.i18n || {}, views: o.views || 0, clicks: o.clicks || 0, updatedAt: o.updatedAt, updatedBy: o.updatedBy,
});

// Only a change that leaves the offer visible to customers needs a second person. Taking an offer down, or deleting it,
// is always immediate: an emergency takedown must never wait.
export const needsApproval = (current, incoming) => incoming?.status === 'published';

// Saves a create, update or delete. Used straight away, or once a second person has approved it.
export async function applyOfferChange({ op, id, data }, by) {
  if (op === 'delete') {
    const doc = await Offer.findByIdAndDelete(id).lean();
    return doc ? { ok: true, deleted: true } : { ok: false, status: 404, errors: ['Offer not found'] };
  }
  const { errors, offer } = validateOffer(data);
  if (errors.length) return { ok: false, status: 400, errors };
  let doc;
  if (op === 'create') doc = await Offer.create({ ...toDoc(offer), createdBy: by, updatedBy: by });
  else doc = await Offer.findByIdAndUpdate(id, { $set: { ...toDoc(offer), updatedBy: by } }, { new: true });
  if (!doc) return { ok: false, status: 404, errors: ['Offer not found'] };
  await sendDueOfferNotifications();
  return { ok: true, offer: offerView(await Offer.findById(doc._id).lean()) };
}

// The customers an offer is meant for
export async function audienceUserIds(audience) {
  const everyone = await User.find(customerFilter).select('_id').lean();
  const all = everyone.map(u => String(u._id));
  if (audience === 'all') return all;
  const set = new Set(all);
  const keep = ids => ids.map(String).filter(id => set.has(id));
  const live = ['disbursed', 'defaulted', 'approved', 'under_review', 'submitted'];
  if (audience === 'new') { const has = new Set((await Loan.distinct('userId')).map(String)); return all.filter(id => !has.has(id)); }
  if (audience === 'repeat') return keep(await Loan.distinct('userId', { status: 'closed' }));
  if (audience === 'has_loan') return keep(await Loan.distinct('userId', { status: { $in: live } }));
  if (audience === 'no_loan') { const has = new Set((await Loan.distinct('userId', { status: { $in: live } })).map(String)); return all.filter(id => !has.has(id)); }
  return [];
}

function localise(o, lang) {
  const t = lang !== 'en' ? o.i18n?.[lang] || {} : {};
  return { title: t.title || o.title, summary: t.summary || o.summary, details: t.details || o.details, terms: t.terms || o.terms, cta: { ...o.cta, text: t.cta || o.cta.text } };
}

// What a customer sees on the Offers tab
export async function offersFor(user, lang = 'en', now = new Date()) {
  const home = getHome();
  if (!home.languages.includes(lang)) lang = 'en';
  const groups = await audienceOf(user._id);
  const rows = await Offer.find({ status: 'published' }).sort({ featured: -1, order: 1, createdAt: -1 }).lean();
  return rows
    .filter(o => isLive(o, now) && (o.audience === 'all' || groups[o.audience]))
    .map(o => {
      const t = localise(o, lang);
      return { id: String(o._id), title: t.title, summary: t.summary, details: t.details, terms: t.terms, badge: o.badge, theme: o.theme, color1: o.color1, color2: o.color2, icon: o.icon, couponCode: o.couponCode, cta: t.cta, featured: o.featured, endsAt: o.endsAt || null, startsAt: o.startsAt || null, createdAt: o.createdAt };
    });
}

// Tells the offer's audience about it: a notification in the app, and a push to their phones when that is set up.
export async function notifyOffer(offer, now = new Date()) {
  const home = getHome();
  const ids = await audienceUserIds(offer.audience);
  const users = await User.find({ _id: { $in: ids } }).select('language').lean();
  const byLang = new Map();
  for (const u of users) {
    const l = home.languages.includes(u.language) ? u.language : 'en';
    (byLang.get(l) || byLang.set(l, []).get(l)).push(u._id);
  }
  let pushJobs = [];
  for (const [lang, list] of byLang) {
    const t = localise(offer, lang);
    const message = t.summary || t.title;
    for (let i = 0; i < list.length; i += 1000) {
      await Notification.insertMany(list.slice(i, i + 1000).map(userId => ({ userId, type: 'OFFER', title: t.title, message, data: { offerId: String(offer._id) } })), { ordered: false });
    }
    pushJobs.push(pushToMany(list, { title: t.title, body: message, type: 'OFFER', data: { offerId: String(offer._id) } }));
  }
  await Offer.updateOne({ _id: offer._id }, { $set: { 'notify.sentAt': now, 'notify.recipients': ids.length } });
  // Pushes go out in the background; the count is recorded when they finish
  Promise.all(pushJobs).then(n => Offer.updateOne({ _id: offer._id }, { $set: { 'notify.pushed': n.reduce((a, b) => a + b, 0) } })).catch(e => console.error('Offer push failed:', e.message));
  return { recipients: ids.length };
}

// Offers set to notify "when it goes live" are announced once, as soon as they are live. Safe to run often.
export async function sendDueOfferNotifications(now = new Date()) {
  const due = await Offer.find({ status: 'published', 'notify.when': 'publish', 'notify.sentAt': { $exists: false } }).lean();
  let sent = 0;
  for (const o of due) {
    if (!isLive(o, now)) continue;
    // claim it first so two servers never send the same offer twice
    const claim = await Offer.findOneAndUpdate({ _id: o._id, 'notify.sentAt': { $exists: false } }, { $set: { 'notify.sentAt': now } });
    if (!claim) continue;
    try { await notifyOffer(o, now); sent++; } catch (e) { console.error('Offer notification failed:', e.message); await Offer.updateOne({ _id: o._id }, { $unset: { 'notify.sentAt': 1 } }); }
  }
  return { sent };
}

export { MAX_OFFERS };
export default { validateOffer, applyOfferChange, offerView, needsApproval, offersFor, notifyOffer, sendDueOfferNotifications, audienceUserIds, stateOf };
