import mongoose from 'mongoose';

const appConfigSchema = new mongoose.Schema(
  {
    // Loan Products Configuration
    loanProducts: [
      {
        id: { type: String, required: true, unique: true },
        name: { type: String, required: true },
        description: String,
        minAmount: { type: Number, default: 1000 },
        maxAmount: { type: Number, default: 500000 },
        minTenure: { type: Number, default: 1 },
        maxTenure: { type: Number, default: 60 },
        interestRate: { type: Number, default: 15 },
        processingFeePercent: { type: Number, default: 2.5 },
        enabled: { type: Boolean, default: true },
      },
    ],

    // KYC Verification Flow Configuration
    kycVerifications: [
      {
        id: { type: String, required: true, unique: true },
        name: { type: String, required: true }, // 'otp', 'pan', 'bank', 'aadhar'
        displayName: String,
        order: { type: Number, default: 0 },
        required: { type: Boolean, default: true },
        enabled: { type: Boolean, default: true },
        apiEndpoint: String, // e.g., '/api/kyc/pan'
        apiMethod: { type: String, default: 'POST' },
        requestPayload: Object, // expected request structure
        responseMapping: Object, // how to map response to UI
        errorMessages: Object, // custom error messages
        successMessage: String,
        retryLimit: { type: Number, default: 3 },
      },
    ],

    // Provider Configuration
    providers: {
      sms: {
        provider: { type: String, enum: ['fast2sms', 'msg91', 'twilio', 'sandbox'] },
        enabled: { type: Boolean, default: true },
      },
      pan: {
        provider: { type: String, enum: ['karza', 'idfy', 'sandbox'] },
        enabled: { type: Boolean, default: true },
      },
      bank: {
        provider: { type: String, enum: ['razorpay', 'cashfree', 'sandbox'] },
        enabled: { type: Boolean, default: true },
      },
      bureau: {
        provider: { type: String, enum: ['equifax', 'sandbox'] },
        enabled: { type: Boolean, default: true },
      },
    },

    // App UI Configuration
    uiConfig: {
      enableOTP: { type: Boolean, default: true },
      enablePAN: { type: Boolean, default: true },
      enableBank: { type: Boolean, default: true },
      enableProfileUpdate: { type: Boolean, default: true },
      otpValidityMinutes: { type: Number, default: 5 },
      maxOTPRetries: { type: Number, default: 3 },
      loanApplicationSteps: [String], // order of steps in loan flow
    },

    // Feature Flags
    features: {
      instantDisbursement: { type: Boolean, default: false },
      autoRepayment: { type: Boolean, default: false },
      partialpayment: { type: Boolean, default: false },
      renewalLoans: { type: Boolean, default: false },
      digitalContract: { type: Boolean, default: true },
    },

    // API Response Configuration
    apiResponses: {
      errorFormat: Object, // how errors should be formatted
      successFormat: Object, // how success should be formatted
      timeoutMs: { type: Number, default: 30000 },
      retryPolicy: Object, // retry configuration
    },

    updatedBy: { type: String, default: 'system' },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.model('AppConfiguration', appConfigSchema);
