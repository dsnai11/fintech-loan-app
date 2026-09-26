# 🧪 Backend API Testing Guide

## Prerequisites

### ✅ What's Working
- Backend server: http://localhost:5000
- Health endpoint: ✅ Responds
- API routes: ✅ Configured

### ⏳ What's Needed
- MongoDB connection: ⏳ **Required**

---

## Setup MongoDB (Choose One)

### Option 1: MongoDB Atlas (Cloud - Free)

**1. Create Free Account**
- Visit: https://www.mongodb.com/cloud/atlas
- Sign up (5 minutes)

**2. Create Cluster**
- Click "Create" button
- Select "M0 Free" tier
- Choose cloud provider and region
- Wait for cluster to be ready (2-3 minutes)

**3. Create Database User**
- Go to "Database Access"
- Click "Add New Database User"
- Username: `testuser`
- Password: `testpass123`
- Click "Add User"

**4. Get Connection String**
- Click "Connect"
- Select "Drivers"
- Copy connection string
- Format: `mongodb+srv://testuser:testpass123@cluster.mongodb.net/fintech-loan?retryWrites=true&w=majority`

**5. Update `.env` File**
```env
MONGODB_URI=mongodb+srv://testuser:testpass123@your-cluster.mongodb.net/fintech-loan?retryWrites=true&w=majority
```

**6. Restart Backend**
```bash
# Stop current backend (Ctrl+C)
# Then restart
cd backend
npm run dev
```

### Option 2: MongoDB Local

**1. Install MongoDB**
- Download: https://www.mongodb.com/try/download/community
- Run installer
- Accept defaults
- MongoDB will auto-start

**2. Verify Installation**
```bash
mongosh
# Should connect to MongoDB shell
# Type: exit
```

**3. Backend will auto-connect**
- .env already configured for localhost
- Run: `npm run dev`

---

## Test Endpoints

Once MongoDB is connected and backend shows `MongoDB connected`:

### 1. Health Check
```bash
curl http://localhost:5000/api/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "timestamp": "2026-09-26T09:00:00.000Z"
}
```

### 2. Signup New User
```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "password": "Test@123456",
    "confirmPassword": "Test@123456"
  }'
```

**Expected Response:**
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id_here",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "9876543210"
  }
}
```

**Save the token for next requests:**
```
TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "Test@123456"
  }'
```

**Expected Response:**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id_here",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "9876543210"
  }
}
```

### 4. Get User Profile
Requires authentication token!

```bash
curl http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response:**
```json
{
  "_id": "user_id",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "kycStatus": "pending",
  "employment": {
    "status": "Employed"
  }
}
```

### 5. Update Profile
```bash
curl -X PUT http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "phone": "9876543210",
    "employment": {
      "status": "Employed",
      "company": "TechCorp",
      "monthlyIncome": 50000
    }
  }'
```

**Expected Response:**
```json
{
  "message": "Profile updated successfully",
  "user": {
    "_id": "user_id",
    "firstName": "John",
    "employment": {
      "status": "Employed",
      "company": "TechCorp",
      "monthlyIncome": 50000
    }
  }
}
```

### 6. Apply for Loan
```bash
curl -X POST http://localhost:5000/api/loans/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "loanAmount": 100000,
    "tenure": 12,
    "purpose": "Personal",
    "loanType": "Personal Loan"
  }'
```

**Expected Response:**
```json
{
  "message": "Loan application submitted",
  "loan": {
    "id": "loan_id",
    "loanAmount": 100000,
    "tenure": 12,
    "monthlyEMI": 8992,
    "totalAmount": 107904,
    "status": "submitted",
    "interestRate": 15
  }
}
```

### 7. Get All User Loans
```bash
curl http://localhost:5000/api/loans \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response:**
```json
[
  {
    "_id": "loan_id",
    "loanAmount": 100000,
    "tenure": 12,
    "monthlyEMI": 8992,
    "status": "submitted",
    "applicationDate": "2026-09-26T09:00:00.000Z"
  }
]
```

### 8. Get Specific Loan
```bash
curl http://localhost:5000/api/loans/LOAN_ID \
  -H "Authorization: Bearer $TOKEN"
```

---

## Testing with Postman

### Import Collection

**1. Create New Collection**
- Open Postman
- Create new collection: "FinTech Loan API"

**2. Set Up Environment**
- Click "Environments" (gear icon)
- Create new: "FinTech Dev"
- Add variables:
  ```
  url: http://localhost:5000
  token: (leave empty, fill after login)
  ```

