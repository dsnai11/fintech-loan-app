import mongoose from 'mongoose';

const configSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  value:     { type: String, default: '' },
  isSecret:  { type: Boolean, default: false },
  group:     { type: String, default: 'general' },
  updatedBy: { type: String, default: 'system' },
}, { timestamps: true });

export default mongoose.model('Config', configSchema);
