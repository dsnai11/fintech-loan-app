import express from 'express';
import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import { adminMiddleware, authMiddleware } from '../middleware/auth.js';
import EMIService from '../services/emiService.js';
import { verifyRazorpayWebhook } from '../services/webhookSecurity.js';
import { getForeclosureQuote, executeForeclosure } from '../services/foreclosureService.js';
import { getCoolingOffQuote, executeCoolingOff } from '../services/coolingOffService.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// 📅 GET EMI SCHEDULE (Customer)
// ═══════════════════════════════════════════════════════════════════

const ownsLoan = async (req, res) => {
  const loan = await Loan.findById(req.params.loanId);
  const isAdmin = req.user.isAdmin || req.user.email === (process.env.ADMIN_EMAIL || 'admin@lifc.in');
  if (!loan || (!isAdmin && String(loan.userId) !== String(req.user.userId))) {
    res.status(404).json({ error: 'Loan not found' });
    return null;
  }
  return loan;
};

router.get('/schedule/:loanId', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
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

router.post('/initiate/:loanId/:emiNumber', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
    const { loanId, emiNumber } = req.params;

    const result = await EMIService.initiateEMIPayment(loanId, parseInt(emiNumber), req.user.userId);

    res.json({
      message: 'EMI payment initiated',
      ...result,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🏁 EARLY CLOSURE (FORECLOSURE)
// ═══════════════════════════════════════════════════════════════════

const sendError = (res, e) =>
  res.status(e.status || 500).json({ error: e.message, ...(e.quote ? { quote: e.quote } : {}) });

router.get('/foreclosure/:loanId', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
    const { quote } = await getForeclosureQuote(req.params.loanId);
    res.json(quote);
  } catch (e) {
    sendError(res, e);
  }
});

router.get('/cooling-off/:loanId', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
    const { quote } = await getCoolingOffQuote(req.params.loanId);
    res.json(quote);
  } catch (e) {
    sendError(res, e);
  }
});

router.post('/cooling-off/:loanId', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
    const result = await executeCoolingOff(req.params.loanId, Number(req.body?.expectedAmount), req.user.email);
    res.json({ message: 'Loan cancelled', ...result });
  } catch (e) {
    sendError(res, e);
  }
});

router.post('/foreclosure/:loanId', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
    const result = await executeForeclosure(req.params.loanId, Number(req.body?.expectedAmount), req.user.email);
    res.json({ message: 'Loan closed successfully', ...result });
  } catch (e) {
    sendError(res, e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🔔 EMI PAYMENT WEBHOOK (Razorpay)
// ═══════════════════════════════════════════════════════════════════

router.post('/webhook/razorpay', async (req, res) => {
  try {
    const check = verifyRazorpayWebhook(req);
    if (!check.ok) return res.status(check.status).json({ error: check.error });

    const { event, payload } = req.body || {};
    if (String(event).startsWith('payment_link.')) {
      const { handlePaymentLinkEvent } = await import('../services/onlinePayments.js');
      return res.json({ status: 'ok', ...(await handlePaymentLinkEvent(event, payload)) });
    }
    if (String(event).startsWith('subscription.')) {
      const { handleSubscriptionEvent } = await import('../services/mandateService.js');
      return res.json({ status: 'ok', ...(await handleSubscriptionEvent(event, payload)) });
    }
    if (event !== 'invoice.paid') return res.json({ status: 'ok', ignored: true, event });

    const invoice = payload?.invoice?.entity;
    const payment = payload?.payment?.entity;
    if (!invoice?.id) return res.status(400).json({ error: 'Invoice details missing' });

    const result = await EMIService.processEMIPayment({
      invoice_id: invoice.id,
      payment_id: payment?.id,
      status: 'paid',
      amount_paid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid / 100 : undefined,
    });
    res.json({ status: 'ok', ...result });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📊 GET PAYMENT HISTORY (Customer)
// ═══════════════════════════════════════════════════════════════════

router.get('/history/:loanId', authMiddleware, async (req, res) => {
  try {
    if (!(await ownsLoan(req, res))) return;
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
        collectionRate: (totalEmis ? (paidEmis / totalEmis) * 100 : 0).toFixed(2) + '%',
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
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const [total, overdueEmis] = await Promise.all([
      EMIPayment.countDocuments({ status: 'OVERDUE' }),
      EMIPayment.find({ status: 'OVERDUE' })
        .sort({ daysOverdue: -1 })
        .limit(limit)
        .populate('userId', 'firstName lastName email phone')
        .populate('loanId', 'loanAmount status'),
    ]);

    res.json({
      total,
      shown: overdueEmis.length,
      emis: overdueEmis.map(emi => ({
        emiId: emi._id,
        loanId: String(emi.loanId?._id || emi.loanId),
        customer: emi.userId ? `${emi.userId.firstName} ${emi.userId.lastName}` : 'Unknown',
        email: emi.userId?.email,
        phone: emi.userId?.phone,
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
// 📋 ADMIN: EMIS BY STATUS (paid, upcoming, failed)
// ═══════════════════════════════════════════════════════════════════

router.get('/admin/list', adminMiddleware, async (req, res) => {
  try {
    const status = String(req.query.status || '').toUpperCase();
    if (!['PAID', 'PENDING', 'FAILED'].includes(status)) return res.status(400).json({ error: 'status must be PAID, PENDING or FAILED' });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    // Paid: most recent first. Upcoming: soonest first. Failed: most recent first.
    const sort = status === 'PENDING' ? { dueDate: 1 } : status === 'PAID' ? { paidDate: -1 } : { updatedAt: -1 };
    const [total, rows] = await Promise.all([
      EMIPayment.countDocuments({ status }),
      EMIPayment.find({ status }).sort(sort).limit(limit).populate('userId', 'firstName lastName phone'),
    ]);
    const day = 86400000;
    res.json({
      status,
      total,
      emis: rows.map(e => ({
        emiId: String(e._id),
        loanId: String(e.loanId),
        customer: e.userId ? `${e.userId.firstName} ${e.userId.lastName}` : 'Unknown',
        phone: e.userId?.phone || '',
        emiNumber: e.emiNumber,
        amount: e.amount,
        dueDate: e.dueDate,
        paidDate: e.paidDate || null,
        paidAmount: e.paidAmount || 0,
        penalty: e.penaltyApplied || 0,
        daysLate: e.paidDate ? Math.max(0, Math.ceil((new Date(e.paidDate) - new Date(e.dueDate)) / day)) : 0,
        daysUntilDue: Math.ceil((new Date(e.dueDate) - Date.now()) / day),
        failureReason: e.metadata?.failureReason || '',
        retries: e.metadata?.retryCount || 0,
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
