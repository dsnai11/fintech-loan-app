# 🎯 Install Flutter NOW - Step by Step

**Current Status:**
- ✅ Backend: Running on port 5000
- ✅ Mobile App Code: Ready
- ❌ Flutter SDK: Not installed
- ❌ Android Tools: Not installed

## Installation Steps (15-20 minutes)

### STEP 1: Install Java JDK
Required by Android tools.

1. Download: https://www.oracle.com/java/technologies/downloads/#java17
2. Select "Windows x64 Installer"
3. Run installer, accept defaults
4. Restart terminal when done

### STEP 2: Install Android Studio
Includes Android SDK and Emulator.

1. Download: https://developer.android.com/studio
2. Run installer (googlesoftwareupdates.exe)
3. Follow setup wizard:
   - Choose "Standard" installation
   - Select default SDK location
   - Create virtual device (or skip, do later)
4. Finish installation
5. Open Android Studio

### STEP 3: Install Flutter SDK

**Option A: Direct Download & Extract**
1. Download: https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.19.6-stable.zip
2. Extract to: `C:\Flutter` (important: exact path)
3. Right-click folder → Properties → verify path is exactly `C:\Flutter`

**Option B: Using Zip** (if already have)
```bash
# If download is in Downloads
Move-Item "C:\Users\sjaid\Downloads\flutter_windows*.zip" "C:\"
Expand-Archive "C:\flutter_windows*.zip" "C:\"
```

### STEP 4: Add Flutter to PATH

**Windows 11/10 - Quick Way:**

1. Press **Windows Key + X** → "System"
2. Click "Advanced system settings" (right panel)
3. Click "Environment Variables" button
4. Under "User variables" section, click **New**
   ```
   Variable name:  FLUTTER_HOME
   Variable value: C:\Flutter
   ```
   Click OK
5. In same dialog, find "Path" variable → Click **Edit**
6. Click **New** and add:
   ```
   %FLUTTER_HOME%\bin
   ```
   Click OK
7. **Close all terminals and restart them**

### STEP 5: Verify Installation

Open **NEW terminal** and run:

```bash
# Check Flutter
flutter --version

# Check Dart
dart --version

# Full doctor check
flutter doctor
```

**Expected output:**
```
Flutter 3.19.6 • channel stable
Dart 3.x.x
Doctor summary (to see all details, run flutter doctor -v):
[✓] Flutter
[✓] Android toolchain
[✓] Android Studio
[!] Connected devices
```

If Android toolchain shows ✗, run:
```bash
flutter doctor --android-licenses
# Accept all licenses
y
y
y
...
```

### STEP 6: Set Up Android Emulator (OPTIONAL - if no phone)

If you want to test on emulator:

1. Open Android Studio
2. Tools → Device Manager
3. Create Virtual Device
4. Select device type (Pixel 6 recommended)
5. Select system image (API 34 or higher)
6. Finish creation
7. Start the emulator (play button)

### STEP 7: Connect Device

**Option A: Android Emulator** (from Step 6)
- Already set up above

**Option B: Physical Phone**
1. Connect phone via USB cable
2. Enable Developer Mode:
   - Settings → About phone
   - Tap "Build number" 7 times
   - Back to Settings → Developer options
   - Enable "USB Debugging"
3. Allow USB access on phone when prompted

### STEP 8: Start the Mobile App

Open terminal in project folder:

```bash
cd D:\project fintech\mobile

# Get dependencies
flutter pub get

# Run the app
flutter run
```

**Choose device if multiple are connected:**
```
Multiple devices found:
1. Android Emulator (emulator-5554)
2. Samsung S21 (device-id)

Which device do you want to use (or 'all')?
```

Type `1` or device number and press Enter.

### STEP 9: See Your App!

```
Launching lib\main.dart on Android Emulator in debug mode...
Compiling... (takes 30-60 seconds on first run)
✓ Built and installed on emulator

Launching the default browser to http://localhost:xxxxx/#/
```

The app will:
1. Show splash screen (2 seconds)
2. Route to login screen
3. Ready to signup/test!

## What Happens Next

App will be running and you can:

1. **Sign Up** - Create account
2. **Login** - Use created account
3. **Apply Loan** - Test loan application
4. **View EMI** - Real-time calculator
5. **Backend Integration** - Data saved in MongoDB

## Total Time Required

| Step | Time | Status |
|------|------|--------|
| 1. Java JDK | 3-5 min | Required |
| 2. Android Studio | 5-10 min | Required |
| 3. Flutter SDK | 2-3 min | Required |
| 4. Add to PATH | 1-2 min | Critical |
| 5. Verify | 1-2 min | Important |
| 6. Emulator (optional) | 5-10 min | Optional |
| 7. Connect Device | 1-2 min | If using phone |
| 8. Run App | 2-3 min | Final |

**Total: 15-25 minutes**

## Troubleshooting During Install

### "Can't extract zip file"
- Use Windows built-in extraction
- Right-click → Extract All → C:\ → Extract

### "PATH not working"
- Make sure you restarted terminal after changing PATH
- Verify with: `echo %FLUTTER_HOME%` → should show `C:\Flutter`

### "flutter: command not found"
```bash
# Check if Flutter is in PATH
where flutter
# If nothing, PATH wasn't set correctly, repeat STEP 4
```

### "Android SDK not found"
```bash
# Android Studio installer will set this up
# If issues, open Android Studio and let it download SDK
```

### "No devices found"
```bash
flutter devices
# Should show at least one device
# If empty, start emulator first or connect phone
```

## Verify Everything is Working

Once installed, run this:

```bash
flutter doctor -v
```

Should show mostly checkmarks ✓

## Commands Reference

```bash
# Check versions
flutter --version
dart --version

# Health check
flutter doctor
flutter doctor -v

# Dependencies
flutter pub get
flutter pub upgrade

# Run app
flutter run
flutter run -v  (verbose)
flutter run --release

# Build APK
flutter build apk --release

# Clean and rebuild
flutter clean
flutter pub get
flutter run
```

## After Getting App Running

1. Test signup flow
2. Test login
3. Apply for loan
4. Build APK for distribution
5. Share with backend team

## Support

If you get stuck:
1. Run `flutter doctor` - shows what's missing
2. Google error message + "flutter"
3. Check Flutter docs: https://flutter.dev/docs

---

## QUICK CHECKLIST

```bash
# Run each command, all should work:
flutter --version      ← Should show version
dart --version         ← Should show version  
flutter devices        ← Should show device
flutter doctor         ← Should show mostly ✓
```

If all pass, run:
```bash
cd D:\project fintech\mobile
flutter pub get
flutter run
```

**🎉 You'll have a working app in seconds!**

---

## Need Video Help?

1. Flutter installation: https://youtu.be/VJnXPzqJcKs
2. Android Studio setup: https://youtu.be/h84gGdL6KQE
3. First Flutter app: https://youtu.be/EpH-qkDL1e0

---

**Done installing? Come back and we'll run the app! ⚡**
