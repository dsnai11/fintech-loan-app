import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { search } from '../services/employerService.js';

// Suggestions while a customer types where they work. Names only; the grade is never shown to customers.
const router = express.Router();
router.get('/search', authMiddleware, (req, res) => {
  res.json({ names: search(String(req.query.q || '').slice(0, 60)) });
});
export default router;
