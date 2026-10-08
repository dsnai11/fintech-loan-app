import mongoose from 'mongoose';

// A phone that can receive push notifications for a customer.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['android', 'ios'], required: true },
  appVersion: { type: String, default: '' },
  lastSeenAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.DeviceToken || mongoose.model('DeviceToken', schema);
