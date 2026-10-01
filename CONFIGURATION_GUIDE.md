# 📋 Admin Configuration Management Guide

## Overview

Your LIFC fintech platform now has a **complete configuration management system**. All app settings, loan products, KYC flows, and features are managed from the **Admin Configuration Panel** in the web portal, and changes immediately sync to all connected APK/IPA apps.

## 🌐 Access URLs

| Component | URL | Purpose |
|---|---|---|
| **User Portal** | `http://10.10.1.117:3000` | Customer app (view loans, apply, verify KYC) |
| **Admin Config** | `http://10.10.1.117:3000/admin-config.html` | Manage all app settings |
| **Backend API** | `https://fintech-loan-app-production.up.railway.app/api` | REST API (production) |
| **Local Backend** | `http://localhost:5000/api` | REST API (local development) |

---

## 🔐 Admin Configuration Panel

### Access
1. Go to: `http://10.10.1.117:3000/admin-config.html`
2. Paste your **Admin JWT Token** (get from `/api/auth/login` as `admin@lifc.in`)
3. Click **"Login"**

### Features

#### 💰 **Loan Products**
Manage loan products offered to customers.

**Create Product:**
- Product Name: e.g., "Instant Personal Loan"
- Min Amount: ₹1,000
- Max Amount: ₹500,000
- Min/Max Tenure: 1-60 months
- Interest Rate: 15% (annual)

**Actions:**
- ✅ Add new products
- ✏️ Edit existing products
- 🗑️ Delete products

**Changes Reflect:** 
- APK/IPA apps fetch on app startup
- Web portal refreshes immediately

#### 🔐 **KYC Verification Flow**

Configure the sequence and type of KYC verifications:

**Available Steps:**
- **OTP**: SMS one-time password
- **PAN**: Permanent Account Number verification
- **Bank**: Bank account verification with IFSC lookup
- **Aadhar**: (optional) Aadhar e-KYC

**Configure:**
- Which steps are required
- Order of verification steps
- API endpoints for each step
- Error messages and success responses
- Retry limits per step

**Example Flow:**
1. OTP (required) → SMS verification
2. PAN (required) → Identity verification
3. Bank (required) → Account verification
4. Aadhar (optional) → e-KYC

#### 🔌 **Providers**

Switch between different service providers without code changes.

**SMS Providers:**
- Fast2SMS
- MSG91
- Twilio
- Sandbox (testing)

**PAN Verification:**
- Karza
- IDfy
- Sandbox (testing)

**Bank Verification:**
- Razorpay
- Cashfree
- Sandbox (testing)

**Bureau (Credit Score):**
- Equifax
- Sandbox (testing)

**Use Case:**
```
Production: Karza → Razorpay → Fast2SMS → Equifax
Testing:   Sandbox → Sandbox → Sandbox → Sandbox
```

#### 🎨 **UI Configuration**

Control what features are visible in the mobile app.

**Toggle:**
- ✅ Enable OTP Verification
- ✅ Enable PAN Verification
- ✅ Enable Bank Verification
- ✅ Enable Profile Updates

**Configure:**
- OTP Validity: 5 minutes (default)
- Max OTP Retries: 3 attempts
- Loan application steps order

**Use Case:**
- Disable PAN if using Aadhar instead
- Disable Bank if using auto-payment
- Adjust OTP validity per regulatory requirements

#### ⚡ **Feature Flags**

Enable/disable experimental and premium features.

**Available Flags:**
- 🚀 **Instant Disbursement**: Direct-to-bank transfer without 24h hold
- 🔄 **Auto Repayment**: Automatic EMI collection via e-NACH
- 💵 **Partial Payment**: Allow partial EMI payments
- 🔁 **Renewal Loans**: Auto-offer loans after repayment
- 📄 **Digital Contract**: e-Signature instead of physical

**Use Case:**
```
MVP Launch:  All disabled
Beta:        Enable Auto Repayment, Digital Contract
Production:  Enable all features
```

---

## 🔄 How Changes Work

### Change Flow
```
Admin Config Panel (Web)
    ↓
Backend Database (MongoDB)
    ↓
Configuration Version (incremented)
    ↓
Mobile Apps detect version change
    ↓
Fetch latest config from /api/app-config
    ↓
Update UI/behavior immediately
```

### Real-Time Sync
- **Web Portal**: Changes visible immediately
- **APK/IPA**: Apps check config on startup
  - If config version changed: auto-fetch new config
  - No app restart needed
  - Changes appear on next app open

---

## 📱 Mobile App Integration

### App Startup Flow
```javascript
// On app launch
const appConfig = await fetch('/api/app-config');
const savedVersion = localStorage.get('configVersion');

if (appConfig.version > savedVersion) {
  // New config available
  localStorage.set('config', appConfig);
  localStorage.set('configVersion', appConfig.version);
  // Rebuild UI based on new config
}
```

