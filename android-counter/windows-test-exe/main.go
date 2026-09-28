// Lotus POS Counter smoke tester for Windows. Uses the official Android SDK.
// Build: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o LotusPOS_Test_Windows.exe .
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	avdName      = "LotusPOS_Counter_Test_API30"
	imagePackage = "system-images;android-30;google_apis;x86_64"
	appID        = "vn.lotusai.pos.counter"
)

var emulatorLine = regexp.MustCompile(`^(emulator-[0-9]+)\s+device\b`)

type tester struct {
	sdk, adb, emulator, logDir, apk, serial string
	env                                     []string
}

func main() {
	fmt.Println("LOTUS POS COUNTER - WINDOWS TEST")
	fmt.Println("--------------------------------")
	if err := test(); err != nil {
		fmt.Fprintln(os.Stderr, "LOI:", err)
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = os.TempDir()
		}
		logDir := filepath.Join(base, "LotusPOSCounterTest", "ket-qua")
		if os.MkdirAll(logDir, 0755) == nil {
			os.WriteFile(filepath.Join(logDir, "loi.txt"), []byte(err.Error()+"\n"), 0644)
		}
		fmt.Println("\nNhan Enter de dong cua so nay.")
		bufio.NewReader(os.Stdin).ReadString('\n')
		os.Exit(1)
	}
}

func test() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	apk := filepath.Join(filepath.Dir(exe), "LotusPOS_Counter_RC5_debug.apk")
	if _, err := os.Stat(apk); err != nil {
		return errors.New("khong thay APK. Giai nen TOAN BO ZIP, giu EXE va APK cung thu muc")
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	logDir := filepath.Join(base, "LotusPOSCounterTest", "ket-qua")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("khong tao duoc thu muc ket qua: %w", err)
	}
	defer func() { fmt.Println("Ket qua va anh chup:", logDir) }()

	sdk := findSDK()
	if sdk == "" {
		openWeb("https://developer.android.com/studio")
		return errors.New("PC chua cai Android SDK. Cai Android Studio mot lan theo trang vua mo, hoan tat Setup Wizard, roi chay lai EXE")
	}
	t := &tester{sdk: sdk, apk: apk, logDir: logDir, env: os.Environ()}
	t.setJavaHome()
	t.adb = filepath.Join(sdk, "platform-tools", "adb.exe")
	t.emulator = filepath.Join(sdk, "emulator", "emulator.exe")
	if !exists(t.adb) || !exists(t.emulator) {
		manager := findManager(sdk, "sdkmanager.bat")
		if manager == "" {
			return errors.New("SDK thieu Emulator/ADB. Trong Android Studio > SDK Manager > SDK Tools, cai Android Emulator, Android SDK Platform-Tools va Command-line Tools")
		}
		fmt.Println("Dang cai Android Emulator va ADB (lan dau se mat vai phut)...")
		if err := t.runBatch(12*time.Minute, "cai-emulator.txt", manager, "--sdk_root="+sdk, "--install", "emulator", "platform-tools"); err != nil {
			return err
		}
	}
	if !exists(t.adb) || !exists(t.emulator) {
		return errors.New("Android Emulator/ADB chua cai xong. Mo Android Studio > SDK Manager > SDK Tools")
	}
	if _, err := t.run(20*time.Second, "", t.adb, "start-server"); err != nil {
		return err
	}

	serials := t.connectedEmulators()
	if len(serials) == 0 {
		avd, err := t.selectAVD()
		if err != nil {
			return err
		}
		fmt.Println("Dang mo Android gia lap:", avd)
		logFile, err := os.Create(filepath.Join(logDir, "emulator.txt"))
		if err != nil {
			return err
		}
		cmd := exec.Command(t.emulator, "-avd", avd, "-no-boot-anim", "-gpu", "auto")
		cmd.Stdout, cmd.Stderr = logFile, logFile
		if err := cmd.Start(); err != nil {
			logFile.Close()
			return fmt.Errorf("khong mo duoc may gia lap: %w", err)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait(); logFile.Close() }()
		deadline := time.Now().Add(5 * time.Minute)
		for time.Now().Before(deadline) {
			serials = t.connectedEmulators()
			if len(serials) != 0 {
				break
			}
			select {
			case err := <-done:
				return fmt.Errorf("may gia lap dung som (%v). Xem emulator.txt; kiem tra VT-x/AMD-V va Windows Hypervisor Platform", err)
			case <-time.After(3 * time.Second):
			}
		}
		if len(serials) == 0 {
			return errors.New("may gia lap khong hien sau 5 phut; xem emulator.txt")
		}
	}
	t.serial = serials[0]
	fmt.Println("May gia lap:", t.serial, "- dang doi Android khoi dong...")
	deadline := time.Now().Add(5 * time.Minute)
	ready := false
	for time.Now().Before(deadline) {
		out, _ := t.adbRun(12*time.Second, "", "shell", "getprop", "sys.boot_completed")
		if strings.TrimSpace(out) == "1" {
			ready = true
			break
		}
		time.Sleep(3 * time.Second)
	}
	if !ready {
		return errors.New("Android khong khoi dong xong; kiem tra VT-x/AMD-V va Windows Hypervisor Platform")
	}
	t.adbRun(15*time.Second, "android-version.txt", "shell", "getprop", "ro.build.version.release")
	t.adbRun(15*time.Second, "device-model.txt", "shell", "getprop", "ro.product.model")
	t.adbRun(15*time.Second, "screen-size.txt", "shell", "wm", "size")
	t.adbRun(15*time.Second, "", "logcat", "-c")
	fmt.Println("Dang cai APK va mo Lotus POS Counter...")
	if _, err := t.adbRun(2*time.Minute, "install.txt", "install", "-r", apk); err != nil {
		return err
	}
	if _, err := t.adbRun(30*time.Second, "launch.txt", "shell", "am", "start", "-W", "-n", appID+"/.MainActivity"); err != nil {
		return err
	}
	time.Sleep(12 * time.Second)
	pid, _ := t.adbRun(15*time.Second, "pid.txt", "shell", "pidof", appID)
	if err := t.screenshot("man-hinh-ban-dau.png"); err != nil {
		fmt.Println("Chua luu duoc anh man hinh:", err)
	}
	t.adbRun(20*time.Second, "activity.txt", "shell", "dumpsys", "activity", "activities")
	t.adbRun(30*time.Second, "logcat.txt", "logcat", "-d", "-v", "time")
	if !regexp.MustCompile(`^\d+(\s+\d+)*$`).MatchString(strings.TrimSpace(pid)) {
		return errors.New("app da dung trong 12 giay; gui thu muc ket-qua de xem log crash")
	}
	fmt.Println("DA MO APP. Thao tac trong cua so Android gia lap.")
	fmt.Println("Dang nhap tren Android gia lap, roi quay lai cua so nay nhan Enter de chup anh va log.")
	bufio.NewReader(os.Stdin).ReadString('\n')
	if err := t.screenshot("man-hinh.png"); err != nil {
		fmt.Println("Chua luu duoc anh sau dang nhap:", err)
	}
	t.adbRun(30*time.Second, "logcat.txt", "logcat", "-d", "-v", "time")
	t.adbRun(20*time.Second, "activity.txt", "shell", "dumpsys", "activity", "activities")
	pid, _ = t.adbRun(15*time.Second, "pid.txt", "shell", "pidof", appID)
	if !regexp.MustCompile(`^\d+(\s+\d+)*$`).MatchString(strings.TrimSpace(pid)) {
		return errors.New("app da dung sau khi dang nhap; gui thu muc ket-qua de xem log crash")
	}
	t.checkSecondDisplay()
	fmt.Println("Da luu anh sau dang nhap va log tai thu muc ket-qua.")
	return nil
}

