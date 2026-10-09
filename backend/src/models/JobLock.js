import mongoose from 'mongoose';

// One document per background job. Whoever holds the lock runs the job; the lock expires on its own if that server dies,
// so with several servers running the same code each job still runs once, not once per server.
const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  holder: String,
  until: Date,
  lastStartedAt: Date,
  lastFinishedAt: Date,
  lastDurationMs: Number,
  lastError: String,
  runs: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
});

export default mongoose.model('JobLock', schema);
