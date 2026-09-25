#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-$PROJECT_DIR/../../../android_toolchain/sdk}"
BUILD_TOOLS_VERSION="35.0.1"
PLATFORM_VERSION="android-35"
TOOLS="$SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION"
ANDROID_JAR="$SDK_ROOT/platforms/$PLATFORM_VERSION/android.jar"
BUILD_DIR="$PROJECT_DIR/build/manual"
APP_DIR="$PROJECT_DIR/app/src/main"
PRINTER_AAR="$PROJECT_DIR/app/libs/printerlibrary-1.0.18.aar"
PRINTER_JAR="$BUILD_DIR/vendor/printerlibrary-1.0.18.jar"
ASSETS="$BUILD_DIR/assets"
KEYSTORE="${LOTUS_KEYSTORE:-$PROJECT_DIR/signing/lotus-cloud-pilot-uat.jks}"
JAVAC_BIN="${JAVAC_BIN:-$PROJECT_DIR/../../jdk-bin/javac}"
OUTPUT_APK="$PROJECT_DIR/dist/LotusPOS_Cloud_v2.4.0_SUNMI_D1_UAT.apk"

for required in "$TOOLS/aapt2" "$TOOLS/d8" "$TOOLS/zipalign" "$TOOLS/apksigner" "$ANDROID_JAR" "$PRINTER_AAR" "$JAVAC_BIN"; do
  if [[ ! -e "$required" ]]; then
    echo "Missing Android tool: $required" >&2
    exit 1
  fi
done

mkdir -p "$BUILD_DIR/compiled" "$BUILD_DIR/generated" "$BUILD_DIR/classes" "$BUILD_DIR/dex" \
  "$BUILD_DIR/vendor" "$PROJECT_DIR/dist" "$PROJECT_DIR/signing" "$ASSETS/staff"

find "$BUILD_DIR/compiled" "$BUILD_DIR/generated" "$BUILD_DIR/classes" "$BUILD_DIR/dex" -mindepth 1 -delete
find "$ASSETS" -mindepth 1 -delete
mkdir -p "$ASSETS/staff"
cp -a "$APP_DIR/assets/staff/." "$ASSETS/staff/"
unzip -p "$PRINTER_AAR" classes.jar > "$PRINTER_JAR"

"$TOOLS/aapt2" compile --dir "$APP_DIR/res" -o "$BUILD_DIR/compiled/resources.zip"

"$TOOLS/aapt2" link \
  -o "$BUILD_DIR/app-unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP_DIR/AndroidManifest.xml" \
  --min-sdk-version 23 \
  --target-sdk-version 35 \
  --version-code 8 \
  --version-name 2.4.0 \
  -A "$ASSETS" \
  --java "$BUILD_DIR/generated" \
  "$BUILD_DIR/compiled/resources.zip"

find "$APP_DIR/java" "$BUILD_DIR/generated" -name '*.java' -print0 | \
  xargs -0 "$JAVAC_BIN" -encoding UTF-8 -source 8 -target 8 -classpath "$ANDROID_JAR:$PRINTER_JAR" -d "$BUILD_DIR/classes"

find "$BUILD_DIR/classes" -name '*.class' -print0 | \
  xargs -0 "$TOOLS/d8" --min-api 23 --lib "$ANDROID_JAR" --output "$BUILD_DIR/dex" "$PRINTER_JAR"

cp "$BUILD_DIR/app-unsigned.apk" "$BUILD_DIR/app-with-dex.apk"
zip -q -j "$BUILD_DIR/app-with-dex.apk" "$BUILD_DIR/dex/classes.dex"
"$TOOLS/zipalign" -f -p 4 "$BUILD_DIR/app-with-dex.apk" "$BUILD_DIR/app-aligned.apk"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "Missing original UAT keystore: $KEYSTORE" >&2
  echo "A new key cannot update the Cloud APK already installed on SUNMI. Supply the original UAT keystore with LOTUS_KEYSTORE." >&2
  exit 1
fi

KEY_ALIAS="${LOTUS_KEY_ALIAS:-lotuscloudpilotuat}"
if [[ -n "${LOTUS_KEYSTORE_PASSWORD:-}" ]]; then
  export LOTUS_KEY_PASSWORD="${LOTUS_KEY_PASSWORD:-$LOTUS_KEYSTORE_PASSWORD}"
  KEY_OPTIONS=(--ks-pass env:LOTUS_KEYSTORE_PASSWORD --key-pass env:LOTUS_KEY_PASSWORD)
else
  KEY_OPTIONS=(--ks-pass pass:android --key-pass pass:android)
fi
"$TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  "${KEY_OPTIONS[@]}" \
  --ks-key-alias "$KEY_ALIAS" \
  --out "$OUTPUT_APK" \
  "$BUILD_DIR/app-aligned.apk"

"$TOOLS/apksigner" verify --verbose --print-certs "$OUTPUT_APK"
(cd "$PROJECT_DIR/dist" && sha256sum "$(basename "$OUTPUT_APK")" > SHA256SUMS.txt)
echo "Built: $OUTPUT_APK"
