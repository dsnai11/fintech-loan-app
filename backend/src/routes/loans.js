import express from 'express';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const { loanAmount, tenure, purpose, loanType } = req.body;

    if (!loanAmount || !tenure || !purpose) {
      return res.status(400).json({ error: 'Loan amount, tenure, and purpose are required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const loan = new Loan({
      userId: req.user.userId,
      loanAmount,
      tenure,
      purpose,
      loanType: loanType || 'Personal Loan',
      interestRate: process.env.DEFAULT_INTEREST_RATE || 15,
    });

    const emiAmount = loan.calculateEMI();
    loan.monthlyEMI = emiAmount;
    loan.totalAmount = emiAmount * tenure;

    await loan.save();
    user.loanHistory.push(loan._id);
    await user.save();

    res.status(201).json({
      message: 'Loan application submitted',
      loan: {
        id: loan._id,
        loanAmount: loan.loanAmount,
        tenure: loan.tenure,
        monthlyEMI: loan.monthlyEMI,
        totalAmount: loan.totalAmount,
        status: loan.status,
        interestRate: loan.interestRate,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId).populate('userId', 'firstName lastName email');

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.userId._id.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json(loan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user.userId }).select('-repaymentHistory');

    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
