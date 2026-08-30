#!/bin/bash
set -e

echo "=== Setting up LaporanPintarID for APK build ==="

# Install Java
echo "[1/6] Installing Java..."
pkg install -y openjdk-17 2>/dev/null || true

# Install Node.js
echo "[2/6] Installing Node.js..."
pkg install -y nodejs 2>/dev/null || true

# Cleanup
echo "[3/6] Cleaning up..."
rm -rf laporanpintar-id project.tar.gz

# Download project
echo "[4/6] Downloading project..."
curl -L "https://laporankuyoks.freebuff.app/project.tar.gz" -o project.tar.gz

# Check file
echo "[5/6] Checking file..."
if grep -q "<!DOCTYPE" project.tar.gz 2>/dev/null; then
  echo "ERROR: Downloaded file is HTML, not tar.gz"
  echo "Try downloading manually from browser:"
  echo "https://laporankuyoks.freebuff.app/project.tar.gz"
  exit 1
fi

# Extract
echo "[6/6] Extracting..."
tar xzf project.tar.gz || { echo "Extract failed. File might be corrupted."; exit 1; }

cd laporanpintar-id

echo ""
echo "=== Installing dependencies ==="
npm install

echo ""
echo "=== Building web assets ==="
npx vite build

echo ""
echo "=== Syncing to Android ==="
npx cap sync android

echo ""
echo "=== Building APK ==="
cd android
chmod +x gradlew
./gradlew assembleDebug

echo ""
echo "=== DONE! ==="
echo "APK location: android/app/build/outputs/apk/debug/app-debug.apk"
echo "Install it: termux-open android/app/build/outputs/apk/debug/app-debug.apk"
