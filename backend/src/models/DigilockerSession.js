import mongoose from 'mongoose';

// One DigiLocker verification in progress: the customer is sent to DigiLocker to sign in and share their
// documents, then comes back. Only the outcome is kept here, not the documents themselves.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['digilocker', 'sandbox'], required: true },
    status: { type: String, enum: ['created', 'completed', 'failed', 'expired'], default: 'created' },
    providerRef: String,
    expiresAt: { type: Date, required: true },
    result: mongoose.Schema.Types.Mixed,
    deleteAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('DigilockerSession', schema);
