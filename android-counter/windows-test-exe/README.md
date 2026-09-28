# Windows test EXE

Build on Linux with Go 1.22+:

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o LotusPOS_Test_Windows.exe .
```

Place `LotusPOS_Counter_RC5_debug.apk` beside the EXE. Double-click the EXE on the ASUS Windows 10/11 x64 PC. It uses the official Android SDK/Emulator, installs the APK on an Android 11 emulator, and launches the app. After logging in on the emulator, return to the EXE and press Enter. It saves `man-hinh.png`, a virtual second-display screenshot `man-hinh-hai-gia-lap.png`, and logs to `%LOCALAPPDATA%\LotusPOSCounterTest\ket-qua`. The startup screenshot is `man-hinh-ban-dau.png`.

First run needs Android Studio with SDK. If missing, the EXE opens the official installation page and gives one setup instruction. No PowerShell is called. The program never writes to Downloads, Desktop or Documents; Windows Controlled Folder Access can protect those folders. It cannot guarantee Windows SmartScreen will trust an unsigned executable. The actual printer/secondary display require the POS hardware for verification.
