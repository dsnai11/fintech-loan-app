import mongoose from 'mongoose';

const loanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    loanAmount: { type: Number, required: true, min: 1000, max: 500000 },
    tenure: { type: Number, required: true, min: 1, max: 60 },
    purpose: { type: String, enum: ['Personal', 'Business', 'Education', 'Medical', 'Other'] },
    loanType: { type: String, enum: ['Personal Loan', 'Micro Loan', 'Business Loan'], default: 'Personal Loan' },
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected', 'disbursed', 'closed', 'defaulted'],
      default: 'submitted',
    },
    applicationDate: { type: Date, default: Date.now },
    approvalDate: Date,
    disbursementDate: Date,
    interestRate: { type: Number, default: 15 },
    monthlyEMI: Number,
    totalAmount: Number,
    documents: [
      {
        type: String,
        enum: ['IncomeProof', 'BankStatement', 'AddressProof', 'EmploymentLetter'],
      },
    ],
    approvalNotes: String,
    approvedBy: String,
    rejectedBy: String,
    rejectionNotes: String,
    disbursedBy: String,
    disbursedAmount: Number,
    transactionId: String,
    nextEmiDate: Date,
    closedAt: Date,
    rejectionReason: String,
    disbursalDetails: {
      accountNumber: String,
      bankName: String,
      transactionId: String,
      disbursedAmount: Number,
      disbursalDate: Date,
    },
    repaymentHistory: [
      {
        month: Number,
        emiAmount: Number,
        paidAmount: Number,
        paidDate: Date,
        status: { type: String, enum: ['pending', 'paid', 'overdue'] },
        dueDate: Date,
      },
    ],
  },
  { timestamps: true }
);

loanSchema.methods.calculateEMI = function () {
  const P = this.loanAmount;
  const R = this.interestRate / 12 / 100;
  const N = this.tenure;
  const emi = (P * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  return Math.round(emi);
};

export default mongoose.model('Loan', loanSchema);
