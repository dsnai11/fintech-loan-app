import mongoose from 'mongoose';

// A salary slip a customer uploaded as proof of income, and what staff decided about it. The photos themselves are in SalarySlipFile
// and are deleted some weeks after the decision. What stays is the decision and the income staff confirmed.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    claimedIncome: { type: Number, required: true }, // the net monthly salary the customer says is on the slip
    employer: { type: String, default: '', maxlength: 80 },
    slipMonth: { type: String, default: '' }, // YYYY-MM printed on the slip
    images: { type: Number, default: 0 },
    hashes: [String],
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    verifiedIncome: Number, // what staff confirmed (may differ from the claim)
    verifiedEmployer: String,
    reason: String, // shown to the customer when rejected
    reviewedBy: String,
    reviewedAt: Date,
    validUntil: Date, // an approved slip counts as proof until then
    duplicateOf: [{ type: mongoose.Schema.Types.ObjectId }], // other customers' slips with an identical photo
  },
  { timestamps: true }
);
schema.index({ status: 1, createdAt: -1 });

export default mongoose.model('SalarySlip', schema);
