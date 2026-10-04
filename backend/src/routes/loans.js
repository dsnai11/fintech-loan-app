import express from 'express';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { screenLoan } from '../services/amlService.js';
import { getPolicy, computeQuote, checkRequest } from '../services/pricingPolicy.js';
import { renderClosureLetter } from '../services/closureLetter.js';

const PURPOSES = ['Personal', 'Business', 'Education', 'Medical', 'Other'];

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

    const namedPlan = planType && planType !== 'standard';
    if (!loanAmount || !purpose || (!tenure && !namedPlan)) {
      return res.status(400).json({ error: 'Loan amount, tenure, and purpose are required' });
    }
    if (!PURPOSES.includes(purpose)) return res.status(400).json({ error: `Purpose must be one of: ${PURPOSES.join(', ')}` });

    const policy = getPolicy();
    const request = { amount: Number(loanAmount), planType: planType || undefined, tenureMonths: tenure === undefined ? undefined : Number(tenure) };
    const problem = checkRequest(policy, request);
    if (problem) return res.status(400).json({ error: problem });
    const quote = computeQuote(policy, request);

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

    // Fees, EMI and tenure all come from the pricing policy (see services/pricingPolicy.js).
    const { processingFee, gst, netDisbursed: disbursedAmount, emi: monthlyEMI, tenureMonths: actualTenure } = quote;

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
      loanAmount: quote.amount,
      tenure: actualTenure,
      purpose,
      loanType: loanType || 'Personal Loan',
      interestRate: quote.interestRatePercent,
      monthlyEMI,
      totalAmount: quote.totalRepayable,
      status: 'submitted',
      planType: quote.planType !== 'standard' ? quote.planType : undefined,
      kfs: quote,
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
    await audit(req.user, 'LOAN_APPLIED', { type: 'Loan', id: loan._id }, { amount: loan.loanAmount, tenure: loan.tenure }, req);
    await screenLoan(loan, user);

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
        gstPercent: quote.gstPercent,
        aprPercent: quote.aprPercent,
        kfs: quote,
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
    if (!PURPOSES.includes(purpose)) return res.status(400).json({ error: `Purpose must be one of: ${PURPOSES.join(', ')}` });

    const policy = getPolicy();
    const request = { amount: Number(loanAmount), planType: 'standard', tenureMonths: Number(tenure) };
    const problem = checkRequest(policy, request);
    if (problem) return res.status(400).json({ error: problem });
    const quote = computeQuote(policy, request);

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const loan = new Loan({
      userId: req.user.userId,
      loanAmount: quote.amount,
      tenure: quote.tenureMonths,
      purpose,
      loanType: loanType || 'Personal Loan',
      interestRate: quote.interestRatePercent,
      monthlyEMI: quote.emi,
      totalAmount: quote.totalRepayable,
      kfs: quote,
      disbursalDetails: { disbursedAmount: quote.netDisbursed },
    });

    await loan.save();
    user.loanHistory.push(loan._id);
    await user.save();
    await audit(req.user, 'LOAN_APPLIED', { type: 'Loan', id: loan._id }, { amount: loan.loanAmount, tenure: loan.tenure }, req);
    await screenLoan(loan, user);

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
        disbursedAmount: quote.netDisbursed,
        processingFee: quote.processingFee,
        gst: quote.gst,
        gstPercent: quote.gstPercent,
        aprPercent: quote.aprPercent,
        kfs: quote,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Loan closure letter / no-dues certificate, for the borrower (or an admin) once the loan is closed
router.get('/:loanId/closure-letter', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId).catch(() => null);
    const isAdmin = req.user.isAdmin || String(req.user.email).toLowerCase() === (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
    if (!loan || (!isAdmin && String(loan.userId) !== String(req.user.userId))) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'closed') return res.status(400).json({ error: 'A closure letter is available once the loan is closed' });
    const user = await User.findById(loan.userId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderClosureLetter(loan, user));
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
