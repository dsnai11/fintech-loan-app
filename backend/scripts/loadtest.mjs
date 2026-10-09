// Load test: seeds a throw-away database with customers, loans and EMIs, starts the server on a free port,
// and hits it with many customers and staff at once. It also times the background jobs against the same data.
//
//   node scripts/loadtest.mjs                      50,000 customers, 100 at once, 30 seconds
//   node scripts/loadtest.mjs --users 10000 --concurrency 50 --seconds 15
//   node scripts/loadtest.mjs --skip-seed          reuse the data from the last run
//   node scripts/loadtest.mjs --jobs               also time the scheduled jobs (reminders, overdue check, ...)
//
// It never touches the real database: it uses MONGO_URL (default mongodb://localhost:27017) and the database
// "fintech-loadtest", which it drops when it seeds.
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const USERS = Number(arg('users', 50000));
const CONC = Number(arg('concurrency', 100));
const SECONDS_DEFAULT = Number(arg('seconds', 30));
const SECONDS = SECONDS_DEFAULT;
const SKIP_SEED = !!arg('skip-seed', false);
const JOBS = !!arg('jobs', false);
const MONGO = (process.env.TEST_MONGO_URL || process.env.MONGO_URL_LOADTEST || 'mongodb://localhost:27017').replace(/\/$/, '');
const DB = 'fintech-loadtest';
const SECRET = 'loadtest-secret';
const DAY = 864e5;

const models = async () => ({
  User: (await import('../src/models/User.js')).default,
  Loan: (await import('../src/models/Loan.js')).default,
  EMIPayment: (await import('../src/models/EMIPayment.js')).default,
});

async function seed() {
  const { User, Loan, EMIPayment } = await models();
  console.log(`Seeding ${USERS.toLocaleString()} customers...`);
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Loan.init(), EMIPayment.init()]);
  const hash = bcrypt.hashSync('x12345678', 10);
  const now = Date.now();
  const BATCH = 5000;
  let loans = 0, emis = 0;
  for (let from = 0; from < USERS; from += BATCH) {
    const to = Math.min(USERS, from + BATCH);
    const users = [];
    for (let i = from; i < to; i++) {
      users.push({ _id: new mongoose.Types.ObjectId(), firstName: `Load${i}`, lastName: 'Test', email: `load${i}@x.in`, phone: `8${String(i).padStart(9, '0')}`, password: hash, kycStatus: 'approved', phoneVerified: true, createdAt: new Date(now - (i % 400) * DAY), employment: { status: 'Employed', monthlyIncome: 30000 + (i % 40) * 1000, salaryDay: 1 + (i % 28) } });
    }
    await User.collection.insertMany(users);
    const ls = [], es = [];
    for (let k = 0; k < users.length; k++) {
      const u = users[k];
      const r = (from + k) % 100;
      // 55% running, 25% closed, 8% waiting, 6% approved, 3% rejected, 3% defaulted
      const status = r < 55 ? 'disbursed' : r < 80 ? 'closed' : r < 88 ? 'submitted' : r < 94 ? 'approved' : r < 97 ? 'rejected' : 'defaulted';
      const loan = { _id: new mongoose.Types.ObjectId(), userId: u._id, loanAmount: 20000 + (k % 10) * 5000, tenure: 3, purpose: 'Personal', interestRate: 15, monthlyEMI: 7000, totalAmount: 21000, status, productKey: 'personal', createdAt: new Date(now - ((from + k) % 300) * DAY), updatedAt: new Date(), disbursementDate: status === 'disbursed' || status === 'closed' || status === 'defaulted' ? new Date(now - 60 * DAY) : undefined };
      ls.push(loan);
      if (loan.disbursementDate) {
        for (let n = 1; n <= 3; n++) {
          // Closed loans are paid; running ones have the first paid and the second due around now, spread over ~10 days
          // so that about 1 in 8 customers has an EMI due in the next three days.
          let due, st = 'PENDING';
          if (status === 'closed') { due = new Date(now - (90 - n * 10) * DAY); st = 'PAID'; }
          else if (status === 'defaulted') { due = new Date(now - (40 - n * 10) * DAY); st = n === 1 ? 'PAID' : 'OVERDUE'; }
          else if (n === 1) { due = new Date(now - 25 * DAY); st = 'PAID'; }
          else { due = new Date(now + ((from + k) % 80 - 8) * DAY / 8 * (n - 1)); if (due < now && (from + k) % 50 === 0) st = 'OVERDUE'; }
          es.push({ loanId: loan._id, userId: u._id, emiNumber: n, dueDate: due, amount: 7000, principalAmount: 6666, interestAmount: 334, status: st, paidDate: st === 'PAID' ? new Date(due) : undefined });
        }
      }
    }
    await Loan.collection.insertMany(ls);
    if (es.length) await EMIPayment.collection.insertMany(es);
    loans += ls.length; emis += es.length;
    process.stdout.write(`  ${to.toLocaleString()} customers\r`);
  }
  console.log(`\nSeeded ${USERS.toLocaleString()} customers, ${loans.toLocaleString()} loans, ${emis.toLocaleString()} EMIs.`);
}

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.js'], { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MONGO_URI: `${MONGO}/${DB}`, PORT: String(port), JWT_SECRET: SECRET, ADMIN_EMAIL: 'admin@lifc.in', EMAIL_USER: '', EMAIL_PASSWORD: '', API_RATE_LIMIT: '100000000', AUTH_RATE_LIMIT: '100000000', DISABLE_SCHEDULER: '1', REQUIRE_TERMS: 'false', REQUIRE_PHONE_VERIFIED: 'false', REQUIRE_ONBOARDING: 'false', OFFER_LIMIT: 'false', ...env } });
  let logs = '';
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  const until = Date.now() + 60000;
  while (!/Config loaded/.test(logs) && Date.now() < until) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 800));
  return { base: `http://localhost:${port}/api`, stop: () => child.kill(), logs: () => logs };
}

