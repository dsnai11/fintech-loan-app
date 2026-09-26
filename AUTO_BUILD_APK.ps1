# FinTech Loan App - Fully Automated APK Build
# Waits for Flutter, installs it, and builds APK automatically

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  FinTech Loan App - Automated Full Build" -ForegroundColor Cyan
Write-Host "  APK Build Automation System" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$downloadPath = "$env:USERPROFILE\Downloads\flutter_windows.zip"
$extractPath = "C:\"
$flutterBin = "C:\Flutter\bin\flutter.bat"
$projectPath = "D:\project fintech\mobile"
$maxWaitMinutes = 20

Write-Host "Starting fully automated build process..." -ForegroundColor Yellow
Write-Host "Max wait time: $maxWaitMinutes minutes" -ForegroundColor Cyan
Write-Host ""

# STEP 1: Wait for Flutter download to complete
Write-Host "STEP 1: Waiting for Flutter download..." -ForegroundColor Yellow
$startTime = Get-Date
$flutter_ready = $false

while (-not $flutter_ready) {
    if (Test-Path $downloadPath) {
        $size = (Get-Item $downloadPath).Length / 1MB
        $percent = [math]::Round(($size / 680) * 100)

        # Show progress
        $elapsed = ((Get-Date) - $startTime).TotalMinutes
        Write-Host "[DOWNLOADING] $([math]::Round($size, 2)) MB / 680 MB ($percent%) - Elapsed: $([math]::Round($elapsed, 1))m" -ForegroundColor Cyan

        if ($size -gt 650) {
            Write-Host "OK - Download complete!" -ForegroundColor Green
            $flutter_ready = $true
            break
        }
    }

    $elapsed = ((Get-Date) - $startTime).TotalMinutes
    if ($elapsed -gt $maxWaitMinutes) {
        Write-Host "WARNING - Download taking longer than expected" -ForegroundColor Yellow
        Write-Host "You can continue with: .\BUILD_APK.ps1" -ForegroundColor Yellow
        exit 1
    }

    Start-Sleep -Seconds 5
}

Write-Host ""

# STEP 2: Extract Flutter
Write-Host "STEP 2: Extracting Flutter..." -ForegroundColor Yellow
try {
    Write-Host "Extracting to $extractPath..." -ForegroundColor Cyan
    Expand-Archive -Path $downloadPath -DestinationPath $extractPath -Force
    Write-Host "OK - Flutter extracted!" -ForegroundColor Green
} catch {
    Write-Host "ERROR - Extraction failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""

# STEP 3: Verify Flutter installation
Write-Host "STEP 3: Verifying Flutter..." -ForegroundColor Yellow
if (Test-Path $flutterBin) {
    Write-Host "OK - Flutter binary found" -ForegroundColor Green
} else {
    Write-Host "ERROR - Flutter binary not found" -ForegroundColor Red
    exit 1
}

Write-Host ""

# STEP 4: Run build script
Write-Host "STEP 4: Building APK..." -ForegroundColor Yellow
Write-Host "Navigating to: $projectPath" -ForegroundColor Cyan

cd $projectPath

Write-Host ""
Write-Host "Running Flutter build command..." -ForegroundColor Cyan
Write-Host ""

try {
    # Add Flutter to PATH temporarily
    $env:Path = "C:\Flutter\bin;" + $env:Path

    # Run the build
    Write-Host "STEP 4.1 - Cleaning project..." -ForegroundColor Cyan
    & flutter clean

    Write-Host ""
    Write-Host "STEP 4.2 - Getting dependencies..." -ForegroundColor Cyan
    & flutter pub get

    Write-Host ""
    Write-Host "STEP 4.3 - Building APK (this takes 3-5 minutes)..." -ForegroundColor Cyan
    & flutter build apk --release

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "OK - APK build successful!" -ForegroundColor Green

        # Verify APK
        $apkPath = "build/app/outputs/flutter-app/release/app-release.apk"
        if (Test-Path $apkPath) {
            $apkSize = (Get-Item $apkPath).Length / 1MB
            Write-Host ""
            Write-Host "=================================================" -ForegroundColor Green
            Write-Host "  SUCCESS - APK BUILD COMPLETE!" -ForegroundColor Green
            Write-Host "=================================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "APK Details:" -ForegroundColor Cyan
            Write-Host "   File: $apkPath" -ForegroundColor White
            Write-Host "   Size: $([math]::Round($apkSize, 2)) MB" -ForegroundColor White
            Write-Host ""
            Write-Host "Next Steps:" -ForegroundColor Cyan
            Write-Host "   1. Transfer APK to Android device" -ForegroundColor White
            Write-Host "   2. Install: adb install $apkPath" -ForegroundColor White
            Write-Host "   3. Or drag APK to Android device file manager" -ForegroundColor White
            Write-Host "   4. Launch app and test features" -ForegroundColor White
            Write-Host ""
            Write-Host "Completed at: $(Get-Date)" -ForegroundColor Cyan
        }
    } else {
        Write-Host "ERROR - Build failed" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "ERROR - Error during build: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
