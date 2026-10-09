import SystemAlert from '../models/SystemAlert.js';
import { getConfig } from './configService.js';
import { sendPlainEmail } from './notificationService.js';

// Tells the people who run the platform when something is wrong. Two ways: an email to a list, and a web address that
// takes a chat message (Slack and most chat tools accept the {"text": ...} form). If neither is set up the alert is still
// kept and shown on the System health page; it just cannot reach anyone by itself.
const REPEAT_MS = () => (Number(getConfig('ALERT_REPEAT_MINUTES', '60')) || 60) * 60000;

// Always https. A local address is allowed only when ALLOW_LOCAL_WEBHOOK=1 (used by the tests).
export const webhookOk = u => /^https:\/\/[^\s]+$/i.test(u) || (process.env.ALLOW_LOCAL_WEBHOOK === '1' && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(u));

export const channels = () => ({
  emails: String(getConfig('ALERT_EMAILS', '')).split(',').map(s => s.trim()).filter(Boolean),
  webhook: getConfig('ALERT_WEBHOOK_URL', ''),
});

async function deliver(a) {
  const { emails, webhook } = channels();
  const used = [];
  const text = `[${a.severity.toUpperCase()}] ${a.title}${a.detail ? `\n${a.detail}` : ''}\nLIFC platform alert`;
  for (const to of emails) {
    try { if ((await sendPlainEmail(to, `LIFC alert: ${a.title}`, text)) === 'sent') used.push('email'); } catch (e) { /* the other channel may still work */ }
  }
  if (webhook && webhookOk(webhook)) {
    try {
      const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) });
      if (r.ok) used.push('webhook');
    } catch (e) { /* recorded as not delivered */ }
  }
  return [...new Set(used)];
}

// Opens the alert, or counts another occurrence. Tells people when it opens, and again at most once an hour while it stays open.
export async function raiseAlert({ key, severity = 'warning', title, detail = '' }) {
  const now = new Date();
  let a = await SystemAlert.findOne({ key });
  if (!a) a = new SystemAlert({ key, firstAt: now, count: 0 });
  const reopened = a.status === 'resolved';
  Object.assign(a, { severity, title, detail: String(detail).slice(0, 500), status: 'open', lastAt: now, resolvedAt: null, count: reopened ? 1 : a.count + 1 });
  if (reopened) a.firstAt = now;
  const due = !a.lastNotifiedAt || reopened || now - a.lastNotifiedAt >= REPEAT_MS();
  if (due) {
    a.notified = await deliver(a);
    a.lastNotifiedAt = now;
  }
  await a.save();
  return a;
}

export const resolveAlert = key => SystemAlert.findOneAndUpdate({ key, status: 'open' }, { status: 'resolved', resolvedAt: new Date() }, { new: true });
export const openAlerts = () => SystemAlert.find({ status: 'open' }).sort({ severity: 1, lastAt: -1 }).lean();
export const recentAlerts = (n = 20) => SystemAlert.find({}).sort({ lastAt: -1 }).limit(n).lean();

export default { raiseAlert, resolveAlert, openAlerts, recentAlerts, channels };