const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0;

async function hammer(base, pool, admin, SECONDS = SECONDS_DEFAULT) {
  const stats = new Map();
  const firstError = new Map();
  const rec = (name, ms, ok) => { const s = stats.get(name) || { ms: [], err: 0 }; s.ms.push(ms); if (!ok) s.err++; stats.set(name, s); };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  // What customers and staff do, and how often (weights are relative)
  const scenarios = [
    ['GET app-settings (app start)', 20, async () => fetch(`${base}/app-settings`)],
    ['GET my loans (home)', 25, async () => { const c = pick(pool); return fetch(`${base}/loans`, { headers: { Authorization: `Bearer ${c.token}` } }); }],
    ['GET EMI schedule', 20, async () => { const c = pick(pool); return fetch(`${base}/emi/schedule/${c.loanId}`, { headers: { Authorization: `Bearer ${c.token}` } }); }],
    ['GET payday status', 8, async () => { const c = pick(pool); return fetch(`${base}/payday/status`, { headers: { Authorization: `Bearer ${c.token}` } }); }],
    ['GET notifications', 8, async () => { const c = pick(pool); return fetch(`${base}/notifications`, { headers: { Authorization: `Bearer ${c.token}` } }); }],
    ['POST login (password check)', 4, async () => { const c = pick(pool); return fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.email, password: 'x12345678' }) }); }],
    ['ADMIN loans list (page)', 3, async () => fetch(`${base}/admin/loans?status=disbursed&page=${1 + Math.floor(Math.random() * 20)}`, { headers: { Authorization: `Bearer ${admin}` } })],
    ['ADMIN loan management list', 2, async () => fetch(`${base}/admin/loans?status=submitted&limit=50`, { headers: { Authorization: `Bearer ${admin}` } })],
    ['ADMIN dashboard', 1, async () => fetch(`${base}/admin/dashboard`, { headers: { Authorization: `Bearer ${admin}` } })],
    ['ADMIN stats', 1, async () => fetch(`${base}/admin/stats`, { headers: { Authorization: `Bearer ${admin}` } })],
    ['ADMIN collections queue', 2, async () => fetch(`${base}/admin/collections/queue`, { headers: { Authorization: `Bearer ${admin}` } })],
    ['ADMIN overdue EMIs', 1, async () => fetch(`${base}/emi/admin/overdue`, { headers: { Authorization: `Bearer ${admin}` } })],
    ['ADMIN customer search', 2, async () => fetch(`${base}/admin/customers?q=load${Math.floor(Math.random() * 1000)}`, { headers: { Authorization: `Bearer ${admin}` } })],
  ];
  const total = scenarios.reduce((a, s) => a + s[1], 0);
  const choose = () => { let r = Math.random() * total; for (const s of scenarios) { r -= s[1]; if (r <= 0) return s; } return scenarios[0]; };
  const end = Date.now() + SECONDS * 1000;
  const worker = async () => {
    while (Date.now() < end) {
      const [name, , fn] = choose();
      const t = performance.now();
      let ok = false;
      try { const r = await fn(); const body = await r.text(); ok = r.status < 400; if (!ok && !firstError.has(name)) firstError.set(name, `${r.status} ${body.slice(0, 160)}`); } catch (e) { ok = false; }
      rec(name, performance.now() - t, ok);
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: CONC }, worker));
  return { stats, seconds: (Date.now() - started) / 1000, firstError };
}

