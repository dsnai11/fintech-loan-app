import mongoose from 'mongoose';

// One Aadhaar eSign in progress: the customer is sent to the signing provider, signs, and comes back. Only the outcome is kept.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    agreementHash: { type: String, required: true }, // exactly what was shown, so a changed agreement cannot be signed by accident
    mode: { type: String, enum: ['esign', 'sandbox'], required: true },
    status: { type: String, enum: ['created', 'completed', 'failed', 'expired'], default: 'created' },
    providerRef: String,
    expiresAt: { type: Date, required: true },
    result: mongoose.Schema.Types.Mixed,
    deleteAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('EsignSession', schema);
