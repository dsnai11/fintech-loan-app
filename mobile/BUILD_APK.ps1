# FinTech Loan App - Automated APK Build Script
# This script handles the complete APK build process

param(
    [string]$BuildType = "release",  # release or debug
    [string]$OutputName = "app"
)

$ErrorActionPreference = "Stop"
$projectPath = Get-Location

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  FinTech Loan App - APK Builder        ║" -ForegroundColor Cyan
Write-Host "║  Flutter APK Build Automation          ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify Flutter
Write-Host "Step 1: Checking Flutter Installation..." -ForegroundColor Yellow
try {
    $flutterVersion = & flutter --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Flutter is installed" -ForegroundColor Green
        Write-Host $flutterVersion -ForegroundColor Green
    } else {
        throw "Flutter not found"
    }
} catch {
    Write-Host "❌ Flutter is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Flutter from: https://flutter.dev/docs/get-started/install/windows" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 2: Verify Android SDK
Write-Host "Step 2: Checking Android SDK..." -ForegroundColor Yellow
try {
    $androidHome = $env:ANDROID_HOME
    if (-not $androidHome) {
        Write-Host "⚠️  ANDROID_HOME not set, but Flutter will handle this" -ForegroundColor Yellow
    } else {
        Write-Host "✅ Android SDK found at: $androidHome" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Android SDK warning: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Verify pubspec.yaml
Write-Host "Step 3: Verifying project files..." -ForegroundColor Yellow
if (Test-Path "pubspec.yaml") {
    Write-Host "✅ pubspec.yaml found" -ForegroundColor Green
} else {
    Write-Host "❌ pubspec.yaml not found" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Clean previous builds
Write-Host "Step 4: Cleaning previous builds..." -ForegroundColor Yellow
Write-Host "Running: flutter clean" -ForegroundColor Cyan
& flutter clean
Write-Host "✅ Clean complete" -ForegroundColor Green

Write-Host ""

# Step 5: Get dependencies
Write-Host "Step 5: Getting Flutter dependencies..." -ForegroundColor Yellow
Write-Host "Running: flutter pub get" -ForegroundColor Cyan
& flutter pub get
Write-Host "✅ Dependencies resolved" -ForegroundColor Green

Write-Host ""

# Step 6: Build APK
Write-Host "Step 6: Building APK ($BuildType mode)..." -ForegroundColor Yellow
Write-Host "This may take 3-5 minutes..." -ForegroundColor Cyan
Write-Host ""

$buildCommand = "flutter build apk --$BuildType"
Write-Host "Running: $buildCommand" -ForegroundColor Cyan
& flutter build apk --$BuildType -v

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 7: Verify APK
Write-Host "Step 7: Verifying APK..." -ForegroundColor Yellow

$apkPath = "build/app/outputs/flutter-app/$BuildType/app-$BuildType.apk"
if (Test-Path $apkPath) {
    $apkSize = (Get-Item $apkPath).Length / 1MB
    Write-Host "✅ APK built successfully!" -ForegroundColor Green
    Write-Host "📱 File: $apkPath" -ForegroundColor Green
    Write-Host "📊 Size: $([math]::Round($apkSize, 2)) MB" -ForegroundColor Green

    # Create output directory
    $outputDir = "$projectPath\dist"
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir | Out-Null
    }

    # Copy APK
    Copy-Item $apkPath "$outputDir\app-$($BuildType)-$(Get-Date -Format 'yyyyMMdd-HHmmss').apk"
    Write-Host "✅ Copied to: $outputDir" -ForegroundColor Green
} else {
    Write-Host "❌ APK not found at: $apkPath" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✅ APK Build Complete!               ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Green

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Install on device: adb install $apkPath" -ForegroundColor White
Write-Host "2. Or drag-drop APK on Android device" -ForegroundColor White
Write-Host "3. Launch the app and test features" -ForegroundColor White
Write-Host ""
Write-Host "Build completed: $(Get-Date)" -ForegroundColor Cyan
