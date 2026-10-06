import mongoose from 'mongoose';

// The one-time code sent to a phone number. Only a hash of the code is stored. The record also remembers
// how many codes went out recently, so the limits survive a server restart and work across servers.
const schema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    codeHash: { type: String, default: '' },
    codeExpiresAt: { type: Date },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date },
    windowStart: { type: Date, default: Date.now },
    sentInWindow: { type: Number, default: 0 },
    deleteAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('PhoneOtp', schema);
