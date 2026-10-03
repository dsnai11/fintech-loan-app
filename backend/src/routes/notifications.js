import express from 'express';
import Notification from '../models/Notification.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { sendEmiReminders } from '../services/notificationService.js';

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-channels');
    const unread = await Notification.countDocuments({ userId: req.user.userId, read: false });
    res.json({ unread, notifications });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.userId, read: false }, { read: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/read', authMiddleware, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user.userId }, { read: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: run the reminder/overdue job on demand
router.post('/admin/run-reminders', adminMiddleware, async (req, res) => {
  try {
    res.json(await sendEmiReminders());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
