import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Partner from '../models/Partner.js';
import PartnerLead from '../models/PartnerLead.js';
import PartnerCommission from '../models/PartnerCommission.js';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import { getSettings as accountingSettings } from './accountingService.js';
import { lockedSeconds, recordFailure, recordSuccess, lockMessage } from './loginGuard.js';
import { audit } from './auditService.js';
import { setupStatus } from './onboardingService.js';

// Partners and agents: people or small businesses who bring customers and earn a share of each loan paid out to them.
//   - A partner has a code (AGT + 6 characters). A customer who types it at sign-up is linked to that partner for good.
//   - When a linked customer's first loan is paid out, the partner earns a commission (a percentage of the loan amount).
//     It is cancelled if the customer cancels in the cooling-off period.
//   - Partners sign in to their own page to see their customers' progress (names shortened, no contact details) and their
//     commissions. Finance pays commissions by hand, with any tax deducted, and records the reference.
// The commission percentage and any tax are the company's decisions and are for the compliance and finance teams to confirm.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeCode = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
export const isPartnerCode = c => /^AGT/.test(normalizeCode(c));
const makeCode = () => 'AGT' + Array.from(crypto.randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join('');
const tempPassword = () => Array.from(crypto.randomBytes(12), b => ALPHABET[b % ALPHABET.length]).join('');
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const mask = s => { const t = String(s || ''); return t.length > 4 ? t.slice(0, 2) + 'X'.repeat(t.length - 4) + t.slice(-2) : t; };

export const tokenFor = partner => jwt.sign({ purpose: 'partner', partnerId: String(partner._id), pwd: partner.passwordChangedAt ? +partner.passwordChangedAt : 0 }, process.env.JWT_SECRET, { expiresIn: '12h' });

// Middleware for the partner's own pages
export async function partnerAuth(req, res, next) {
  try {
    const h = String(req.headers.authorization || '');
    const d = jwt.verify(h.replace(/^Bearer\s+/i, ''), process.env.JWT_SECRET);
    if (d.purpose !== 'partner') throw new Error('not a partner token');
    const p = await Partner.findById(d.partnerId);
    if (!p || p.status !== 'active') return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    if ((p.passwordChangedAt ? +p.passwordChangedAt : 0) !== d.pwd) return res.status(401).json({ error: 'Your password was changed. Please sign in again.' });
    req.partner = p;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Please sign in.' });
  }
}

export async function createPartner(input, by) {
  const errors = [];
  const name = String(input?.name || '').trim();
  const email = String(input?.email || '').trim().toLowerCase();
  const percent = Number(input?.commissionPercent);
  if (!name || name.length > 80) errors.push('Enter the partner\'s name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('Enter a valid email address');
  if (!Number.isFinite(percent) || percent < 0 || percent > 10) errors.push('The commission must be between 0 and 10 percent');
  if (input?.phone && !/^[6-9]\d{9}$/.test(String(input.phone))) errors.push('Enter a valid 10-digit mobile number');
  if (errors.length) return { ok: false, status: 400, errors };
  if (await Partner.exists({ email })) return { ok: false, status: 409, errors: ['A partner with that email already exists'] };
  let code;
  for (let i = 0; i < 6; i++) { code = makeCode(); if (!(await Partner.exists({ code }))) break; }
  const password = tempPassword();
  const p = new Partner({ name, email, phone: String(input?.phone || ''), code, commissionPercent: percent, panNumber: String(input?.panNumber || '').toUpperCase().slice(0, 10), createdBy: by });
  await p.setPassword(password);
  await p.save();
  await audit({ email: by, role: 'staff' }, 'PARTNER_CREATED', { type: 'Partner', id: p._id }, { name, commissionPercent: percent, code }, null);
  return { ok: true, partner: p, password };
}

export async function resetPassword(partner, by) {
  const password = tempPassword();
  await partner.setPassword(password);
  partner.mustChangePassword = true;
  await partner.save();
  await audit({ email: by, role: 'staff' }, 'PARTNER_PASSWORD_RESET', { type: 'Partner', id: partner._id }, {}, null);
  return password;
}

export async function login(emailRaw, password) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const key = `partner:${email}`;
  const locked = await lockedSeconds(key);
  if (locked) return { ok: false, status: 429, error: lockMessage(locked) };
  const p = await Partner.findOne({ email }).select('+passwordHash');
  const ok = p && p.status === 'active' && (await p.checkPassword(password));
  if (!ok) {
    await recordFailure(key);
    return { ok: false, status: 400, error: 'Invalid email or password' };
  }
  await recordSuccess(key);
  p.lastLoginAt = new Date();
  await p.save();
  return { ok: true, partner: p, token: tokenFor(p) };
}

// ── Customers ──────────────────────────────────────────────────────────────────────────────────
export async function findByCode(raw) {
  const code = normalizeCode(raw);
  if (!/^AGT[A-Z2-9]{6}$/.test(code)) return null;
  const p = await Partner.findOne({ code, status: 'active' });
  return p || null;
}

export async function attachLead(partner, user) {
  try { await PartnerLead.create({ partnerId: partner._id, userId: user._id, code: partner.code }); } catch (e) { return false; }
  await User.updateOne({ _id: user._id }, { acquisition: { source: 'partner', campaign: partner.code, medium: '' } });
  await audit({ email: user.email, role: 'customer' }, 'PARTNER_LEAD', { type: 'User', id: user._id }, { partnerId: String(partner._id), code: partner.code }, null);
  return true;
}

const STAGES = ['signed_up', 'setup_done', 'applied', 'approved', 'disbursed'];
const STAGE_TEXT = { signed_up: 'Signed up', setup_done: 'Finished set-up', applied: 'Applied for a loan', approved: 'Loan approved', disbursed: 'Loan paid out', closed: 'Loan repaid', rejected: 'Application not approved' };

export async function leadsOf(partner) {
  const leads = await PartnerLead.find({ partnerId: partner._id }).sort({ createdAt: -1 }).limit(500).lean();
  const users = await User.find({ _id: { $in: leads.map(l => l.userId) } }).select('firstName lastName phone dateOfBirth gender address employment bankAccount selfie kycDigilocker createdAt').lean();
  const byU = Object.fromEntries(users.map(u => [String(u._id), u]));
  const loans = await Loan.find({ userId: { $in: leads.map(l => l.userId) } }).select('userId status loanAmount').lean();
  return leads.map(l => {
    const u = byU[String(l.userId)];
    if (!u) return null;
    const ls = loans.filter(x => String(x.userId) === String(l.userId));
    let stage = 'signed_up';
    if (setupStatus(u).complete) stage = 'setup_done';
    if (ls.length) stage = 'applied';
    if (ls.some(x => ['approved'].includes(x.status))) stage = 'approved';
    if (ls.some(x => ['disbursed', 'closed', 'defaulted', 'written_off'].includes(x.status))) stage = ls.every(x => x.status === 'closed') ? 'closed' : 'disbursed';
    if (stage === 'applied' && ls.every(x => x.status === 'rejected')) stage = 'rejected';
    return { name: `${u.firstName} ${(u.lastName || '').slice(0, 1)}.`, phone: mask(u.phone), joined: l.createdAt, stage, stageText: STAGE_TEXT[stage], amount: ls.filter(x => ['disbursed', 'closed', 'defaulted', 'written_off'].includes(x.status)).reduce((a, x) => a + x.loanAmount, 0) };
  }).filter(Boolean);
}

export async function summaryOf(partner) {
  const [leads, comm] = await Promise.all([leadsOf(partner), PartnerCommission.find({ partnerId: partner._id }).sort({ createdAt: -1 }).limit(500).lean()]);
  const sum = s => r2(comm.filter(c => c.status === s).reduce((a, c) => a + c.gross, 0));
  return {
    profile: { name: partner.name, email: partner.email, code: partner.code, commissionPercent: partner.commissionPercent, mustChangePassword: partner.mustChangePassword },
    counts: { customers: leads.length, setupDone: leads.filter(l => STAGES.indexOf(l.stage) >= 1 || l.stage === 'closed').length, applied: leads.filter(l => !['signed_up', 'setup_done'].includes(l.stage)).length, disbursed: leads.filter(l => ['disbursed', 'closed'].includes(l.stage)).length },
    money: { due: sum('due'), paid: r2(comm.filter(c => c.status === 'paid').reduce((a, c) => a + c.net, 0)), tdsDeducted: r2(comm.filter(c => c.status === 'paid').reduce((a, c) => a + c.tds, 0)) },
    commissions: comm.map(c => ({ id: String(c._id), loanAmount: c.loanAmount, percent: c.percent, gross: c.gross, tds: c.tds, net: c.net, status: c.status, voidReason: c.voidReason || null, at: c.createdAt, paidAt: c.paidAt || null, reference: c.reference || null })),
    leads,
  };
}

// ── Commission ─────────────────────────────────────────────────────────────────────────────────
// Called when a loan is paid out. The partner earns on the customer's first paid-out loan only.
export async function onLoanDisbursed(loan) {
  const lead = await PartnerLead.findOne({ userId: loan.userId });
  if (!lead) return null;
  const partner = await Partner.findById(lead.partnerId);
  if (!partner || partner.status !== 'active') return null;
  const earlier = await PartnerCommission.exists({ partnerId: partner._id, userId: loan.userId });
  if (earlier) return null;
  const gross = Math.round(loan.loanAmount * partner.commissionPercent) / 100;
  try {
    return await PartnerCommission.create({ partnerId: partner._id, loanId: loan._id, userId: loan.userId, loanAmount: loan.loanAmount, percent: partner.commissionPercent, gross: r2(gross), net: r2(gross) });
  } catch (e) { return null; }
}

// The customer cancelled in the cooling-off period: the commission is cancelled too
export async function onLoanCancelled(loanId, reason = 'The customer cancelled the loan in the cooling-off period') {
  return PartnerCommission.findOneAndUpdate({ loanId, status: 'due' }, { status: 'void', voidReason: reason }, { new: true });
}

export async function markPaid(id, reference, by) {
  const ref = String(reference || '').trim();
  if (!ref || ref.length > 80) return { ok: false, status: 400, error: 'Enter the bank or UPI reference of the payment.' };
  const c = await PartnerCommission.findOne({ _id: id, status: 'due' });
  if (!c) return { ok: false, status: 409, error: 'That commission is not waiting to be paid.' };
  const rate = accountingSettings().tds.partner || 0;
  c.tdsPercent = rate;
  c.tds = r2((c.gross * rate) / 100);
  c.net = r2(c.gross - c.tds);
  c.status = 'paid'; c.paidAt = new Date(); c.paidBy = by; c.reference = ref;
  await c.save();
  await audit({ email: by, role: 'staff' }, 'PARTNER_COMMISSION_PAID', { type: 'Partner', id: c.partnerId }, { gross: c.gross, tds: c.tds, net: c.net, reference: ref }, null);
  return { ok: true, commission: c };
}

export async function voidCommission(id, reason, by) {
  const why = String(reason || '').trim();
  if (!why) return { ok: false, status: 400, error: 'Write the reason.' };
  const c = await PartnerCommission.findOneAndUpdate({ _id: id, status: 'due' }, { status: 'void', voidReason: why.slice(0, 200) }, { new: true });
  if (!c) return { ok: false, status: 409, error: 'That commission is not waiting to be paid.' };
  await audit({ email: by, role: 'staff' }, 'PARTNER_COMMISSION_VOIDED', { type: 'Partner', id: c.partnerId }, { gross: c.gross, reason: why }, null);
  return { ok: true, commission: c };
}

// For the accounts team: what was paid to partners in a period
export async function partnerPayouts(start, end) {
  const rows = await PartnerCommission.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).lean();
  const partners = Object.fromEntries((await Partner.find({ _id: { $in: rows.map(r => r.partnerId) } }).lean()).map(p => [String(p._id), p]));
  return rows.map(r => ({ partnerId: r.partnerId, name: partners[String(r.partnerId)]?.name || '', pan: partners[String(r.partnerId)]?.panNumber || '', gross: r.gross, tdsPercent: r.tdsPercent, tds: r.tds, net: r.net, paidAt: r.paidAt, reference: r.reference }));
}

