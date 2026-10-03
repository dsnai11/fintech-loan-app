import express from 'express';
import User from '../models/User.js';
import { generateToken } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';

const router = express.Router();

router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, phone, password, confirmPassword } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Email or phone already registered' });
    }

    const user = new User({
      firstName,
      lastName,
      email,
      phone,
      password,
    });

    await user.save();
    const token = generateToken(user._id, user.email);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    // Stored emails are lowercase; phones love to capitalise the first letter or add a trailing space.
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isPasswordMatch = await user.comparePassword(password);
    if (!isPasswordMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
    const isAdmin = user.email === adminEmail;
    const token = generateToken(user._id, user.email, isAdmin);
    if (isAdmin) await audit({ email: user.email, role: 'admin' }, 'ADMIN_LOGIN', { type: 'User', id: user._id }, {}, req);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
