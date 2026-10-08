import mongoose from 'mongoose';

// A change to pricing or the home-screen banners that waits for a second person to approve it.
const schema = new mongoose.Schema({
  target: { type: String, enum: ['PRICING', 'APP_HOME', 'DECISION_RULES', 'OFFER'], required: true },
  ref: String, // what is being changed, when the target is many things (an offer's id)
  summary: [String],
  proposed: mongoose.Schema.Types.Mixed,
  baseHash: String, // fingerprint of what was live when the change was proposed
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'withdrawn'], default: 'pending', index: true },
  requestedBy: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  decidedBy: String,
  decidedAt: Date,
  note: String,
});

export default mongoose.models.ChangeRequest || mongoose.model('ChangeRequest', schema);
