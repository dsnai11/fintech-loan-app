import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    rule: {
      type: String,
      enum: ['WATCHLIST_MATCH', 'LARGE_LOAN', 'RAPID_REAPPLICATION', 'SHARED_BANK_ACCOUNT', 'EARLY_CLOSURE', 'DUPLICATE_PAN', 'KYC_NAME_MISMATCH'],
      required: true,
    },
    severity: { type: String, enum: ['MEDIUM', 'HIGH'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    detail: { type: String, default: '' },
    status: { type: String, enum: ['OPEN', 'CLEARED', 'ESCALATED'], default: 'OPEN', index: true },
    reviewedBy: String,
    reviewNote: String,
    reviewedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('AmlAlert', schema);
