import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['DISBURSEMENT', 'EMI_PAYMENT', 'REFUND', 'PENALTY'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED'],
      default: 'PENDING',
    },
    paymentGateway: {
      type: String,
      enum: ['RAZORPAY', 'CASHFREE', 'SANDBOX'],
      default: 'SANDBOX',
    },
    transferId: {
      type: String, // Razorpay payout ID
      sparse: true,
    },
    orderId: {
      type: String, // Razorpay order ID
      sparse: true,
    },
    paymentId: {
      type: String, // Razorpay payment ID
      sparse: true,
    },
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolder: String,
      bankName: String,
    },
    error: String,
    metadata: {
      razorpayResponse: mongoose.Schema.Types.Mixed,
      razorpayStatus: String,
      sandbox: Boolean,
      initiatedBy: String, // admin email or 'system'
      initiatedAt: Date,
      completedAt: Date,
      failedAt: Date,
      lastCheckedAt: Date,
      webhookProcessed: Boolean,
      notes: String,
    },
    receipt: String,
    referenceId: String, // Internal reference
  },
  { timestamps: true }
);

// Indexes
transactionSchema.index({ loanId: 1 });
transactionSchema.index({ userId: 1 });
transactionSchema.index({ type: 1, status: 1 });
transactionSchema.index({ transferId: 1 });
transactionSchema.index({ createdAt: -1 });

export default mongoose.model('Transaction', transactionSchema);
