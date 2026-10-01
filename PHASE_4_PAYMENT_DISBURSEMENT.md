# 💳 Phase 4: Payment Disbursement & Integration

## ✅ What's Built

### **Complete Payment Lifecycle**

```
Admin Approves Loan
        ↓
  Initiates Disbursement
        ↓
  Razorpay Payout Created
        ↓
  NEFT Transfer (1-2 hours)
        ↓
  Status Updated (Webhook)
        ↓
  Loan Status: Active
        ↓
  Repayment Schedule Starts
```

---

## 🏦 Payment Gateway Integration

### **Razorpay Payouts (Production)**

**What Happens:**
1. Admin clicks "Disburse" on approved loan
2. System calls Razorpay Payouts API
3. Creates NEFT transfer to customer's bank account
4. Status: PROCESSING (1-2 hours for NEFT)
5. Webhook confirms when completed
6. Loan marked as "Active"

**Security:**
- API key authentication
- HMAC signature verification on webhooks
- No plain text bank details
- Encrypted transmission

**Supported Transfer Methods:**
- ✅ NEFT (1-2 hours, no charges)
- ✅ IMPS (Instant, charges apply)
- ✅ RTGS (For large amounts)

### **Sandbox Mode (Testing)**

For testing without real Razorpay account:
```
PAYMENT_MODE=SANDBOX  // Set in .env
```

**What Happens:**
- Instantly completes transfers
- Creates mock transaction records
- Updates loan status immediately
- No actual bank charges

---

## 📊 Database Schema

### **Transaction Model**

```javascript
{
  loanId: ObjectId,              // Reference to loan
  userId: ObjectId,              // Customer who received funds
  type: 'DISBURSEMENT',          // Transaction type
  amount: 30000,                 // Amount in ₹
  status: 'COMPLETED',           // PENDING, PROCESSING, COMPLETED, FAILED, REVERSED
  paymentGateway: 'RAZORPAY',    // RAZORPAY, CASHFREE, SANDBOX
  transferId: 'payout_ABC123',   // Razorpay payout ID
  bankDetails: {
    accountNumber: 'XXXXX1234',  // Masked
    ifscCode: 'SBIN0001234',
    accountHolder: 'John Doe',
    bankName: 'State Bank of India'
  },
  metadata: {
    razorpayStatus: 'completed',
    completedAt: Date,
    failureReason: null,
    webhookProcessed: true,
    initiatedBy: 'admin@lifc.in'
  },
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🔌 API Endpoints

### **1. Initiate Disbursement**

```http
POST /api/payments/disburse/:loanId
Authorization: Bearer <admin-token>
Content-Type: application/json
```

**Request:**
```json
{}
```

**Response:**
```json
{
  "message": "Disbursement initiated",
  "transactionId": "txn_507_123",
  "transferId": "payout_ABC123",
  "status": "processing",
  "amount": 30000,
  "estimatedTime": "1-2 hours (NEFT)"
}
```

**Status Codes:**
- `200`: Disbursement initiated successfully
- `400`: Loan not approved / Already disbursed / Bank details missing
- `404`: Loan not found
- `500`: Payment gateway error

---

### **2. Check Disbursement Status**

```http
GET /api/payments/status/:loanId
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "loanId": "loan_507",
  "transactionId": "txn_507_123",
  "type": "DISBURSEMENT",
  "amount": 30000,
  "status": "COMPLETED",
  "bankDetails": {
    "accountNumber": "XXXXX1234",
    "ifscCode": "SBIN0001234",
    "accountHolder": "John Doe"
  },
  "createdAt": "2026-10-01T10:30:00Z",
  "completedAt": "2026-10-01T11:45:00Z"
}
```

**Status Values:**
- `PENDING`: Waiting to process
- `PROCESSING`: Razorpay processing (1-2 hours NEFT)
- `COMPLETED`: ✅ Successfully transferred
- `FAILED`: ❌ Transfer failed
- `REVERSED`: Transfer was reversed

---

### **3. Get Transaction History**

```http
GET /api/payments/history
Authorization: Bearer <user-token>
```

**Response:**
```json
{
  "total": 1,
  "transactions": [
    {
      "loanId": { "amount": 30000, "tenure": 12 },
      "type": "DISBURSEMENT",
      "amount": 30000,
      "status": "COMPLETED",
      "createdAt": "2026-10-01T10:30:00Z"
    }
  ]
}
```

---

### **4. Retry Failed Disbursement**

```http
POST /api/payments/retry/:loanId
Authorization: Bearer <admin-token>
```

**Use case:** If disbursement failed, admin can retry

**Response:**
```json
{
  "message": "Disbursement retry initiated",
  "transactionId": "txn_507_124",
  "transferId": "payout_DEF456",
  "status": "processing"
}
```

---

### **5. Payment Analytics**

```http
GET /api/payments/analytics/summary
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "totalDisbursed": 840000,
  "disbursementStats": {
    "COMPLETED": { "count": 28, "amount": 840000 },
    "PROCESSING": { "count": 2, "amount": 60000 },
    "FAILED": { "count": 1, "amount": 30000 }
  },
  "avgDisbursementTimeMinutes": 78,
  "failureRate": "3.33%"
}
```

---

### **6. Razorpay Webhook**

```http
POST /api/payments/webhook/razorpay
X-Razorpay-Signature: <signature>
Content-Type: application/json
```

**Webhook Events Handled:**
- `payout.completed`: Transfer successful
- `payout.failed`: Transfer failed
- `payout.reversed`: Transfer reversed

**Webhook Processing:**
1. Verifies HMAC signature
2. Updates transaction status
3. Updates loan status
4. Sends notification to customer

---

## 🧪 Testing Flow

### **Scenario: Approve and Disburse Loan**

**Step 1: Admin Approves Loan**
```
Admin Dashboard → Loan LN001 → Click "Approve"
Status changes: "Under Review" → "Approved"
```

**Step 2: Admin Initiates Disbursement**
```
POST /api/payments/disburse/507
Response: {
  status: "processing",
  transferId: "payout_ABC123"
}
```

**Step 3: Check Status (Polling)**
```
GET /api/payments/status/507
Response: {
  status: "PROCESSING",
  amount: 30000
}
// Repeats every 30 seconds until completed
```

**Step 4: Webhook Confirms (Auto)**
```
Razorpay Webhook arrives:
{
  event: "payout.completed",
  payload: { transferId: "payout_ABC123", ... }
}
// System updates: status → "COMPLETED", loan → "Active"
```

**Step 5: Customer Sees Funds**
```
Money arrives in customer's bank account
Loan status: "Active"
EMI repayment schedule begins
```

---

## 🎛️ Configuration

### **Environment Variables**

```bash
# Razorpay Credentials
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxx
RAZORPAY_ACCOUNT_ID=12345678901234

