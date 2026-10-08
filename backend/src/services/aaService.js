import AaSession from '../models/AaSession.js';
import User from '../models/User.js';
import { getConfig } from './configService.js';
import { baseUrl } from './passwordReset.js';
import { audit } from './auditService.js';

// Income checks from bank statements, shared by the customer through the Account Aggregator (AA) network.
//
// The customer approves a consent at their bank or AA app; the statements come to us through an AA provider (a licensed
// Financial Information User partner such as Finvu, OneMoney, Setu or Perfios). We read them once, keep only a SUMMARY on
// the customer (income seen, bounced payments, monthly loan repayments, average balance) and throw the statements away.
// The customer can withdraw and delete the summary any time.
//
// A real provider's adapter is registered in PROVIDERS once the lender has an account:
//   { start({ user, session, redirectUrl }) -> { providerRef, url },
//     fetch({ session }) -> { bank?, transactions: [{ date, amount, type: 'CREDIT'|'DEBIT', narration, balance? }] } }
// Until then, outside production, a test mode runs the whole journey with a stand-in consent page and made-up statements.
// Test results are labelled as test data. In production with no provider the feature says it is not available.

const DAY = 864e5;
const SESSION_MINUTES = 20;
const SESSIONS_PER_HOUR = 5;

export const PROVIDERS = {};
export const providerName = () => getConfig('AA_PROVIDER') || '';
const realProvider = () => PROVIDERS[providerName()] || null;
export const sandboxAllowed = () => !realProvider() && process.env.PAYMENT_MODE !== 'PRODUCTION';
export const modeNow = () => (realProvider() ? 'aa' : sandboxAllowed() ? 'sandbox' : 'unavailable');
const fail = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) });

// ── Reading the statements ───────────────────────────────────────────────────────────────────
const SALARY = /salary|\bsal\b|payroll|wages|stipend/i;
const OBLIGATION = /\bemi\b|loan|nach|ecs|\bach\b|instalment|installment|repayment|mandate/i;
const BOUNCE = /bounce|return|insufficient|dishonou?r|\bchq ret|\bchrg.*ret|nach ret|ecs ret/i;
const monthKey = d => d.getUTCFullYear() * 12 + d.getUTCMonth();
const median = list => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = n => Math.round(n);

export function analyse(transactions) {
  const t = (Array.isArray(transactions) ? transactions : [])
    .map(x => ({ d: new Date(x.date), amt: Math.abs(Number(x.amount)), type: String(x.type).toUpperCase(), text: String(x.narration || ''), bal: x.balance === undefined || x.balance === null ? null : Number(x.balance) }))
    .filter(x => !Number.isNaN(x.d.getTime()) && Number.isFinite(x.amt) && x.amt > 0 && (x.type === 'CREDIT' || x.type === 'DEBIT'));
  if (!t.length) return null;
  const months = new Set(t.map(x => monthKey(x.d)));
  const count = months.size;
  const credits = t.filter(x => x.type === 'CREDIT'), debits = t.filter(x => x.type === 'DEBIT');

  const sumByMonth = list => { const m = new Map(); for (const x of list) m.set(monthKey(x.d), (m.get(monthKey(x.d)) || 0) + x.amt); return m; };
  const creditMonths = sumByMonth(credits);

  // Salary: credits that say so, or one large credit every month of about the same size
  const namedSalary = credits.filter(x => SALARY.test(x.text));
  const largest = new Map();
  for (const x of credits) if (!largest.get(monthKey(x.d)) || x.amt > largest.get(monthKey(x.d)).amt) largest.set(monthKey(x.d), x);
  const med = median([...largest.values()].map(x => x.amt));
  const steady = [...largest.values()].filter(x => x.amt >= 3000 && Math.abs(x.amt - med) <= 0.2 * med);
  const namedMonths = new Set(namedSalary.map(x => monthKey(x.d)));
  const need = Math.max(2, Math.ceil(count / 2));
  let salaryRows = [];
  if (namedMonths.size >= need) salaryRows = namedSalary;
  else if (steady.length >= Math.max(3, need)) salaryRows = steady;
  const salaryByMonth = sumByMonth(salaryRows);
  const salaryDetected = salaryRows.length > 0;

  const obligations = debits.filter(x => OBLIGATION.test(x.text) && !BOUNCE.test(x.text));
  const obligationMonths = sumByMonth(obligations);
  const balances = t.map(x => x.bal).filter(b => b !== null && Number.isFinite(b));
  const dates = t.map(x => x.d.getTime());
  return {
    months: count,
    from: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    to: new Date(Math.max(...dates)).toISOString().slice(0, 10),
    entries: t.length,
    avgMonthlyCredits: round([...creditMonths.values()].reduce((a, b) => a + b, 0) / count),
    salaryDetected,
    estimatedMonthlyIncome: salaryDetected ? round(median([...salaryByMonth.values()])) : null,
    incomeStabilityPercent: salaryDetected ? Math.round((salaryByMonth.size / count) * 100) : 0,
    monthlyObligations: round(median([...obligationMonths.values()])),
    bounces: debits.filter(x => BOUNCE.test(x.text)).length,
    avgBalance: balances.length ? round(balances.reduce((a, b) => a + b, 0) / balances.length) : null,
    minBalance: balances.length ? round(Math.min(...balances)) : null,
    lowBalancePercent: balances.length ? Math.round((balances.filter(b => b < 1000).length / balances.length) * 100) : null,
  };
}

