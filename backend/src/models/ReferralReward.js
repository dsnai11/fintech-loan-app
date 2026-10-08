import mongoose from 'mongoose';

// An amount the company owes a customer for a referral. Finance pays it and marks it paid.
const schema = new mongoose.Schema({
  referralId: { type: mongoose.Schema.Types.ObjectId, ref: 'Referral', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['referrer', 'referee'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['due', 'paid', 'void'], default: 'due', index: true },
  paidAt: Date,
  paidBy: String,
  reference: String, // the bank reference of the payment
  voidReason: String,
  createdAt: { type: Date, default: Date.now },
});
schema.index({ referralId: 1, role: 1 }, { unique: true }); // never rewarded twice

export default mongoose.models.ReferralReward || mongoose.model('ReferralReward', schema);
