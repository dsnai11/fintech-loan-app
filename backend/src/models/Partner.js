import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// An agent or partner who brings customers and earns a commission on the loans paid out to them.
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, default: '' },
    code: { type: String, required: true, unique: true }, // customers type this when they sign up: AGT + 6 characters
    passwordHash: { type: String, required: true, select: false },
    mustChangePassword: { type: Boolean, default: true },
    commissionPercent: { type: Number, required: true, min: 0, max: 10 }, // of each loan paid out
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    panNumber: { type: String, default: '' },
    bank: { accountHolder: String, accountNumber: String, ifscCode: String },
    createdBy: String,
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  { timestamps: true }
);

schema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
  this.passwordChangedAt = new Date();
};
schema.methods.checkPassword = function (plain) {
  return bcrypt.compare(String(plain), this.passwordHash);
};

export default mongoose.model('Partner', schema);