export async function overview() {
  const partners = await Partner.find({}).sort({ createdAt: -1 }).lean();
  const leads = await PartnerLead.aggregate([{ $group: { _id: '$partnerId', n: { $sum: 1 } } }]);
  const comm = await PartnerCommission.aggregate([{ $group: { _id: { p: '$partnerId', s: '$status' }, n: { $sum: 1 }, gross: { $sum: '$gross' } } }]);
  const ln = Object.fromEntries(leads.map(l => [String(l._id), l.n]));
  const cm = {};
  for (const c of comm) { const k = String(c._id.p); cm[k] = cm[k] || {}; cm[k][c._id.s] = { n: c.n, gross: r2(c.gross) }; }
  return partners.map(p => ({ id: String(p._id), name: p.name, email: p.email, phone: p.phone, code: p.code, commissionPercent: p.commissionPercent, status: p.status, panNumber: p.panNumber, customers: ln[String(p._id)] || 0, due: cm[String(p._id)]?.due || { n: 0, gross: 0 }, paid: cm[String(p._id)]?.paid || { n: 0, gross: 0 }, lastLoginAt: p.lastLoginAt || null, at: p.createdAt }));
}

export default { createPartner, resetPassword, login, partnerAuth, findByCode, attachLead, leadsOf, summaryOf, onLoanDisbursed, onLoanCancelled, markPaid, voidCommission, partnerPayouts, overview, isPartnerCode, normalizeCode };
