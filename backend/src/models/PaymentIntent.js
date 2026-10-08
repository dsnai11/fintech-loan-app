import mongoose from 'mongoose';

// A payment the customer is asked to make outside the normal EMI flow: several instalments at once, closing the loan early,
// or a settlement. The amount is always worked out on our side. The money is applied only after the payment provider confirms it.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    purpose: { type: String, enum: ['pay_ahead', 'foreclosure', 'settlement'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['created', 'processing', 'paid', 'expired', 'cancelled', 'review', 'resolved'], default: 'created' },
    provider: { type: String, enum: ['razorpay', 'sandbox'], required: true },
    providerRef: String,
    url: String,
    paymentId: String,
    meta: mongoose.Schema.Types.Mixed, // which instalments, or which settlement offer
    reviewReason: String,
    resolvedBy: String,
    resolvedNote: String,
    expiresAt: { type: Date, required: true },
    paidAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('PaymentIntent', schema);
