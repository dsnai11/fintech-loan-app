import mongoose from 'mongoose';

const emiPaymentSchema = new mongoose.Schema(
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
    emiNumber: {
      type: Number,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    principalAmount: Number,
    interestAmount: Number,
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'OVERDUE', 'FAILED', 'WAIVED'],
      default: 'PENDING',
    },
    paidDate: Date,
    paidAmount: Number,
    paymentMethod: {
      type: String,
      enum: ['NEFT', 'UPI', 'CARD', 'WALLET', 'AUTO_DEBIT'],
      default: 'AUTO_DEBIT',
    },
    paymentGateway: {
      type: String,
      enum: ['RAZORPAY', 'CASHFREE', 'MANUAL'],
      default: 'RAZORPAY',
    },
    transactionId: String,
    orderId: String,
    paymentId: String,
    daysOverdue: {
      type: Number,
      default: 0,
    },
    penaltyApplied: {
      type: Number,
      default: 0,
    },
    penaltyReason: String,
    notes: String,
    metadata: {
      razorpayResponse: mongoose.Schema.Types.Mixed,
      failureReason: String,
      retryCount: { type: Number, default: 0 },
      lastRetryAt: Date,
      notificationSent: { type: Boolean, default: false },
      reminderSent: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// Indexes
emiPaymentSchema.index({ loanId: 1 });
emiPaymentSchema.index({ userId: 1 });
emiPaymentSchema.index({ status: 1 });
emiPaymentSchema.index({ dueDate: 1 });
emiPaymentSchema.index({ loanId: 1, emiNumber: 1 });

export default mongoose.model('EMIPayment', emiPaymentSchema);
