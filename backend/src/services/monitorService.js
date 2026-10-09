import mongoose from 'mongoose';
import JobLock from '../models/JobLock.js';
import PayoutRecord from '../models/PayoutRecord.js';
import { summary } from './metrics.js';
import { raiseAlert, resolveAlert } from './alerts.js';
import { securityChecks, isProduction } from './securityChecks.js';

// Runs every minute (on one server only). Looks at the database, the traffic of the last five minutes, the background jobs and the
// automatic payouts, and opens or clears alerts. The thresholds are plain numbers here; change them as you learn what normal looks like.
export const LIMITS = {
  dbSlowMs: 1500,
  minRequests: 50, // below this many requests in five minutes a percentage means little
  errorRate: 0.05, // 5xx share that raises a warning
  criticalErrorRate: 0.2,
  slowP95Ms: 3000,
  staleFactor: 3, // a job that has not finished in this many of its own intervals is stuck
};

const check1 = async (key, bad, make) => { if (bad) await raiseAlert({ key, ...make }); else await resolveAlert(key); };

export async function ping() {
  const t = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: e.message };
  }
}

export async function check() {
  const out = { problems: [] };
  const db = await ping();
  await check1('db-down', !db.ok, { severity: 'critical', title: 'The database does not answer', detail: db.error });
  await check1('db-slow', db.ok && db.ms > LIMITS.dbSlowMs, { severity: 'warning', title: 'The database is slow', detail: `A simple check took ${db.ms} ms` });
  if (!db.ok || db.ms > LIMITS.dbSlowMs) out.problems.push('database');

  const m = await summary(5);
  const rate = m.requests ? m.errors5xx / m.requests : 0;
  await check1('errors-high', m.requests >= LIMITS.minRequests && rate > LIMITS.errorRate, { severity: rate > LIMITS.criticalErrorRate ? 'critical' : 'warning', title: 'Many requests are failing', detail: `${m.errors5xx} of ${m.requests} requests in the last 5 minutes failed with a server error (${Math.round(rate * 100)}%)` });
  await check1('slow', m.requests >= LIMITS.minRequests && m.p95Ms > LIMITS.slowP95Ms, { severity: 'warning', title: 'The app is slow', detail: `19 in 20 requests finish within ${m.p95Ms} ms or less; this is above ${LIMITS.slowP95Ms} ms` });
  if (m.requests >= LIMITS.minRequests && (rate > LIMITS.errorRate || m.p95Ms > LIMITS.slowP95Ms)) out.problems.push('traffic');

  // Jobs that stopped running. Only jobs that have run before can be late.
  const { JOBS } = await import('./scheduler.js');
  const locks = await JobLock.find({}).lean();
  for (const job of JOBS) {
    const l = locks.find(x => x.name === job.name);
    if (!l || !l.lastFinishedAt) continue;
    const late = Date.now() - new Date(l.lastFinishedAt).getTime() > job.everyMs * LIMITS.staleFactor + job.ttlMs;
    await check1(`job-stale:${job.name}`, late, { severity: 'critical', title: `Background job has stopped: ${job.label}`, detail: `Last finished ${new Date(l.lastFinishedAt).toISOString()}; it should run every ${Math.round(job.everyMs / 60000)} minutes` });
    if (late) out.problems.push(`job ${job.name}`);
  }

  // Settings that leave the deployment exposed (only judged on a real deployment, not on a developer's machine)
  const bad = isProduction() ? securityChecks().filter(c => !c.ok && c.severity === 'critical') : [];
  await check1('security-config', bad.length > 0, { severity: 'critical', title: 'A security setting needs fixing', detail: bad.map(c => c.label).join('; ') });
  if (bad.length) out.problems.push('security');

  // Money that did not go out
  const failed = await PayoutRecord.countDocuments({ status: { $in: ['failed', 'reversed'] }, createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } });
  await check1('payouts-failed', failed > 0, { severity: 'warning', title: 'Automatic payouts failed', detail: `${failed} payout(s) failed or were reversed in the last hour. See Automatic or manual.` });
  if (failed) out.problems.push('payouts');
  return out;
}

export default { check, ping, LIMITS };
