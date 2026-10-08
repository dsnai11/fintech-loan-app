import mongoose from 'mongoose';

// One automatic reminder that went out for one instalment. The unique index is what stops the same step being sent twice.
const schema = new mongoose.Schema(
  {
    emiId: { type: mongoose.Schema.Types.ObjectId, ref: 'EMIPayment', required: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stepId: { type: String, required: true },
    offsetDays: Number,
    results: mongoose.Schema.Types.Mixed, // { app: 'sent', sms: 'skipped', whatsapp: 'test' }
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);
schema.index({ emiId: 1, stepId: 1 }, { unique: true });

export default mongoose.model('ReminderLog', schema);
