import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    name: String,
    pan: String,
    phone: String,
    accountNumber: String,
    source: { type: String, default: 'Internal' },
    reason: { type: String, default: '' },
    active: { type: Boolean, default: true },
    addedBy: String,
  },
  { timestamps: true }
);

export default mongoose.model('WatchlistEntry', schema);