**3. Add Requests**

**Health Check**
```
GET {{url}}/api/health
```

**Signup**
```
POST {{url}}/api/auth/signup
Body (JSON):
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "password": "Test@123456",
  "confirmPassword": "Test@123456"
}

Tests (auto-save token):
var jsonData = pm.response.json();
pm.environment.set("token", jsonData.token);
```

**Login**
```
POST {{url}}/api/auth/login
Body (JSON):
{
  "email": "john@example.com",
  "password": "Test@123456"
}

Tests:
var jsonData = pm.response.json();
pm.environment.set("token", jsonData.token);
```

**Get Profile**
```
GET {{url}}/api/users/profile
Headers:
  Authorization: Bearer {{token}}
```

**Apply Loan**
```
POST {{url}}/api/loans/apply
Headers:
  Authorization: Bearer {{token}}
Body (JSON):
{
  "loanAmount": 100000,
  "tenure": 12,
  "purpose": "Personal",
  "loanType": "Personal Loan"
}
```

---

## Testing with PowerShell/Bash

### Save Token Variable

**PowerShell:**
```powershell
$token = "your_token_here"
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}
```

**Bash:**
```bash
TOKEN="your_token_here"
HEADERS="-H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json'"
```

### Make Authenticated Request

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:5000/api/users/profile" `
  -Headers $headers `
  -Method Get | ConvertFrom-Json
```

**Bash:**
```bash
curl -X GET http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

---

## Full Testing Workflow

### Step 1: Verify Backend Running
```bash
curl http://localhost:5000/api/health
# Should return: {"status":"OK",...}
```

### Step 2: Signup
```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test'$(date +%s)'@example.com",
    "phone": "9999999999",
    "password": "Test@123456",
    "confirmPassword": "Test@123456"
  }'
# Save token from response
```

### Step 3: View Profile
```bash
curl http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Step 4: Apply Loan
```bash
curl -X POST http://localhost:5000/api/loans/apply \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "loanAmount": 100000,
    "tenure": 12,
    "purpose": "Personal",
    "loanType": "Personal Loan"
  }'
```

### Step 5: View Loans
```bash
curl http://localhost:5000/api/loans \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Expected API Behavior

### Success Responses
- Status: 200 or 201
- Body: `{"message": "...", "data": {...}}`

### Error Responses
- Status: 400, 401, 403, 404, 500
- Body: `{"error": "Error message"}`

### Common Errors

**No Token**
```json
{
  "error": "No token provided"
}
```

**Invalid Token**
```json
{
  "error": "Invalid token"
}
```

**User Already Exists**
```json
{
  "error": "Email or phone already registered"
}
```

**Invalid Credentials**
```json
{
  "error": "Invalid email or password"
}
```

---

## Database Verification

Once data is created, verify in MongoDB:

**Using MongoDB Compass or mongosh:**

```javascript
// Connect to MongoDB
use fintech-loan

// View users
db.users.find()

// View loans
db.loans.find()

// View specific user
db.users.findOne({ email: "john@example.com" })

// View user's loans
db.loans.find({ userId: ObjectId("...") })
```

---

## Troubleshooting

### "MongoDB connection failed"
- Set up MongoDB Atlas account
- Get correct connection string
- Update .env with correct URL
- Restart backend: `npm run dev`
- Wait 10-20 seconds for connection

### "MongoDB connection timeout"
- Check internet connection
- Verify connection string format
- If using Atlas, whitelist your IP:
  - Go to Network Access
  - Click "Add IP Address"
  - Select "Add current IP"

### "No token provided"
- Include Authorization header
- Format: `Authorization: Bearer <token>`
- Not just: `Authorization: <token>`

### "Invalid token"
- Token may have expired
- Login again to get new token
- Copy full token from response

### "Email already registered"
- Use different email
- Include timestamp: `test+$(date +%s)@example.com`

---

## Success Checklist

```
✅ Backend running on port 5000
✅ Health endpoint responding
✅ MongoDB connected
✅ Can signup new user
✅ Can login with credentials
✅ Can view user profile
✅ Can update profile
✅ Can apply for loan
✅ Can view loan list
✅ Data saved in MongoDB
```

If all pass, API is fully functional! 🎉

---

## Next Steps

1. **Set up MongoDB** (Atlas or local)
2. **Restart backend** after MongoDB setup
3. **Run test commands** above
4. **Use Postman** for interactive testing
5. **Verify data in MongoDB**

---

**Once all tests pass, your backend API is ready for mobile app integration!**
