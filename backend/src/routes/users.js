import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { flagDuplicatePan } from '../services/amlService.js';

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
    if (panNumber) {
      const pan = String(panNumber).toUpperCase().trim();
      if (!/^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/.test(pan)) return res.status(400).json({ error: 'Invalid PAN format' });
      const current = await User.findById(req.user.userId);
      if (!current) return res.status(404).json({ error: 'User not found' });
      if (current.panNumber !== pan) {
        if (await User.exists({ panNumber: pan, _id: { $ne: current._id } })) {
          await flagDuplicatePan(current, pan);
          await audit(req.user, 'KYC_DUPLICATE_PAN', { type: 'User', id: current._id }, { panLast4: pan.slice(-4) }, req);
          return res.status(409).json({ error: 'This PAN is already registered to another account. Please contact support.' });
        }
        // Customers cannot approve their own KYC. A new PAN goes to review.
        update.panNumber = pan;
        update.kycStatus = 'pending';
        await audit(req.user, 'KYC_SUBMITTED', { type: 'User', id: current._id }, { mode: 'profile', kycStatus: 'pending' }, req);
      }
    }

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
