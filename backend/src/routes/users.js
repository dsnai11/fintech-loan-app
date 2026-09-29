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
    const { firstName, lastName, phone, dateOfBirth, gender, nationality, address, employment, bankAccount, panNumber } = req.body;

    const update = {};
    if (firstName !== undefined) update.firstName = firstName;
    if (lastName !== undefined) update.lastName = lastName;
    if (phone !== undefined) update.phone = phone;
    if (dateOfBirth !== undefined) update.dateOfBirth = dateOfBirth;
    if (gender !== undefined) update.gender = gender;
    if (nationality !== undefined) update.nationality = nationality;
    if (panNumber) { update.panNumber = panNumber.toUpperCase(); update.kycStatus = 'approved'; }

    // Use dot-notation for nested objects to merge rather than replace
    if (address && typeof address === 'object') {
      for (const [k, v] of Object.entries(address)) {
        if (v !== undefined) update[`address.${k}`] = v;
      }
    }
    if (employment && typeof employment === 'object') {
      for (const [k, v] of Object.entries(employment)) {
        if (v !== undefined) update[`employment.${k}`] = v;
      }
    }
    if (bankAccount && typeof bankAccount === 'object') {
      for (const [k, v] of Object.entries(bankAccount)) {
        if (v !== undefined) update[`bankAccount.${k}`] = v;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: update },
      { new: true, runValidators: false }
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
