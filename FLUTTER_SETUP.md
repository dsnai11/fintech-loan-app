# Flutter App Setup & Installation Guide

Flutter SDK is not currently installed on this system. Here's how to set it up:

## Option 1: Quick Installation (Recommended)

### Step 1: Download Flutter SDK
1. Visit: https://flutter.dev/docs/get-started/install/windows
2. Download **Flutter SDK** for Windows (v3.19.6 or latest stable)
3. Extract to: `C:\Flutter` (or your preferred location)

### Step 2: Add Flutter to PATH
**Windows 11/10:**
1. Press `Win + X` → System
2. Click "Advanced system settings"
3. Click "Environment Variables"
4. Under "User variables", click "New"
   - Variable name: `FLUTTER_HOME`
   - Variable value: `C:\Flutter`
5. Edit "Path" and add: `%FLUTTER_HOME%\bin`
6. Click OK and restart terminal

### Step 3: Verify Installation
```bash
flutter --version
dart --version
flutter doctor
```

Should show:
```
Flutter 3.19.6 • channel stable
Dart 3.x.x
```

## Option 2: Using Chocolatey (Windows Package Manager)

If you have Chocolatey installed:
```bash
choco install flutter
```

## Option 3: Using Scoop

```bash
scoop install flutter
```

## Setup Mobile Project After Installing Flutter

### Step 1: Navigate to Mobile Directory
```bash
cd "D:\project fintech\mobile"
```

### Step 2: Get Dependencies
```bash
flutter pub get
```

Output should show:
```
Running "flutter pub get" in mobile...
Got dependencies!
```

### Step 3: Check Android Setup
```bash
flutter doctor -v
```

Should show:
```
✓ Flutter (Channel stable, 3.19.6, ...)
✓ Android toolchain - develop for Android devices
✓ Android Studio (version 2023.x.x)
✓ VS Code (version 1.x.x)
✓ Connected devices (Android Emulator or Physical Device)
```

⚠️ If Android setup is incomplete, follow on-screen instructions.

## Step 4: Run the App

### Option A: Run on Android Emulator
```bash
# List available devices
flutter devices

# Run the app
flutter run

# Or specify device
flutter run -d <device_name>
```

### Option B: Run on Physical Android Phone
1. Enable **Developer Mode** on phone:
   - Go to Settings → About phone
   - Tap "Build number" 7 times
   - Go back to Settings → Developer options
   - Enable "USB Debugging"

2. Connect phone via USB

3. Run:
   ```bash
   flutter run
   ```

### Option C: Run on Windows (Desktop)
```bash
flutter run -d windows
```

## Configure Backend Connection

### For Local Backend
Edit `lib/services/api_service.dart`:
```dart
static const String baseUrl = 'http://localhost:5000/api';
```

### For Android Emulator + Local Backend
Edit `lib/services/api_service.dart`:
```dart
static const String baseUrl = 'http://10.0.2.2:5000/api';
```

### For Remote/Network Backend
Edit `lib/services/api_service.dart`:
```dart
static const String baseUrl = 'http://YOUR_MACHINE_IP:5000/api';
```

Find your IP:
```bash
ipconfig
# Look for "IPv4 Address"
```

## Testing the App

### 1. App Startup
- Splash screen appears (2 seconds)
- Routes to Login screen

### 2. Signup Flow
- Click "Sign Up"
- Fill in details:
  - First Name, Last Name
  - Email, Phone
  - Password (min 8 chars recommended)
- Click "Create Account"
- Should route to Home screen

### 3. Login Flow
- Enter email and password
- Click "Login"
- Should show user greeting on Home screen

### 4. Apply Loan
- On Home screen, click "Apply for Loan"
- Enter:
  - Loan Amount (₹1,000 - ₹500,000)
  - Tenure (6 - 60 months)
  - Purpose (dropdown)
  - Loan Type (dropdown)
- Real-time EMI calculation
- Click "Apply Now"

## Build APK for Release

### Step 1: Configure App Signing
```bash
# Generate keystore (one-time)
keytool -genkey -v -keystore D:\fintech-key.jks ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -alias fintech-key
```

### Step 2: Create Key Properties
Create `android/key.properties`:
```properties
storeFile=D:/fintech-key.jks
storePassword=your_password
keyPassword=your_password
keyAlias=fintech-key
```

### Step 3: Build APK
```bash
# Build release APK
flutter build apk --release

# Or split APKs (smaller size)
flutter build apk --release --split-per-abi
```

APK location: `build/app/outputs/flutter-app/release/app-release.apk`

### Step 4: Install on Device
```bash
adb install build/app/outputs/flutter-app/release/app-release.apk
```

## Troubleshooting

### "Flutter command not found"
- Ensure PATH is set correctly
- Restart terminal/IDE
- Check: `echo %FLUTTER_HOME%`

### "Android toolchain not found"
```bash
flutter doctor --android-licenses
# Accept all licenses
flutter doctor
```

### "Connected device not found"
```bash
flutter devices
adb devices
adb kill-server
adb start-server
```

### "Cannot connect to backend"
- Verify backend is running: `npm run dev`
- Check API URL in `api_service.dart`
- Verify no firewall blocking port 5000
- For emulator: Use `http://10.0.2.2:5000/api`

### "Build fails"
```bash
flutter clean
flutter pub get
flutter pub upgrade
flutter build apk --release
```

## Directory Structure
```
mobile/
├── lib/
│   ├── main.dart
│   ├── screens/
│   │   ├── splash_screen.dart
│   │   ├── login_screen.dart
│   │   ├── signup_screen.dart
│   │   ├── home_screen.dart
│   │   └── loan_application_screen.dart
│   └── services/
│       ├── api_service.dart
│       └── auth_service.dart
├── android/
│   └── app/
│       └── build.gradle
├── pubspec.yaml
└── README.md
```

## Useful Commands

```bash
# Clean and rebuild
flutter clean
flutter pub get

# Run with verbose output
flutter run -v

# Run on specific device
flutter run -d <device_id>

# Run in release mode
flutter run --release

# Check dependencies
flutter pub deps

# Update dependencies
flutter pub upgrade

# Format code
dart format lib/

# Analyze code
dart analyze

# Get app logs
flutter logs
```

## Environment Setup Summary

```
✓ Node.js v24.19.0 - Backend ✓
✓ npm packages - 139 installed ✓
✓ Backend server - Running on port 5000 ✓
⏳ Flutter SDK - Needs installation
⏳ Android SDK - Needs setup
⏳ Mobile app - Ready to run (after Flutter install)
```

## Next Steps After Installing Flutter

1. ```bash
   cd "D:\project fintech\mobile"
   flutter pub get
   flutter run
   ```

2. Test signup/login with the running backend

3. Build APK for distribution:
   ```bash
   flutter build apk --release
   ```

---

**Once Flutter is installed, come back and we'll start the app immediately!**
