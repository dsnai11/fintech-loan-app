import mongoose from 'mongoose';

// Money a staff member recorded against a live loan (cash, UPI, bank transfer, cheque), a part-prepayment, or a staff-run
// early closure. Payments that arrive through the payment provider are on the instalments themselves; these are the ones
// a person entered, so each has a receipt number, a reference, who posted it, and a way to reverse it.
const schema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['payment', 'prepayment', 'foreclosure'], default: 'payment' },
    amount: { type: Number, required: true }, // what was received
    mode: { type: String, enum: ['CASH', 'UPI', 'NEFT', 'CHEQUE', 'CARD', 'OTHER'], required: true },
    reference: String, // UTR, cheque number, transaction id
    valueDate: { type: Date, required: true },
    note: String,
    // Which instalments it cleared: [{ emiNumber, amount, penalty }]
    allocations: [mongoose.Schema.Types.Mixed],
    advanceBefore: { type: Number, default: 0 }, // money held on the loan before and after (paid in advance, not yet used)
    advanceAfter: { type: Number, default: 0 },
    // For a part-prepayment: what changed
    prepayment: mongoose.Schema.Types.Mixed,
    postedBy: String,
    status: { type: String, enum: ['posted', 'reversed'], default: 'posted' },
    reversal: mongoose.Schema.Types.Mixed, // { at, by, reason }
  },
  { timestamps: true }
);
schema.index({ loanId: 1, createdAt: -1 });
schema.index({ loanId: 1, reference: 1 });

export default mongoose.model('LoanReceipt', schema);
