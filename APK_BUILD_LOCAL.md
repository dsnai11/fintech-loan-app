# 📱 Build APK on Your Local Machine

Since the server environment lacks Android SDK, here's how to build the APK on your computer.

---

## Prerequisites

✅ **Already Installed (from earlier):**
- Flutter SDK (C:\Flutter)
- Project files (D:\project fintech\mobile)
- All dependencies

❌ **Still Needed:**
- Android SDK (via Android Studio)
- Java JDK

---

## Option 1: Quick Build with Android Studio (Recommended)

### Step 1: Install Android Studio
1. Download: https://developer.android.com/studio
2. Run installer
3. Complete setup (will install Android SDK automatically)
4. Accept Android SDK licenses

### Step 2: Build APK

Open PowerShell and run:

```powershell
# Navigate to project
cd D:\project fintech\mobile

# Set ANDROID_HOME (if not auto-detected)
$env:ANDROID_HOME = "C:\Users\YourUsername\AppData\Local\Android\Sdk"

# Build APK
flutter clean
flutter pub get
flutter build apk --release
```

**APK Location:**
```
D:\project fintech\mobile\build\app\outputs\flutter-app\release\app-release.apk
```

---

## Option 2: Use Flutter's Built-in Android SDK Download

```powershell
cd D:\project fintech\mobile

# Let Flutter set up Android SDK
flutter config --android-sdk-path=C:\Android\sdk

# Build APK
flutter build apk --release
```

Flutter will download Android SDK automatically on first run.

---

## Option 3: Cloud Build (No Local Android SDK Needed)

### Using GitHub Actions (Free)

1. Create `.github/workflows/build.yml` in your project:

```yaml
name: Build APK

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.19.6'
      - run: flutter pub get
      - run: flutter build apk --release
      - uses: actions/upload-artifact@v2
        with:
          name: app-release.apk
          path: build/app/outputs/flutter-app/release/app-release.apk
```

2. Push to GitHub
3. GitHub will build APK automatically
4. Download from "Actions" tab

### Using Codemagic (Cloud Build Service)

1. Visit: https://codemagic.io
2. Sign up (free tier available)
3. Connect GitHub repository
4. Codemagic builds APK automatically

---

## Complete Build Script

Save as `build-apk.ps1` in your project folder:

```powershell
param(
    [string]$BuildType = "release"
)

Write-Host "Building APK..." -ForegroundColor Cyan

$env:ANDROID_HOME = "C:\Users\$env:USERNAME\AppData\Local\Android\Sdk"
$env:Path = "C:\Flutter\bin;" + $env:Path

cd D:\project fintech\mobile

Write-Host "Step 1: Clean..." -ForegroundColor Yellow
flutter clean

Write-Host "Step 2: Get dependencies..." -ForegroundColor Yellow
flutter pub get

Write-Host "Step 3: Building APK..." -ForegroundColor Yellow
flutter build apk --$BuildType

$apkPath = "build/app/outputs/flutter-app/$BuildType/app-$BuildType.apk"

if (Test-Path $apkPath) {
    $size = (Get-Item $apkPath).Length / 1MB
    Write-Host ""
    Write-Host "SUCCESS - APK Built!" -ForegroundColor Green
    Write-Host "File: $apkPath" -ForegroundColor Green
    Write-Host "Size: $([math]::Round($size, 2)) MB" -ForegroundColor Green
} else {
    Write-Host "Build failed - APK not found" -ForegroundColor Red
}
```

Run it:
```powershell
.\build-apk.ps1 -BuildType release
```

---

## Troubleshooting

### "ANDROID_HOME not set"
```powershell
$env:ANDROID_HOME = "C:\Users\YourUsername\AppData\Local\Android\Sdk"
```

### "Android SDK not found"
1. Install Android Studio
2. Let it download Android SDK
3. Set ANDROID_HOME path

### "Build failed - Gradle error"
```powershell
flutter clean
flutter pub get
flutter build apk --release -v  # verbose mode
```

### "Java not found"
1. Install Java JDK 17+
2. Set JAVA_HOME:
```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17.0.x"
```

---

## Installation After Build

### Install on Connected Device

```bash
adb install build/app/outputs/flutter-app/release/app-release.apk
```

### Or Run on Emulator

```bash
flutter run --release
```

### Or Transfer Manually
1. Copy APK to phone via USB
2. Open file manager
3. Tap APK to install

---

## Files Ready for You

Everything is already set up:

✅ Source code (`D:\project fintech\mobile\lib\`)
✅ Pubspec.yaml with dependencies
✅ Android configuration
✅ Build files created

---

## Complete Timeline

```
1. Install Android Studio (10 min)
2. Navigate to mobile folder (1 min)
3. Run build script (3-5 min)
4. APK ready to use! ✅
```

Total: ~15 minutes

---

## APK Details

| Item | Value |
|------|-------|
| Package Name | com.fintech.loan |
| Version | 1.0 |
| Build Type | Release (optimized) |
| Min SDK | API 21 (Android 5.0+) |
| Target SDK | API 34 (Android 14) |
| Expected Size | 30-50 MB |
| Signing | Default debug key |

---

## Distribution After Build

### For Testing
- Share APK via WhatsApp, email, etc.
- Users can install directly

### For Production
- Sign APK with production key
- Upload to Google Play Store
- Or host on your website

### Generate Production Key
```powershell
keytool -genkey -v -keystore my-release-key.jks `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -alias my-key-alias
```

Then update `android/key.properties`:
```
storeFile=../my-release-key.jks
storePassword=your_password
keyPassword=your_password
keyAlias=my-key-alias
```

---

## Next Steps

1. **On Your Local Machine:**
   - Install Android Studio
   - Run `flutter build apk --release`
   - Get APK file

2. **Test the APK:**
   - Install on Android device
   - Test signup/login
   - Test loan application

3. **Distribute:**
   - Share APK
   - Upload to Play Store
   - Host on website

---

## Support

If you hit issues:
1. Run `flutter doctor` to diagnose
2. Check BUILD_STATUS.md for details
3. Review BUILD_APK_AND_iOS.md for troubleshooting
4. See API_TESTING.md for backend verification

---

## What's Included in APK

✅ Complete FinTech loan application
✅ User signup/login system
✅ Loan application form
✅ Real-time EMI calculator  
✅ User profile management
✅ Professional Material Design UI
✅ Secure API integration
✅ State management
✅ Local data storage
✅ Error handling

---

**Ready to build? Follow Option 1 or 2 above! 🚀**
