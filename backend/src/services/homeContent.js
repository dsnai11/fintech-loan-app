import { getConfig, setConfig } from './configService.js';
import { getPolicy } from './pricingPolicy.js';
import { activeOffer } from './offerService.js';
import Loan from '../models/Loan.js';

// What the customer app's home screen shows around the loan offer: the company's branding and the offer
// banners (animated, scheduled, aimed at a group of customers). Staff manage all of it on the portal's
// "Offers and branding" page; the app reads it from GET /api/app-home.

export const THEMES = ['brand', 'sunrise', 'ocean', 'emerald', 'royal', 'gold', 'midnight', 'custom'];
export const ICONS = ['rupee', 'gift', 'bolt', 'star', 'shield', 'clock', 'rocket', 'heart', 'calendar', 'party'];
export const ANIMATIONS = ['none', 'shimmer', 'pulse', 'float', 'confetti'];
export const ACTIONS = ['none', 'apply', 'calculator', 'loans', 'messages', 'help', 'url'];
export const AUDIENCES = ['all', 'new', 'repeat', 'has_loan', 'no_loan'];
export const TRUST_ICONS = ['shield', 'lock', 'check', 'receipt', 'bolt', 'heart', 'star'];

export const DEFAULTS = {
  brand: {
    tagline: 'Money when you need it',
    primaryColor: '#7B0000',
    secondaryColor: '#C41E3A',
    heroAnimation: true,
    showRegistration: true,
    trustStrip: [
      { icon: 'receipt', text: 'Every charge shown first' },
      { icon: 'lock', text: 'Secured with OTP and KYC' },
      { icon: 'check', text: 'Instalments you can see' },
    ],
  },
  carousel: { autoplaySeconds: 4 },
  banners: [],
};

const clone = o => JSON.parse(JSON.stringify(o));
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9_-]{1,40}$/;
const TOKENS = ['name', 'offer', 'maxLoan'];

export function getHome() {
  let stored = null;
  try {
    const raw = getConfig('APP_HOME', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* defaults */ }
  const out = clone(DEFAULTS);
  if (stored && typeof stored === 'object') {
    if (stored.brand && typeof stored.brand === 'object') Object.assign(out.brand, stored.brand);
    if (stored.carousel && typeof stored.carousel === 'object') Object.assign(out.carousel, stored.carousel);
    if (Array.isArray(stored.banners)) out.banners = stored.banners;
  }
  return out;
}

const str = (v, max, name, errors, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) errors.push(`${name} is required`);
  if (s.length > max) errors.push(`${name} is too long (max ${max} characters)`);
  return s.slice(0, max);
};
const date = (v, name, errors) => {
  if (v === undefined || v === null || v === '') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) { errors.push(`${name} is not a valid date`); return ''; }
  return d.toISOString();
};
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

export function validateHome(candidate) {
  const errors = [];
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const out = clone(DEFAULTS);

  const b = c.brand || {};
  out.brand.tagline = str(b.tagline, 80, 'Tagline', errors);
  for (const k of ['primaryColor', 'secondaryColor']) {
    const v = String(b[k] ?? DEFAULTS.brand[k]).trim();
    if (!HEX.test(v)) errors.push(`${k === 'primaryColor' ? 'Main' : 'Second'} brand colour must look like #7B0000`);
    else out.brand[k] = v.toUpperCase();
  }
  out.brand.heroAnimation = b.heroAnimation !== false;
  out.brand.showRegistration = b.showRegistration !== false;
  out.brand.trustStrip = [];
  const strip = Array.isArray(b.trustStrip) ? b.trustStrip : [];
  if (strip.length > 4) errors.push('Use at most 4 points in the trust strip');
  for (const [i, t] of strip.slice(0, 4).entries()) {
    const text = str(t?.text, 40, `Trust point ${i + 1}`, errors);
    if (text) out.brand.trustStrip.push({ icon: pick(t.icon, TRUST_ICONS, 'check'), text });
  }

  const sec = Number(c.carousel?.autoplaySeconds ?? DEFAULTS.carousel.autoplaySeconds);
  if (!Number.isFinite(sec) || sec < 0 || sec > 30) errors.push('Banner rotation must be between 0 (off) and 30 seconds');
  else out.carousel.autoplaySeconds = Math.round(sec);

  const list = Array.isArray(c.banners) ? c.banners : [];
  if (list.length > 12) errors.push('Keep to 12 banners or fewer so the app stays quick');
  const seen = new Set();
  out.banners = [];
  for (const [i, raw] of list.slice(0, 12).entries()) {
    const label = `Banner ${i + 1}`;
    const r = raw && typeof raw === 'object' ? raw : {};
    let id = String(r.id || '').trim();
    if (!ID.test(id)) id = `b${Date.now().toString(36)}${i}`;
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const title = str(r.title, 60, `${label} headline`, errors, true);
    const bn = {
      id,
      enabled: r.enabled !== false,
      title,
      subtitle: str(r.subtitle, 140, `${label} line below`, errors),
      badge: str(r.badge, 20, `${label} tag`, errors),
      theme: pick(r.theme, THEMES, 'brand'),
      color1: '', color2: '',
      icon: pick(r.icon, ICONS, 'rupee'),
      animation: pick(r.animation, ANIMATIONS, 'shimmer'),
      cta: { text: str(r.cta?.text, 24, `${label} button text`, errors), action: pick(r.cta?.action, ACTIONS, 'none'), url: '' },
      audience: pick(r.audience, AUDIENCES, 'all'),
      startsAt: date(r.startsAt, `${label} start`, errors),
      endsAt: date(r.endsAt, `${label} end`, errors),
      showCountdown: r.showCountdown === true,
      imageUrl: '',
    };
    if (bn.theme === 'custom') {
      for (const k of ['color1', 'color2']) {
        const v = String(r[k] ?? '').trim();
        if (!HEX.test(v)) errors.push(`${label}: pick both colours for the custom look`);
        else bn[k] = v.toUpperCase();
      }
    }
    if (bn.cta.action !== 'none' && !bn.cta.text) errors.push(`${label}: write the button text, or set the button to do nothing`);
    if (bn.cta.action === 'url') {
      const u = String(r.cta?.url ?? '').trim();
      if (!/^https:\/\/[^\s]{3,300}$/.test(u)) errors.push(`${label}: the link must start with https://`);
      else bn.cta.url = u;
    }
    const img = String(r.imageUrl ?? '').trim();
    if (img) {
      if (!/^https:\/\/[^\s]{3,400}$/.test(img)) errors.push(`${label}: the picture link must start with https://`);
      else bn.imageUrl = img;
    }
    if (bn.startsAt && bn.endsAt && new Date(bn.endsAt) <= new Date(bn.startsAt)) errors.push(`${label}: the end must be after the start`);
    if (bn.showCountdown && !bn.endsAt) errors.push(`${label}: the countdown needs an end date`);
    for (const m of `${bn.title} ${bn.subtitle}`.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
      if (!TOKENS.includes(m[1])) errors.push(`${label}: {{${m[1]}}} is not a known placeholder (use ${TOKENS.map(t => `{{${t}}}`).join(', ')})`);
    }
    out.banners.push(bn);
  }
  return { errors, home: out };
}

