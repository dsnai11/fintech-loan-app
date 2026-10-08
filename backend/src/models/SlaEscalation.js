import mongoose from 'mongoose';

// Records that a late item has been reported to the managers, so each one is reported once.
const schema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    itemId: { type: String, required: true },
    reportedAt: { type: Date, default: Date.now },
    emailed: { type: String, default: 'skipped' },
  },
  { timestamps: false }
);
schema.index({ kind: 1, itemId: 1 }, { unique: true });
schema.index({ reportedAt: 1 }, { expireAfterSeconds: 90 * 86400 });

export default mongoose.model('SlaEscalation', schema);
