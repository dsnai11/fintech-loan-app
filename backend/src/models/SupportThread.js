import mongoose from 'mongoose';

// One conversation between a customer and the company. Messages are kept inside the thread.
const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['customer', 'staff'], required: true },
    senderName: { type: String, default: '' },
    senderEmail: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const threadSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    subject: { type: String, default: '', maxlength: 120 },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    assignedTo: { type: String, default: '' },
    lastFrom: { type: String, enum: ['customer', 'staff'], default: 'customer' },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    unreadForStaff: { type: Number, default: 0 },
    unreadForCustomer: { type: Number, default: 0 },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('SupportThread', threadSchema);
