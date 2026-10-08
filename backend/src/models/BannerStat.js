import mongoose from 'mongoose';

// How often each home-screen banner was shown and tapped, per day.
const schema = new mongoose.Schema({
  bannerId: { type: String, required: true },
  day: { type: String, required: true }, // YYYY-MM-DD
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
});
schema.index({ bannerId: 1, day: 1 }, { unique: true });

export default mongoose.models.BannerStat || mongoose.model('BannerStat', schema);
