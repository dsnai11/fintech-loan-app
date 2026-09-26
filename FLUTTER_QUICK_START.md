# 🚀 Flutter App Quick Start

## Current Project Status

```
✅ Backend API        - RUNNING on http://localhost:5000
✅ Database Models    - Created (User, Loan)
✅ API Endpoints      - Auth, Users, Loans
✅ Flutter Project    - Structure created
⏳ Flutter SDK        - NOT INSTALLED (need to install)
⏳ Android Emulator   - Need to set up
```

## 5-Minute Flutter Installation

### For Windows 11/10:

**1. Download Flutter (1 minute)**
- Go to: https://flutter.dev/docs/get-started/install/windows
- Download latest stable (v3.19.6+)
- Extract to: `C:\Flutter` (or preferred location)

**2. Add to PATH (2 minutes)**
- Press `Win + X` → System
- Click "Advanced system settings"
- Click "Environment Variables"
- Add new User Variable:
  - Name: `FLUTTER_HOME`
  - Value: `C:\Flutter` (your extraction path)
- Edit "Path" variable, add: `%FLUTTER_HOME%\bin`
- Click OK, restart terminal

**3. Verify Installation (1 minute)**
```bash
flutter --version
flutter doctor
```

**4. Start App (1 minute)**
```bash
cd D:\project fintech\mobile
flutter pub get
flutter run
```

## Alternative: Chocolatey (1 command)

If you have Chocolatey installed:
```bash
choco install flutter
```

Then run the app:
```bash
cd D:\project fintech\mobile
flutter pub get
flutter run
```

## Requirements for Running

### Minimum:
- ✅ Flutter SDK installed
- ✅ Dart SDK (comes with Flutter)
- ⏳ Android Emulator OR physical phone

### For Android Emulator:
- Android Studio (includes emulator)
- Virtual device created
- API 21+ recommended

### For Physical Phone:
- USB cable
- Developer mode enabled
- USB Debugging enabled

## What You'll See

1. **Splash Screen** (2 seconds)
   - Loading animation
   - Routes to Login

2. **Login/Signup Screen**
   - Beautiful card-based design
   - Form validation
   - Error messages

3. **Home Screen** (after login)
   - User greeting
   - Quick action cards:
     - Apply for Loan
     - Loan History
     - EMI Calculator
     - My Profile

4. **Loan Application**
   - Real-time EMI calculator
   - Loan amount & tenure input
   - Purpose & type selection
   - Submission to backend

## Backend Connection

App automatically connects to:
```
http://localhost:5000/api
```

For Android Emulator:
```
http://10.0.2.2:5000/api
```

(Emulator route to host machine)

## Test Flow

1. **Sign Up**
   ```
   First Name: John
   Last Name: Doe
   Email: john@test.com
   Phone: 9876543210
   Password: Test@123
   ```

2. **After Signup**
   - Auto-logged in
   - Routed to Home screen

3. **Apply Loan**
   - Amount: 100000
   - Tenure: 12
   - Purpose: Personal
   - See calculated EMI

4. **Check Backend**
   - Visit: http://localhost:5000/api/users/profile
   - Use token from signup response
   - See saved user data

## Project Structure

```
D:\project fintech\
├── backend/              ✅ Running
│   ├── src/
│   ├── .env             ✅ Created
│   └── node_modules/    ✅ Installed
│
├── mobile/              ✓ Ready
│   ├── lib/
│   │   ├── main.dart
│   │   ├── screens/
│   │   └── services/
│   ├── pubspec.yaml
│   └── pubspec.lock
│
├── README.md
├── SETUP_GUIDE.md
├── FLUTTER_SETUP.md
└── BACKEND_RUNNING.md
```

## File Size & Download Time

- Flutter SDK: ~670 MB
- Download time: 2-10 minutes (depending on internet)
- Installation: ~2 minutes

## Troubleshooting During Setup

### "Command not found: flutter"
```bash
# Add to PATH and restart terminal
echo %FLUTTER_HOME%
# Should show: C:\Flutter
```

### "Android toolchain not found"
```bash
flutter doctor --android-licenses
# Accept all licenses
flutter doctor
```

### "No devices found"
```bash
flutter devices
# If empty, need to start Android Emulator or connect phone
```

### "Can't connect to backend"
```bash
# Check backend is running
curl http://localhost:5000/api/health

# Check API URL in app
# Edit: mobile/lib/services/api_service.dart
```

## Quick Verify Checklist

Before running the app:

- [ ] Flutter installed (`flutter --version`)
- [ ] Backend running (`npm run dev` in backend/)
- [ ] Android Emulator started or phone connected
- [ ] Mobile dependencies installed (`flutter pub get`)

## Full Setup Commands

```bash
# Terminal 1 - Backend (already running)
cd backend
npm run dev

# Terminal 2 - Mobile
cd mobile
flutter pub get
flutter run

# Terminal 3 - View logs (optional)
cd mobile
flutter logs
```

## Build & Share APK

Once app works in emulator:

```bash
flutter build apk --release

# APK location:
# D:\project fintech\mobile\build\app\outputs\flutter-app\release\app-release.apk

# Install on phone:
adb install app-release.apk
```

## Next Step

1. **Install Flutter** (5 minutes)
2. Come back here and run:
   ```bash
   cd D:\project fintech\mobile
   flutter pub get
   flutter run
   ```

---

**Once Flutter is installed, run `flutter run` and you'll have a working fintech app! 🎉**
