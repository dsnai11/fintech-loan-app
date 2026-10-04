import express from 'express';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import Notification from '../models/Notification.js';
import Announcement from '../models/Announcement.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';

// Send one message to many customers at once (it appears in their in-app notifications).
const router = express.Router();
router.use(adminMiddleware);

const bad = (res, status, error) => res.status(status).json({ error, });
export const AUDIENCES = {
  all: 'Every customer',
  active_loans: 'Customers with a loan being repaid',
  overdue: 'Customers with an overdue instalment',
  no_loans: 'Customers with no loan yet',
};

async function audienceIds(audience) {
  const customers = await User.find({ role: { $in: [null, 'customer'] }, status: 'active', email: { $ne: (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase() } }).distinct('_id');
  const set = new Set(customers.map(String));
  const keep = ids => ids.map(String).filter(id => set.has(id));
  if (audience === 'all') return [...set];
  if (audience === 'active_loans') return keep(await Loan.distinct('userId', { status: 'disbursed' }));
  if (audience === 'overdue') return keep(await EMIPayment.distinct('userId', { status: 'OVERDUE' }));
  if (audience === 'no_loans') {
    const withLoans = new Set((await Loan.distinct('userId')).map(String));
    return [...set].filter(id => !withLoans.has(id));
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    const items = await Announcement.find().sort({ createdAt: -1 }).limit(50);
    res.json({ audiences: AUDIENCES, announcements: items.map(a => ({ id: String(a._id), title: a.title, message: a.message, audience: a.audience, audienceLabel: AUDIENCES[a.audience], recipients: a.recipients, sentBy: a.sentBy, at: a.createdAt })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/count', async (req, res) => {
  try {
    const ids = await audienceIds(String(req.query.audience));
    if (!ids) return bad(res, 400, 'Choose who should get it');
    res.json({ count: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    const message = String(req.body?.message ?? '').trim();
    const audience = String(req.body?.audience ?? '');
    if (!title || title.length > 80) return bad(res, 400, 'Give it a title of up to 80 characters');
    if (!message || message.length > 500) return bad(res, 400, 'Write a message of up to 500 characters');
    const ids = await audienceIds(audience);
    if (!ids) return bad(res, 400, 'Choose who should get it');
    if (!ids.length) return bad(res, 400, 'No customers match that group right now');
    // The sender confirms the number they saw, so a group that changed in the meantime is not messaged by surprise.
    if (Number(req.body?.expectedCount) !== ids.length) return res.status(409).json({ error: `The group now has ${ids.length} customers. Check the number and send again.`, count: ids.length });

    for (let i = 0; i < ids.length; i += 1000) {
      await Notification.insertMany(ids.slice(i, i + 1000).map(userId => ({ userId, type: 'ANNOUNCEMENT', title, message })), { ordered: false });
    }
    const record = await Announcement.create({ title, message, audience, recipients: ids.length, sentBy: req.user.email });
    await audit(req.user, 'ANNOUNCEMENT_SENT', { type: 'Announcement', id: record._id }, { audience, recipients: ids.length, title }, req);
    res.status(201).json({ recipients: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
