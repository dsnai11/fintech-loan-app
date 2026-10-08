import mongoose from 'mongoose';

// A badge (and perhaps a cash reward) a customer earned for paying EMIs on time. One per customer per milestone.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true }, // e.g. "streak-6"
    streak: { type: Number, required: true },
    title: { type: String, required: true },
    cashback: { type: Number, default: 0 },
    status: { type: String, enum: ['earned', 'due', 'paid', 'void'], default: 'earned' }, // due = cash to pay, paid = paid
    awardedAt: { type: Date, default: Date.now },
    paidAt: Date,
    paidReference: String,
    paidBy: String,
  },
  { timestamps: false }
);
schema.index({ userId: 1, key: 1 }, { unique: true });

export default mongoose.model('LoyaltyAward', schema);
