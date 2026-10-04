import mongoose from 'mongoose';

// Failed sign-ins per email address. Kept for emails that do not exist too, so locking out never
// reveals whether an account is real. Entries disappear on their own after a day.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  lockedUntil: Date,
  updatedAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
});

export default mongoose.model('LoginAttempt', schema);
