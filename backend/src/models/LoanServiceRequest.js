import mongoose from 'mongoose';

// A change to a live loan that waits for a second person to approve it (late-fee waiver, new due day, longer tenure, a pause
// in instalments, a restructure). Nothing changes on the loan until it is approved, and approving re-checks that the loan
// has not moved on since it was asked for.
const schema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['waiver', 'date_change', 'extension', 'moratorium', 'restructure'], required: true },
    payload: mongoose.Schema.Types.Mixed,
    reason: { type: String, required: true },
    summary: [String], // what will change, in plain words, worked out when it was asked for
    baseHash: String, // fingerprint of the loan's unpaid instalments when it was asked for
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'withdrawn', 'failed'], default: 'pending', index: true },
    requestedBy: { type: String, required: true },
    requestedAt: { type: Date, default: Date.now },
    decidedBy: String,
    decidedAt: Date,
    decisionNote: String,
    autoApplied: { type: Boolean, default: false }, // two-person approval was switched off, so it was applied straight away
    result: mongoose.Schema.Types.Mixed, // what was done
  },
  { timestamps: true }
);
schema.index({ status: 1, requestedAt: -1 });

export default mongoose.model('LoanServiceRequest', schema);
