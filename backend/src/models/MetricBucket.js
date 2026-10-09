import mongoose from 'mongoose';

// One minute of traffic from one server process: how many requests, how many failed, and how long they took
// (counted into time bands so the 95th percentile can be worked out across all processes).
const schema = new mongoose.Schema({
  _id: String, // host-minute
  host: String,
  minute: { type: Date, index: { expireAfterSeconds: 2 * 86400 } },
  n: Number,
  e4: Number,
  e5: Number,
  sumMs: Number,
  h: [Number],
}, { _id: false });

export default mongoose.model('MetricBucket', schema);
