import { runLocked } from './jobRunner.js';
import { raiseAlert, resolveAlert } from './alerts.js';
import { startMetrics } from './metrics.js';

// Every background job, how often it runs, and how long its lock is held at most. A job takes its lock before it runs, so
// with several server copies it still runs once. `ttlMs` is above the longest normal run; the lock also frees itself the
// moment the job finishes.
const MIN = 60 * 1000;
const lazy = (file, name, ...args) => async () => (await import(file))[name](...args);

export const JOBS = [
  { name: 'daily-reminders', label: 'EMI reminders, overdue check, collections steps, referral rewards', everyMs: 6 * 60 * MIN, firstMs: 30 * 1000, ttlMs: 30 * MIN,
    run: async () => {
      const out = {};
      out.reminders = await (await import('./notificationService.js')).sendEmiReminders();
      out.escalations = await (await import('./collectionsService.js')).runEscalations();
      out.referrals = await (await import('./referralService.js')).settleReferrals();
      out.offers = await (await import('./promoOffers.js')).sendDueOfferNotifications();
      return out;
    } },
  { name: 'offers', label: 'Offer announcements', everyMs: 5 * MIN, firstMs: 40 * 1000, ttlMs: 4 * MIN, run: lazy('./promoOffers.js', 'sendDueOfferNotifications') },
  { name: 'auto-debit', label: 'Auto-debit', everyMs: 30 * MIN, firstMs: 60 * 1000, ttlMs: 25 * MIN, run: lazy('./mandateService.js', 'runAutoDebits') },
  { name: 'collections-reminders', label: 'Collections reminders and settlement offers', everyMs: 30 * MIN, firstMs: 90 * 1000, ttlMs: 25 * MIN,
    run: async () => { const m = await import('./collectionsAutomation.js'); const r = await m.runReminders(); await m.expireOffers(); return r; } },
  { name: 'nudges', label: 'Customer nudges', everyMs: 30 * MIN, firstMs: 120 * 1000, ttlMs: 25 * MIN, run: lazy('./nudgeService.js', 'runNudges') },
  { name: 'service-targets', label: 'Service targets (SLA)', everyMs: 15 * MIN, firstMs: 150 * 1000, ttlMs: 12 * MIN, run: lazy('./slaService.js', 'escalate') },
  { name: 'auto-payouts', label: 'Automatic payouts', everyMs: 5 * MIN, firstMs: 180 * 1000, ttlMs: 4 * MIN, run: lazy('./payoutService.js', 'runAutoPayouts') },
  { name: 'monitor', label: 'Health checks and alerts', everyMs: 1 * MIN, firstMs: 45 * 1000, ttlMs: 50 * 1000, run: lazy('./monitorService.js', 'check') },
];

const onFail = (name, e) => raiseAlert({ key: `job-failed:${name}`, severity: 'critical', title: `Background job failed: ${name}`, detail: e.message });

export function startJobs() {
  startMetrics();
  for (const job of JOBS) {
    const tick = async () => {
      try {
        const r = await runLocked(job.name, job.ttlMs, job.run, { onFail });
        if (r.ran && !r.error) await resolveAlert(`job-failed:${job.name}`);
        if (r.error) console.error(`Job ${job.name} failed:`, r.error);
      } catch (e) {
        console.error(`Job ${job.name} could not start:`, e.message);
      }
    };
    setTimeout(tick, job.firstMs).unref();
    setInterval(tick, job.everyMs).unref();
  }
}

export default { JOBS, startJobs };
