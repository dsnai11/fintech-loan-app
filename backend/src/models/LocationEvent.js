import mongoose from 'mongoose';

// Where a customer's phone said it was at a key moment (applying for a loan, verifying identity). Shared by the app with the
// customer's permission. Kept for 6 months, then removed.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['apply', 'kyc', 'login', 'other'], default: 'other' },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    accuracy: Number, // metres
    mocked: { type: Boolean, default: false }, // the phone says an app is faking the location
    ip: String,
    platform: String,
    at: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 183 },
  },
  { timestamps: false }
);
schema.index({ lat: 1, lon: 1, at: -1 });

export default mongoose.model('LocationEvent', schema);
