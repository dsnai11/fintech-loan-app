import express from 'express';
import mongoose from 'mongoose';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { can } from '../services/permissions.js';
import { getConfig, setConfig } from '../services/configService.js';
import { summary, HOST } from '../services/metrics.js';
import { webhookOk, channels, openAlerts, recentAlerts, raiseAlert, resolveAlert } from '../services/alerts.js';
import { ping, LIMITS } from '../services/monitorService.js';
import { JOBS } from '../services/scheduler.js';
import { securityChecks, isProduction } from '../services/securityChecks.js';
import JobLock from '../models/JobLock.js';

// System health for staff: is the database up, how is traffic, are the background jobs running, what is open, and who gets told.
const router = express.Router();
router.use(adminMiddleware);

const deny = res => res.status(403).json({ error: 'Your role cannot change alert settings.', code: 'NOT_PERMITTED', needs: 'config.manage' });
const mask = v => (v ? v.slice(0, 12) + '...' : '');

router.get('/', async (req, res) => {
  try {
    const [db, traffic, locks, open, recent] = await Promise.all([ping(), summary(60), JobLock.find({}).lean(), openAlerts(), recentAlerts(15)]);
    const ch = channels();
    res.json({
      database: { ok: db.ok, ms: db.ms, connections: mongoose.connection.readyState },
      process: { host: HOST, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), nodeVersion: process.version, processes: Number(process.env.WEB_CONCURRENCY) || 1 },
      traffic,
      jobs: JOBS.map(j => { const l = locks.find(x => x.name === j.name); return { name: j.name, label: j.label, everyMinutes: Math.round(j.everyMs / 60000), lastFinishedAt: l?.lastFinishedAt || null, lastDurationMs: l?.lastDurationMs ?? null, runs: l?.runs || 0, failures: l?.failures || 0, lastError: l?.lastError || null }; }),
      alerts: { open, recent },
      notify: { emails: ch.emails, webhook: mask(ch.webhook), reachable: ch.emails.length > 0 || !!ch.webhook, repeatMinutes: Number(getConfig('ALERT_REPEAT_MINUTES', '60')) || 60 },
      limits: LIMITS,
      security: { production: isProduction(), checks: securityChecks() },
      canEdit: can(req.user.role, 'config.manage'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/notify', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return deny(res);
    const emails = String(req.body?.emails || '').split(',').map(s => s.trim()).filter(Boolean);
    const bad = emails.find(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) return res.status(400).json({ error: `"${bad}" is not a valid email address.` });
    if (emails.length > 10) return res.status(400).json({ error: 'Use at most 10 email addresses.' });
    const webhook = String(req.body?.webhook || '').trim();
    if (webhook && !webhookOk(webhook)) return res.status(400).json({ error: 'The chat web address must start with https://' });
    const repeat = req.body?.repeatMinutes === undefined ? 60 : Number(req.body.repeatMinutes);
    if (!Number.isInteger(repeat) || repeat < 5 || repeat > 1440) return res.status(400).json({ error: 'Repeat between 5 and 1440 minutes.' });
    await setConfig('ALERT_EMAILS', emails.join(','), { group: 'alerts', updatedBy: req.user.email });
    // Only replace the web address when one was typed; a masked value sent back means "keep it"
    if (!webhook.endsWith('...')) await setConfig('ALERT_WEBHOOK_URL', webhook, { group: 'alerts', isSecret: true, updatedBy: req.user.email });
    await setConfig('ALERT_REPEAT_MINUTES', String(repeat), { group: 'alerts', updatedBy: req.user.email });
    await audit(req.user, 'ALERT_SETTINGS_UPDATED', { type: 'Config', id: 'ALERTS' }, { emails: emails.length, webhook: !!webhook, repeat }, req);
    res.json({ message: 'Saved.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/test-alert', async (req, res) => {
  try {
    if (!can(req.user.role, 'config.manage')) return deny(res);
    const ch = channels();
    if (!ch.emails.length && !ch.webhook) return res.status(400).json({ error: 'Add an email address or a chat web address first.' });
    // A fresh key each time so the hourly limit does not swallow the test
    const a = await raiseAlert({ key: `test:${Date.now()}`, severity: 'warning', title: 'Test alert', detail: `Sent by ${req.user.email}. If you can read this, alerts reach you.` });
    await resolveAlert(a.key); // a test should not stay open
    res.json({ message: a.notified.length ? `Sent by ${a.notified.join(' and ')}.` : 'It could not be delivered. Check the email settings and the chat web address.', notified: a.notified });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
