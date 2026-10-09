import os from 'os';
import crypto from 'crypto';
import MetricBucket from '../models/MetricBucket.js';

// What the server records about itself: a request id on every request, one line in the log for each failed or very slow
// request (never the query string, which can hold personal data), and per-minute counts that the System health page and
// the alerts read.
export const HOST = `${os.hostname()}-${process.pid}`;
export const EDGES = [50, 100, 250, 500, 1000, 2500]; // upper edges in ms; the last band is everything slower
const buckets = new Map(); // minute -> counters

const band = ms => { const i = EDGES.findIndex(e => ms < e); return i < 0 ? EDGES.length : i; };

function bucketFor(minute) {
  let b = buckets.get(minute);
  if (!b) { b = { n: 0, e4: 0, e5: 0, sumMs: 0, h: new Array(EDGES.length + 1).fill(0) }; buckets.set(minute, b); }
  return b;
}

export function record(ms, status) {
  const b = bucketFor(Math.floor(Date.now() / 60000));
  b.n++;
  b.sumMs += ms;
  b.h[band(ms)]++;
  if (status >= 500) b.e5++; else if (status >= 400) b.e4++;
}

export function metricsMiddleware(req, res, next) {
  req.id = String(req.headers['x-request-id'] || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const t = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    record(ms, res.statusCode);
    if (res.statusCode >= 500 || ms > 3000) {
      console.log(JSON.stringify({ level: res.statusCode >= 500 ? 'error' : 'warn', msg: 'request', id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) }));
    }
  });
  next();
}

export async function flush() {
  const now = Math.floor(Date.now() / 60000);
  const ops = [];
  for (const [minute, b] of buckets) {
    ops.push({ updateOne: { filter: { _id: `${HOST}-${minute}` }, update: { $set: { host: HOST, minute: new Date(minute * 60000), n: b.n, e4: b.e4, e5: b.e5, sumMs: Math.round(b.sumMs), h: b.h } }, upsert: true } });
    if (minute < now - 1) buckets.delete(minute);
  }
  if (ops.length) await MetricBucket.bulkWrite(ops, { ordered: false });
}

export function startMetrics() {
  setInterval(() => flush().catch(() => {}), 15000).unref();
}

// The last `minutes` minutes across all server processes: a series and totals, with the 95th percentile read from the bands
export async function summary(minutes = 60) {
  const from = new Date(Math.floor(Date.now() / 60000) * 60000 - (minutes - 1) * 60000);
  const docs = await MetricBucket.find({ minute: { $gte: from } }).lean();
  const byMinute = new Map();
  const hosts = new Set();
  for (const d of docs) {
    hosts.add(d.host);
    const k = new Date(d.minute).getTime();
    const m = byMinute.get(k) || { n: 0, e4: 0, e5: 0, sumMs: 0, h: new Array(EDGES.length + 1).fill(0) };
    m.n += d.n; m.e4 += d.e4; m.e5 += d.e5; m.sumMs += d.sumMs;
    (d.h || []).forEach((v, i) => { m.h[i] += v; });
    byMinute.set(k, m);
  }
  const p95 = h => {
    const total = h.reduce((a, v) => a + v, 0);
    if (!total) return 0;
    let run = 0;
    for (let i = 0; i < h.length; i++) { run += h[i]; if (run >= total * 0.95) return i < EDGES.length ? EDGES[i] : EDGES[EDGES.length - 1] * 2; }
    return 0;
  };
  const series = [...byMinute.entries()].sort((a, b) => a[0] - b[0]).map(([t, m]) => ({ t, n: m.n, e5: m.e5, e4: m.e4, avgMs: m.n ? Math.round(m.sumMs / m.n) : 0, p95Ms: p95(m.h) }));
  const total = { n: 0, e4: 0, e5: 0, sumMs: 0, h: new Array(EDGES.length + 1).fill(0) };
  for (const m of byMinute.values()) { total.n += m.n; total.e4 += m.e4; total.e5 += m.e5; total.sumMs += m.sumMs; m.h.forEach((v, i) => { total.h[i] += v; }); }
  return { minutes, series, hosts: hosts.size, requests: total.n, errors5xx: total.e5, errors4xx: total.e4, avgMs: total.n ? Math.round(total.sumMs / total.n) : 0, p95Ms: p95(total.h) };
}

export default { metricsMiddleware, record, flush, summary, startMetrics };
