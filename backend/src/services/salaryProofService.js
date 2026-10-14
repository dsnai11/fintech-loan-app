import crypto from 'crypto';
import mongoose from 'mongoose';
import SalarySlip from '../models/SalarySlip.js';
import SalarySlipFile from '../models/SalarySlipFile.js';
import User from '../models/User.js';
import { audit } from './auditService.js';
import { notify } from './notificationService.js';

// Proof of salary by a salary slip: the customer photographs the latest slip and says the net monthly salary; staff look at it and
// either confirm an income (which then counts as proof of income for 90 days) or send it back with a reason. A slip is easy to fake, so
// this is a lighter proof than bank statements. The company decides how much it trusts it (the payday advance has its own limit for
// slip-verified customers). When bank statements are available they take priority over a slip.

const DAY = 864e5;
export const VALID_DAYS = 90;
const KEEP_AFTER_DECISION_DAYS = 30;
const MAX_IMAGES = 3;
const MAX_BYTES = 1.1 * 1024 * 1024;
const fail = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) });

function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

// What counts as proof right now: an approved slip that has not run out
export function proofOf(user, now = new Date()) {
  const p = user?.salaryProof;
  if (!p || !(p.income > 0) || !p.until || new Date(p.until) <= now) return null;
  return { income: p.income, employer: p.employer || '', approvedAt: p.approvedAt, until: p.until };
}

export async function statusFor(user) {
  const latest = await SalarySlip.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean();
  const proof = proofOf(user);
  return {
    verified: !!proof,
    income: proof?.income || null,
    validUntil: proof?.until || null,
    latest: latest ? { id: String(latest._id), status: latest.status, claimedIncome: latest.claimedIncome, at: latest.createdAt, reason: latest.status === 'rejected' ? latest.reason : null } : null,
    canUpload: !latest || latest.status !== 'pending',
  };
}