# Payment Mode
PAYMENT_MODE=PRODUCTION    # or SANDBOX for testing

# Webhook
RAZORPAY_WEBHOOK_URL=https://yourapi.com/api/payments/webhook/razorpay
```

### **.env Example (Sandbox)**

```bash
# For local testing
PAYMENT_MODE=SANDBOX
RAZORPAY_KEY_ID=rzp_test_key
RAZORPAY_KEY_SECRET=rzp_test_secret
```

---

## 📊 Admin Dashboard Updates

### **Loan Management Dashboard - Disbursement Section**

Added to loan detail modal:

```
STATUS TABS:
┌─────────────────────────────────┐
│ Pending | Approved | Active ✅  │
└─────────────────────────────────┘

DISBURSEMENT SECTION:
┌─────────────────────────────────┐
│ Status: COMPLETED ✅             │
│ Amount: ₹30,000                 │
│ Method: NEFT                     │
│ Transfer ID: payout_ABC123      │
│ Sent To: SBIN0001234            │
│ Completed: 2026-10-01 11:45 AM │
│                                 │
│ [📊 View History]               │
└─────────────────────────────────┘
```

---

## ⚠️ Error Handling

### **Common Failures & Fixes**

| Error | Cause | Fix |
|-------|-------|-----|
| "Bank details not verified" | Customer hasn't verified bank | Ask customer to re-verify bank |
| "Payout failed: Invalid account" | Wrong account number | Retry after customer corrects |
| "Daily limit exceeded" | Razorpay daily payout limit | Retry next day or use higher limit |
| "Account suspended" | Bank blocked the account | Contact customer's bank |

### **Automatic Retries**

System automatically retries failed disbursements:
1. First retry: After 1 hour
2. Second retry: After 4 hours
3. Third retry: After 24 hours
4. After 3 failures: Marked as failed, requires manual review

---

## 🔐 Security Checklist

✅ **API Security**
- JWT authentication on all endpoints
- Admin-only disbursement endpoints
- Rate limiting on retry endpoint

✅ **Payment Security**
- HMAC signature verification on webhooks
- No plain text bank account numbers
- Encrypted API communication (HTTPS)
- Sensitive data masked in logs

✅ **Data Security**
- Transaction records immutable
- Audit trail of all transfers
- Webhook signature validation
- No sensitive data in error messages

---

## 📈 Transaction Flow Diagram

```
Customer
  ↓
Submits Loan Application → Database: "Under Review"
  ↓
Admin Reviews & Approves → Database: "Approved"
  ↓
Admin Clicks "Disburse" → 
  ↓
System Calls Razorpay API →
  ↓
Razorpay Creates Payout → Database: Transaction "PROCESSING"
  ↓
NEFT Transfer Initiated (1-2 hours) →
  ↓
Razorpay Sends Webhook "payout.completed" →
  ↓
System Processes Webhook →
  ↓
Database: Transaction "COMPLETED", Loan "Active"
  ↓
Customer Receives Funds in Bank Account
  ↓
EMI Schedule Begins
```

---

## 🎯 What's Now Complete

| Component | Status |
|-----------|--------|
| **Approval System** | ✅ Phase 3 |
| **Payment Gateway** | ✅ Phase 4 |
| **Disbursement** | ✅ Phase 4 |
| **Status Tracking** | ✅ Phase 4 |
| **Webhook Handling** | ✅ Phase 4 |
| **Analytics** | ✅ Phase 4 |
| **Error Handling** | ✅ Phase 4 |
| **Admin Dashboard** | ✅ Phase 3-4 |

---

## ⏳ What's Next (Phase 5)

### **Repayment & EMI Collection**

- [ ] EMI Schedule calculation
- [ ] Auto-debit from customer account
- [ ] Payment tracking
- [ ] Late payment notifications
- [ ] Default handling
- [ ] Loan closure

---

## 🚀 Deployment Checklist

Before going live with Razorpay:

- [ ] Get Razorpay API keys from dashboard
- [ ] Set up webhook in Razorpay dashboard
- [ ] Test with sandbox credentials
- [ ] Get compliance approval for bank transfers
- [ ] Set up 24/7 monitoring
- [ ] Document incident response procedures
- [ ] Train support team on payment issues
- [ ] Set up email/SMS notifications to customers

---

**Status**: ✅ **Phase 4 Complete**
**Last Updated**: 2026-10-01
**Ready for**: Phase 5 (Repayment System)