function report(label, { stats, seconds, firstError }) {
  let reqs = 0, errs = 0;
  const rows = [];
  for (const [name, s] of stats) {
    s.ms.sort((a, b) => a - b);
    reqs += s.ms.length; errs += s.err;
    rows.push({ name, n: s.ms.length, p50: pct(s.ms, 50), p95: pct(s.ms, 95), p99: pct(s.ms, 99), err: s.err });
  }
  rows.sort((a, b) => b.p95 - a.p95);
  console.log(`\n${label}: ${reqs.toLocaleString()} requests in ${seconds.toFixed(0)}s = ${(reqs / seconds).toFixed(0)} per second, ${errs} errors`);
  console.log('  endpoint'.padEnd(36) + 'count'.padStart(8) + 'p50 ms'.padStart(9) + 'p95 ms'.padStart(9) + 'p99 ms'.padStart(9) + 'errors'.padStart(8));
  for (const r of rows) console.log(('  ' + r.name).padEnd(36) + String(r.n).padStart(8) + r.p50.toFixed(0).padStart(9) + r.p95.toFixed(0).padStart(9) + r.p99.toFixed(0).padStart(9) + String(r.err).padStart(8));
  for (const [name, e] of firstError || []) console.log(`  first error on ${name}: ${e}`);
  return { reqs, errs, rps: reqs / seconds };
}

async function timeJobs() {
  console.log('\nBackground jobs against the same data (one run each, in this process):');
  const { loadAllConfig } = await import('../src/services/configService.js');
  await loadAllConfig();
  const jobs = [
    ['EMI reminders and overdue check', async () => (await import('../src/services/notificationService.js')).sendEmiReminders()],
    ['Collections escalation', async () => (await import('../src/services/collectionsService.js')).runEscalations()],
    ['Referral rewards', async () => (await import('../src/services/referralService.js')).settleReferrals()],
    ['Offer announcements', async () => (await import('../src/services/promoOffers.js')).sendDueOfferNotifications()],
    ['Auto-debit', async () => (await import('../src/services/mandateService.js')).runAutoDebits()],
    ['Collections reminders', async () => (await import('../src/services/collectionsAutomation.js')).runReminders()],
    ['Nudges', async () => (await import('../src/services/nudgeService.js')).runNudges()],
    ['Service targets', async () => (await import('../src/services/slaService.js')).escalate()],
    ['Automatic payouts', async () => (await import('../src/services/payoutService.js')).runAutoPayouts()],
  ];
  const out = [];
  for (const [name, fn] of jobs) {
    const t = Date.now();
    let note = '';
    try { const r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('still running after 5 minutes')), 300000))]); note = r && typeof r === 'object' ? JSON.stringify(r).slice(0, 80) : ''; } catch (e) { note = `FAILED: ${e.message}`; }
    const s = (Date.now() - t) / 1000;
    out.push([name, s]);
    console.log(`  ${name.padEnd(36)} ${s.toFixed(1).padStart(7)} s  ${note}`);
  }
  return out;
}

await mongoose.connect(`${MONGO}/${DB}`);
process.env.JWT_SECRET = SECRET;
if (!SKIP_SEED) await seed();
const { User, Loan } = await models();
// A pool of customers to act as, each with a token and one of their loans
const sample = await User.aggregate([{ $sample: { size: Math.min(3000, USERS) } }, { $project: { email: 1 } }]);
const loanOf = new Map((await Loan.find({ userId: { $in: sample.map(u => u._id) } }).select('userId').lean()).map(l => [String(l.userId), l._id]));
const pool = sample.filter(u => loanOf.has(String(u._id))).map(u => ({ email: u.email, token: jwt.sign({ userId: String(u._id), email: u.email, iatMs: Date.now() }, SECRET, { expiresIn: '1d' }), loanId: String(loanOf.get(String(u._id))) }));
const adminUser = (await User.findOne({ email: 'admin@lifc.in' })) || (await User.create({ firstName: 'Ad', lastName: 'Min', email: 'admin@lifc.in', phone: 'admin-0', password: 'AdminPass123' }));
const admin = jwt.sign({ userId: String(adminUser._id), email: 'admin@lifc.in', isAdmin: true, iatMs: Date.now() }, SECRET, { expiresIn: '1d' });

console.log(`\nStarting the server and sending ${CONC} users at once for ${SECONDS}s...`);
const srv = await startServer();
let summary;
try {
  await hammer(srv.base, pool, admin, 4); // a short warm-up so start-up costs are not counted
  summary = report('RESULT', await hammer(srv.base, pool, admin));
} finally {
  srv.stop();
}
let jobs = [];
if (JOBS) jobs = await timeJobs();
await mongoose.disconnect();
console.log(`\nDone. ${summary.errs ? 'There were errors: check the table above.' : 'No errors.'}`);
process.exit(0);
