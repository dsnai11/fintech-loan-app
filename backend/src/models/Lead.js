import mongoose from 'mongoose';

// Someone who asked to be contacted: from a page on the company's website, or from the app for a product that partners provide
// (home loan, loan against property). They agreed to be contacted, and the wording they agreed to is kept with the lead.
const schema = new mongoose.Schema(
  {
    kind: { type: String, required: true, index: true }, // a marketplace product key (home_loan, lap), or 'personal' / 'callback' from a web page
    source: { type: String, enum: ['app', 'web'], required: true },
    page: { type: String, default: '' }, // the web page it came from
    name: { type: String, required: true, maxlength: 60 },
    phone: { type: String, required: true, index: true },
    city: { type: String, default: '', maxlength: 40 },
    amount: Number,
    propertyValue: Number,
    employment: { type: String, default: '', maxlength: 20 },
    note: { type: String, default: '', maxlength: 300 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    consentAt: { type: Date, required: true },
    consentText: { type: String, required: true },
    ipHash: { type: String, index: true },
    status: { type: String, enum: ['new', 'contacted', 'with_partner', 'won', 'lost'], default: 'new', index: true },
    partner: { type: String, default: '', maxlength: 80 }, // the partner it was passed to
    assignedTo: { type: String, default: '' },
    notes: [{ at: { type: Date, default: Date.now }, by: String, text: String }],
  },
  { timestamps: true }
);
schema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Lead', schema);
