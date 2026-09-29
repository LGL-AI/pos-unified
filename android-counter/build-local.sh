#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to installed Android SDK}"
TOOLS="$ANDROID_SDK_ROOT/build-tools/35.0.1"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
JAVAC_BIN="${JAVAC_BIN:-javac}"
BUILD="$PROJECT_DIR/build/manual"
mkdir -p "$BUILD"/{generated,classes,dex} "$PROJECT_DIR/dist"
ASSETS="$BUILD/assets"
rm -rf "$ASSETS"
mkdir -p "$ASSETS"
cp "$PROJECT_DIR/app/src/main/assets/hook.js" "$ASSETS/hook.js"
for path in counter/index.html counter/counter.css counter/poc-counter.css counter/shift-ui.css counter/analytics.css counter/devices.js counter/shift-ui.js counter/analytics.js staff/staff.css staff/staff.js staff/qrcode.js staff/scanner.js staff/barcode.js display/index.html display/display.css display/display.js assets/qrcode.js brands/echo-coffee.jpg; do
  mkdir -p "$ASSETS/ui/$(dirname "$path")"
  cp "$PROJECT_DIR/../public/$path" "$ASSETS/ui/$path"
done
"$TOOLS/aapt2" link -o "$BUILD/base.apk" -I "$ANDROID_JAR" --manifest "$PROJECT_DIR/app/src/main/AndroidManifest.xml" --min-sdk-version 23 --target-sdk-version 30 --version-code 10 --version-name 2.6.0-rc.5.1-counter-p0.8 -A "$ASSETS" --java "$BUILD/generated"
find "$PROJECT_DIR/app/src/main/java" "$BUILD/generated" -name '*.java' -print0 | xargs -0 "$JAVAC_BIN" -encoding UTF-8 -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$BUILD/classes"
if unzip -tq "$TOOLS/lib/d8.jar" >/dev/null 2>&1; then
  D8=("$TOOLS/d8")
else
  D8=(java -cp "$ANDROID_SDK_ROOT/cmdline-tools/latest/lib/r8.jar" com.android.tools.r8.D8)
fi
find "$BUILD/classes" -name '*.class' -print0 | xargs -0 "${D8[@]}" --min-api 23 --lib "$ANDROID_JAR" --output "$BUILD/dex"
cp "$BUILD/base.apk" "$BUILD/with-dex.apk"
zip -q -j "$BUILD/with-dex.apk" "$BUILD/dex/classes.dex"
"$TOOLS/zipalign" -f -p 4 "$BUILD/with-dex.apk" "$BUILD/aligned.apk"
DEBUG_KEY="$PROJECT_DIR/build/counter-debug.jks"
if [[ ! -f "$DEBUG_KEY" ]]; then keytool -genkeypair -keystore "$DEBUG_KEY" -storepass android -keypass android -alias counter-debug -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Lotus Counter Test' -noprompt >/dev/null 2>&1; fi
"$TOOLS/apksigner" sign --ks "$DEBUG_KEY" --ks-pass pass:android --key-pass pass:android --ks-key-alias counter-debug --out "$PROJECT_DIR/dist/LotusPOS_Counter_P0_debug.apk" "$BUILD/aligned.apk"
if [[ -n "${LOTUS_COUNTER_RELEASE_KEYSTORE:-}" ]]; then
  : "${LOTUS_COUNTER_RELEASE_PASSWORD:?Set release keystore password}"
  : "${LOTUS_COUNTER_RELEASE_ALIAS:?Set release key alias}"
  "$TOOLS/apksigner" sign --ks "$LOTUS_COUNTER_RELEASE_KEYSTORE" --ks-pass env:LOTUS_COUNTER_RELEASE_PASSWORD --ks-key-alias "$LOTUS_COUNTER_RELEASE_ALIAS" --out "$PROJECT_DIR/dist/LotusPOS_Counter_P0_release.apk" "$BUILD/aligned.apk"
else
  cp "$BUILD/aligned.apk" "$PROJECT_DIR/dist/LotusPOS_Counter_P0_release-unsigned.apk"
fi
"$TOOLS/apksigner" verify "$PROJECT_DIR/dist/LotusPOS_Counter_P0_debug.apk"
sha256sum "$PROJECT_DIR"/dist/*.apk > "$PROJECT_DIR/dist/SHA256SUMS.txt"
