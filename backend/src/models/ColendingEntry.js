import mongoose from 'mongoose';

// One amount that moves between the company and a co-lending partner for one loan.
//   funding    - the partner's share of the loan, which the partner pays in
//   remittance - the partner's share of what the customer paid (principal and its interest), which the company pays over
const schema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'ColendingPartner', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    kind: { type: String, enum: ['funding', 'remittance'], required: true },
    emiNumber: Number, // for an instalment; absent for early closure and settlement
    source: { type: String, enum: ['loan', 'emi', 'foreclosure', 'settlement'], required: true },
    principal: { type: Number, default: 0 },
    interest: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'settled'], default: 'pending', index: true },
    settledAt: Date,
    settledBy: String,
    reference: String,
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
schema.index({ loanId: 1, kind: 1, emiNumber: 1, source: 1 }, { unique: true }); // never recorded twice

export default mongoose.model('ColendingEntry', schema);
