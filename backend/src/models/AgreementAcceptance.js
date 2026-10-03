import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: String, required: true },
    hash: { type: String, required: true },
    text: { type: String, required: true },
    acceptedAt: { type: Date, default: Date.now },
    ip: String,
    userAgent: String,
  },
  { timestamps: false }
);

export default mongoose.model('AgreementAcceptance', schema);
