import express from 'express';
import Loan from '../models/Loan.js';
import Transaction from '../models/Transaction.js';
import { adminMiddleware } from '../middleware/auth.js';
import PaymentService from '../services/paymentService.js';
import crypto from 'crypto';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// 💰 INITIATE DISBURSEMENT (Admin only)
// ═══════════════════════════════════════════════════════════════════

router.post('/disburse/:loanId', adminMiddleware, async (req, res) => {
  try {
    const { loanId } = req.params;
    const loan = await Loan.findById(loanId).populate('userId');

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'Approved') {
      return res.status(400).json({
        error: 'Only approved loans can be disbursed',
        currentStatus: loan.status,
      });
    }

    if (loan.disbursed) {
      return res.status(400).json({ error: 'Loan already disbursed' });
    }

    if (!loan.bankDetails?.accountNumber) {
      return res.status(400).json({ error: 'Bank details not verified' });
    }

    // Initiate payment transfer
    const result = await PaymentService.initiateTransfer(loanId, loan);

    res.json({
      message: 'Disbursement initiated',
      transactionId: result.transactionId,
      transferId: result.transferId,
      status: result.status,
      amount: result.amount,
      estimatedTime: result.status === 'processing' ? '1-2 hours (NEFT)' : 'Instant',
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: 'Disbursement initiation failed',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ✅ CHECK DISBURSEMENT STATUS
// ═══════════════════════════════════════════════════════════════════

router.get('/status/:loanId', adminMiddleware, async (req, res) => {
  try {
    const { loanId } = req.params;

    const transaction = await Transaction.findOne({
      loanId,
      type: 'DISBURSEMENT',
    });

    if (!transaction) {
      return res.status(404).json({ error: 'No disbursement found for this loan' });
    }

    // If in progress, check current status
    if (transaction.status === 'PROCESSING' && transaction.transferId) {
      try {
        const status = await PaymentService.checkTransferStatus(transaction.transferId);
        const updated = await PaymentService.verifyAndUpdateTransaction(loanId, transaction.transferId);
        return res.json(updated);
      } catch (checkError) {
        console.error('Error checking status:', checkError.message);
        // Return cached status
      }
    }

    res.json({
      loanId,
      transactionId: transaction._id,
      type: transaction.type,
      amount: transaction.amount,
      status: transaction.status,
      bankDetails: transaction.bankDetails,
      createdAt: transaction.createdAt,
      completedAt: transaction.metadata?.completedAt,
      failureReason: transaction.metadata?.failureReason,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📊 GET TRANSACTION HISTORY (User)
// ═══════════════════════════════════════════════════════════════════

router.get('/history', async (req, res) => {
  try {
    const userId = req.user?.id || req.query.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .populate('loanId', 'amount tenure status')
      .select('-metadata.razorpayResponse'); // Hide sensitive data

    res.json({
      total: transactions.length,
      transactions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🔔 RAZORPAY WEBHOOK (Handle payment confirmations)
// ═══════════════════════════════════════════════════════════════════

router.post('/webhook/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Process webhook
    const result = await PaymentService.handlePayoutWebhook(req.body);

    res.json({
      status: 'ok',
      message: 'Webhook processed',
      result,
    });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📈 PAYMENT ANALYTICS
// ═══════════════════════════════════════════════════════════════════

router.get('/analytics/summary', adminMiddleware, async (req, res) => {
  try {
    const totalDisbursed = await Transaction.aggregate([
      { $match: { type: 'DISBURSEMENT', status: 'COMPLETED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const disbursementStats = await Transaction.aggregate([
      { $match: { type: 'DISBURSEMENT' } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const avgDisbursementTime = await Transaction.aggregate([
      {
        $match: {
          type: 'DISBURSEMENT',
          status: 'COMPLETED',
          'metadata.completedAt': { $exists: true },
        },
      },
      {
        $group: {
          _id: null,
          avgTimeMs: {
            $avg: {
              $subtract: ['$metadata.completedAt', '$createdAt'],
            },
          },
        },
      },
    ]);

    const failureRate =
      disbursementStats.length > 0
        ? (disbursementStats.find((s) => s._id === 'FAILED')?.count || 0) /
          disbursementStats.reduce((sum, s) => sum + s.count, 0) *
          100
        : 0;

    res.json({
      totalDisbursed: totalDisbursed[0]?.total || 0,
      disbursementStats: Object.fromEntries(
        disbursementStats.map((s) => [
          s._id,
          { count: s.count, amount: s.totalAmount },
        ])
      ),
      avgDisbursementTimeMinutes:
        avgDisbursementTime[0]?.avgTimeMs / 1000 / 60 || 0,
      failureRate: failureRate.toFixed(2) + '%',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🔄 RETRY FAILED DISBURSEMENT
// ═══════════════════════════════════════════════════════════════════

router.post('/retry/:loanId', adminMiddleware, async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findById(loanId).populate('userId');
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'Approved') {
      return res.status(400).json({
        error: 'Only approved loans can be retried',
      });
    }

    // Check if there's a failed transaction
    const failedTransaction = await Transaction.findOne({
      loanId,
      type: 'DISBURSEMENT',
      status: 'FAILED',
    });

    if (!failedTransaction) {
      return res.status(400).json({
        error: 'No failed disbursement found for this loan',
      });
    }

    // Retry disbursement
    const result = await PaymentService.initiateTransfer(loanId, loan);

    res.json({
      message: 'Disbursement retry initiated',
      transactionId: result.transactionId,
      transferId: result.transferId,
      status: result.status,
      amount: result.amount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
