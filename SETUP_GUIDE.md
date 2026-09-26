# FinTech Instant Loan Application - Setup Guide

Complete guide to set up and run both backend and mobile app.

## Prerequisites

### Backend
- Node.js (v18 or higher)
- npm or yarn
- MongoDB (local or cloud - MongoDB Atlas)
- Postman (optional, for API testing)

### Mobile
- Flutter SDK (v3.0 or higher)
- Android SDK (for APK development)
- Android Studio or VS Code with Flutter extension

## Backend Setup

### Step 1: Install Dependencies
```bash
cd backend
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/fintech-loan
JWT_SECRET=your_secure_jwt_secret_here
NODE_ENV=development
DEFAULT_INTEREST_RATE=15
```

**For MongoDB:**
- **Local**: `mongodb://localhost:27017/fintech-loan`
- **MongoDB Atlas (Cloud)**:
  ```
  mongodb+srv://username:password@cluster.mongodb.net/fintech-loan?retryWrites=true&w=majority
  ```

### Step 3: Start MongoDB (if using local)
```bash
# Windows
mongod

# Mac/Linux
brew services start mongodb-community
```

### Step 4: Start Backend Server
```bash
npm run dev
```

Server will run on `http://localhost:5000`

Test health endpoint:
```bash
curl http://localhost:5000/api/health
```

## Mobile Setup

### Step 1: Install Flutter Dependencies
```bash
cd mobile
flutter pub get
```

### Step 2: Update API Base URL (if needed)
Edit `lib/services/api_service.dart`:

```dart
static const String baseUrl = 'http://YOUR_BACKEND_URL/api';
```

For Android emulator connecting to local backend:
```dart
static const String baseUrl = 'http://10.0.2.2:5000/api';
```

### Step 3: Run the App (Development)
```bash
# List connected devices
flutter devices

# Run on emulator
flutter run

# Run on specific device
flutter run -d <device_id>
```

### Step 4: Build APK for Release
```bash
# Build release APK
flutter build apk --release

# APK location: build/app/outputs/flutter-app/release/app-release.apk

# Build split APKs (smaller size)
flutter build apk --release --split-per-abi

# APK locations: build/app/outputs/flutter-app/release/
```

### Step 5: Install APK on Device
```bash
# Install APK on connected device
adb install build/app/outputs/flutter-app/release/app-release.apk

# Or use Flutter directly
flutter install --release
```

## Testing the Application

### Test Account (after signup)
- First Name: John
- Last Name: Doe
- Email: john@example.com
- Phone: 9876543210
- Password: Test@123

### API Testing with Postman

1. **Signup:**
   ```
   POST http://localhost:5000/api/auth/signup
   Content-Type: application/json
   
   {
     "firstName": "John",
     "lastName": "Doe",
     "email": "john@example.com",
     "phone": "9876543210",
     "password": "Test@123",
     "confirmPassword": "Test@123"
   }
   ```

2. **Login:**
   ```
   POST http://localhost:5000/api/auth/login
   Content-Type: application/json
   
   {
     "email": "john@example.com",
     "password": "Test@123"
   }
   ```

3. **Apply for Loan:**
   ```
   POST http://localhost:5000/api/loans/apply
   Authorization: Bearer <token_from_login>
   Content-Type: application/json
   
   {
     "loanAmount": 100000,
     "tenure": 12,
     "purpose": "Personal",
     "loanType": "Personal Loan"
   }
   ```

## Project Structure

```
project-fintech/
├── backend/
│   ├── src/
│   │   ├── models/
│   │   │   ├── User.js
│   │   │   └── Loan.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── loans.js
│   │   │   └── users.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   └── index.js
│   ├── .env.example
│   └── package.json
│
├── mobile/
│   ├── lib/
│   │   ├── main.dart
│   │   ├── screens/
│   │   │   ├── splash_screen.dart
│   │   │   ├── login_screen.dart
│   │   │   ├── signup_screen.dart
│   │   │   ├── home_screen.dart
│   │   │   └── loan_application_screen.dart
│   │   └── services/
│   │       ├── api_service.dart
│   │       └── auth_service.dart
│   └── pubspec.yaml
```

## Troubleshooting

### Backend Issues

**Port Already in Use:**
```bash
# Change port in .env or kill process on port 5000
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -i :5000
kill -9 <PID>
```

**MongoDB Connection Error:**
- Verify MongoDB is running
- Check connection string in `.env`
- Ensure database name exists

**CORS Error in Mobile App:**
- Check backend is running
- Verify API URL in `api_service.dart`
- Ensure backend allows requests from mobile

### Mobile App Issues

**APK Build Fails:**
```bash
flutter clean
flutter pub get
flutter build apk --release
```

**Emulator Connection Issues:**
```bash
adb kill-server
adb start-server
flutter devices
```

## Next Steps

1. **Frontend Enhancements:**
   - Add KYC verification screens
   - Implement loan status tracking
   - Add repayment history UI

2. **Backend Features:**
   - Implement instant approval logic
   - Add credit scoring algorithm
   - Integrate payment gateway
   - Add SMS/Email notifications

3. **Security:**
   - Implement rate limiting
   - Add input validation
   - Enable HTTPS for production
   - Add fraud detection

4. **Testing:**
   - Unit tests for backend APIs
   - Widget tests for Flutter screens
   - Integration tests for workflows

## Support

For issues or questions:
1. Check logs: Backend logs in terminal, Flutter logs with `flutter logs`
2. Review API documentation: See `backend/API_DOCS.md`
3. Check GitHub issues or create new ones

## License

This project is for educational purposes.
