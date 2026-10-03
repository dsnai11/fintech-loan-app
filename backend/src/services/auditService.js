import crypto from 'crypto';
import AuditLog from '../models/AuditLog.js';

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// Sorted-key JSON so the same data always hashes the same way, whatever order Mongo returns keys in.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export const hashEntry = e =>
  sha256(`${e.prevHash}|${e.seq}|${e.at}|${e.actor}|${e.role}|${e.action}|${e.entityType}|${e.entityId}|${stable(e.details)}|${e.ip}`);

export function clientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : req?.ip) || '';
}

// Each entry carries the hash of the one before it, so editing or removing an old entry breaks the chain.
// Writes in this process go through a queue, so they never collide with each other. The unique `seq`
// index is the safety net if more than one server process ever writes at once: the loser retries.
let queue = Promise.resolve();
const enqueue = fn => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function append(entry) {
  return enqueue(async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      const last = await AuditLog.findOne().sort({ seq: -1 }).select('seq hash').lean();
      const doc = { ...entry, seq: (last?.seq || 0) + 1, prevHash: last?.hash || 'GENESIS' };
      doc.hash = hashEntry(doc);
      try {
        return await AuditLog.create(doc);
      } catch (e) {
        if (e.code !== 11000) throw e;
        await sleep(10 + Math.random() * 40);
      }
    }
    throw new Error('Could not append audit entry');
  });
}

// Never throws: a logging problem must not block the action being logged.
// Pass only identifiers and non-sensitive facts in `details` (no passwords, tokens, PAN or account numbers).
export async function audit(actor, action, entity = {}, details = {}, req = null) {
  try {
    const a = typeof actor === 'string' ? { email: actor, role: 'system' } : actor || { email: 'system', role: 'system' };
    const isAdmin = a.isAdmin || a.email === (process.env.ADMIN_EMAIL || 'admin@lifc.in');
    return await append({
      at: new Date().toISOString(),
      actor: a.email || String(a.userId || 'unknown'),
      role: a.role || (isAdmin ? 'admin' : 'customer'),
      action,
      entityType: entity.type || '',
      entityId: entity.id ? String(entity.id) : '',
      details: JSON.parse(JSON.stringify(details)),
      ip: clientIp(req),
    });
  } catch (e) {
    console.error('audit failed:', e.message);
    return null;
  }
}

export async function verifyChain() {
  let prev = 'GENESIS';
  let expectedSeq = 1;
  let checked = 0;
  const cursor = AuditLog.find().sort({ seq: 1 }).lean().cursor();
  for await (const e of cursor) {
    if (e.seq !== expectedSeq) return { ok: false, checked, brokenAt: expectedSeq, reason: `Entry ${expectedSeq} is missing` };
    if (e.prevHash !== prev) return { ok: false, checked, brokenAt: e.seq, reason: 'Link to the previous entry does not match' };
    if (hashEntry(e) !== e.hash) return { ok: false, checked, brokenAt: e.seq, reason: 'Entry contents do not match their hash' };
    prev = e.hash;
    expectedSeq++;
    checked++;
  }
  return { ok: true, checked };
}

export default { audit, verifyChain, hashEntry, clientIp };
