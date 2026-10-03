import mongoose from 'mongoose';

const collectionNoteSchema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['NOTE', 'CALL', 'PROMISE_TO_PAY', 'LETTER', 'ESCALATION', 'DEFAULTED', 'WRITE_OFF', 'RECOVERY'],
      required: true,
    },
    text: { type: String, default: '', maxlength: 2000 },
    promiseDate: Date,
    promiseAmount: Number,
    amount: Number,
    stage: String,
    createdBy: { type: String, default: 'system' },
  },
  { timestamps: true }
);

collectionNoteSchema.index({ loanId: 1, createdAt: -1 });

export default mongoose.model('CollectionNote', collectionNoteSchema);
