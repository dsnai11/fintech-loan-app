import mongoose from 'mongoose';

// Request counters kept in the database, so the limit is shared by every server copy. With the default in-memory counters
// each copy counts on its own, so five copies would allow five times the limit.
export class MongoRateLimitStore {
  constructor(prefix = 'rl') {
    this.prefix = prefix;
    this.localKeys = false;
    this.windowMs = 60000;
  }

  init(options) {
    this.windowMs = options.windowMs;
    // Entries delete themselves when their window is over
    this.col().createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  }

  col() {
    return mongoose.connection.collection('ratelimits');
  }

  key(k) {
    return `${this.prefix}:${k}`;
  }

  async increment(key) {
    const now = new Date();
    const next = new Date(now.getTime() + this.windowMs);
    const doc = await this.col().findOneAndUpdate(
      { _id: this.key(key) },
      [{ $set: {
        hits: { $cond: [{ $gt: ['$resetAt', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1] },
        resetAt: { $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', next] },
      } }],
      { upsert: true, returnDocument: 'after' }
    );
    const d = doc?.value || doc; // the driver version decides which shape comes back
    return { totalHits: d.hits, resetTime: d.resetAt };
  }

  async decrement(key) {
    await this.col().updateOne({ _id: this.key(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await this.col().deleteOne({ _id: this.key(key) });
  }
}

export const sharedLimits = () => process.env.RATE_LIMIT_STORE === 'shared' || (process.env.RATE_LIMIT_STORE !== 'memory' && Number(process.env.WEB_CONCURRENCY) > 1);
