import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { allowed, isStaffRole, ensureRoles, permissionsOf } from '../services/permissions.js';

const adminEmail = () => (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();

// A token is only good while its account exists, is active, and the password has not changed since it was issued.
async function check(decoded) {
  // A two-factor challenge token only proves the password was right. It is never a session.
  const expired = { problem: { status: 401, error: 'Your session has expired. Please sign in again.' } };
  if (decoded.purpose) return expired;
  if (!mongoose.isValidObjectId(decoded.userId)) return expired;
  const account = await User.findById(decoded.userId).select('email status passwordChangedAt role twoFactorEnabled');
  if (!account) return { problem: { status: 401, error: 'Account not found' } };
  if (account.status && account.status !== 'active') return { problem: { status: 403, error: 'Your account is not active. Please contact support.' } };
  if (account.passwordChangedAt && decoded.iat < Math.floor(account.passwordChangedAt.getTime() / 1000)) {
    return { problem: { status: 401, error: 'Your password was changed. Please sign in again.' } };
  }
  return { account };
}
const accountProblem = async decoded => (await check(decoded)).problem || null;

// The role comes from the database on every request, so removing or changing someone's role takes effect at once.
export const roleOf = account => (String(account.email).toLowerCase() === adminEmail() ? 'super_admin' : isStaffRole(account.role) ? account.role : null);

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Please sign in to continue' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const problem = await accountProblem(decoded);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
};

export const adminMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Please sign in to continue' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { problem, account } = await check(decoded);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    await ensureRoles();
    const role = roleOf(account);
    if (!role) return res.status(403).json({ error: 'Staff access required' });

    // Everyone except the super admin must have two-factor sign-in on before using the back office.
    if (role !== 'super_admin' && process.env.STAFF_REQUIRE_2FA !== 'false' && !account.twoFactorEnabled) {
      return res.status(403).json({ error: 'Turn on two-factor sign-in first (Compliance > My security), then sign in again.', code: '2FA_SETUP_REQUIRED' });
    }

    const verdict = allowed(role, req.method, req.baseUrl + req.path);
    if (!verdict.ok) return res.status(403).json({ error: 'Your role does not allow this action.', code: 'NOT_PERMITTED', needs: verdict.need });

    req.user = { ...decoded, isAdmin: true, role, permissions: permissionsOf(role) };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
};

export const generateToken = (userId, email, isAdmin = false) => {
  return jwt.sign({ userId, email, isAdmin }, process.env.JWT_SECRET, {
    expiresIn: isAdmin ? process.env.ADMIN_JWT_EXPIRE || '8h' : process.env.JWT_EXPIRE || '7d',
  });
};