// Made-up statements for test mode. `profile` chooses the story the tester wants to see.
export function sampleStatement(profile, salary = 40000, now = new Date()) {
  const rows = [];
  let bal = Math.round(salary * 0.3);
  const push = (date, amount, type, narration) => {
    bal += type === 'CREDIT' ? amount : -amount;
    rows.push({ date, amount, type, narration, balance: Math.max(bal, 0) });
  };
  for (let i = 5; i >= 0; i--) {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const at = d => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), d)).toISOString();
    if (profile === 'irregular') {
      const amounts = [14000, 52000, 8000, 31000, 19000, 44000];
      push(at(4 + (i % 3) * 5), amounts[i], 'CREDIT', 'UPI/CR/customer payment');
      push(at(12), 6500, 'DEBIT', 'UPI/DR/rent');
      push(at(20), 4200, 'DEBIT', 'POS/grocery');
    } else {
      push(at(2), salary, 'CREDIT', 'NEFT/SALARY/ACME PRIVATE LIMITED');
      push(at(5), Math.round(salary * 0.25), 'DEBIT', 'NACH/DR/HOME LOAN EMI');
      push(at(9), Math.round(salary * 0.15), 'DEBIT', 'UPI/DR/rent');
      push(at(18), Math.round(salary * 0.2), 'DEBIT', 'POS/shopping');
      if (profile === 'stressed') {
        push(at(7), 750, 'DEBIT', 'NACH RETURN CHARGES - insufficient funds');
        if (i % 2 === 0) push(at(22), 750, 'DEBIT', 'ECS RET CHARGES - insufficient funds');
        bal = Math.round(salary * 0.02);
        rows[rows.length - 1].balance = bal;
      }
    }
  }
  return { bank: 'Test Bank', transactions: rows };
}

