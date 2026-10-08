import express from 'express';
import mongoose from 'mongoose';
import Offer from '../models/Offer.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { pushConfigured, deviceCount } from '../services/pushService.js';
import { getHome } from '../services/homeContent.js';
import { approvalRequired, propose } from '../services/changeApprovals.js';
import { LANGUAGES } from '../i18n/catalogue.js';
import { validateOffer, applyOfferChange, offerView as view, needsApproval, stateOf, audienceUserIds, notifyOffer, MAX_OFFERS } from '../services/promoOffers.js';

// Staff side of the Offers tab: write offers, schedule them, aim them at a group, and tell customers about them.
// With the two-person rule on for offers, anything that leaves an offer visible to customers waits for a second person.
// Drafts can always be saved freely, and taking an offer down or deleting it is always immediate.
const router = express.Router();
router.use(adminMiddleware);

const bad = (res, errors) => res.status(400).json({ error: errors[0], errors });
const pending = (res, doc) => res.status(202).json({ pending: true, requestId: String(doc._id), message: 'Sent for approval. It goes live once someone else approves it.' });

router.get('/', async (req, res) => {
  try {
    const rows = await Offer.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ offers: rows.map(view), languages: getHome().languages, allLanguages: LANGUAGES, pushAvailable: pushConfigured(), approvalRequired: approvalRequired('OFFER') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/count', async (req, res) => {
  try {
    const ids = await audienceUserIds(String(req.query.audience || 'all'));
    res.json({ count: ids.length, pushAvailable: pushConfigured(), devices: await deviceCount(ids) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    if ((await Offer.countDocuments()) >= MAX_OFFERS) return bad(res, [`There are already ${MAX_OFFERS} offers. Delete old ones first.`]);
    const { errors, offer } = validateOffer(req.body);
    if (errors.length) return bad(res, errors);
    if (approvalRequired('OFFER') && needsApproval(null, offer)) return pending(res, await propose('OFFER', { op: 'create', data: offer }, req.user, req));
    const r = await applyOfferChange({ op: 'create', data: offer }, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'OFFER_CREATED', { type: 'Offer', id: r.offer.id }, { title: r.offer.title, status: r.offer.status, audience: r.offer.audience }, req);
    res.status(201).json({ offer: r.offer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, ['Invalid offer']);
    const current = await Offer.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: 'Offer not found' });
    const { errors, offer } = validateOffer({ ...view(current), ...req.body });
    if (errors.length) return bad(res, errors);
    if (approvalRequired('OFFER') && needsApproval(current, offer)) return pending(res, await propose('OFFER', { op: 'update', id: req.params.id, data: offer }, req.user, req, req.params.id));
    const r = await applyOfferChange({ op: 'update', id: req.params.id, data: offer }, req.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.errors[0], errors: r.errors });
    await audit(req.user, 'OFFER_UPDATED', { type: 'Offer', id: r.offer.id }, { before: { title: current.title, status: current.status }, after: { title: r.offer.title, status: r.offer.status } }, req);
    res.json({ offer: r.offer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, ['Invalid offer']);
    const current = await Offer.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: 'Offer not found' });
    await applyOfferChange({ op: 'delete', id: req.params.id }, req.user.email);
    await audit(req.user, 'OFFER_DELETED', { type: 'Offer', id: current._id }, { title: current.title }, req);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sends the notification now. The sender confirms the number they saw, as with announcements.
router.post('/:id/notify', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, ['Invalid offer']);
    const o = await Offer.findById(req.params.id).lean();
    if (!o) return res.status(404).json({ error: 'Offer not found' });
    if (stateOf(o) !== 'live') return res.status(409).json({ error: 'Only an offer that is live can be announced. Publish it first, and check its dates.' });
    if (o.notify?.sentAt && Date.now() - new Date(o.notify.sentAt).getTime() < 24 * 36e5) return res.status(409).json({ error: 'Customers were already notified about this offer in the last 24 hours.' });
    const ids = await audienceUserIds(o.audience);
    if (!ids.length) return bad(res, ['No customers match the group this offer is for right now']);
    if (Number(req.body?.expectedCount) !== ids.length) return res.status(409).json({ error: `The group now has ${ids.length} customers. Check the number and send again.`, count: ids.length });
    const r = await notifyOffer(o);
    await audit(req.user, 'OFFER_NOTIFIED', { type: 'Offer', id: o._id }, { title: o.title, audience: o.audience, recipients: r.recipients }, req);
    res.json({ recipients: r.recipients, pushQueued: pushConfigured() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
