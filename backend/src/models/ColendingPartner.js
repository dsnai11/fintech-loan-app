import mongoose from 'mongoose';

// A bank or lender that funds part of each loan alongside the company (co-lending).
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    active: { type: Boolean, default: true },
    partnerSharePercent: { type: Number, required: true, min: 1, max: 90 }, // the share of each loan the partner funds
    partnerRatePercent: { type: Number, required: true, min: 0, max: 60 }, // the yearly rate the partner earns on its share
    minAmount: { type: Number, default: 0 },
    maxAmount: { type: Number, default: 10000000 },
    monthlyCap: { type: Number, default: 0 }, // most the partner will fund in a calendar month (0 = no limit)
    note: { type: String, default: '', maxlength: 300 },
    createdBy: String,
  },
  { timestamps: true }
);

export default mongoose.model('ColendingPartner', schema);
