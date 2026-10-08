import mongoose from 'mongoose';

// A customer's permission for the company to collect their EMIs from their bank account or UPI app automatically.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
  provider: { type: String, required: true }, // sandbox or razorpay
  method: { type: String, enum: ['upi', 'enach'], default: 'upi' },
  status: { type: String, enum: ['pending_auth', 'active', 'paused', 'cancelled', 'failed', 'completed'], default: 'pending_auth', index: true },
  providerRef: String,
  authUrl: String,
  maxAmount: { type: Number, required: true }, // the most one debit can be
  covers: Number, // for providers that charge a fixed amount each month: how many instalments it covers
  activatedAt: Date,
  cancelledAt: Date,
  cancelledBy: String,
  failedReason: String,
  lastDebitAt: Date,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Mandate || mongoose.model('Mandate', schema);
