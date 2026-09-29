# Lotus POS Android Counter — build

Source: `pos-unified` RC5.1. APK `2.6.0-rc.5.1-counter-p0.12` (versionCode 14). Worker RC5.1 and migrations 0014–0015 phải triển khai trước khi thử bán hàng/QR bàn. Cấu hình dọc/ngang tại **Thiết bị → Chiều và cỡ giao diện quầy**.

The Counter APK has a separate package, `vn.lotusai.pos.counter`, targets Android 11/API 30 and loads the bundled counter and second-display UI under the configured HTTPS origin. All `/api/` traffic goes to that origin. The default origin is `https://pos-unified.lgl247-ai.workers.dev`; the app checks `/api/health` for Worker RC5.1, D1, table QR, display and auto print before opening the counter. The QR page and handheld POS use that same server/database. The build copies UI from the sibling `public/` folder into the APK.

Requirements: JDK 17, Android SDK platform 35 and build-tools 35.0.1. Standard Android Gradle project is in this directory. With Gradle installed, run `gradle :app:assembleDebug`. The dependency-free local build is:

```bash
ANDROID_SDK_ROOT=/path/to/android-sdk JAVAC_BIN=/path/to/javac ./build-local.sh
```

`dist/LotusPOS_Counter_P0_debug.apk` is installable and signed by the local debug key. Without a release keystore, `dist/LotusPOS_Counter_P0_release-unsigned.apk` cannot be installed. To sign a release APK set `LOTUS_COUNTER_RELEASE_KEYSTORE`, `LOTUS_COUNTER_RELEASE_PASSWORD`, and `LOTUS_COUNTER_RELEASE_ALIAS` and rerun the script. Protect and retain the release keystore: later upgrades require the same signing certificate. Never put it in Git or the APK.

The manual build uses SDK D8; if the SDK's `d8.jar` is damaged it uses the installed command-line tools' R8 jar. `SHA256SUMS.txt` records each APK. Build artifacts and signing keys are ignored by Git.
