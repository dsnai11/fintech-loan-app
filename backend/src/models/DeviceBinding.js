import mongoose from 'mongoose';

// Which customer used which installation of the app. The app makes a random installation id the first time it opens and
// sends it with every request. It is not a hardware id and is not tied to the SIM; it tells us when one phone is used by
// several accounts, or an account moves to a new phone around the time of a loan.
const schema = new mongoose.Schema(
  {
    installId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastIp: { type: String, default: '', index: true },
    events: { type: Number, default: 1 },
  },
  { timestamps: false }
);
schema.index({ installId: 1, userId: 1 }, { unique: true });

export default mongoose.model('DeviceBinding', schema);
