import mongoose from 'mongoose';

// One photo of a salary slip. Kept apart so it is never loaded by accident, handed out only to staff who review it (and logged),
// and removed by the database itself when `deleteAt` passes.
const schema = new mongoose.Schema({
  slipId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalarySlip', required: true, index: true },
  index: Number,
  mime: String,
  data: { type: Buffer, required: true, select: false },
  sha256: { type: String, index: true },
  size: Number,
  deleteAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export default mongoose.model('SalarySlipFile', schema);
