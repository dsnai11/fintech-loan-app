import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import AaSession from '../models/AaSession.js';
import { authMiddleware } from '../middleware/auth.js';
import { startSession, completeSession, finishWithProvider, sandboxAllowed, modeNow, sampleStatement, withdraw, view } from '../services/aaService.js';

// Sharing bank statements to check income (Account Aggregator). The app starts a session and opens the link; the customer
// approves at their bank; the app polls. The pages the customer sees in the browser are public, because the browser has no
// app login, but each is tied to a long random session id that belongs to one customer and expires.
const router = express.Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px 18px;color:#111827;line-height:1.5}h1{font-size:21px}label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px;color:#4b5563}
input,select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;box-sizing:border-box}button{padding:12px 18px;border:0;border-radius:10px;font:600 15px system-ui;cursor:pointer}
.go{background:#15803d;color:#fff;width:100%;margin-top:18px}.no{background:#e5e7eb;width:100%;margin-top:8px}.test{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:10px;font-size:13px}</style></head><body>${body}</body></html>`;

const ownSession = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: 'Invalid session' }); return null; }
  const s = await AaSession.findOne({ _id: req.params.id, userId: req.user.userId });
  if (!s) { res.status(404).json({ error: 'Session not found' }); return null; }
  return s;
};

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('incomeCheck');
    const mode = modeNow();
    res.json({ available: mode !== 'unavailable', mode, check: view(user?.incomeCheck) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

// The customer takes back their permission: the summary is deleted
router.delete('/mine', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ removed: await withdraw(user, req) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const id = String(req.query.session || '');
    const s = mongoose.isValidObjectId(id) ? await AaSession.findById(id) : null;
    if (!s) return res.status(404).send(page('Not found', '<h1>This link is not valid</h1><p>Please go back to the app and start again.</p>'));
    if (s.status === 'created' && s.expiresAt < new Date()) { s.status = 'expired'; await s.save(); }
    if (s.status === 'created' && s.mode === 'aa') await finishWithProvider(s, req);
    const fresh = await AaSession.findById(id);
    const ok = fresh.status === 'completed';
    res.send(page(ok ? 'Done' : 'Not finished', ok
      ? '<h1>Done</h1><p>Your bank details have been shared. You can close this page and go back to the app.</p>'
      : '<h1>We could not finish</h1><p>Please go back to the app and try again.</p>'));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1><p>Please go back to the app and try again.</p>'));
  }
});

// ── Test mode: a stand-in for approving the consent at the bank ───────────────────────────────────
async function sandboxSession(req, res) {
  if (!sandboxAllowed()) { res.status(404).send(page('Not found', '<h1>Not found</h1>')); return null; }
  const id = req.params.id;
  const s = mongoose.isValidObjectId(id) ? await AaSession.findById(id) : null;
  if (!s || s.mode !== 'sandbox' || s.status !== 'created' || s.expiresAt < new Date()) { res.status(404).send(page('Expired', '<h1>This test page has expired</h1><p>Please go back to the app and start again.</p>')); return null; }
  return s;
}

router.get('/sandbox/:id', async (req, res) => {
  try {
    const s = await sandboxSession(req, res);
    if (!s) return;
    const u = await User.findById(s.userId);
    res.send(page('Share bank statements (test)', `<div class="test">TEST MODE. This is not a real bank or Account Aggregator. No bank is contacted. It stands in for the consent screen and makes up six months of statements so the journey can be tried.</div>
<h1>Share 6 months of statements with the lender?</h1>
<form method="post" action="/api/income-check/sandbox/${esc(s._id)}">
<label for="profile">What should the made-up statements look like?</label>
<select id="profile" name="profile"><option value="salaried">Steady salary, EMIs paid on time</option><option value="stressed">Salary, but bounced payments and low balance</option><option value="irregular">Irregular income, no salary</option></select>
<label for="salary">Monthly salary (Rs)</label><input id="salary" name="salary" type="number" min="1000" value="${esc(u?.employment?.monthlyIncome || 40000)}">
<button class="go" name="action" value="allow">Approve</button><button class="no" name="action" value="deny">Decline</button></form>`));
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

router.post('/sandbox/:id', async (req, res) => {
  try {
    const s = await sandboxSession(req, res);
    if (!s) return;
    if (req.body?.action !== 'allow') {
      s.status = 'failed';
      s.result = { error: 'The customer did not allow it' };
      await s.save();
      return res.redirect(`/api/income-check/callback?session=${s._id}`);
    }
    const profile = ['salaried', 'stressed', 'irregular'].includes(req.body.profile) ? req.body.profile : 'salaried';
    const salary = Math.min(Math.max(Number(req.body.salary) || 40000, 1000), 10000000);
    await completeSession(s, sampleStatement(profile, salary), req);
    res.redirect(`/api/income-check/callback?session=${s._id}`);
  } catch (e) {
    res.status(500).send(page('Error', '<h1>Something went wrong</h1>'));
  }
});

export default router;