### Dynamic UI Building
```javascript
// Example: Show only required KYC steps
const kycSteps = appConfig.kycVerifications
  .filter(step => step.required && step.enabled)
  .sort((a, b) => a.order - b.order);

// Dynamically show screens based on config
kycSteps.forEach(step => {
  if (step.id === 'otp') showOTPScreen();
  if (step.id === 'pan') showPANScreen();
  if (step.id === 'bank') showBankScreen();
});
```

### Provider Usage
```javascript
// Example: Use configured provider
const bankProvider = appConfig.providers.bank.provider;

if (bankProvider === 'razorpay') {
  const result = await razorpayBankVerify(account);
} else if (bankProvider === 'cashfree') {
  const result = await cashfreeBankVerify(account);
} else {
  const result = await sandboxBankVerify(account);
}
```

---

## 🚀 Configuration Examples

### MVP Configuration
```json
{
  "loanProducts": [
    {
      "name": "Basic Personal Loan",
      "minAmount": 10000,
      "maxAmount": 100000,
      "interestRate": 15
    }
  ],
  "kycVerifications": [
    {"id": "otp", "order": 1, "required": true},
    {"id": "pan", "order": 2, "required": true}
  ],
  "providers": {
    "sms": "sandbox",
    "pan": "sandbox",
    "bank": "sandbox"
  },
  "features": {
    "instantDisbursement": false,
    "autoRepayment": false,
    "digitalContract": true
  }
}
```

### Production Configuration
```json
{
  "loanProducts": [
    {
      "name": "Instant Personal Loan",
      "minAmount": 5000,
      "maxAmount": 500000,
      "interestRate": 12
    },
    {
      "name": "Business Loan",
      "minAmount": 50000,
      "maxAmount": 1000000,
      "interestRate": 14
    }
  ],
  "kycVerifications": [
    {"id": "otp", "order": 1, "required": true},
    {"id": "pan", "order": 2, "required": true},
    {"id": "bank", "order": 3, "required": true},
    {"id": "aadhar", "order": 4, "required": false}
  ],
  "providers": {
    "sms": "fast2sms",
    "pan": "karza",
    "bank": "razorpay",
    "bureau": "equifax"
  },
  "features": {
    "instantDisbursement": true,
    "autoRepayment": true,
    "partialPayment": true,
    "renewalLoans": true,
    "digitalContract": true
  }
}
```

---

## 🔗 API Endpoints

### Public APIs (for mobile apps)
```
GET  /api/app-config              # Get all configuration
GET  /api/app-config/:section     # Get specific section
     Sections: loanProducts, kycVerifications, providers, 
               uiConfig, features
```

### Admin APIs (requires JWT token)
```
POST   /api/app-config/admin/loan-products
       Add new loan product

PUT    /api/app-config/admin/loan-products/:productId
       Update existing product

DELETE /api/app-config/admin/loan-products/:productId
       Delete product

PUT    /api/app-config/admin/kyc-verifications
       Update KYC flow

PUT    /api/app-config/admin/providers
       Update provider configuration

PUT    /api/app-config/admin/ui-config
       Update UI settings

PUT    /api/app-config/admin/features
       Update feature flags

GET    /api/app-config/admin/version
       Get current config version (for cache busting)
```

---

## 📊 Configuration Storage

### Database
- **Model**: `AppConfiguration` (MongoDB)
- **Collection**: `appconfigurations`
- **Auto-created**: On first access

### Fields
```javascript
{
  loanProducts: [],       // Array of loan product configs
  kycVerifications: [],   // Array of KYC step configs
  providers: {},          // SMS, PAN, Bank, Bureau
  uiConfig: {},           // UI feature toggles
  features: {},           // Feature flags
  version: 1,             // Incremented on each change
  updatedBy: "admin",     // Email of admin who updated
  updatedAt: Date         // Last update timestamp
}
```

---

## ✅ Verification Checklist

**Before going live:**

- [ ] Loan products configured with correct rates and limits
- [ ] KYC verification flow set up (OTP → PAN → Bank)
- [ ] Providers set to production (Karza, Razorpay, Fast2SMS)
- [ ] UI toggles match your product roadmap
- [ ] Feature flags set for MVP vs. Full features
- [ ] APK/IPA apps tested with live config
- [ ] Admin token secured (use strong password for admin@lifc.in)

**Testing changes:**

1. Change a configuration in admin panel
2. Restart APK/IPA app
3. Verify the change is reflected in the app
4. Check app logs for any errors

---

## 🔐 Security Notes

- Admin token required for all configuration changes
- Only admins (email: admin@lifc.in) can modify config
- Configuration changes logged with admin email
- Configuration version prevents caching old data
- All API calls to production use HTTPS

---

## 📞 Support

**Common Issues:**

**Q: Changes not appearing in APK/IPA**
- A: Apps cache config. Force-close and restart app.

**Q: Can't log in to admin panel**
- A: Use admin@lifc.in credentials. Get JWT token from `/api/auth/login`.

**Q: Provider not responding**
- A: Check if provider credentials are correct in environment variables on Railway.

**Q: Configuration not saving**
- A: Check admin token is valid. Verify backend is running.

---

**Version**: 1.0.0  
**Last Updated**: 2026-10-01  
**Status**: Production Ready
