# 📦 Build APK & iOS App

Complete guide to build FinTech Loan app for both Android and iOS platforms.

---

## Prerequisites

### ✅ Required (Both Platforms)
- Flutter SDK installed
- Dart SDK installed
- Android Studio installed
- Java JDK 17+ installed

### 📱 For iOS (macOS Only)
- macOS 10.15 or later (required)
- Xcode 14 or later
- CocoaPods (comes with Xcode)
- iPhone/iPad for testing (optional)

### 🤖 For Android (Windows/Mac/Linux)
- Android SDK (from Android Studio)
- Android SDK Platform 21+ (for APK)
- Any computer can build

---

## Part 1: Build Android APK

### Step 1: Generate Upload Key (One-Time)

Create a keystore for signing your APK:

```bash
# Navigate to project
cd D:\project fintech\mobile

# Generate keystore
keytool -genkey -v -keystore release-key.jks ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -alias fintech-key
```

**Enter when prompted:**
```
Keystore password: fintech@2026
Key password: fintech@2026
First name: John
Last name: Doe
Organization: FinTech
City: Mumbai
State: Maharashtra
Country: IN
```

**Keystore created at:** `D:\project fintech\mobile\release-key.jks`

### Step 2: Create Key Properties File

Create `android/key.properties`:

```properties
storeFile=../release-key.jks
storePassword=fintech@2026
keyPassword=fintech@2026
keyAlias=fintech-key
```

### Step 3: Configure build.gradle

Edit `android/app/build.gradle` and add before `buildTypes`:

```gradle
signingConfigs {
    release {
        def keystoreProperties = new Properties()
        def keystorePropertiesFile = rootProject.file('key.properties')
        if (keystorePropertiesFile.exists()) {
            keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
        }
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
        storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
        storePassword keystoreProperties['storePassword']
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
    }
}
```

### Step 4: Build APK

**Option A: Single APK (Larger, works on all devices)**
```bash
cd D:\project fintech\mobile

flutter clean
flutter pub get

flutter build apk --release
```

**Output:** `build/app/outputs/flutter-app/release/app-release.apk`
**Size:** ~30-50 MB

**Option B: Split APKs (Smaller, device-specific)**
```bash
flutter build apk --release --split-per-abi
```

**Outputs:**
- `app-armeabi-v7a-release.apk` (~20-25 MB) - Most phones
- `app-arm64-v8a-release.apk` (~25-30 MB) - Modern phones
- `app-x86_64-release.apk` (~25-30 MB) - Emulators/tablets

**Option C: App Bundle (For Google Play Store)**
```bash
flutter build appbundle --release
```

**Output:** `build/app/outputs/bundle/release/app-release.aab`
**Size:** ~20 MB (Google Play will generate APKs from this)

### Step 5: Test APK

**Install on device/emulator:**
```bash
# Single APK
adb install build/app/outputs/flutter-app/release/app-release.apk

# Or install directly via Flutter
flutter install --release

# Or from file manager
# Just double-click the APK file on Android device
```

### APK Testing Checklist

```
✅ App launches
✅ Splash screen shows
✅ Login page appears
✅ Can signup/login
✅ Can apply for loan
✅ EMI calculator works
✅ Can go back/navigate
✅ No crashes
```

---

## Part 2: Build iOS App

### Prerequisites for iOS

**Requirement:** macOS (Windows cannot build iOS)

If on Windows, you have options:
1. Use cloud CI/CD (GitHub Actions, Codemagic)
2. Build on a Mac
3. Use online Mac rental services

### Step 1: Set Up iOS Project

```bash
cd D:\project fintech\mobile

# Get iOS dependencies
flutter pub get
flutter pub upgrade

# Open iOS project in Xcode
open ios/Runner.xcworkspace
```

### Step 2: Configure iOS Signing

**Option A: Automatic (Easiest)**
```bash
flutter run -v
# Xcode will prompt for signing
# Select "Automatically manage signing"
```

**Option B: Manual**
1. Open Xcode: `open ios/Runner.xcworkspace`
2. Select "Runner" project
3. Select "Runner" target
4. Go to "Signing & Capabilities" tab
5. Select your team from dropdown
6. Xcode will auto-generate certificates

### Step 3: Update App Info

**Edit `ios/Runner/Info.plist`:**

