import User from '../models/User.js';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import AmlAlert from '../models/AmlAlert.js';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import DeviceToken from '../models/DeviceToken.js';
import NudgeLog from '../models/NudgeLog.js';
import { getConfig, setConfig } from './configService.js';
import { notify } from './notificationService.js';
import { setupStatus } from './onboardingService.js';
import { activeOffer } from './offerService.js';

// Gentle reminders for customers who stopped part-way: an unfinished set-up, an offer they have not used, an offer about
// to expire, an approved loan not yet accepted, a customer who repaid and has not come back, a customer who has not opened
// the app for a while.
//
// They are marketing-style messages, so they follow the customer's "Offers and news" setting, never go out in quiet hours,
// keep a gap between any two nudges, have a weekly limit, and stop after a set number per reason. Customers who are
// behind on payments or have an open AML alert get none (collections or compliance deal with them). SMS is off unless
// switched on per reason, and a marketing SMS needs an approved template under the telecom rules.

const DAY = 864e5;
const IST = 5.5 * 36e5;
const istHour = d => new Date(+new Date(d) + IST).getUTCHours();

export const SEGMENTS = {
  setup_abandoned: { label: 'Did not finish set-up', hint: 'Signed up but identity, details, photo or bank account is still missing.', timing: 'afterDays', timingLabel: 'Days after sign-up' },
  eligibility_no_apply: { label: 'Checked eligibility, did not apply', hint: 'Has a loan offer but has not applied.', timing: 'afterDays', timingLabel: 'Days after the offer was made' },
  offer_expiring: { label: 'Offer about to expire', hint: 'The loan offer ends soon.', timing: 'daysBefore', timingLabel: 'Days before it expires' },
  approved_not_accepted: { label: 'Approved, agreement not accepted', hint: 'Loan approved but the customer has not accepted the agreement, so no money has been sent.', timing: 'afterDays', timingLabel: 'Days after approval' },
  winback: { label: 'Repaid, has not come back', hint: 'Repaid a loan in full and has no new application.', timing: 'afterDays', timingLabel: 'Days after the loan closed' },
  inactive: { label: 'Has not opened the app', hint: 'Has the app on a phone but has not opened it for a while.', timing: 'afterDays', timingLabel: 'Days since last opened' },
};

// Most urgent first: when a customer fits several, only the first one goes out until the gap has passed
const ORDER = ['approved_not_accepted', 'offer_expiring', 'eligibility_no_apply', 'setup_abandoned', 'winback', 'inactive'];

export const DEFAULTS = {
  enabled: false,
  quietStart: 21, quietEnd: 9,
  minGapDays: 2, // between any two nudges to one customer
  weeklyCap: 2, // most nudges one customer gets in 7 days
  segments: {
    setup_abandoned: { enabled: true, afterDays: 1, repeatEveryDays: 3, maxSends: 3, sms: false, title: 'Finish setting up your account', message: 'Hi {name}, you are a few steps away from your loan offer. It takes about 3 minutes to finish.' },
    eligibility_no_apply: { enabled: true, afterDays: 1, repeatEveryDays: 4, maxSends: 2, sms: false, title: 'Your loan offer is waiting', message: 'Hi {name}, you can borrow up to {amount}. Apply in the app whenever you are ready.' },
    offer_expiring: { enabled: true, daysBefore: 3, repeatEveryDays: 30, maxSends: 1, sms: false, title: 'Your offer ends soon', message: 'Hi {name}, your offer of up to {amount} ends in {days} days. Apply before it does.' },
    approved_not_accepted: { enabled: true, afterDays: 1, repeatEveryDays: 2, maxSends: 3, sms: false, title: 'Your loan is approved', message: 'Hi {name}, your loan is approved. Open the app and accept the agreement so we can send the money to your bank account.' },
    winback: { enabled: false, afterDays: 30, repeatEveryDays: 45, maxSends: 2, sms: false, title: 'Need money again?', message: 'Hi {name}, thank you for repaying on time. You may be able to borrow more now. Check your offer in the app.' },
    inactive: { enabled: false, afterDays: 30, repeatEveryDays: 30, maxSends: 2, sms: false, title: 'We have missed you', message: 'Hi {name}, there is something new in the app for you. Take a look when you have a moment.' },
  },
};

const clone = o => JSON.parse(JSON.stringify(o));
export function getSettings() {
  try {
    const saved = JSON.parse(getConfig('NUDGE_SETTINGS', '') || '{}');
    const out = { ...clone(DEFAULTS), ...saved, segments: {} };
    for (const k of Object.keys(DEFAULTS.segments)) out.segments[k] = { ...DEFAULTS.segments[k], ...(saved.segments?.[k] || {}) };
    return out;
  } catch (e) {
    return clone(DEFAULTS);
  }
}

