import mongoose from 'mongoose';

// One automatic collection of one instalment: told about, tried, and what happened.
const schema = new mongoose.Schema({
  mandateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mandate', required: true, index: true },
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emiNumber: { type: Number, required: true },
  amount: { type: Number, required: true },
  dueDate: Date,
  status: { type: String, enum: ['notified', 'success', 'failed'], default: 'notified', index: true },
  notifiedAt: Date, // the customer was told in advance
  attempts: { type: Number, default: 0 },
  lastAttemptAt: Date,
  nextAttemptAt: Date,
  providerRef: String,
  failureReason: String,
  createdAt: { type: Date, default: Date.now },
});
schema.index({ mandateId: 1, emiNumber: 1 }, { unique: true });

export default mongoose.models.MandateDebit || mongoose.model('MandateDebit', schema);
