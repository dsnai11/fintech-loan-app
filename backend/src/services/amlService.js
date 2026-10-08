import AmlAlert from '../models/AmlAlert.js';
import WatchlistEntry from '../models/WatchlistEntry.js';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { audit } from './auditService.js';

const DAY = 24 * 60 * 60 * 1000;
const largeLoanThreshold = () => {
  const v = Number(process.env.AML_LARGE_LOAN);
  return Number.isFinite(v) && v > 0 ? v : 200000;
};

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
export const sameName = (a, b) => {
  const x = norm(a).sort().join(' ');
  const y = norm(b).sort().join(' ');
  return !!x && x === y;
};
// Tokens of the shorter name must all appear in the longer one ("Rahul Kumar" vs "Rahul Kumar Sharma").
export const namesCompatible = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x.length || !y.length) return false;
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  return small.every(t => big.includes(t));
};

// One open alert per rule + customer + loan, so re-running a check does not pile up duplicates.
export async function raise(rule, severity, user, loan, detail) {
  const filter = { rule, userId: user._id, status: 'OPEN', ...(loan ? { loanId: loan._id } : {}) };
  const existing = await AmlAlert.findOne(filter);
  if (existing) return existing;
  const alert = await AmlAlert.create({ rule, severity, userId: user._id, loanId: loan?._id, detail });
  await audit('system', 'AML_ALERT_RAISED', { type: 'AmlAlert', id: alert._id }, { rule, severity, userId: String(user._id), loanId: loan ? String(loan._id) : undefined });
  return alert;
}

export async function matchWatchlist(user) {
  const full = `${user.firstName} ${user.lastName}`;
  const entries = await WatchlistEntry.find({ active: true });
  return entries.filter(
    e =>
      (e.name && sameName(e.name, full)) ||
      (e.pan && user.panNumber && e.pan.toUpperCase() === user.panNumber.toUpperCase()) ||
      (e.phone && user.phone && e.phone === user.phone) ||
      (e.accountNumber && user.bankAccount?.accountNumber && e.accountNumber === user.bankAccount.accountNumber)
  );
}

// Runs when a loan is applied for. Never throws; screening must not stop an application from being saved.
export async function screenLoan(loan, user) {
  try {
    const hits = await matchWatchlist(user);
    for (const h of hits) {
      await raise('WATCHLIST_MATCH', 'HIGH', user, loan, `Matches watchlist entry (${h.source}${h.reason ? ': ' + h.reason : ''})`);
    }

    if (loan.loanAmount >= largeLoanThreshold()) {
      await raise('LARGE_LOAN', 'MEDIUM', user, loan, `Loan of Rs ${loan.loanAmount.toLocaleString('en-IN')} is at or above the Rs ${largeLoanThreshold().toLocaleString('en-IN')} review threshold`);
    }

    const recent = await Loan.countDocuments({ userId: user._id, createdAt: { $gte: new Date(Date.now() - DAY) } });
    if (recent >= 3) {
      await raise('RAPID_REAPPLICATION', 'MEDIUM', user, loan, `${recent} loan applications in the last 24 hours`);
    }

    const acct = user.bankAccount?.accountNumber;
    if (acct) {
      const others = await User.find({ _id: { $ne: user._id }, 'bankAccount.accountNumber': acct }).select('_id');
      if (others.length) {
        await raise('SHARED_BANK_ACCOUNT', 'HIGH', user, loan, `Same bank account is used by ${others.length} other customer account(s)`);
      }
    }
  } catch (e) {
    console.error('AML screening failed:', e.message);
  }
}

export async function flagEarlyClosure(loan, user) {
  try {
    const start = loan.disbursementDate;
    if (start && Date.now() - new Date(start).getTime() < 30 * DAY) {
      await raise('EARLY_CLOSURE', 'MEDIUM', user, loan, 'Loan was closed early within 30 days of disbursement');
    }
  } catch (e) {
    console.error('AML early-closure check failed:', e.message);
  }
}

export async function flagDuplicatePan(user, pan) {
  try {
    await raise('DUPLICATE_PAN', 'HIGH', user, null, `Tried to register a PAN that already belongs to another account (ends ${pan.slice(-4)})`);
  } catch (e) {
    console.error('AML duplicate-PAN flag failed:', e.message);
  }
}

export async function flagDuplicateAadhaar(user) {
  try {
    await raise('DUPLICATE_AADHAAR', 'HIGH', user, null, 'The Aadhaar details shared through DigiLocker belong to another account too');
  } catch (e) {
    console.error('AML duplicate-Aadhaar flag failed:', e.message);
  }
}

export async function flagNameMismatch(user, providerName) {
  try {
    await raise('KYC_NAME_MISMATCH', 'MEDIUM', user, null, `PAN holder name "${providerName}" does not match the account name "${user.firstName} ${user.lastName}"`);
  } catch (e) {
    console.error('AML name-mismatch flag failed:', e.message);
  }
}

export async function raiseWatchlistAlerts(entry) {
  const or = [];
  if (entry.pan) or.push({ panNumber: entry.pan });
  if (entry.phone) or.push({ phone: entry.phone });
  if (entry.accountNumber) or.push({ 'bankAccount.accountNumber': entry.accountNumber });
  const found = new Map();
  if (or.length) for (const u of await User.find({ $or: or })) found.set(String(u._id), u);
  if (entry.name) {
    for (const u of await User.find({}).select('firstName lastName').limit(5000)) {
      if (sameName(entry.name, `${u.firstName} ${u.lastName}`)) found.set(String(u._id), u);
    }
  }
  for (const u of found.values()) {
    await raise('WATCHLIST_MATCH', 'HIGH', u, null, `Matches watchlist entry (${entry.source}${entry.reason ? ': ' + entry.reason : ''})`);
  }
  return found.size;
}

export async function openHighAlerts(userId) {
  return AmlAlert.find({ userId, status: 'OPEN', severity: 'HIGH' });
}

export default { raiseWatchlistAlerts, screenLoan, flagEarlyClosure, flagDuplicatePan, flagDuplicateAadhaar, flagNameMismatch, openHighAlerts, matchWatchlist };
