import mongoose from 'mongoose';

const loanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    loanAmount: { type: Number, required: true, min: 1 },
    tenure: { type: Number, required: true, min: 1, max: 60 },
    purpose: { type: String, enum: ['Personal', 'Business', 'Education', 'Medical', 'Other'] },
    planType: { type: String, enum: ['one_time', '3_emi', '6_emi'] },
    productKey: { type: String, default: 'personal' },
    // What the decision engine found when the application came in (see services/decisionEngine.js)
    decision: mongoose.Schema.Types.Mixed,
    // The Key Fact Statement the customer was shown when they applied. Later price changes never alter it.
    kfs: mongoose.Schema.Types.Mixed,
    closureType: { type: String, enum: ['repaid', 'foreclosure', 'cooling_off', 'settlement'] },
    loanType: { type: String, enum: ['Personal Loan', 'Micro Loan', 'Business Loan'], default: 'Personal Loan' },
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected', 'disbursed', 'closed', 'defaulted', 'written_off'],
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
    assignedTo: String, // staff email working this collections case
    assignedAt: Date,
    rejectedBy: String,
    rejectionNotes: String,
    disbursedBy: String,
    disbursedAmount: Number,
    transactionId: String,
    nextEmiDate: Date,
    closedAt: Date,
    collectionStage: String,
    collectionStageSince: Date,
    defaultedAt: Date,
    writtenOffAt: Date,
    writtenOffAmount: Number,
    writeOffReason: String,
    recoveredAmount: { type: Number, default: 0 },
    colending: mongoose.Schema.Types.Mixed, // the partner bank funding part of this loan: { partnerId, partnerName, partnerShare, nbfcShare, partnerRate, funding }
    payday: mongoose.Schema.Types.Mixed, // payday advance: { salaryDay, dueDate, days, fee }
    dateChanges: [mongoose.Schema.Types.Mixed], // times the customer moved the due day: { at, fromDay, toDay, shiftDays, by }
    foreclosure: {
      date: Date,
      amount: Number,
      principal: Number,
      accruedInterest: Number,
      fee: Number,
    },
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

// Every customer screen and staff list filters or sorts on these
loanSchema.index({ userId: 1, createdAt: -1 });
loanSchema.index({ status: 1, createdAt: -1 });
loanSchema.index({ status: 1, disbursementDate: -1 });
loanSchema.index({ productKey: 1, status: 1 });
loanSchema.index({ assignedTo: 1 });
loanSchema.index({ createdAt: -1 });

loanSchema.methods.calculateEMI = function () {
  const P = this.loanAmount;
  const R = this.interestRate / 12 / 100;
  const N = this.tenure;
  const emi = (P * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  return Math.round(emi);
};

export default mongoose.model('Loan', loanSchema);
