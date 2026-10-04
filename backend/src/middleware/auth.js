import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';

// A token is only good while its account exists, is active, and the password has not changed since it was issued.
async function accountProblem(decoded) {
  // A two-factor challenge token only proves the password was right. It is never a session.
  if (decoded.purpose) return { status: 401, error: 'Invalid token' };
  if (!mongoose.isValidObjectId(decoded.userId)) return { status: 401, error: 'Invalid token' };
  const account = await User.findById(decoded.userId).select('status passwordChangedAt');
  if (!account) return { status: 401, error: 'Account not found' };
  if (account.status && account.status !== 'active') return { status: 403, error: 'Your account is not active. Please contact support.' };
  if (account.passwordChangedAt && decoded.iat < Math.floor(account.passwordChangedAt.getTime() / 1000)) {
    return { status: 401, error: 'Your password was changed. Please sign in again.' };
  }
  return null;
}

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const problem = await accountProblem(decoded);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const adminMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose) return res.status(401).json({ error: 'Invalid token' });
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
    if (String(decoded.email).toLowerCase() !== adminEmail && !decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const problem = await accountProblem(decoded);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const generateToken = (userId, email, isAdmin = false) => {
  return jwt.sign({ userId, email, isAdmin }, process.env.JWT_SECRET, {
    expiresIn: isAdmin ? process.env.ADMIN_JWT_EXPIRE || '12h' : process.env.JWT_EXPIRE || '7d',
  });
};
