import { appSecret } from './appSecret.js';
import crypto from 'crypto';
import Lead from '../models/Lead.js';
import { clientIp } from './auditService.js';
import { getSettings as appSettings } from './appSettings.js';

// Requests to be contacted. Two ways in: a signed-in customer asking about a product partners provide, and a visitor on a page of
// the company's website. Both must tick that they agree to be contacted; the wording is stored with the lead.

export const STATUSES = ['new', 'contacted', 'with_partner', 'won', 'lost'];
export const CONSENT_TEXT = 'I agree that LIFC and its partners may call, SMS or WhatsApp me about this loan request. This overrides any Do Not Disturb setting for this request.';
const EMPLOYMENT = ['Salaried', 'Self-Employed', 'Business', 'Other'];
const fail = (status, error) => ({ ok: false, status, error });

export const isIndianMobile = p => /^[6-9]\d{9}$/.test(p);
export const cleanPhone = p => String(p ?? '').replace(/\D/g, '').slice(-10);

function amountOf(v, label, errors, { max = 1e10 } = {}) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1000 || n > max) { errors.push(`${label} must be between Rs 1,000 and Rs ${max.toLocaleString('en-IN')}`); return undefined; }
  return Math.round(n);
}

const ipHash = req => crypto.createHash('sha256').update(`${clientIp(req) || ''}|${appSecret()}`).digest('hex').slice(0, 32);

// Common checks and saving. `who` is { name, phone, userId? }.
async function save({ kind, source, page, who, body, req }) {
  const errors = [];
  if (body.consent !== true) return fail(400, 'Please tick that you agree to be contacted.');
  const name = String(who.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) return fail(400, 'Enter your name.');
  const phone = cleanPhone(who.phone);
  if (!isIndianMobile(phone)) return fail(400, 'Enter a 10-digit mobile number.');
  const amount = amountOf(body.amount, 'The loan amount', errors);
  const propertyValue = amountOf(body.propertyValue, 'The property value', errors);
  if (errors.length) return fail(400, errors[0]);
  const employment = EMPLOYMENT.includes(body.employment) ? body.employment : '';
  const city = String(body.city ?? '').trim().slice(0, 40);
  const note = String(body.note ?? '').trim().slice(0, 300);

  // The same person asking twice in a day is one request
  const dup = await Lead.findOne({ phone, kind, createdAt: { $gte: new Date(Date.now() - 86400000) } });
  if (dup) return { ok: true, status: 200, duplicate: true, id: String(dup._id) };
  // A visitor cannot flood us: a few requests an hour from one address
  const hash = ipHash(req);
  if (source === 'web' && (await Lead.countDocuments({ ipHash: hash, createdAt: { $gte: new Date(Date.now() - 3600000) } })) >= 5) return fail(429, 'Too many requests from your connection. Please try again later.');

  const lead = await Lead.create({ kind, source, page, name, phone, city, amount, propertyValue, employment, note, userId: who.userId, consentAt: new Date(), consentText: CONSENT_TEXT, ipHash: hash });
  return { ok: true, status: 201, id: String(lead._id) };
}

// A signed-in customer asks about a marketplace product. Their name and number come from their account.
export async function fromApp(user, body, req) {
  const key = String(body.kind || '');
  const product = (appSettings().marketplace || []).find(p => p.key === key && p.enabled);
  if (!product) return fail(400, 'That product is not available right now.');
  return save({ kind: key, source: 'app', page: '', who: { name: `${user.firstName} ${user.lastName}`, phone: user.phone, userId: user._id }, body, req });
}

// A visitor on the company's website. A hidden field that people never fill in catches simple bots.
export async function fromWeb(body, req) {
  if (String(body.website || '').trim()) return { ok: true, status: 200, duplicate: true }; // a bot: say thanks, keep nothing
  const kind = ['personal', 'callback'].includes(body.kind) ? body.kind : 'personal';
  return save({ kind, source: 'web', page: String(body.page ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 60), who: { name: body.name, phone: body.phone }, body, req });
}

export const cell = v => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export default { fromApp, fromWeb, STATUSES, CONSENT_TEXT };
