import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    type: {
      type: String,
      enum: ['LOAN_APPROVED', 'LOAN_REJECTED', 'LOAN_DISBURSED', 'EMI_PAID', 'EMI_REMINDER', 'EMI_OVERDUE', 'LOAN_CLOSED', 'COLLECTION_NOTICE', 'KYC_UPDATE', 'SUPPORT_REPLY', 'ANNOUNCEMENT', 'REFERRAL_REWARD', 'OFFER', 'AUTOPAY'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    data: mongoose.Schema.Types.Mixed, // anything the app needs to open the right screen, like { offerId }
    channels: {
      email: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'skipped' },
      sms: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'skipped' },
      push: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'skipped' },
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
