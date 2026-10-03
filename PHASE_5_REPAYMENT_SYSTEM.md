# 💰 Phase 5: Repayment & EMI System

## ✅ What's Built

### **Complete EMI Lifecycle**

```
Loan Approved & Disbursed
        ↓
EMI Schedule Created (12-60 months)
        ↓
Each Month: EMI Due Date Arrives
        ↓
Customer Makes Payment (Auto-debit)
        ↓
Payment Processed via Razorpay
        ↓
System Updates Payment Status
        ↓
After 12-60 months: Loan Closed
```

---

## 📊 Database Schema

### **EMIPayment Model**

```javascript
{
  loanId: ObjectId,              // Reference to loan
  userId: ObjectId,              // Customer
  emiNumber: 1-60,               // Which EMI (1st, 2nd, 3rd, etc.)
  dueDate: Date,                 // When EMI is due
  amount: 5000,                  // EMI amount
  principalAmount: 4000,         // Principal portion
  interestAmount: 1000,          // Interest portion
  status: 'PENDING',             // PENDING, PAID, OVERDUE, FAILED, WAIVED
  paidDate: Date,                // When customer paid
  paidAmount: 5500,              // Amount paid (includes penalty)
  paymentMethod: 'AUTO_DEBIT',   // How it was paid
  paymentGateway: 'RAZORPAY',    // Which gateway
  transactionId: 'txn_123',      // Razorpay ID
  daysOverdue: 15,               // How many days late
  penaltyApplied: 500,           // Penalty for late payment (2% per month)
  metadata: {
    razorpayResponse: {},        // Full gateway response
    failureReason: 'Insufficient funds',
    retryCount: 2,               // How many retries
    notificationSent: true,      // SMS/Email sent?
  }
}
```

---

## 🔌 API Endpoints

### **1. Get EMI Schedule**

```http
GET /api/emi/schedule/:loanId
```

**Response:**
```json
{
  "loanId": "507",
  "emis": [
    {
      "emiNumber": 1,
      "dueDate": "2026-11-01",
      "amount": 5000,
      "principalAmount": 4000,
      "interestAmount": 1000,
      "status": "PENDING",
      "paidDate": null,
      "daysOverdue": 0,
      "penaltyApplied": 0
    },
    {
      "emiNumber": 2,
      "dueDate": "2026-12-01",
      "amount": 5000,
      "status": "PAID",
      "paidDate": "2026-12-01",
      "paidAmount": 5000
    }
  ],
  "stats": {
    "total": 12,
    "pending": 10,
    "paid": 1,
    "overdue": 1,
    "failed": 0
  }
}
```

---

### **2. Initiate EMI Payment**

```http
POST /api/emi/initiate/:loanId/:emiNumber
Authorization: Bearer <user-token>
```

**Response:**
```json
{
  "message": "EMI payment initiated",
  "emiId": "emi_507_001",
  "invoiceId": "inv_ABC123",
  "amount": 5000,
  "emiNumber": 1
}
```

**What Happens:**
1. System creates Razorpay invoice
2. Customer receives payment link
3. Customer pays via UPI/Card/NetBanking
4. Webhook confirms payment
5. Status updates to PAID

---

### **3. EMI Payment Webhook**

```http
POST /api/emi/webhook/razorpay
X-Razorpay-Signature: <signature>
```

**Webhook Events:**
- `invoice.paid` → Mark EMI as PAID
- `invoice.failed` → Mark EMI as FAILED, apply penalty
- `invoice.issued` → EMI still PENDING

---

### **4. Get Payment History**

```http
GET /api/emi/history/:loanId
```

**Response:**
```json
{
  "loanId": "507",
  "total": 12,
  "payments": [
    {
      "emiNumber": 1,
      "dueDate": "2026-11-01",
      "amount": 5000,
      "status": "PAID",
      "paidDate": "2026-11-02",
      "paidAmount": 5250,
      "penaltyApplied": 250
    }
  ]
}
```

---

### **5. Admin: EMI Analytics**

```http
GET /api/emi/admin/analytics
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "totalEmis": 15000,
  "stats": {
    "paid": 12000,
    "pending": 2500,
    "overdue": 400,
    "failed": 100
  },
  "collections": {
    "totalCollected": 60000000,
    "totalPenalties": 500000,
    "collectionRate": "80%"
  }
}
```

---

### **6. Admin: Get Overdue EMIs**

```http
GET /api/emi/admin/overdue
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "total": 450,
  "emis": [
    {
      "loanId": "507",
      "customer": "Rahul Kumar",
      "emiNumber": 5,
      "amount": 5000,
      "daysOverdue": 15,
      "penalty": 250,
      "totalDue": 5250
    }
  ]
}
```

---

### **7. Admin: Mark Overdue EMIs**

```http
POST /api/emi/admin/check-overdue
Authorization: Bearer <admin-token>
```

**Runs Daily:** Checks all pending EMIs, marks overdue, calculates penalties

---

## 📱 Mobile App Implementation

### **Customer EMI Schedule Screen**

