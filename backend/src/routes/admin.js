import express from 'express';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import { adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/admin/users
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const total = await User.countDocuments();
    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/loans
router.get('/loans', adminMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = status ? { status } : {};
    const loans = await Loan.find(filter)
      .populate('userId', 'firstName lastName email phone panNumber kycStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Loan.countDocuments(filter);
    res.json({ loans, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/stats
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const [totalLoans, disbursed, pending, totalUsers] = await Promise.all([
      Loan.countDocuments(),
      Loan.countDocuments({ status: 'disbursed' }),
      Loan.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
      User.countDocuments(),
    ]);
    const pipeline = await Loan.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byStatus = Object.fromEntries(pipeline.map(p => [p._id, p.count]));
    res.json({ totalLoans, disbursed, pending, totalUsers, byStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/loans/:id/status
router.put('/loans/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { status, notes, rejectionReason } = req.body;
    const allowed = ['under_review', 'approved', 'rejected', 'disbursed', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }

    const update = { status };
    if (status === 'approved') update.approvalDate = new Date();
    if (status === 'disbursed') {
      update.disbursementDate = new Date();
      update['disbursalDetails.transactionId'] = `TXN${Date.now()}`;
      update['disbursalDetails.disbursalDate'] = new Date();
    }
    if (notes) update.approvalNotes = notes;
    if (rejectionReason) update.rejectionReason = rejectionReason;

    const loan = await Loan.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('userId', 'firstName lastName email phone');
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    res.json({ message: `Loan ${status}`, loan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User status updated', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
