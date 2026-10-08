import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import EsignSession from '../models/EsignSession.js';
import AgreementAcceptance from '../models/AgreementAcceptance.js';
import { authMiddleware } from '../middleware/auth.js';
import { startEsign, completeEsign, finishWithProvider, sandboxAllowed } from '../services/signingService.js';
import { agreementPdf } from '../services/agreementPdf.js';

// Aadhaar eSign for the loan agreement, and the agreement as a PDF. The pages the customer sees in the browser (the
// callback, and in test mode a stand-in signing page) are public because the browser has no app login, but each is tied
// to a long random session id that belongs to one customer and expires.
const router = express.Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px 18px;color:#111827;line-height:1.5}h1{font-size:21px}label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px;color:#4b5563}
input{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;box-sizing:border-box}button{padding:12px 18px;border:0;border-radius:10px;font:600 15px system-ui;cursor:pointer}
.go{background:#15803d;color:#fff;width:100%;margin-top:18px}.no{background:#e5e7eb;width:100%;margin-top:8px}.test{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:10px;font-size:13px}</style></head><body>${body}</body></html>`;

const ownedLoan = async (req, res) => {
  const id = req.params.loanId || req.body?.loanId;
  const loan = mongoose.isValidObjectId(id) ? await Loan.findById(id) : null;
  if (!loan || String(loan.userId) !== String(req.user.userId)) { res.status(404).json({ error: 'Loan not found' }); return null; }
  return loan;
};

router.post('/start/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await ownedLoan(req, res);
    if (!loan) return;
    const user = await User.findById(req.user.userId);
    const r = await startEsign(loan, user, req.body?.hash);
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
    res.json({ sessionId: String(r.session._id), url: r.url, mode: r.mode, expiresInSeconds: r.expiresInSeconds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status/:id', authMiddleware, async (req, res) => {
  try {
    const s = mongoose.isValidObjectId(req.params.id) ? await EsignSession.findOne({ _id: req.params.id, userId: req.user.userId }) : null;
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (s.status === 'created' && s.expiresAt < new Date()) { s.status = 'expired'; await s.save(); }
    res.json({ status: s.status, mode: s.mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const id = String(req.query.session || '');
    const s = mongoose.isValidObjectId(id) ? await EsignSession.findById(id) : null;
    if (!s) return res.status(404).send(page('Not found', '<h1>This link is not valid</h1><p>Please go back to the app and start again.</p>'));
    if (s.status === 'created' && s.expiresAt < new Date()) { s.status = 'expired'; await s.save(); }
    if (s.status === 'created' && s.mode === 'esign') await finishWithProvider(s, req);
    const fresh = await EsignSession.findById(id);
    const ok = fresh.status === 'completed';
    res.send(page(ok ? 'Signed' : 'Not finished', ok
      ? '<h1>Signed</h1><p>Your agreement has been signed. You can close this page and go back to the app.</p>'
      : '<h1>We could not finish</h1><p>Please go back to the app and try again.</p>'));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1><p>Please go back to the app and try again.</p>'));
  }
});

// ── Test mode: a stand-in for the Aadhaar eSign page ───────────────────────────────────────────
async function sandboxSession(req, res) {
  if (!sandboxAllowed()) { res.status(404).send(page('Not found', '<h1>Not found</h1>')); return null; }
  const s = mongoose.isValidObjectId(req.params.id) ? await EsignSession.findById(req.params.id) : null;
  if (!s || s.mode !== 'sandbox' || s.status !== 'created' || s.expiresAt < new Date()) { res.status(404).send(page('Expired', '<h1>This test page has expired</h1><p>Please go back to the app and start again.</p>')); return null; }
  return s;
}

router.get('/sandbox/:id', async (req, res) => {
  try {
    const s = await sandboxSession(req, res);
    if (!s) return;
    const u = await User.findById(s.userId);
    res.send(page('Aadhaar eSign (test)', `<div class="test">TEST MODE. This is not a real Aadhaar eSign. No Aadhaar is used and the result is marked as a test signature.</div>
<h1>Sign the loan agreement</h1><p>${esc(u?.firstName)} ${esc(u?.lastName)}, you are about to sign your loan agreement.</p>
<form method="post" action="/api/esign/sandbox/${esc(s._id)}"><label for="otp">Code sent to your Aadhaar-linked mobile (any 6 digits in test mode)</label><input id="otp" name="otp" inputmode="numeric" pattern="\\d{6}" value="123456">
<button class="go" name="action" value="sign">Sign</button><button class="no" name="action" value="deny">Cancel</button></form>`));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

router.post('/sandbox/:id', async (req, res) => {
  try {
    const s = await sandboxSession(req, res);
    if (!s) return;
    if (req.body?.action !== 'sign' || !/^\d{6}$/.test(String(req.body?.otp || ''))) {
      s.status = 'failed';
      s.result = { error: 'The customer did not sign' };
      await s.save();
      return res.redirect(`/api/esign/callback?session=${s._id}`);
    }
    const u = await User.findById(s.userId);
    await completeEsign(s, { signerName: `${u.firstName} ${u.lastName}`, certificateId: `TEST-${String(s._id).slice(-8)}` }, req);
    res.redirect(`/api/esign/callback?session=${s._id}`);
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

// ── The agreement as a PDF ───────────────────────────────────────────────────────────────────
// The app cannot attach a login header to a browser tab, so it asks for a link that works for 5 minutes and for this one loan.
router.post('/pdf-link/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await ownedLoan(req, res);
    if (!loan) return;
    if (['submitted', 'under_review', 'rejected'].includes(loan.status)) return res.status(400).json({ error: 'The agreement is available once your loan is approved' });
    const t = jwt.sign({ purpose: 'agreement-pdf', loanId: String(loan._id), userId: String(loan.userId) }, process.env.JWT_SECRET, { expiresIn: '5m' });
    res.json({ path: `/api/esign/pdf?t=${t}`, expiresInSeconds: 300 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/pdf', async (req, res) => {
  try {
    const d = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
    if (d.purpose !== 'agreement-pdf') throw new Error('wrong purpose');
    const loan = await Loan.findById(d.loanId).catch(() => null);
    if (!loan || String(loan.userId) !== d.userId) return res.status(404).send('Not found');
    const user = await User.findById(loan.userId);
    const acceptance = await AgreementAcceptance.findOne({ loanId: loan._id });
    const pdf = await agreementPdf(loan, user, acceptance);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="loan-agreement-${String(loan._id).slice(-6)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (e) {
    res.status(401).send('This link has expired. Please go back to the app and open it again.');
  }
});

export default router;