```xml
<dict>
  <key>CFBundleDisplayName</key>
  <string>FinTech Loan</string>
  
  <key>CFBundleIdentifier</key>
  <string>com.fintech.loan</string>
  
  <key>CFBundleVersion</key>
  <string>1</string>
  
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  
  <key>CFBundleExecutable</key>
  <string>Runner</string>
  
  <key>UIMainStoryboardFile</key>
  <string>Main</string>
</dict>
```

### Step 4: Build iOS

**Option A: Debug (for testing)**
```bash
flutter build ios --debug

# Or run on device/simulator
flutter run
```

**Option B: Release (for production)**
```bash
flutter build ios --release
```

**Output:** `build/ios/iphoneos/Runner.app`

### Step 5: Deploy to Device/App Store

**Option A: Run on Simulator**
```bash
flutter run
# App will launch on default simulator
```

**Option B: Run on Physical iPhone**
```bash
# Connect iPhone via USB
flutter devices
# Should show your iPhone

flutter run -d <device_id>
```

**Option C: Create IPA (for App Store/Distribution)**

1. Open Xcode
2. Product → Scheme → Runner
3. Product → Destination → "Generic iOS Device"
4. Product → Archive
5. Organizer opens → Click "Distribute App"
6. Select distribution method
7. Create IPA file

---

## Building Without macOS (Cloud Build)

### Option A: GitHub Actions (Free)

Create `.github/workflows/build.yml`:

```yaml
name: Build APK & iOS

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
      
      - name: Upload APK
        uses: actions/upload-artifact@v2
        with:
          name: app-release.apk
          path: build/app/outputs/flutter-app/release/app-release.apk

  build-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v2
      
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.19.6'
          
      - run: flutter pub get
      
      - run: flutter build ios --release
      
      - name: Upload iOS
        uses: actions/upload-artifact@v2
        with:
          name: ios-build
          path: build/ios/iphoneos/
```

Push to GitHub and it will build automatically.

### Option B: Codemagic (Cloud Build)

1. Visit: https://codemagic.io
2. Sign up (free tier available)
3. Connect GitHub repository
4. Configure build settings
5. Codemagic builds APK & iOS automatically
6. Download built files

### Option C: EAS Build (Expo Service)

1. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Create EAS config:
   ```bash
   cd mobile
   eas build --platform android --release
   eas build --platform ios --release
   ```

3. Follow prompts to configure

---

## Distribution

### Android Distribution

**Option A: Google Play Store**
1. Create Google Play Developer account ($25 one-time)
2. Create app listing
3. Upload APK/AAB to Play Console
4. Set pricing & distribution
5. Submit for review (24 hours typically)

**Option B: Direct APK Distribution**
- Share APK via:
  - Email
  - WhatsApp
  - Google Drive
  - GitHub Releases
  - Website

**File Sharing:**
```bash
# Copy APK to shared folder
copy build/app/outputs/flutter-app/release/app-release.apk C:\Users\Public\Downloads\
```

### iOS Distribution

**Option A: App Store**
1. Enroll in Apple Developer Program ($99/year)
2. Create App Store Connect account
3. Upload IPA to App Store Connect
4. Submit for review (1-5 days)

**Option B: TestFlight (Beta)**
1. Upload IPA to TestFlight
2. Invite testers via email
3. Testers can install beta app

**Option C: Direct Install (Development)**
- Only works on registered devices
- Limited to 100 devices per year
- Use Xcode to install directly

---

## Build Configuration File

Create `build_config.yaml` in project root:

```yaml
app:
  name: FinTech Loan
  identifier: com.fintech.loan
  version: 1.0.0
  build: 1

android:
  minSdk: 21
  targetSdk: 34
  package: com.fintech.loan

ios:
  bundleId: com.fintech.loan
  minVersion: 11.0

signing:
  android:
    keystore: release-key.jks
    storePassword: fintech@2026
    keyAlias: fintech-key
    keyPassword: fintech@2026
  ios:
    team: YOUR_TEAM_ID
    certificate: distribution
```

---

## Complete Build Script

### PowerShell (Windows)

Create `build.ps1`:

