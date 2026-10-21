import { encryptBuffer, decryptBuffer } from '../services/dataCrypto.js';
import mongoose from 'mongoose';

// A photo taken during onboarding (the selfie frames). Kept apart from the user record so it is never loaded by
// accident, and only handed out through routes that check who is asking.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['selfie_before', 'selfie_after', 'aadhaar_card'], required: true },
    mime: { type: String, default: 'image/jpeg' },
    // Sealed with AES-256-GCM when DATA_ENCRYPTION_KEY is set (see services/dataCrypto.js); reading it gives the original bytes back
    data: { type: Buffer, required: true, select: false, set: v => encryptBuffer(v), get: v => decryptBuffer(v) },
    sha256: { type: String, required: true, index: true },
    size: Number,
    width: Number,
    height: Number,
    challengeId: String,
  },
  { timestamps: true }
);

export default mongoose.model('KycMedia', schema);
