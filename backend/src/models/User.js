import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    dateOfBirth: Date,
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    nationality: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    panNumber: { type: String, unique: true, sparse: true },
    aadharNumber: { type: String, unique: true, sparse: true },
    kycStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    documents: [
      {
        type: { type: String, enum: ['PAN', 'Aadhar', 'DrivingLicense', 'Passport'] },
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    employment: {
      status: { type: String, enum: ['Employed', 'Self-Employed', 'Student', 'Unemployed'] },
      company: String,
      designation: String,
      monthlyIncome: Number,
      yearsOfExperience: Number,
    },
    bankAccount: {
      accountNumber: String,
      ifscCode: String,
      bankName: String,
      accountHolder: String,
    },
    loanHistory: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Loan' }],
    creditScore: { type: Number, min: 0, max: 900 },
    phoneVerified: { type: Boolean, default: false },
    phoneVerifiedAt: Date,
    // Credit check and the loan offer worked out from it (see services/offerService.js)
    creditScoreAt: Date,
    creditScoreSource: String,
    bureauConsentAt: Date,
    // The selfie taken at sign-up and its blink check (the photos themselves live in KycMedia)
    selfie: mongoose.Schema.Types.Mixed,
    // The KYC outcome from DigiLocker: status, whether name and date of birth matched, last 4 digits of the Aadhaar
    kycDigilocker: mongoose.Schema.Types.Mixed,
    selfieAttempts: mongoose.Schema.Types.Mixed,
    offer: mongoose.Schema.Types.Mixed,
    pushPrefs: mongoose.Schema.Types.Mixed, // which kinds of push notification the customer switched off: { offers: false }
    referralCode: { type: String, unique: true, sparse: true }, // shared with friends
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    language: { type: String, default: 'en' }, // the language the customer chose in the app
    // The terms and conditions the customer last accepted (see services/terms.js)
    termsVersion: { type: Number, default: 0 },
    termsAcceptedAt: Date,
    termsAcceptedIp: String,
    // Never returned by a normal query. Ask for them with .select('+field') when needed.
    passwordResetHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordResetRequestedAt: Date,
    passwordChangedAt: Date,
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    twoFactorPendingSecret: { type: String, select: false },
    twoFactorRecovery: { type: [String], select: false },
    twoFactorLastStep: { type: Number, select: false },
    status: { type: String, enum: ['active', 'inactive', 'blocked'], default: 'active' },
    // Staff accounts have a role from services/permissions.js; customers are 'customer'.
    role: { type: String, default: 'customer' },
    branch: { type: String, default: '', maxlength: 80 },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (!this.isNew) this.passwordChangedAt = new Date();

  try {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (password) {
  return bcryptjs.compare(password, this.password);
};

export default mongoose.model('User', userSchema);
