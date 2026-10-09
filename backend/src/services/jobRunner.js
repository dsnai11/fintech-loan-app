import os from 'os';
import JobLock from '../models/JobLock.js';

const HOLDER = `${os.hostname()}-${process.pid}`;

// Runs a job only if no other server is running it. `ttlMs` is how long the lock is held at most: set it above the
// job's longest normal run. Returns { ran, skipped, error, result }.
export async function runLocked(name, ttlMs, fn, { onFail } = {}) {
  const now = new Date();
  let lock;
  try {
    lock = await JobLock.findOneAndUpdate(
      { name, $or: [{ until: { $lt: now } }, { until: null }] },
      { $set: { holder: HOLDER, until: new Date(now.getTime() + ttlMs), lastStartedAt: now }, $setOnInsert: { name } },
      { upsert: true, new: true }
    );
  } catch (e) {
    // Another server created or holds it (duplicate key on upsert): that server runs the job
    if (e.code === 11000) return { ran: false, skipped: true };
    throw e;
  }
  if (!lock || lock.holder !== HOLDER) return { ran: false, skipped: true };
  const t = Date.now();
  // A long run keeps its lock alive. Without this, a job that takes longer than its lock time (10,000 reminders on a busy due
  // date) would be started a second time by another server while the first is still going.
  const beat = setInterval(() => { JobLock.updateOne({ name, holder: HOLDER }, { $set: { until: new Date(Date.now() + ttlMs) } }).catch(() => {}); }, Math.max(1000, Math.floor(ttlMs / 3)));
  try {
    const result = await fn();
    await JobLock.updateOne({ name, holder: HOLDER }, { $set: { until: new Date(), lastFinishedAt: new Date(), lastDurationMs: Date.now() - t, lastError: null }, $inc: { runs: 1 } });
    clearInterval(beat);
    return { ran: true, result };
  } catch (e) {
    clearInterval(beat);
    await JobLock.updateOne({ name, holder: HOLDER }, { $set: { until: new Date(), lastFinishedAt: new Date(), lastDurationMs: Date.now() - t, lastError: String(e.message).slice(0, 300) }, $inc: { runs: 1, failures: 1 } }).catch(() => {});
    if (onFail) await onFail(name, e).catch(() => {});
    return { ran: true, error: e.message };
  }
}

export default { runLocked };
