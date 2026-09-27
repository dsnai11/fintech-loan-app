import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { firstName, lastName, phone, dateOfBirth, gender, nationality, address, employment, bankAccount, panNumber, kycStatus } = req.body;

    const update = { firstName, lastName, phone, dateOfBirth, gender, nationality, address, employment, bankAccount };
    if (panNumber) { update.panNumber = panNumber.toUpperCase(); update.kycStatus = 'approved'; }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      update,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      user,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
