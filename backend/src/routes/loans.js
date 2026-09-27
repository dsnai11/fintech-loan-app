import express from 'express';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Submit full loan application (from the 7-step flow)
router.post('/apply-full', authMiddleware, async (req, res) => {
  try {
    const {
      loanAmount,
      tenure,
      purpose,
      loanType,
      planType, // 'one_time' | '3_emi' | '6_emi'
      bankDetails, // { accountHolder, accountNumber, ifscCode }
      personalDetails, // { pincode, gender, address, email }
    } = req.body;

    if (!loanAmount || !tenure || !purpose) {
      return res.status(400).json({ error: 'Loan amount, tenure, and purpose are required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update user profile with personal + bank details
    if (personalDetails) {
      user.gender = personalDetails.gender || user.gender;
      if (personalDetails.address) {
        user.address = { street: personalDetails.address, zipCode: personalDetails.pincode };
      }
    }
    if (bankDetails) {
      user.bankAccount = {
        accountNumber: bankDetails.accountNumber,
        ifscCode: bankDetails.ifscCode,
        accountHolder: bankDetails.accountHolder || `${user.firstName} ${user.lastName}`,
        bankName: _inferBankName(bankDetails.ifscCode),
      };
    }

    const processingFee = Math.round(loanAmount * 0.025); // 2.5% processing fee
    const gst = Math.round(processingFee * 0.18);
    const disbursedAmount = loanAmount - processingFee - gst;

    // Calculate EMI based on plan
    let monthlyEMI = 0;
    let actualTenure = tenure;
    const rate = 15 / 12 / 100;
    if (planType === 'one_time') {
      monthlyEMI = loanAmount; // full amount in one go
      actualTenure = 1;
    } else if (planType === '3_emi') {
      actualTenure = 3;
      monthlyEMI = Math.round((loanAmount * 1.05) / 3); // 5% interest
    } else if (planType === '6_emi') {
      actualTenure = 6;
      monthlyEMI = Math.round((loanAmount * 1.09) / 6); // 9% interest
    } else {
      // standard EMI formula
      monthlyEMI = Math.round(
        (loanAmount * rate * Math.pow(1 + rate, actualTenure)) /
          (Math.pow(1 + rate, actualTenure) - 1)
      );
    }

    // Build repayment schedule
    const repaymentHistory = [];
    const startDate = new Date();
    for (let i = 1; i <= actualTenure; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      repaymentHistory.push({
        month: i,
        emiAmount: monthlyEMI,
        paidAmount: 0,
        status: 'pending',
        dueDate,
      });
    }

    const loan = new Loan({
      userId: req.user.userId,
      loanAmount,
      tenure: actualTenure,
      purpose,
      loanType: loanType || 'Personal Loan',
      interestRate: planType === 'one_time' ? 0 : planType === '3_emi' ? 5 : planType === '6_emi' ? 9 : 15,
      monthlyEMI,
      totalAmount: monthlyEMI * actualTenure,
      status: 'submitted',
      disbursalDetails: {
        accountNumber: bankDetails?.accountNumber || '',
        bankName: _inferBankName(bankDetails?.ifscCode),
        disbursedAmount,
      },
      repaymentHistory,
    });

    await loan.save();
    user.loanHistory.push(loan._id);
    await user.save();

    res.status(201).json({
      message: 'Loan application submitted successfully',
      loan: {
        id: loan._id,
        loanAmount: loan.loanAmount,
        tenure: loan.tenure,
        monthlyEMI: loan.monthlyEMI,
        totalAmount: loan.totalAmount,
        status: loan.status,
        interestRate: loan.interestRate,
        disbursedAmount,
        processingFee,
        gst,
        repaymentSchedule: repaymentHistory.map((r) => ({
          month: r.month,
          dueDate: r.dueDate,
          amount: r.emiAmount,
          status: r.status,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy apply endpoint
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const { loanAmount, tenure, purpose, loanType } = req.body;

    if (!loanAmount || !tenure || !purpose) {
      return res.status(400).json({ error: 'Loan amount, tenure, and purpose are required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const loan = new Loan({
      userId: req.user.userId,
      loanAmount,
      tenure,
      purpose,
      loanType: loanType || 'Personal Loan',
      interestRate: process.env.DEFAULT_INTEREST_RATE || 15,
    });

    loan.monthlyEMI = loan.calculateEMI();
    loan.totalAmount = loan.monthlyEMI * tenure;

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

// Get all loans for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user.userId })
      .select('-repaymentHistory')
      .sort({ createdAt: -1 });
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single loan with repayment schedule
router.get('/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json(loan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function _inferBankName(ifsc) {
  if (!ifsc) return 'Unknown Bank';
  const code = ifsc.substring(0, 4).toUpperCase();
  const banks = {
    SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank',
    AXIS: 'Axis Bank', KKBK: 'Kotak Mahindra Bank', PUNB: 'Punjab National Bank',
    BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India',
    IOBA: 'Indian Overseas Bank',
  };
  return banks[code] || 'Unknown Bank';
}

export default router;
