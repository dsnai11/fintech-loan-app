import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import DigilockerSession from '../models/DigilockerSession.js';
import { authMiddleware } from '../middleware/auth.js';
import { startSession, completeSession, finishWithProvider, sandboxAllowed } from '../services/digilockerService.js';

// KYC through DigiLocker. The app starts a session and opens the link; the customer signs in at DigiLocker and
// comes back; the app polls the status. The pages the customer sees in the browser (the callback, and in test
// mode a stand-in DigiLocker) are public, because the browser has no app login, but each is tied to a long
// random session id that belongs to one customer and expires.
const router = express.Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px 18px;color:#111827;line-height:1.5}h1{font-size:21px}label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px;color:#4b5563}
input,select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;box-sizing:border-box}button{padding:12px 18px;border:0;border-radius:10px;font:600 15px system-ui;cursor:pointer}
.go{background:#1d4ed8;color:#fff;width:100%;margin-top:18px}.no{background:#e5e7eb;width:100%;margin-top:8px}.test{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:10px;font-size:13px}</style></head><body>${body}</body></html>`;

const ownSession = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: 'Invalid session' }); return null; }
  const s = await DigilockerSession.findOne({ _id: req.params.id, userId: req.user.userId });
  if (!s) { res.status(404).json({ error: 'Session not found' }); return null; }
  return s;
};

router.post('/start', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await startSession(user);
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
    res.json({ sessionId: String(r.session._id), url: r.url, mode: r.mode, expiresInSeconds: r.expiresInSeconds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status/:id', authMiddleware, async (req, res) => {
  try {
    const s = await ownSession(req, res);
    if (!s) return;
    if (s.status === 'created' && s.expiresAt < new Date()) { s.status = 'expired'; await s.save(); }
    res.json({ status: s.status, mode: s.mode, result: s.status === 'completed' ? s.result : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Where DigiLocker sends the customer back to. With a real provider this is when we fetch their documents.
router.get('/callback', async (req, res) => {
  try {
    const id = String(req.query.session || '');
    const s = mongoose.isValidObjectId(id) ? await DigilockerSession.findById(id) : null;
    if (!s) return res.status(404).send(page('Not found', '<h1>This link is not valid</h1><p>Please go back to the app and start again.</p>'));
    if (s.status === 'created' && s.expiresAt < new Date()) { s.status = 'expired'; await s.save(); }
    if (s.status === 'created' && s.mode === 'digilocker') await finishWithProvider(s, req);
    const fresh = await DigilockerSession.findById(id);
    const ok = fresh.status === 'completed';
    res.send(page(ok ? 'Done' : 'Not finished', ok
      ? '<h1>Done</h1><p>Your details have been shared. You can close this page and go back to the app.</p>'
      : '<h1>We could not finish</h1><p>Please go back to the app and try again.</p>'));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1><p>Please go back to the app and try again.</p>'));
  }
});

// ── Test mode: a stand-in for the DigiLocker sign-in and consent page ──────────────────────────────
async function sandboxSession(req, res) {
  if (!sandboxAllowed()) { res.status(404).send(page('Not found', '<h1>Not found</h1>')); return null; }
  const id = req.params.id;
  const s = mongoose.isValidObjectId(id) ? await DigilockerSession.findById(id) : null;
  if (!s || s.mode !== 'sandbox' || s.status !== 'created' || s.expiresAt < new Date()) { res.status(404).send(page('Expired', '<h1>This test page has expired</h1><p>Please go back to the app and start again.</p>')); return null; }
  return s;
}

router.get('/sandbox/:id', async (req, res) => {
  try {
    const s = await sandboxSession(req, res);
    if (!s) return;
    const u = await User.findById(s.userId);
    const a = u.address || {};
    const dob = u.dateOfBirth ? new Date(u.dateOfBirth).toISOString().slice(0, 10) : '1992-04-12';
    res.send(page('DigiLocker (test)', `<div class="test">TEST MODE. This is not the real DigiLocker. No Aadhaar is looked up. It stands in for DigiLocker so the sign-up flow can be tried, using the details below.</div>
<h1>Share your documents with ${esc(u.firstName)}'s lender?</h1>
<form method="post" action="/api/kyc/digilocker/sandbox/${esc(s._id)}">
<label for="name">Name on Aadhaar</label><input id="name" name="name" value="${esc(`${u.firstName} ${u.lastName}`)}" required>
<label for="dob">Date of birth</label><input id="dob" name="dob" type="date" value="${esc(dob)}" required>
<label for="gender">Gender</label><select id="gender" name="gender">${['Male', 'Female', 'Other'].map(g => `<option ${g === (u.gender || 'Male') ? 'selected' : ''}>${g}</option>`).join('')}</select>
<label for="last4">Aadhaar, last 4 digits</label><input id="last4" name="last4" value="${esc(String(u.phone || '').slice(-4).padStart(4, '1'))}" pattern="\\d{4}" required>
<label for="pan">PAN (optional)</label><input id="pan" name="pan" value="${esc(u.panNumber || '')}">
<label for="street">Address</label><input id="street" name="street" value="${esc(a.street || '12 Test Street')}">
<label for="city">City</label><input id="city" name="city" value="${esc(a.city || 'Jaipur')}">
<label for="state">State</label><input id="state" name="state" value="${esc(a.state || 'Rajasthan')}">
<label for="zip">PIN code</label><input id="zip" name="zip" value="${esc(a.zipCode || '302001')}">
<button class="go" name="action" value="allow">Allow</button><button class="no" name="action" value="deny">Deny</button></form>`));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

router.post('/sandbox/:id', async (req, res) => {
  try {
    const s = await sandboxSession(req, res);
    if (!s) return;
    if (req.body.action !== 'allow') {
      s.status = 'failed';
      s.result = { error: 'The customer did not allow it' };
      await s.save();
      return res.redirect(`/api/kyc/digilocker/callback?session=${s._id}`);
    }
    const b = req.body;
    await completeSession(s, { name: b.name, dob: b.dob, gender: b.gender, aadhaarLast4: b.last4, panNumber: b.pan, address: { street: b.street, city: b.city, state: b.state, zipCode: b.zip } }, req);
    res.redirect(`/api/kyc/digilocker/callback?session=${s._id}`);
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

export default router;
