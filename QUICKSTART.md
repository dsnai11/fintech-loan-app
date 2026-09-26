# Quick Start Guide - FinTech Loan App

Get the app running in 5 minutes!

## 🚀 Quick Setup

### Backend (Terminal 1)
```bash
cd backend
npm install
npm run dev
```
✅ Server running on `http://localhost:5000`

### Mobile (Terminal 2)
```bash
cd mobile
flutter pub get
flutter run
```
✅ App running on emulator/device

## 📱 Try It Out

### 1. Signup
- Tap "Sign Up" on the login screen
- Fill in your details
- Create password
- Tap "Create Account"

### 2. Login
- Use your email and password
- Tap "Login"

### 3. Apply for Loan
- Tap "Apply for Loan" on home screen
- Enter loan amount (₹1000 - ₹500000)
- Select tenure (6 - 60 months)
- Choose purpose and loan type
- View calculated EMI
- Tap "Apply Now"

## 🔧 Configuration Changes

### Change Backend URL
If backend is not on localhost, edit `mobile/lib/services/api_service.dart`:
```dart
static const String baseUrl = 'http://YOUR_IP:5000/api';
```

### Change MongoDB Connection
Edit `backend/.env`:
```env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/fintech-loan
```

## 📦 Build APK

```bash
cd mobile
flutter build apk --release
```
APK will be at: `build/app/outputs/flutter-app/release/app-release.apk`

## 🧪 Test with Postman

**Signup:**
```
POST http://localhost:5000/api/auth/signup
Body:
{
  "firstName": "Test",
  "lastName": "User",
  "email": "test@example.com",
  "phone": "9999999999",
  "password": "Test@123",
  "confirmPassword": "Test@123"
}
```

**Login:**
```
POST http://localhost:5000/api/auth/login
Body:
{
  "email": "test@example.com",
  "password": "Test@123"
}
```

**Apply Loan:**
```
POST http://localhost:5000/api/loans/apply
Authorization: Bearer <token_from_login>
Body:
{
  "loanAmount": 100000,
  "tenure": 12,
  "purpose": "Personal",
  "loanType": "Personal Loan"
}
```

## 📚 Full Documentation
- Backend API: See `backend/API_DOCS.md`
- Complete Setup: See `SETUP_GUIDE.md`
- Project Info: See `README.md`

## ⚡ Useful Commands

**Backend:**
```bash
npm run dev      # Start with auto-reload
npm start        # Start production
```

**Mobile:**
```bash
flutter clean    # Clean build
flutter pub get  # Get dependencies
flutter run      # Run in debug mode
flutter build apk --release  # Build release APK
```

## 🎯 Features Implemented

✅ User Authentication (Signup/Login)
✅ Loan Application Form
✅ EMI Calculator
✅ MongoDB Database
✅ JWT Token Authentication
✅ Responsive UI
✅ Error Handling
✅ User Profile Management

## 🔜 Coming Soon

- [ ] KYC Verification
- [ ] Instant Approval System
- [ ] Payment Gateway Integration
- [ ] Loan Status Dashboard
- [ ] Repayment Management
- [ ] SMS/Email Notifications
- [ ] Advanced Security Features

## ❓ Troubleshooting

**Backend won't start?**
- Check if port 5000 is free
- Verify MongoDB is running
- Check `.env` configuration

**Mobile won't connect to backend?**
- Verify backend is running
- Check API URL in `api_service.dart`
- For emulator: Use `http://10.0.2.2:5000/api`

**APK build fails?**
```bash
flutter clean
flutter pub get
flutter build apk --release
```

## 📞 Need Help?
1. Check full documentation in `SETUP_GUIDE.md`
2. Review API docs in `backend/API_DOCS.md`
3. Check Flutter logs: `flutter logs`
4. Check backend logs in terminal

---

**Happy Building! 🎉**
