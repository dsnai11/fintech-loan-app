import mongoose from 'mongoose';

// A one-time challenge the app has to answer when taking the selfie. It cannot be reused, and expires quickly.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    blinks: { type: Number, default: 2 },
    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    deleteAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('LivenessChallenge', schema);
