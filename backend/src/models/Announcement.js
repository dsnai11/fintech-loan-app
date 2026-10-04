import mongoose from 'mongoose';

// A message sent by staff to many customers at once. Kept as a record of who was told what.
const schema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 80 },
    message: { type: String, required: true, maxlength: 500 },
    audience: { type: String, enum: ['all', 'active_loans', 'overdue', 'no_loans'], required: true },
    recipients: { type: Number, default: 0 },
    sentBy: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('Announcement', schema);
