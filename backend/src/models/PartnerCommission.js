import mongoose from 'mongoose';

// What the company owes a partner for one loan. Finance pays it and records the reference.
const schema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, unique: true }, // never twice for one loan
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    loanAmount: { type: Number, required: true },
    percent: { type: Number, required: true },
    gross: { type: Number, required: true },
    tdsPercent: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    status: { type: String, enum: ['due', 'paid', 'void'], default: 'due', index: true },
    voidReason: String,
    paidAt: Date,
    paidBy: String,
    reference: String,
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export default mongoose.model('PartnerCommission', schema);
