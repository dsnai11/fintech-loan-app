import mongoose from 'mongoose';

// An offer shown on the Offers tab of the customer app. Staff manage these on the portal's Offers page.
const schema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 60 },
  summary: { type: String, default: '', maxlength: 140 },
  details: { type: String, default: '', maxlength: 1500 },
  terms: { type: String, default: '', maxlength: 1500 },
  badge: { type: String, default: '', maxlength: 20 },
  theme: { type: String, default: 'brand' },
  color1: { type: String, default: '' },
  color2: { type: String, default: '' },
  icon: { type: String, default: 'gift' },
  couponCode: { type: String, default: '' }, // shown to the customer to copy; informational
  cta: { text: { type: String, default: '' }, action: { type: String, default: 'none' }, url: { type: String, default: '' } },
  audience: { type: String, default: 'all' },
  startsAt: Date,
  endsAt: Date,
  featured: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
  notify: {
    when: { type: String, enum: ['none', 'publish', 'manual'], default: 'none' },
    sentAt: Date,
    recipients: { type: Number, default: 0 },
    pushed: { type: Number, default: 0 },
  },
  i18n: mongoose.Schema.Types.Mixed, // { hi: { title, summary, details, terms, cta } }
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

export default mongoose.models.Offer || mongoose.model('Offer', schema);
