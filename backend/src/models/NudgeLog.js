import mongoose from 'mongoose';

// One nudge sent to one customer. Used to keep nudges polite (gaps, weekly limit, how many times per reason) and to see which ones work.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    segment: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
schema.index({ userId: 1, sentAt: -1 });
schema.index({ segment: 1, sentAt: -1 });

export default mongoose.model('NudgeLog', schema);
