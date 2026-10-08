import mongoose from 'mongoose';

// A one-time settlement (OTS) offered to a customer who cannot repay in full: pay this amount, the loan is closed as settled.
const schema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['offered', 'accepted', 'paid', 'declined', 'expired', 'withdrawn'], default: 'offered' },
    originalDue: { type: Number, required: true }, // what the customer would owe in full today
    waiverPercent: { type: Number, required: true },
    amount: { type: Number, required: true }, // what they pay to settle
    validUntil: { type: Date, required: true },
    createdBy: String,
    acceptedAt: Date,
    paidAt: Date,
    paidReference: String,
    paidRecordedBy: String,
    note: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

export default mongoose.model('Settlement', schema);
