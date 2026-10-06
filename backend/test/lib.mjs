import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';

// Tokens are signed and checked with this secret, in this process and in the servers we start.
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'admin@lifc.in';

const here = path.dirname(fileURLToPath(import.meta.url));
export const backendDir = path.resolve(here, '..');
export const MONGO = (process.env.TEST_MONGO_URL || 'mongodb://localhost:27017').replace(/\/$/, '');

let passed = 0;
let failed = 0;
export function check(name, ok, extra = '') {
  ok ? passed++ : failed++;
  console.log(ok ? '  ok  ' : '  FAIL', name, ok ? '' : `-> ${extra}`);
}
export const section = title => console.log(`\n${title}`);
export function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForHealth(url, ms, exited) {
  let done = false;
  exited.then(() => { done = true; });
  const end = Date.now() + ms;
  while (Date.now() < end && !done) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  return false;
}

// Starts the real server as a child process on a random port, against its own database.
export async function startServer(db, env = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 5100 + Math.floor(Math.random() * 3000);
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MONGO_URI: `${MONGO}/${db}`,
        PORT: String(port),
        JWT_SECRET: 'test-secret',
        ADMIN_EMAIL: 'admin@lifc.in',
        EMAIL_USER: '',
        EMAIL_PASSWORD: '',
        API_RATE_LIMIT: '1000000',
        AUTH_RATE_LIMIT: '1000000',
        DISABLE_SCHEDULER: '1',
        PAYMENT_MODE: '',
        ADMIN_RESET_PASSWORD: '',
        RAZORPAY_WEBHOOK_SECRET: '',
        REQUIRE_KYC_FOR_APPROVAL: '',
        REQUIRE_LOAN_AGREEMENT: '',
        REQUIRE_TERMS: 'false',
        REQUIRE_PHONE_VERIFIED: 'false',
        ...env,
      },
    });
    let logs = '';
    child.stdout.on('data', d => { logs += d; });
    child.stderr.on('data', d => { logs += d; });
    const exited = new Promise(r => child.once('exit', r));
    if (await waitForHealth(`http://localhost:${port}/api/health`, 20000, exited)) {
      // Health answers before the database step finishes. Wait for "Config loaded", then give the
      // startup work that follows it (admin bootstrap) a moment, so tests never race the server.
      const until = Date.now() + 15000;
      while (!/Config loaded/.test(logs) && Date.now() < until) await sleep(100);
      await sleep(400);
      return {
        base: `http://localhost:${port}/api`,
        port,
        logs: () => logs,
        stop: async () => { child.kill(); await exited; },
      };
    }
    child.kill();
  }
  throw new Error('Could not start the test server');
}

// Always drop before the server starts, so the server creates its indexes on a clean database.
export async function connect(db) {
  await mongoose.connect(`${MONGO}/${db}`);
  await mongoose.connection.dropDatabase();
}
export async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export const day = n => new Date(Date.now() + n * 864e5);

const model = async name => (await import(pathToFileURL(path.join(backendDir, 'src', 'models', `${name}.js`)).href)).default;
export const models = async (...names) => Promise.all(names.map(model));

export async function tokenFor(user, isAdmin = false) {
  const { generateToken } = await import(pathToFileURL(path.join(backendDir, 'src', 'middleware', 'auth.js')).href);
  return generateToken(String(user._id), user.email, isAdmin);
}

// The admin account the middleware checks against. Created once per database.
export async function makeAdmin() {
  const [User] = await models('User');
  const admin = (await User.findOne({ email: 'admin@lifc.in' })) || (await User.create({ firstName: 'Ad', lastName: 'Min', email: 'admin@lifc.in', phone: 'admin-0', password: 'AdminPass123' }));
  return { user: admin, token: await tokenFor(admin, true) };
}

export function client(base) {
  return async (method, p, token, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let d;
    try { d = JSON.parse(text); } catch (e) { d = text; }
    return { s: res.status, d, headers: res.headers };
  };
}