// ── Journey ──────────────────────────────────────────────────────────────────────────────────
export async function startSession(user) {
  const mode = modeNow();
  if (mode === 'unavailable') return fail(503, 'Sharing bank statements is not available right now.', 'UNAVAILABLE');
  const recent = await AaSession.countDocuments({ userId: user._id, createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } });
  if (recent >= SESSIONS_PER_HOUR) return fail(429, 'You have tried a lot of times in the last hour. Please wait a little and try again.');
  const now = Date.now();
  const session = await AaSession.create({ userId: user._id, mode, expiresAt: new Date(now + SESSION_MINUTES * 60000), deleteAt: new Date(now + 24 * 3600 * 1000) });
  let url;
  if (mode === 'aa') {
    const started = await realProvider().start({ user, session, redirectUrl: `${baseUrl()}/api/income-check/callback?session=${session._id}` });
    session.providerRef = started.providerRef;
    await session.save();
    url = started.url;
  } else {
    url = `${baseUrl()}/api/income-check/sandbox/${session._id}`;
  }
  await audit({ email: user.email, role: 'customer' }, 'INCOME_CHECK_STARTED', { type: 'User', id: user._id }, { mode }, null);
  return { ok: true, session, url, mode, expiresInSeconds: SESSION_MINUTES * 60 };
}

// Reads the statements, keeps the summary on the customer, and forgets the statements.
export async function completeSession(session, statement, req = null) {
  const user = await User.findById(session.userId);
  if (!user) return fail(404, 'Account not found');
  const summary = analyse(statement?.transactions);
  if (!summary) {
    session.status = 'failed';
    session.result = { error: 'No statement could be read' };
    await session.save();
    return fail(422, 'We could not read any transactions from your bank.');
  }
  user.incomeCheck = { ...summary, at: new Date(), mode: session.mode, bank: String(statement.bank || '').slice(0, 60) };
  user.markModified('incomeCheck');
  await user.save();
  session.status = 'completed';
  session.result = view(user.incomeCheck);
  await session.save();
  await audit({ email: user.email, role: 'customer' }, 'INCOME_CHECK_DONE', { type: 'User', id: user._id }, { mode: session.mode, months: summary.months, salaryDetected: summary.salaryDetected }, req);
  return { ok: true, summary: user.incomeCheck };
}

export async function finishWithProvider(session, req = null) {
  const p = realProvider();
  if (!p || session.mode !== 'aa') return fail(400, 'This session is not an Account Aggregator session');
  try {
    return await completeSession(session, await p.fetch({ session }), req);
  } catch (e) {
    session.status = 'failed';
    session.result = { error: String(e.message).slice(0, 120) };
    await session.save();
    return fail(502, 'We could not get your bank statements. Please try again.');
  }
}

// The monthly income to rely on, and where it came from
export function incomeBasis(user) {
  const c = user?.incomeCheck;
  const fresh = c && c.at && Date.now() - new Date(c.at).getTime() <= 90 * DAY;
  if (fresh && c.estimatedMonthlyIncome > 0) return { amount: c.estimatedMonthlyIncome, source: 'bank statements' };
  const declared = user?.employment?.monthlyIncome || 0;
  return declared > 0 ? { amount: declared, source: 'declared' } : { amount: 0, source: 'none' };
}

export async function withdraw(user, req = null) {
  if (!user.incomeCheck) return false;
  user.incomeCheck = undefined;
  user.markModified('incomeCheck');
  await user.save();
  await audit({ email: user.email, role: 'customer' }, 'INCOME_CHECK_WITHDRAWN', { type: 'User', id: user._id }, {}, req);
  return true;
}

// What staff and the customer are shown
export function view(c) {
  if (!c) return null;
  return {
    at: c.at, mode: c.mode, bank: c.bank || '', months: c.months, from: c.from, to: c.to,
    salaryDetected: !!c.salaryDetected, estimatedMonthlyIncome: c.estimatedMonthlyIncome, avgMonthlyCredits: c.avgMonthlyCredits, incomeStabilityPercent: c.incomeStabilityPercent,
    monthlyObligations: c.monthlyObligations, bounces: c.bounces, avgBalance: c.avgBalance, minBalance: c.minBalance, lowBalancePercent: c.lowBalancePercent,
    stale: !!c.at && Date.now() - new Date(c.at).getTime() > 90 * DAY,
  };
}

export default { analyse, sampleStatement, startSession, completeSession, finishWithProvider, withdraw, view, modeNow, PROVIDERS };
