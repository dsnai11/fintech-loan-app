import mongoose from 'mongoose';

// A customer asking the company to phone them back at a time that suits them.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    phone: { type: String, required: true },
    topic: { type: String, enum: ['loan', 'payment', 'kyc', 'other'], default: 'other' },
    day: { type: String, enum: ['today', 'tomorrow'], default: 'today' },
    slot: { type: String, enum: ['morning', 'afternoon', 'evening'], default: 'morning' },
    note: { type: String, maxlength: 300, default: '' },
    status: { type: String, enum: ['open', 'done', 'cancelled'], default: 'open', index: true },
    assignedTo: { type: String, default: '' },
    outcome: { type: String, maxlength: 300, default: '' },
    doneBy: String,
    doneAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('CallbackRequest', schema);
