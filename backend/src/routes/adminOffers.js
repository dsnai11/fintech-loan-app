import express from 'express';
import mongoose from 'mongoose';
import Offer from '../models/Offer.js';
import { adminMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { pushConfigured, deviceCount } from '../services/pushService.js';
import { getHome } from '../services/homeContent.js';
import { LANGUAGES } from '../i18n/catalogue.js';
import { validateOffer, stateOf, audienceUserIds, notifyOffer, sendDueOfferNotifications, MAX_OFFERS } from '../services/promoOffers.js';

// Staff side of the Offers tab: write offers, schedule them, aim them at a group, and tell customers about them.
const router = express.Router();
router.use(adminMiddleware);

const view = o => ({
  id: String(o._id), title: o.title, summary: o.summary, details: o.details, terms: o.terms, badge: o.badge, theme: o.theme, color1: o.color1, color2: o.color2, icon: o.icon, couponCode: o.couponCode,
  cta: o.cta, audience: o.audience, startsAt: o.startsAt || null, endsAt: o.endsAt || null, featured: o.featured, order: o.order, status: o.status, state: stateOf(o),
  notify: { when: o.notify?.when || 'none', sentAt: o.notify?.sentAt || null, recipients: o.notify?.recipients || 0, pushed: o.notify?.pushed || 0 },
  i18n: o.i18n || {}, views: o.views || 0, clicks: o.clicks || 0, updatedAt: o.updatedAt, updatedBy: o.updatedBy,
});
const toDoc = o => { const { notifyWhen, ...rest } = o; return { ...rest, 'notify.when': notifyWhen }; };
const bad = (res, errors) => res.status(400).json({ error: errors[0], errors });

router.get('/', async (req, res) => {
  try {
    const rows = await Offer.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ offers: rows.map(view), languages: getHome().languages, allLanguages: LANGUAGES, pushAvailable: pushConfigured() });
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
    const doc = await Offer.create({ ...toDoc(offer), createdBy: req.user.email, updatedBy: req.user.email });
    await audit(req.user, 'OFFER_CREATED', { type: 'Offer', id: doc._id }, { title: doc.title, status: doc.status, audience: doc.audience }, req);
    await sendDueOfferNotifications();
    res.status(201).json({ offer: view(await Offer.findById(doc._id).lean()) });
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
    const doc = await Offer.findByIdAndUpdate(req.params.id, { $set: { ...toDoc(offer), updatedBy: req.user.email } }, { new: true }).lean();
    await audit(req.user, 'OFFER_UPDATED', { type: 'Offer', id: doc._id }, { before: { title: current.title, status: current.status }, after: { title: doc.title, status: doc.status } }, req);
    await sendDueOfferNotifications();
    res.json({ offer: view(await Offer.findById(doc._id).lean()) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return bad(res, ['Invalid offer']);
    const doc = await Offer.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Offer not found' });
    await audit(req.user, 'OFFER_DELETED', { type: 'Offer', id: doc._id }, { title: doc.title }, req);
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
