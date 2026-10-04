import express from 'express';
import User from '../models/User.js';
import { generateToken } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { issueResetToken, consumeResetToken } from '../services/passwordReset.js';
import { sendPlainEmail } from '../services/notificationService.js';

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

// Always answers the same way, so it cannot be used to find out which emails are registered.
router.post('/forgot-password', async (req, res) => {
  const generic = { message: 'If that email is registered, we have sent a link to reset the password.' };
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    // One email a minute per account, so the form cannot be used to flood someone's inbox.
    const recent = user?.passwordResetRequestedAt && Date.now() - user.passwordResetRequestedAt.getTime() < 60 * 1000;
    if (user && (!user.status || user.status === 'active') && !recent) {
      const { link } = await issueResetToken(user._id, 60);
      const result = await sendPlainEmail(
        user.email,
        'Reset your LIFC password',
        `We got a request to reset your LIFC password.

Open this link within 1 hour to choose a new one:
${link}

If you did not ask for this, you can ignore this email. Your password has not changed.`
      );
      if (result !== 'sent') console.warn(`Password reset email for a customer was not sent (${result}). Email is not configured or failed.`);
      await audit({ email: user.email, role: 'customer' }, 'PASSWORD_RESET_REQUESTED', { type: 'User', id: user._id }, { emailStatus: result }, req);
    }
    res.json(generic);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 8 to 128 characters.' });
    }
    const user = await consumeResetToken(token, password);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please ask for a new one.' });

    await audit({ email: user.email, role: user.email === (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase() ? 'admin' : 'customer' }, 'PASSWORD_RESET_COMPLETED', { type: 'User', id: user._id }, {}, req);
    await sendPlainEmail(user.email, 'Your LIFC password was changed', 'Your LIFC password was just changed. If this was not you, contact support straight away.');
    res.json({ message: 'Password changed. You can now sign in.' });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
