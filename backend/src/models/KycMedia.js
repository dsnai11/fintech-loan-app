import mongoose from 'mongoose';

// A photo taken during onboarding (the selfie frames). Kept apart from the user record so it is never loaded by
// accident, and only handed out through routes that check who is asking.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['selfie_before', 'selfie_after'], required: true },
    mime: { type: String, default: 'image/jpeg' },
    data: { type: Buffer, required: true, select: false },
    sha256: { type: String, required: true, index: true },
    size: Number,
    width: Number,
    height: Number,
    challengeId: String,
  },
  { timestamps: true }
);

export default mongoose.model('KycMedia', schema);
