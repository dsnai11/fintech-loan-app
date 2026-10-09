// Runs `fn` over `items` with at most `limit` running at once. A failure in one item is counted, not thrown, so one bad
// customer never stops a batch of 10,000 reminders.
export async function mapLimit(items, limit, fn) {
  let next = 0;
  let failed = 0;
  const results = new Array(items.length);
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { failed++; results[i] = undefined; console.error('batch item failed:', e.message); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { results, failed };
}

// A tiny in-memory cache for expensive staff pages: the same answer for `ttlMs`, and never more than one calculation
// at a time for the same key (so ten staff opening the dashboard at once cost one calculation).
const store = new Map();
export async function cached(key, ttlMs, compute) {
  const hit = store.get(key);
  if (hit && hit.until > Date.now()) return hit.promise;
  const promise = compute().catch(e => { store.delete(key); throw e; });
  store.set(key, { until: Date.now() + ttlMs, promise });
  if (store.size > 200) for (const [k, v] of store) if (v.until < Date.now()) store.delete(k);
  return promise;
}
export const dropCached = prefix => { for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k); };

export default { mapLimit, cached, dropCached };