export function validateSettings(input) {
  const errors = [];
  const out = clone(DEFAULTS);
  const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number between ${min} and ${max}`); return undefined; }
    return n;
  };
  out.enabled = input?.enabled === true;
  out.quietStart = int(input?.quietStart ?? DEFAULTS.quietStart, 0, 23, 'Quiet hours start');
  out.quietEnd = int(input?.quietEnd ?? DEFAULTS.quietEnd, 0, 23, 'Quiet hours end');
  out.minGapDays = int(input?.minGapDays ?? DEFAULTS.minGapDays, 0, 30, 'Days between two nudges');
  out.weeklyCap = int(input?.weeklyCap ?? DEFAULTS.weeklyCap, 1, 10, 'Most nudges in a week');
  for (const [k, def] of Object.entries(DEFAULTS.segments)) {
    const s = input?.segments?.[k] || {};
    const label = SEGMENTS[k].label;
    const t = SEGMENTS[k].timing;
    const title = String(s.title ?? def.title).trim();
    const message = String(s.message ?? def.message).trim();
    if (!title || title.length > 60) errors.push(`${label}: the title must be 1 to 60 characters`);
    if (!message || message.length > 300) errors.push(`${label}: the message must be 1 to 300 characters`);
    out.segments[k] = {
      enabled: s.enabled === true, [t]: int(s[t] ?? def[t], t === 'daysBefore' ? 1 : 0, 365, `${label}: ${SEGMENTS[k].timingLabel}`),
      repeatEveryDays: int(s.repeatEveryDays ?? def.repeatEveryDays, 1, 365, `${label}: days between repeats`),
      maxSends: int(s.maxSends ?? def.maxSends, 1, 10, `${label}: most messages`), sms: s.sms === true, title, message,
    };
  }
  return { errors, settings: out };
}

export async function saveSettings(input, by) {
  const { errors, settings } = validateSettings(input);
  if (errors.length) return { ok: false, errors };
  await setConfig('NUDGE_SETTINGS', JSON.stringify(settings), { group: 'app', updatedBy: by });
  return { ok: true, settings };
}

const render = (tpl, v) => String(tpl).replace(/\{(name|amount|days)\}/g, (_, k) => v[k] ?? '');
const inr = n => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
export const inQuietHours = (now, s) => {
  const h = istHour(now);
  return s.quietStart > s.quietEnd ? h >= s.quietStart || h < s.quietEnd : h >= s.quietStart && h < s.quietEnd;
};

// Customers a nudge must never go to: behind on payments, an open AML alert, blocked, or not a customer
async function blockedIds(ids) {
  const [late, aml] = await Promise.all([
    EMIPayment.distinct('userId', { userId: { $in: ids }, status: { $in: ['OVERDUE', 'FAILED'] } }),
    AmlAlert.distinct('userId', { userId: { $in: ids }, status: { $in: ['OPEN', 'ESCALATED'] } }),
  ]);
  const defaulted = await Loan.distinct('userId', { userId: { $in: ids }, status: { $in: ['defaulted', 'written_off'] } });
  return new Set([...late, ...aml, ...defaulted].map(String));
}

const customers = (extra = {}) => ({ role: 'customer', status: 'active', ...extra });
const openStatuses = ['submitted', 'under_review', 'approved', 'disbursed'];

// Everyone in a segment right now, before the politeness rules are applied. [{ user, vars }]
export async function audience(key, s, now = new Date()) {
  const seg = s.segments[key];
  const out = [];
  if (key === 'setup_abandoned') {
    const users = await User.find(customers({ createdAt: { $lte: new Date(+now - seg.afterDays * DAY), $gte: new Date(+now - 60 * DAY) } })).limit(2000);
    const withLoan = new Set((await Loan.distinct('userId', { userId: { $in: users.map(u => u._id) } })).map(String));
    for (const u of users) if (!setupStatus(u).complete && !withLoan.has(String(u._id))) out.push({ user: u, vars: {} });
  } else if (key === 'eligibility_no_apply' || key === 'offer_expiring') {
    const range = key === 'offer_expiring'
      ? { 'offer.expiresAt': { $gt: now, $lte: new Date(+now + seg.daysBefore * DAY) } }
      : { 'offer.expiresAt': { $gt: now }, 'offer.computedAt': { $lte: new Date(+now - seg.afterDays * DAY) } };
    const users = await User.find(customers({ ...range, 'offer.status': { $ne: 'DECLINED' } })).limit(2000);
    for (const u of users) {
      const offer = activeOffer(u);
      if (!offer || !(offer.amount > 0)) continue;
      if (await Loan.exists({ userId: u._id, createdAt: { $gte: offer.computedAt } })) continue;
      out.push({ user: u, vars: { amount: inr(offer.amount), days: Math.max(1, Math.ceil((new Date(offer.expiresAt) - now) / DAY)) } });
    }
  } else if (key === 'approved_not_accepted') {
    const loans = await Loan.find({ status: 'approved', approvalDate: { $lte: new Date(+now - seg.afterDays * DAY), $gte: new Date(+now - 30 * DAY) } }).limit(2000);
    const accepted = new Set((await AgreementAcceptance.distinct('loanId', { loanId: { $in: loans.map(l => l._id) } })).map(String));
    const seen = new Set();
    for (const l of loans) {
      if (accepted.has(String(l._id)) || seen.has(String(l.userId))) continue;
      const u = await User.findOne(customers({ _id: l.userId }));
      if (u) { seen.add(String(l.userId)); out.push({ user: u, vars: { amount: inr(l.loanAmount) } }); }
    }
  } else if (key === 'winback') {
    const closed = await Loan.find({ status: 'closed', closureType: 'repaid', closedAt: { $lte: new Date(+now - seg.afterDays * DAY), $gte: new Date(+now - 365 * DAY) } }).sort({ closedAt: -1 }).limit(2000);
    const seen = new Set();
    for (const l of closed) {
      if (seen.has(String(l.userId))) continue;
      seen.add(String(l.userId));
      if (await Loan.exists({ userId: l.userId, $or: [{ status: { $in: openStatuses } }, { createdAt: { $gt: l.closedAt } }] })) continue;
      const u = await User.findOne(customers({ _id: l.userId }));
      if (u) out.push({ user: u, vars: {} });
    }
  } else if (key === 'inactive') {
    const seen = await DeviceToken.aggregate([{ $group: { _id: '$userId', last: { $max: '$lastSeenAt' } } }, { $match: { last: { $lte: new Date(+now - seg.afterDays * DAY), $gte: new Date(+now - 180 * DAY) } } }, { $limit: 2000 }]);
    const users = await User.find(customers({ _id: { $in: seen.map(x => x._id) } }));
    for (const u of users) out.push({ user: u, vars: {} });
  }
  const blocked = await blockedIds(out.map(x => x.user._id));
  return out.filter(x => !blocked.has(String(x.user._id)) && x.user.pushPrefs?.offers !== false);
}

// Sends what is due. Run every half hour or so.
export async function runNudges(now = new Date()) {
  const s = getSettings();
  const result = { sent: 0, bySegment: {}, quiet: false };
  if (!s.enabled) return { ...result, off: true };
  if (inQuietHours(now, s)) return { ...result, quiet: true };

  for (const key of ORDER) {
    const seg = s.segments[key];
    if (!seg.enabled) continue;
    result.bySegment[key] = 0;
    for (const { user, vars } of await audience(key, s, now)) {
      const logs = await NudgeLog.find({ userId: user._id, sentAt: { $gte: new Date(+now - 90 * DAY) } }).sort({ sentAt: -1 }).lean();
      const mine = logs.filter(l => l.segment === key);
      if (mine.length >= seg.maxSends) continue;
      if (mine[0] && now - new Date(mine[0].sentAt) < seg.repeatEveryDays * DAY) continue;
      if (logs[0] && now - new Date(logs[0].sentAt) < s.minGapDays * DAY) continue;
      if (logs.filter(l => now - new Date(l.sentAt) < 7 * DAY).length >= s.weeklyCap) continue;
      try { await NudgeLog.create({ userId: user._id, segment: key, sentAt: now }); } catch (e) { continue; }
      const message = render(seg.message, { name: user.firstName, ...vars });
      await notify(user._id, { type: 'NUDGE', title: seg.title, message, data: { segment: key } }, { email: false, sms: seg.sms });
      result.sent++;
      result.bySegment[key]++;
    }
  }
  return result;
}

// How big each group is today, how many were nudged lately, and how many of those applied for a loan within a week
export async function overview(now = new Date()) {
  const s = getSettings();
  const since = new Date(+now - 30 * DAY);
  const rows = [];
  for (const key of Object.keys(SEGMENTS)) {
    const logs = await NudgeLog.find({ segment: key, sentAt: { $gte: since } }).lean();
    let applied = 0;
    for (const l of logs) if (await Loan.exists({ userId: l.userId, createdAt: { $gt: l.sentAt, $lte: new Date(+new Date(l.sentAt) + 7 * DAY) } })) applied++;
    rows.push({ key, label: SEGMENTS[key].label, hint: SEGMENTS[key].hint, enabled: s.segments[key].enabled, audience: (await audience(key, s, now)).length, sent30: logs.length, customers30: new Set(logs.map(l => String(l.userId))).size, applied7: applied });
  }
  return { settings: s, segments: rows, total30: rows.reduce((a, r) => a + r.sent30, 0) };
}

export default { getSettings, saveSettings, validateSettings, runNudges, overview, audience, SEGMENTS };
