import mongoose from 'mongoose';

// Something that needs a person: a job that failed, errors rising, a slow database. One document per kind of problem; it
// is opened when the problem starts and resolved when it clears, and the people who watch are told once an hour at most.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  severity: { type: String, enum: ['warning', 'critical'], default: 'warning' },
  title: { type: String, required: true },
  detail: String,
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  firstAt: Date,
  lastAt: Date,
  resolvedAt: Date,
  count: { type: Number, default: 1 },
  lastNotifiedAt: Date,
  notified: [String], // channels used the last time: email, webhook
});

export default mongoose.model('SystemAlert', schema);
