import mongoose from 'mongoose';

// One attempt to send money automatically: a reward, a partner commission or a loan payout. The reference is sent to the
// payment provider so the same attempt can never pay twice.
const schema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['referral', 'loyalty', 'partner', 'loan'], required: true, index: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, // the reward, award, commission or loan
    userId: mongoose.Schema.Types.ObjectId, // the customer, when there is one
    amount: { type: Number, required: true }, // what is actually sent (after any tax)
    attempt: { type: Number, default: 1 },
    referenceId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['processing', 'processed', 'failed', 'reversed'], default: 'processing', index: true },
    provider: { type: String, enum: ['razorpay', 'sandbox'], required: true },
    providerRef: { type: String, index: true },
    failureReason: String,
    finishedAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export default mongoose.model('PayoutRecord', schema);