// Android's developer overlay exercises Presentation without a physical customer screen.
func (t *tester) checkSecondDisplay() {
	current, err := t.adbRun(10*time.Second, "", "shell", "settings", "get", "global", "overlay_display_devices")
	if err != nil || (strings.TrimSpace(current) != "" && strings.TrimSpace(current) != "null") {
		fmt.Println("Giu nguyen cau hinh man hinh thu hai hien tai; khong doi setting cua may ao.")
		return
	}
	fmt.Println("Dang thu man hinh khach thu hai bang overlay Android...")
	if _, err := t.adbRun(10*time.Second, "overlay-setting.txt", "shell", "settings", "put", "global", "overlay_display_devices", "1024x600/160"); err != nil {
		fmt.Println("May ao khong bat duoc overlay display:", err)
		return
	}
	defer t.adbRun(10*time.Second, "", "shell", "settings", "delete", "global", "overlay_display_devices")
	time.Sleep(5 * time.Second)
	out, err := t.adbRun(15*time.Second, "man-hinh-hai-dumpsys.txt", "shell", "dumpsys", "display")
	if err != nil || !strings.Contains(strings.ToLower(out), "overlay") {
		fmt.Println("Chua xac nhan overlay display; xem man-hinh-hai-dumpsys.txt.")
		return
	}
	if err := t.screenshot("man-hinh-hai-gia-lap.png"); err != nil {
		fmt.Println("Khong chup duoc overlay display:", err)
	}
	t.adbRun(30*time.Second, "man-hinh-hai-logcat.txt", "logcat", "-d", "-v", "time")
	fmt.Println("Da ghi nhan man hinh gia lap thu hai. Xem man-hinh-hai-gia-lap.png va log; can man hinh that de ket luan phan cung.")
}

