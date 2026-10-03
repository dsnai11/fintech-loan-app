import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['DELETE'], required: true },
    reason: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['OPEN', 'COMPLETED', 'REJECTED'], default: 'OPEN', index: true },
    processedBy: String,
    processedAt: Date,
    note: String,
  },
  { timestamps: true }
);

export default mongoose.model('DataRequest', schema);