export async function saveHome(candidate, updatedBy) {
  const { errors, home } = validateHome(candidate);
  if (errors.length) return { ok: false, errors };
  await setConfig('APP_HOME', JSON.stringify(home), { group: 'app', updatedBy });
  return { ok: true, home };
}

const rupees = n => `₹${Number(n).toLocaleString('en-IN')}`;

// Which group of customers is this person in?
async function audienceOf(userId) {
  const loans = await Loan.find({ userId }).select('status').lean();
  const live = loans.some(l => ['disbursed', 'defaulted', 'approved', 'under_review', 'submitted'].includes(l.status));
  const everRepaid = loans.some(l => l.status === 'closed');
  return { new: loans.length === 0, repeat: everRepaid, has_loan: live, no_loan: !live };
}

const live = (b, now) => b.enabled && (!b.startsAt || new Date(b.startsAt) <= now) && (!b.endsAt || new Date(b.endsAt) > now);

// The home content for one customer: branding, and the banners that are on, in date, and meant for them.
export async function homeFor(user, now = new Date()) {
  const home = getHome();
  const policy = getPolicy();
  const groups = await audienceOf(user._id);
  const offer = activeOffer(user);
  const offerAmount = offer && offer.status !== 'DECLINED' && offer.amount > 0 ? offer.amount : null;
  const values = { name: String(user.firstName || '').trim(), offer: offerAmount ? rupees(offerAmount) : '', maxLoan: policy.maxAmount ? rupees(policy.maxAmount) : '' };

  const banners = [];
  for (const b of home.banners) {
    if (!live(b, now)) continue;
    if (b.audience !== 'all' && !groups[b.audience]) continue;
    const text = `${b.title} ${b.subtitle}`;
    // A line that quotes the customer's own offer or name is skipped when there is nothing to put in it.
    const need = [...text.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map(m => m[1]);
    if (need.some(t => !values[t])) continue;
    const fill = s => s.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, t) => values[t] ?? '');
    banners.push({ id: b.id, title: fill(b.title), subtitle: fill(b.subtitle), badge: b.badge, theme: b.theme, color1: b.color1, color2: b.color2, icon: b.icon, animation: b.animation, cta: b.cta, endsAt: b.showCountdown ? b.endsAt : '', imageUrl: b.imageUrl });
  }

  const inst = policy.institution || {};
  return {
    brand: {
      name: inst.lenderName || '',
      tagline: home.brand.tagline,
      primaryColor: home.brand.primaryColor,
      secondaryColor: home.brand.secondaryColor,
      heroAnimation: home.brand.heroAnimation,
      registration: home.brand.showRegistration && inst.registrationNumber ? `NBFC · Reg. no. ${inst.registrationNumber}` : '',
      trustStrip: home.brand.trustStrip,
    },
    carousel: home.carousel,
    banners,
    serverTime: now.toISOString(),
  };
}

export default { getHome, saveHome, validateHome, homeFor, DEFAULTS };