func findSDK() string {
	paths := []string{os.Getenv("ANDROID_SDK_ROOT"), os.Getenv("ANDROID_HOME"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Android", "Sdk")}
	for _, path := range paths {
		if path != "" && exists(filepath.Join(path, "platform-tools", "adb.exe")) && exists(filepath.Join(path, "emulator", "emulator.exe")) {
			return path
		}
	}
	for _, path := range paths {
		if path != "" && exists(path) {
			return path
		}
	}
	return ""
}

func findManager(sdk, name string) string {
	base := filepath.Join(sdk, "cmdline-tools")
	preferred := filepath.Join(base, "latest", "bin", name)
	if exists(preferred) {
		return preferred
	}
	entries, _ := os.ReadDir(base)
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for _, dir := range names {
		path := filepath.Join(base, dir, "bin", name)
		if exists(path) {
			return path
		}
	}
	return ""
}

func (t *tester) selectAVD() (string, error) {
	out, err := t.run(20*time.Second, "avd-list.txt", t.emulator, "-list-avds")
	if err != nil {
		return "", err
	}
	avds := []string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, " ") {
			continue
		}
		avds = append(avds, line)
		if line == avdName {
			return avdName, nil
		}
	}
	manager := findManager(t.sdk, "avdmanager.bat")
	if manager != "" {
		imagePath := filepath.Join(t.sdk, "system-images", "android-30", "google_apis", "x86_64", "system.img")
		if !exists(imagePath) {
			sdkmanager := findManager(t.sdk, "sdkmanager.bat")
			if sdkmanager == "" {
				return "", errors.New("thieu image Android 11. Cai Android SDK Command-line Tools trong Android Studio > SDK Manager")
			}
			fmt.Println("Lan dau dang tai Android 11 (co the mat vai GB va vai phut)...")
			if err := t.runBatch(25*time.Minute, "cai-image.txt", sdkmanager, "--sdk_root="+t.sdk, "--install", imagePackage); err != nil {
				return "", err
			}
		}
		fmt.Println("Dang tao may gia lap Android 11...")
		if err := t.runBatch(2*time.Minute, "tao-avd.txt", manager, "create", "avd", "-n", avdName, "-k", imagePackage, "-f"); err != nil {
			return "", err
		}
		return avdName, nil
	}
	if len(avds) > 0 {
		return avds[0], nil
	}
	return "", errors.New("chua co may Android gia lap. Trong Android Studio > Device Manager, tao mot may Android 11, roi chay lai EXE")
}

func (t *tester) connectedEmulators() []string {
	out, err := t.run(10*time.Second, "", t.adb, "devices")
	if err != nil {
		return nil
	}
	serials := []string{}
	for _, line := range strings.Split(out, "\n") {
		if m := emulatorLine.FindStringSubmatch(line); m != nil {
			serials = append(serials, m[1])
		}
	}
	return serials
}

func (t *tester) adbRun(timeout time.Duration, filename string, args ...string) (string, error) {
	return t.run(timeout, filename, t.adb, append([]string{"-s", t.serial}, args...)...)
}

func (t *tester) run(timeout time.Duration, filename, binary string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = t.env
	out, err := cmd.CombinedOutput()
	if filename != "" {
		os.WriteFile(filepath.Join(t.logDir, filename), out, 0644)
	}
	if err != nil {
		return string(out), fmt.Errorf("%s: %w (%s)", filepath.Base(binary), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// Android's SDK command-line managers are .bat files; cmd.exe is required.
// This never invokes PowerShell and writes logs only under LocalAppData.
func (t *tester) runBatch(timeout time.Duration, filename, batch string, args ...string) error {
	quoted := []string{cmdQuote(batch)}
	for _, arg := range args {
		quoted = append(quoted, cmdQuote(arg))
	}
	line := strings.Join(quoted, " ")
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "cmd.exe", "/d", "/s", "/c", line)
	cmd.Env = t.env
	cmd.Stdin = strings.NewReader(strings.Repeat("y\r\n", 30))
	out, err := cmd.CombinedOutput()
	os.WriteFile(filepath.Join(t.logDir, filename), out, 0644)
	if err != nil {
		return fmt.Errorf("cai dat Android SDK that bai (%v); xem %s", err, filename)
	}
	return nil
}

func cmdQuote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

func (t *tester) screenshot(filename string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	file, err := os.Create(filepath.Join(t.logDir, filename))
	if err != nil {
		return err
	}
	defer file.Close()
	cmd := exec.CommandContext(ctx, t.adb, "-s", t.serial, "exec-out", "screencap", "-p")
	cmd.Stdout = file
	return cmd.Run()
}

func (t *tester) setJavaHome() {
	if os.Getenv("JAVA_HOME") != "" {
		return
	}
	path := filepath.Join(os.Getenv("ProgramFiles"), "Android", "Android Studio", "jbr")
	if !exists(filepath.Join(path, "bin", "java.exe")) {
		return
	}
	t.env = append(t.env, "JAVA_HOME="+path)
}

func openWeb(url string)      { exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start() }
func exists(path string) bool { _, err := os.Stat(path); return err == nil }
