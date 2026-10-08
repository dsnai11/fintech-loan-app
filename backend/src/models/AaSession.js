import mongoose from 'mongoose';

// One bank-statement sharing in progress (Account Aggregator): the customer is sent to approve the consent, then comes back.
// Only the outcome is kept here, not the statements themselves.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['aa', 'sandbox'], required: true },
    status: { type: String, enum: ['created', 'completed', 'failed', 'expired'], default: 'created' },
    providerRef: String,
    expiresAt: { type: Date, required: true },
    result: mongoose.Schema.Types.Mixed,
    deleteAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('AaSession', schema);