```
┌─────────────────────────────────┐
│ 📅 EMI SCHEDULE                 │
├─────────────────────────────────┤
│ Loan: ₹30,000                   │
│ Tenure: 12 months               │
│ Monthly EMI: ₹2,715             │
│ Interest Rate: 15% p.a.         │
├─────────────────────────────────┤
│ EMI #1  Oct 2026  ₹2,715  ✅    │
│ EMI #2  Nov 2026  ₹2,715  ✅    │
│ EMI #3  Dec 2026  ₹2,715  ⏰    │
│ EMI #4  Jan 2027  ₹2,715  ⏳    │
│         ...                     │
├─────────────────────────────────┤
│ Progress: 2/12 paid (16%)       │
│ ████████░░░░░░░░░░░░░░░░░      │
├─────────────────────────────────┤
│ [Pay Next EMI] [View Details]   │
└─────────────────────────────────┘
```

### **Payment Screen**

```
┌─────────────────────────────────┐
│ 💳 PAY EMI #3                   │
├─────────────────────────────────┤
│ Amount Due: ₹2,715              │
│ Due Date: Dec 1, 2026           │
│ Days Overdue: 0                 │
│ Penalty: ₹0                     │
│ Total: ₹2,715                   │
├─────────────────────────────────┤
│ [Pay Now]                       │
│ [Set Auto-debit]                │
│ [Request Extension]             │
└─────────────────────────────────┘
```

---

## ⚙️ Backend Implementation Details

### **How EMI Schedule is Created**

When loan is approved and disbursed:

```javascript
await emiService.createEMISchedule(loanId);
// Creates 12-60 EMI records with:
// - Calculated principal + interest split
// - Monthly due dates
// - Status: PENDING
```

### **How Penalties Work**

**Late Payment Penalty = 2% of EMI amount per month** (minimum ₹500)

```
EMI #3 due: Dec 1, 2026
Paid: Dec 16, 2026 (15 days late)
Penalty: 2% × ₹2,715 = ₹54 (or ₹500 minimum)
Total due: ₹2,715 + ₹500 = ₹3,215
```

### **Auto-debit Process**

1. Daily cron job checks for EMIs due
2. For each due EMI, system initiates Razorpay payment
3. Razorpay auto-debits customer's bank account
4. Webhook confirms payment
5. Status updated to PAID

---

## 📊 Integration with Other Phases

### **Phase 2 → Phase 5**
```
Customer applies for loan
        ↓
Loan is approved & disbursed (Phase 4)
        ↓
EMI schedule auto-created (Phase 5)
        ↓
Customer starts paying EMIs
```

### **Phase 3 → Phase 5**
```
Admin approves loan
        ↓
Admin clicks "Disburse"
        ↓
System auto-creates EMI schedule
        ↓
Admin dashboard shows EMI collection status
```

---

## 🎯 Key Features

| Feature | Details |
|---------|---------|
| **EMI Schedule** | Auto-calculated from loan amount, tenure, interest rate |
| **Smart EMI Split** | Each EMI split into principal + interest |
| **Auto-debit** | Monthly automatic payment via Razorpay |
| **Overdue Tracking** | System marks overdue after due date passes |
| **Penalty Calculation** | 2% per month (minimum ₹500) for late payments |
| **Collection Analytics** | Real-time dashboard for collections team |
| **Customer View** | Track payments, see due dates, pay anytime |
| **Admin Control** | Override status, waive penalties, retry payments |

---

## 🧪 Testing Flow

### **Step 1: Approval & Disbursement**
```
Admin approves loan → ₹30,000
Admin disbursement → Payment completed
System auto-creates 12 EMI records
```

### **Step 2: View EMI Schedule**
```
GET /api/emi/schedule/507
Returns 12 EMIs, all PENDING
```

### **Step 3: Pay EMI #1**
```
POST /api/emi/initiate/507/1
Returns Razorpay invoice
Customer pays → EMI status: PAID
```

### **Step 4: Check Status**
```
GET /api/emi/history/507
Shows 1 PAID, 11 PENDING
```

### **Step 5: After 12 Months**
```
All 12 EMIs: PAID
Loan status: closed
Customer notified
```

---

## 📈 Admin Dashboard Enhancements

### **EMI Collection Dashboard**

```
┌─────────────────────────────────┐
│ 📊 EMI COLLECTIONS             │
├─────────────────────────────────┤
│ Total EMIs: 15,000              │
│ Paid: 12,000 (80%)              │
│ Pending: 2,500 (16%)            │
│ Overdue: 400 (2%)               │
│ Failed: 100 (0.6%)              │
├─────────────────────────────────┤
│ Total Collected: ₹6 Cr          │
│ Penalties: ₹50 Lakh             │
│ Collection Rate: 80%            │
├─────────────────────────────────┤
│ [View Overdue] [Retry Failed]   │
│ [Send Reminders] [Analytics]    │
└─────────────────────────────────┘
```

---

## 🔐 Security Features

✅ **Payment Security**
- HMAC signature verification on webhooks
- Encrypted bank details
- No plain text sensitive data
- Audit trail for all payments

✅ **Data Security**
- Immutable payment records
- Role-based access control
- Transaction hashing
- Compliance logging

---

## 🚀 Deployment Checklist

Before going live:

- [ ] EMI schedule creation tested
- [ ] Penalty calculation verified
- [ ] Razorpay webhook configured
- [ ] Auto-debit flow tested
- [ ] Overdue detection working
- [ ] Admin dashboard functional
- [ ] Notifications tested
- [ ] Compliance checks passed
- [ ] Database backups configured
- [ ] 24/7 monitoring enabled

---

**Status**: ✅ **Phase 5 Backend Complete**
**Last Updated**: 2026-10-03
**Next**: Mobile App UI + Admin Dashboard

