import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!mongoose.isValidObjectId(decoded.userId)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const account = await User.findById(decoded.userId).select('status');
    if (!account) return res.status(401).json({ error: 'Account not found' });
    if (account.status && account.status !== 'active') {
      return res.status(403).json({ error: 'Your account is not active. Please contact support.' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const adminMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@lifc.in';
    if (decoded.email !== adminEmail && !decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const generateToken = (userId, email, isAdmin = false) => {
  return jwt.sign({ userId, email, isAdmin }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};
