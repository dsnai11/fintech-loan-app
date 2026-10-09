import express from 'express';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { adminMiddleware } from '../middleware/auth.js';
import PaymentService from '../services/paymentService.js';
import { notify, templates } from '../services/notificationService.js';
import { audit } from '../services/auditService.js';
import { openHighAlerts } from '../services/amlService.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// 📊 GET ALL LOANS (with filters)
// ═══════════════════════════════════════════════════════════════════

router.get('/', adminMiddleware, async (req, res) => {
  try {
    const { status, sortBy = '-createdAt' } = req.query;
    const filter = status ? { status } : {};
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const page = Math.max(1, Number(req.query.page) || 1);

    const loans = await Loan.find(filter)
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'firstName lastName email phone panNumber')
      .select('-bankDetails.accountNumber'); // Hide sensitive info

    // Transform loans: map loanAmount to amount for frontend compatibility
    const transformedLoans = loans.map(loan => ({
      ...loan.toObject(),
      amount: loan.loanAmount,
    }));

    // The total and the status counts come from one grouped read, instead of five separate counts per page view
    const byStatus = Object.fromEntries((await Loan.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map(r => [r._id, r.n]));
    const total = status ? (byStatus[status] || 0) : Object.values(byStatus).reduce((a, n) => a + n, 0);
    const approved = byStatus.approved || 0;
    const rejected = byStatus.rejected || 0;
    const underReview = byStatus.submitted || 0; // submitted = under review
    const disbursed = byStatus.disbursed || 0;

    res.json({
      loans: transformedLoans,
      total,
      page,
      pages: Math.ceil(total / limit),
      stats: { approved, rejected, underReview, disbursed },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 👁️ GET LOAN DETAILS
// ═══════════════════════════════════════════════════════════════════

router.get('/:loanId', adminMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId)
      .populate('userId', 'firstName lastName email phone dateOfBirth panNumber kycStatus');

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Calculate credit score
    const creditScore = await calculateCreditScore(loan.userId, loan);

    res.json({
      loan: { ...loan.toObject(), amount: loan.loanAmount },
      creditScore,
      riskAssessment: assessRisk(creditScore, loan),
      recommendation: generateRecommendation(creditScore, loan),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ✅ APPROVE LOAN
// ═══════════════════════════════════════════════════════════════════

router.post('/:loanId/approve', adminMiddleware, async (req, res) => {
  try {
    const { notes, conditions } = req.body;

    const loan = await Loan.findById(req.params.loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (!['submitted', 'under_review'].includes(loan.status)) {
      return res.status(400).json({ error: `Cannot approve a loan in status '${loan.status}'` });
    }

    const customer = await User.findById(loan.userId).select('kycStatus');
    if (process.env.REQUIRE_KYC_FOR_APPROVAL !== 'false' && customer?.kycStatus !== 'approved') {
      return res.status(409).json({ error: `Customer KYC is ${customer?.kycStatus || 'missing'}. Approve it under Compliance > KYC before approving the loan.` });
    }
    const alerts = await openHighAlerts(loan.userId);
    if (alerts.length) {
      return res.status(409).json({ error: `${alerts.length} open high-severity AML alert(s) on this customer must be reviewed first (Compliance > AML).` });
    }

    loan.status = 'approved';
    loan.approvedBy = req.user.email;
    loan.approvalDate = new Date();
    loan.approvalNotes = notes || '';

    await loan.save();
    await audit(req.user, 'LOAN_APPROVED', { type: 'Loan', id: loan._id }, { amount: loan.loanAmount, notes: loan.approvalNotes }, req);
    await notify(loan.userId, templates.approved(loan), { sms: true });

    // Send approval notification to user
    console.log(`✅ Loan ${loan._id} approved by ${req.user.email}`);

    res.json({
      message: 'Loan approved successfully',
      loan,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ❌ REJECT LOAN
// ═══════════════════════════════════════════════════════════════════

router.post('/:loanId/reject', adminMiddleware, async (req, res) => {
  try {
    const { reason, notes } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const loan = await Loan.findById(req.params.loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (!['submitted', 'under_review'].includes(loan.status)) {
      return res.status(400).json({ error: `Cannot reject a loan in status '${loan.status}'` });
    }

    loan.status = 'rejected';
    loan.rejectedBy = req.user.email;
    loan.rejectionReason = reason;
    loan.rejectionNotes = notes || '';

    await loan.save();
    await audit(req.user, 'LOAN_REJECTED', { type: 'Loan', id: loan._id }, { reason }, req);
    await notify(loan.userId, templates.rejected(loan, reason), { sms: true });

    // Send rejection notification to user
    console.log(`❌ Loan ${loan._id} rejected by ${req.user.email}`);

    res.json({
      message: 'Loan rejected',
      loan,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 💰 DISBURSE LOAN (Transfer funds to customer)
// ═══════════════════════════════════════════════════════════════════

router.post('/:loanId/disburse', adminMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId).populate('userId');
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'approved') {
      return res.status(400).json({
        error: 'Only approved loans can be disbursed',
      });
    }

    {
      const { getPolicy: gp } = await import('../services/pricingPolicy.js');
      if (gp().controls.fourEyesDisbursal && loan.approvedBy && loan.approvedBy === req.user.email) {
        return res.status(403).json({ error: 'Four-eyes rule: a different person must release this payout. You approved this loan.', code: 'FOUR_EYES' });
      }
    }
    {
      const { required, isVerified } = await import('../services/bankVerifyService.js');
      if (required() && !isVerified(loan.userId)) return res.status(409).json({ error: 'The customer\'s bank account has not been verified, so the money cannot be sent yet. Ask them to check it in the app, or verify it by hand on their record.', code: 'BANK_NOT_VERIFIED' });
    }
    const result = await PaymentService.initiateTransfer(loan._id, loan, req.user.email);

    res.json({
      message: result.status === 'COMPLETED' ? 'Loan disbursed successfully' : 'Disbursement initiated',
      status: result.status,
      transactionId: result.transferId,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📊 AUTO-SCORING LOGIC
// ═══════════════════════════════════════════════════════════════════

async function calculateCreditScore(userId, loan) {
  try {
    const user = await User.findById(userId);
    if (!user) return 300; // Default low score

    let score = 300; // Base score

    // KYC Status (max 200 points)
    if (user.kycStatus === 'approved') {
      score += 200;
    } else if (user.kycStatus === 'pending') {
      score += 50;
    }

    // PAN Verification (max 150 points)
    if (user.panNumber) {
      score += 150;
    }

    // Bank Account Verification (max 150 points)
    if (user.bankAccount?.accountNumber) {
      score += 150;
    }

    // Phone Verification (max 100 points)
    if (user.phoneVerified) {
      score += 100;
    }

    // Employment Status (max 200 points)
    const emp = user.employment?.status;
    if (emp === 'Employed') {
      score += 200;
    } else if (emp === 'Self-Employed') {
      score += 150;
    } else if (emp === 'Student') {
      score += 50;
    }

    // Monthly Income (max 100 points)
    const income = user.employment?.monthlyIncome || 0;
    if (income >= 100000) {
      score += 100;
    } else if (income >= 50000) {
      score += 75;
    } else if (income >= 25000) {
      score += 50;
    }

    // Loan Amount vs Income (max 100 points)
    if (income > 0 && loan.loanAmount) {
      const ratio = loan.loanAmount / income;
      if (ratio <= 3) {
        score += 100; // Conservative
      } else if (ratio <= 6) {
        score += 50; // Moderate
      }
    }

    // Cap at 900 (CIBIL max)
    return Math.min(score, 900);
  } catch (e) {
    console.error('Error calculating credit score:', e);
    return 300;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 RISK ASSESSMENT
// ═══════════════════════════════════════════════════════════════════

function assessRisk(score, loan) {
  if (score >= 750) {
    return { level: 'Low', color: 'green', riskMultiplier: 0.8 };
  } else if (score >= 650) {
    return { level: 'Medium', color: 'yellow', riskMultiplier: 1.0 };
  } else if (score >= 550) {
    return { level: 'High', color: 'orange', riskMultiplier: 1.2 };
  } else {
    return { level: 'Very High', color: 'red', riskMultiplier: 1.5 };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 💡 AUTO RECOMMENDATION
// ═══════════════════════════════════════════════════════════════════

function generateRecommendation(score, loan) {
  if (score >= 750) {
    return {
      recommendation: 'APPROVE',
      reason: 'Excellent credit profile',
      confidence: '95%',
    };
  } else if (score >= 650) {
    return {
      recommendation: 'APPROVE',
      reason: 'Good credit profile with conditions',
      confidence: '85%',
      suggestedConditions: [
        'Higher interest rate (18% instead of 15%)',
        'Smaller loan amount',
        'Shorter tenure',
      ],
    };
  } else if (score >= 550) {
    return {
      recommendation: 'REVIEW',
      reason: 'Moderate risk - requires manual review',
      confidence: '60%',
      suggestedConditions: [
        'Require co-signer',
        'Collateral/security deposit',
        'Higher interest rate (20%)',
      ],
    };
  } else {
    return {
      recommendation: 'REJECT',
      reason: 'Credit score too low',
      confidence: '90%',
      suggestedAction: 'Recommend customer improve KYC and reapply',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📊 DASHBOARD ANALYTICS
// ═══════════════════════════════════════════════════════════════════

router.get('/analytics/summary', adminMiddleware, async (req, res) => {
  try {
    const total = await Loan.countDocuments();
    const approved = await Loan.countDocuments({ status: 'approved' });
    const rejected = await Loan.countDocuments({ status: 'rejected' });
    const underReview = await Loan.countDocuments({ status: { $in: ['submitted', 'under_review'] } });
    const disbursed = await Loan.countDocuments({ status: { $in: ['disbursed', 'closed'] } });

    const totalAmount = await Loan.aggregate([
      { $match: { status: { $in: ['disbursed', 'closed'] } } },
      { $group: { _id: null, total: { $sum: '$loanAmount' } } },
    ]);

    const avgAmount =
      total > 0
        ? (await Loan.aggregate([
            { $group: { _id: null, avg: { $avg: '$loanAmount' } } },
          ]))[0]?.avg || 0
        : 0;

    const approvalRate =
      total > 0 ? ((approved + disbursed) / total * 100).toFixed(2) : 0;

    res.json({
      total,
      approved,
      rejected,
      underReview,
      disbursed,
      totalDisbursedAmount: totalAmount[0]?.total || 0,
      averageLoanAmount: Math.round(avgAmount),
      approvalRate: `${approvalRate}%`,
      pendingApprovals: underReview,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
