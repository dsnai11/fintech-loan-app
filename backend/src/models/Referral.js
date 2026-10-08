import mongoose from 'mongoose';

// One customer bringing in another. Created when the new customer signs up with the code.
const schema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  refereeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // a customer can only be referred once
  code: { type: String, required: true },
  status: { type: String, enum: ['signed_up', 'in_hold', 'rewarded', 'void'], default: 'signed_up', index: true },
  loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' }, // the loan that qualified
  eligibleAt: Date, // rewards are worked out once this date passes
  voidReason: String,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Referral || mongoose.model('Referral', schema);
