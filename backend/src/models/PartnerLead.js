import mongoose from 'mongoose';

// A customer who signed up with a partner's code. One partner per customer, for good.
const schema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    code: String,
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export default mongoose.model('PartnerLead', schema);