export async function submit(user, body, req) {
  const imgs = Array.isArray(body?.images) ? body.images : [];
  if (imgs.length < 1 || imgs.length > MAX_IMAGES) return fail(400, `Add 1 to ${MAX_IMAGES} photos of your latest salary slip.`);
  const income = Number(body?.monthlyIncome);
  if (!Number.isInteger(income) || income < 3000 || income > 10000000) return fail(400, 'Enter your net monthly salary, the amount that reaches your bank, between Rs 3,000 and Rs 1,00,00,000.');
  const employer = String(body?.employer ?? '').trim().slice(0, 80);
  let slipMonth = String(body?.slipMonth ?? '').trim();
  if (slipMonth) {
    const m = slipMonth.match(/^(\d{4})-(\d{2})$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return fail(400, 'Write the month of the slip like 2026-09.');
    const age = (new Date().getUTCFullYear() - Number(m[1])) * 12 + (new Date().getUTCMonth() + 1 - Number(m[2]));
    if (age < 0) return fail(400, 'That month has not come yet.');
    if (age > 3) return fail(400, 'Upload a slip from the last 3 months.');
  } else slipMonth = '';

  const pending = await SalarySlip.findOne({ userId: user._id, status: 'pending' });
  if (pending) return fail(409, 'Your last salary slip is still being checked. We will tell you the moment it is done.', 'PENDING');
  const today = await SalarySlip.countDocuments({ userId: user._id, createdAt: { $gte: new Date(Date.now() - DAY) } });
  if (today >= 3) return fail(429, 'You have sent a few slips today. Please try again tomorrow.');

  const files = [];
  for (const [i, raw] of imgs.entries()) {
    const b64 = String(raw?.data ?? raw ?? '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return fail(400, `Photo ${i + 1} could not be read.`);
    if (buf.length > MAX_BYTES) return fail(400, `Photo ${i + 1} is too large. Take it again at a lower quality.`);
    const mime = imageType(buf);
    if (!mime) return fail(400, `Photo ${i + 1} must be a JPEG, PNG or WebP picture.`);
    files.push({ buf, mime, sha: crypto.createHash('sha256').update(buf).digest('hex') });
  }
  if (new Set(files.map(f => f.sha)).size !== files.length) return fail(400, 'The same photo was added twice.');

  const hashes = files.map(f => f.sha);
  const dupSlips = await SalarySlipFile.find({ sha256: { $in: hashes } }).select('slipId').lean();
  const dupOwners = dupSlips.length ? await SalarySlip.find({ _id: { $in: dupSlips.map(d => d.slipId) }, userId: { $ne: user._id } }).select('_id').lean() : [];

  const slip = await SalarySlip.create({ userId: user._id, claimedIncome: income, employer, slipMonth, images: files.length, hashes, duplicateOf: dupOwners.map(d => d._id) });
  await SalarySlipFile.insertMany(files.map((f, i) => ({ slipId: slip._id, index: i, mime: f.mime, data: f.buf, sha256: f.sha, size: f.buf.length, deleteAt: new Date(Date.now() + 45 * DAY) })));
  await audit({ email: user.email, role: 'customer' }, 'SALARY_SLIP_SENT', { type: 'SalarySlip', id: slip._id }, { claimed: income, images: files.length, duplicate: dupOwners.length > 0 }, req);
  return { ok: true, status: 201, id: String(slip._id) };
}

export async function queue({ status = 'pending', limit = 100 } = {}) {
  const f = ['pending', 'approved', 'rejected'].includes(status) ? { status } : {};
  const slips = await SalarySlip.find(f).sort({ createdAt: status === 'pending' ? 1 : -1 }).limit(limit).populate('userId', 'firstName lastName phone employment incomeCheck').lean();
  return slips.map(s => ({
    id: String(s._id), status: s.status, at: s.createdAt, images: s.images, slipMonth: s.slipMonth,
    customer: s.userId ? `${s.userId.firstName} ${s.userId.lastName}` : 'Unknown', customerId: s.userId ? String(s.userId._id) : null, phone: s.userId?.phone || '',
    claimedIncome: s.claimedIncome, employer: s.employer, declaredIncome: s.userId?.employment?.monthlyIncome || 0, declaredEmployer: s.userId?.employment?.company || '',
    statementIncome: s.userId?.incomeCheck?.estimatedMonthlyIncome || null,
    duplicate: (s.duplicateOf || []).length > 0, verifiedIncome: s.verifiedIncome, reason: s.reason, reviewedBy: s.reviewedBy, reviewedAt: s.reviewedAt, validUntil: s.validUntil,
  }));
}

export async function image(slipId, index, by, req) {
  if (!mongoose.isValidObjectId(slipId)) return null;
  const f = await SalarySlipFile.findOne({ slipId, index: Number(index) || 0 }).select('+data mime');
  if (!f) return null;
  await audit(by, 'SALARY_SLIP_VIEWED', { type: 'SalarySlip', id: slipId }, { photo: Number(index) || 0 }, req);
  return f;
}

export async function review(slipId, by, { decision, verifiedIncome, verifiedEmployer, reason }, req) {
  if (!mongoose.isValidObjectId(slipId)) return fail(404, 'Slip not found');
  const slip = await SalarySlip.findById(slipId);
  if (!slip) return fail(404, 'Slip not found');
  if (slip.status !== 'pending') return fail(409, 'This slip has already been decided.');
  const user = await User.findById(slip.userId);
  if (!user) return fail(404, 'Customer not found');
  const keepUntil = new Date(Date.now() + KEEP_AFTER_DECISION_DAYS * DAY);

  if (decision === 'approve') {
    const income = Number(verifiedIncome);
    if (!Number.isInteger(income) || income < 3000 || income > 10000000) return fail(400, 'Enter the net monthly salary you confirmed from the slip.');
    if (income > slip.claimedIncome * 1.1) return fail(400, `The customer claimed Rs ${slip.claimedIncome.toLocaleString('en-IN')}. Do not confirm more than they claimed; ask them to upload again.`);
    const until = new Date(Date.now() + VALID_DAYS * DAY);
    slip.set({ status: 'approved', verifiedIncome: income, verifiedEmployer: String(verifiedEmployer ?? slip.employer ?? '').slice(0, 80), reviewedBy: by.email, reviewedAt: new Date(), validUntil: until });
    await slip.save();
    await User.updateOne({ _id: user._id }, { salaryProof: { income, employer: slip.verifiedEmployer, approvedAt: new Date(), until, slipId: slip._id } });
    await notify(user._id, { type: 'KYC_UPDATE', title: 'Salary confirmed', message: `We confirmed your salary of Rs ${income.toLocaleString('en-IN')} a month. It counts for the next ${VALID_DAYS} days.` }, { sms: true });
  } else if (decision === 'reject') {
    const why = String(reason ?? '').trim().slice(0, 200);
    if (why.length < 3) return fail(400, 'Write the reason the customer will see, for example "The photo is blurred".');
    slip.set({ status: 'rejected', reason: why, reviewedBy: by.email, reviewedAt: new Date() });
    await slip.save();
    await notify(user._id, { type: 'KYC_UPDATE', title: 'We could not confirm your salary slip', message: `${why} You can upload it again.` }, { sms: true });
  } else return fail(400, 'Choose approve or reject.');

  await SalarySlipFile.updateMany({ slipId: slip._id }, { deleteAt: keepUntil });
  await audit(by, decision === 'approve' ? 'SALARY_SLIP_APPROVED' : 'SALARY_SLIP_REJECTED', { type: 'SalarySlip', id: slip._id }, { userId: String(user._id), claimed: slip.claimedIncome, verified: slip.verifiedIncome, reason: slip.reason }, req);
  return { ok: true, status: 200 };
}

export default { proofOf, statusFor, submit, queue, image, review, VALID_DAYS };
