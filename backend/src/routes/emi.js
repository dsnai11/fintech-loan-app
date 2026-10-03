import express from 'express';
import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import { adminMiddleware } from '../middleware/auth.js';
import EMIService from '../services/emiService.js';
import crypto from 'crypto';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// 📅 GET EMI SCHEDULE (Customer)
// ═══════════════════════════════════════════════════════════════════

router.get('/schedule/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;
    const { emis, stats } = await EMIService.getEMISchedule(loanId);

    res.json({
      loanId,
      emis: emis.map(emi => ({
        emiNumber: emi.emiNumber,
        dueDate: emi.dueDate,
        amount: emi.amount,
        principalAmount: emi.principalAmount,
        interestAmount: emi.interestAmount,
        status: emi.status,
        paidDate: emi.paidDate,
        paidAmount: emi.paidAmount,
        daysOverdue: emi.daysOverdue,
        penaltyApplied: emi.penaltyApplied,
      })),
      stats,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 💳 INITIATE EMI PAYMENT (Customer)
// ═══════════════════════════════════════════════════════════════════

router.post('/initiate/:loanId/:emiNumber', async (req, res) => {
  try {
    const { loanId, emiNumber } = req.params;
    const userId = req.user?.id || req.query.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await EMIService.initiateEMIPayment(loanId, parseInt(emiNumber), userId);

    res.json({
      message: 'EMI payment initiated',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🔔 EMI PAYMENT WEBHOOK (Razorpay)
// ═══════════════════════════════════════════════════════════════════

router.post('/webhook/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Process payment
    const result = await EMIService.processEMIPayment(req.body);

    res.json({ status: 'ok', ...result });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📊 GET PAYMENT HISTORY (Customer)
// ═══════════════════════════════════════════════════════════════════

router.get('/history/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;
    const payments = await EMIService.getPaymentHistory(loanId);

    res.json({
      loanId,
      total: payments.length,
      payments: payments.map(p => ({
        emiNumber: p.emiNumber,
        dueDate: p.dueDate,
        amount: p.amount,
        status: p.status,
        paidDate: p.paidDate,
        paidAmount: p.paidAmount,
        penaltyApplied: p.penaltyApplied,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📈 ADMIN: EMI COLLECTION ANALYTICS
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/analytics', adminMiddleware, async (req, res) => {
  try {
    const totalEmis = await EMIPayment.countDocuments();
    const paidEmis = await EMIPayment.countDocuments({ status: 'PAID' });
    const pendingEmis = await EMIPayment.countDocuments({ status: 'PENDING' });
    const overdueEmis = await EMIPayment.countDocuments({ status: 'OVERDUE' });
    const failedEmis = await EMIPayment.countDocuments({ status: 'FAILED' });

    const totalCollected = await EMIPayment.aggregate([
      { $match: { status: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$paidAmount' } } },
    ]);

    const totalPenalties = await EMIPayment.aggregate([
      { $match: { status: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$penaltyApplied' } } },
    ]);

    res.json({
      totalEmis,
      stats: {
        paid: paidEmis,
        pending: pendingEmis,
        overdue: overdueEmis,
        failed: failedEmis,
      },
      collections: {
        totalCollected: totalCollected[0]?.total || 0,
        totalPenalties: totalPenalties[0]?.total || 0,
        collectionRate: ((paidEmis / totalEmis) * 100).toFixed(2) + '%',
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📋 ADMIN: GET OVERDUE EMIS
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/overdue', adminMiddleware, async (req, res) => {
  try {
    const overdueEmis = await EMIPayment.find({ status: 'OVERDUE' })
      .populate('userId', 'firstName lastName email phone')
      .populate('loanId', 'amount status')
      .sort({ daysOverdue: -1 });

    res.json({
      total: overdueEmis.length,
      emis: overdueEmis.map(emi => ({
        emiId: emi._id,
        loanId: emi.loanId._id,
        customer: `${emi.userId.firstName} ${emi.userId.lastName}`,
        email: emi.userId.email,
        phone: emi.userId.phone,
        emiNumber: emi.emiNumber,
        amount: emi.amount,
        daysOverdue: emi.daysOverdue,
        penalty: emi.penaltyApplied,
        totalDue: emi.amount + emi.penaltyApplied,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ⚙️ ADMIN: MARK OVERDUE EMIS
// ═══════════════════════════════════════════════════════════════════

router.post('/admin/check-overdue', adminMiddleware, async (req, res) => {
  try {
    const result = await EMIService.checkAndMarkOverdue();
    res.json({ message: 'Overdue EMIs updated', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