```powershell
param(
    [string]$Platform = "android"
)

$projectPath = "D:\project fintech\mobile"
cd $projectPath

Write-Host "🔨 Building $Platform..." -ForegroundColor Cyan

flutter clean
flutter pub get

if ($Platform -eq "android") {
    Write-Host "📱 Building Android APK..." -ForegroundColor Yellow
    flutter build apk --release
    
    $apkPath = "build/app/outputs/flutter-app/release/app-release.apk"
    if (Test-Path $apkPath) {
        Write-Host "✅ APK built successfully!" -ForegroundColor Green
        Write-Host "Location: $apkPath" -ForegroundColor Green
        Write-Host "Size: $(Get-Item $apkPath | ForEach-Object {[math]::Round($_.Length/1MB, 2)} ) MB"
    }
} elseif ($Platform -eq "ios") {
    Write-Host "🍎 Building iOS..." -ForegroundColor Yellow
    flutter build ios --release
    Write-Host "✅ iOS built successfully!" -ForegroundColor Green
    Write-Host "Location: build/ios/iphoneos/Runner.app"
} elseif ($Platform -eq "both") {
    Write-Host "📱 Building Android..." -ForegroundColor Yellow
    flutter build apk --release
    
    Write-Host "🍎 Building iOS..." -ForegroundColor Yellow
    flutter build ios --release
    
    Write-Host "✅ Both builds complete!" -ForegroundColor Green
}
```

**Run:**
```bash
# Build APK
.\build.ps1 -Platform android

# Build iOS
.\build.ps1 -Platform ios

# Build both
.\build.ps1 -Platform both
```

---

## Release Checklist

Before releasing:

```
✅ Update version in pubspec.yaml
✅ Update build number in pubspec.yaml
✅ Update app name and description
✅ Test on real device/emulator
✅ Test all features:
  ✅ Login/Signup
  ✅ Profile management
  ✅ Loan application
  ✅ EMI calculation
✅ Check performance
✅ No console errors
✅ Privacy policy written
✅ Terms & conditions ready
✅ App icon created (192x192 for Android, 1024x1024 for iOS)
✅ Screenshots for store listings
✅ Description & changelog written
```

---

## Troubleshooting

### APK Build Issues

**"Gradle build failed"**
```bash
flutter clean
flutter pub get
flutter build apk --release -v
```

**"Signing failed"**
- Check key.properties exists
- Verify keystore password
- Check file paths are correct

**"App too large"**
- Use split APKs
- Shrink resources: `android/app/build.gradle`
- Enable minification

### iOS Build Issues

**"Pod install failed"**
```bash
cd ios
pod repo update
pod install
cd ..
flutter build ios --release
```

**"Signing issues"**
- Open in Xcode
- Select automatic signing
- Let Xcode manage certificates

**"App rejected from App Store"**
- Check bundle ID format (com.company.app)
- Ensure privacy policies
- Test on real device
- Check build settings

---

## Commands Quick Reference

```bash
# Clean & prepare
flutter clean
flutter pub get
flutter pub upgrade

# Debug builds
flutter run
flutter run -d <device>
flutter run -v

# Release builds
flutter build apk --release
flutter build apk --release --split-per-abi
flutter build appbundle --release
flutter build ios --release

# Device management
flutter devices
flutter attach
flutter logs

# Testing
flutter test
flutter test -v
```

---

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| APK | `mobile/build/app/outputs/flutter-app/release/` | Android install file |
| AAB | `mobile/build/app/outputs/bundle/release/` | Google Play file |
| iOS | `mobile/build/ios/iphoneos/` | iOS app |
| IPA | Xcode archive | App Store file |
| Icon | `mobile/assets/icon/` | App icon |
| Pubspec | `mobile/pubspec.yaml` | Version & metadata |

---

## Version Management

**Update version in `pubspec.yaml`:**

```yaml
version: 1.0.0+1
#        ^     ^
#        |     +-- Build number
#        +-------- Version string
```

Examples:
- `1.0.0+1` - First release
- `1.0.1+2` - Bug fix
- `1.1.0+3` - New feature
- `2.0.0+4` - Major release

---

## Success Indicators

✅ APK builds without errors
✅ APK installs on device
✅ App launches on device
✅ All features work
✅ No permission warnings
✅ iOS builds without errors
✅ App Store ready
✅ Files are optimized

---

## Next Steps

1. **Build APK**: Follow "Part 1: Build Android APK" above
2. **Test APK**: Install on phone, verify all features
3. **For iOS**: Requires macOS (or use cloud CI/CD)
4. **Distribute**: Upload to Play Store / App Store

---

**Ready to build? Start with Step 1 above! 🚀**
