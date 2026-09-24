package vn.lotusai.pos.cloudpilot;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.bluetooth.BluetoothAdapter;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.FeatureInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.database.DatabaseUtils;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.BitmapFactory;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.usb.UsbManager;
import android.media.MediaScannerConnection;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import android.os.RemoteException;
import android.os.StatFs;
import android.os.UserManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.print.pdf.PrintedPdfDocument;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterException;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.InnerResultCallback;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

public class DiagnosticsActivity extends Activity {
    private static final String APP_VERSION = "1.1.0";
    private static final int CAMERA_REQUEST = 301;
    private static final String STATUS_PASS = "PASS";
    private static final String STATUS_WARN = "WARN";
    private static final String STATUS_FAIL = "FAIL";
    private static final String STATUS_INFO = "INFO";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<ResultItem> results = new ArrayList<>();
    private LinearLayout resultList;
    private TextView summary;
    private TextView privacy;
    private ProgressBar progress;
    private Button runButton;
    private EditText scannerInput;
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private boolean nfcTestArmed;
    private boolean printerBound;
    private SunmiPrinterService sunmiPrinterService;
    private InnerPrinterCallback sunmiPrinterCallback;
    private BroadcastReceiver printerStatusReceiver;
    private boolean printerStatusReceiverRegistered;
    private Uri cameraOutputUri;
    private Thread.UncaughtExceptionHandler previousCrashHandler;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installCrashRecorder();
        incrementLaunchCounter();
        buildInterface();
        prepareNfc();
        addResult("APP", "Ứng dụng đã khởi động / 应用已启动", STATUS_PASS,
                "Lotus Device Check " + APP_VERSION + " — " + now());
    }

    private void buildInterface() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244, 245, 248));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(18), dp(16), dp(18), dp(14));
        header.setBackgroundColor(Color.rgb(25, 28, 36));

        TextView title = new TextView(this);
        title.setText("LOTUS DEVICE CHECK");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        header.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Kiểm tra tương thích POS Android\nAndroid POS 兼容性检测");
        subtitle.setTextColor(Color.rgb(215, 219, 230));
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        subtitle.setPadding(0, dp(5), 0, 0);
        header.addView(subtitle);
        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(14), dp(12), dp(14), dp(24));
        scroll.addView(content);

        privacy = cardText(
                "Quyền riêng tư / 隐私：Không đọc IMEI, số điện thoại, serial hoặc MAC. " +
                        "Báo cáo chỉ lưu trên máy cho đến khi người dùng tự chia sẻ.\n" +
                        "不读取 IMEI、电话号码、序列号或 MAC。报告仅保存在本机。",
                Color.rgb(255, 248, 229), Color.rgb(104, 73, 0));
        content.addView(privacy);

        runButton = actionButton("CHẠY TOÀN BỘ KIỂM TRA / 运行全部检测", true);
        runButton.setOnClickListener(v -> runAllChecks());
        content.addView(runButton);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgress(0);
        progress.setVisibility(View.GONE);
        content.addView(progress, margins(dp(2), dp(8), dp(2), dp(8)));

        summary = cardText("Sẵn sàng / 准备就绪", Color.WHITE, Color.rgb(25, 28, 36));
        summary.setTypeface(Typeface.DEFAULT_BOLD);
        content.addView(summary);

        TextView manualTitle = sectionTitle("KIỂM TRA THỦ CÔNG / 手动检测");
        content.addView(manualTitle);

        LinearLayout manualGrid = new LinearLayout(this);
        manualGrid.setOrientation(LinearLayout.VERTICAL);
        Button printerBind = actionButton("Kết nối dịch vụ in SUNMI / 连接 SUNMI 打印服务", false);
        printerBind.setOnClickListener(v -> testSunmiPrinterBinding());
        manualGrid.addView(printerBind);
        Button printerStatus = actionButton("Đọc trạng thái: giấy/lỗi in / 读取打印机状态", false);
        printerStatus.setOnClickListener(v -> readSunmiPrinterStatus(true));
        manualGrid.addView(printerStatus);
        Button print = actionButton("In trực tiếp bằng SUNMI SDK / 使用 SUNMI SDK 打印", false);
        print.setOnClickListener(v -> startPrintTest());
        manualGrid.addView(print);
        Button camera = actionButton("Chụp và xác thực ảnh camera / 拍照并验证图像", false);
        camera.setOnClickListener(v -> startCameraTest());
        manualGrid.addView(camera);
        Button nfc = actionButton("Đọc thẻ NFC A/B/F/V / 读取 NFC 卡", false);
        nfc.setOnClickListener(v -> armNfcTest());
        manualGrid.addView(nfc);
        content.addView(manualGrid);

        scannerInput = new EditText(this);
        scannerInput.setHint("Bấm vào đây rồi quét mã / 点击后扫描条码");
        scannerInput.setSingleLine(true);
        scannerInput.setImeOptions(EditorInfo.IME_ACTION_DONE);
        scannerInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        scannerInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        scannerInput.setBackgroundColor(Color.WHITE);
        scannerInput.setOnEditorActionListener((v, actionId, event) -> {
            if (scannerInput.getText().length() > 0) {
                int length = scannerInput.getText().length();
                addResult("SCANNER", "Nhận dữ liệu scanner / 扫码输入", STATUS_PASS,
                        "Nhận " + length + " ký tự; nội dung không được lưu / 已接收 " + length + " 个字符，内容未保存");
                scannerInput.setText("");
                updateSummary();
                return true;
            }
            return false;
        });
        content.addView(scannerInput, margins(0, dp(8), 0, dp(8)));

        LinearLayout reportButtons = new LinearLayout(this);
        reportButtons.setOrientation(LinearLayout.VERTICAL);
        Button share = actionButton("Chia sẻ báo cáo / 分享报告", false);
        share.setOnClickListener(v -> shareReport());
        reportButtons.addView(share);
        Button save = actionButton("Lưu vào Downloads / 保存到下载目录", false);
        save.setOnClickListener(v -> saveReport());
        reportButtons.addView(save);
        Button copy = actionButton("Sao chép báo cáo / 复制报告", false);
        copy.setOnClickListener(v -> copyReport());
        reportButtons.addView(copy);
        content.addView(reportButtons);

        content.addView(sectionTitle("KẾT QUẢ / 检测结果"));
        resultList = new LinearLayout(this);
        resultList.setOrientation(LinearLayout.VERTICAL);
        content.addView(resultList);

        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private void runAllChecks() {
        synchronized (results) {
            results.clear();
        }
        resultList.removeAllViews();
        runButton.setEnabled(false);
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(2);
        summary.setText("Đang kiểm tra… / 检测中…");

        worker.execute(() -> {
            try {
                testAppAndBuild(); setCheckProgress(10);
                testSystemDiagnosticsNoAdb(); setCheckProgress(15);
                testCpuAndMemory(); setCheckProgress(22);
                testDisplay(); setCheckProgress(28);
                testStorage(); setCheckProgress(40);
                testDatabase(); setCheckProgress(48);
                testBatteryAndPower(); setCheckProgress(57);
                testSecurityAndPolicy(); setCheckProgress(66);
                testNetwork(); setCheckProgress(76);
                testHardwareCapabilities(); setCheckProgress(86);
                testWebView(); setCheckProgress(91);
                testPrintEnvironment(); setCheckProgress(96);
                testPreviousCrash(); setCheckProgress(99);
                getSharedPreferences("device_check", MODE_PRIVATE).edit()
                        .putLong("last_full_run", System.currentTimeMillis()).apply();
            } catch (Throwable t) {
                addResult("APP", "Tiến trình kiểm tra / 检测流程", STATUS_FAIL,
                        t.getClass().getSimpleName() + ": " + safeMessage(t));
            }
            runOnUiThread(() -> {
                progress.setProgress(100);
                progress.setVisibility(View.GONE);
                runButton.setEnabled(true);
                updateSummary();
            });
        });
    }

    private void testAppAndBuild() {
        PackageManager pm = getPackageManager();
        try {
            PackageInfo pi = pm.getPackageInfo(getPackageName(), 0);
            String installer = null;
            try { installer = pm.getInstallerPackageName(getPackageName()); } catch (Throwable ignored) { }
            addResult("APP", "Gói ứng dụng / 应用包", STATUS_PASS,
                    getPackageName() + " | version=" + pi.versionName + " (" + versionCode(pi) + ") | installer=" + value(installer));
        } catch (Exception e) {
            addResult("APP", "Gói ứng dụng / 应用包", STATUS_FAIL, safeMessage(e));
        }

        SharedPreferences prefs = getSharedPreferences("device_check", MODE_PRIVATE);
        int launches = prefs.getInt("launch_count", 1);
        long previous = prefs.getLong("last_full_run", 0);
        addResult("APP", "Vòng đời ứng dụng / 应用生命周期", STATUS_INFO,
                "Launch count=" + launches + "; last full test=" + (previous == 0 ? "never" : formatTime(previous)));

        addResult("SYSTEM", "Thiết bị / 设备", STATUS_INFO,
                Build.MANUFACTURER + " " + Build.MODEL + " | device=" + Build.DEVICE + " | product=" + Build.PRODUCT);
        addResult("SYSTEM", "Android / 安卓版本", Build.VERSION.SDK_INT == 30 ? STATUS_PASS : STATUS_INFO,
                "Android " + Build.VERSION.RELEASE + " | API " + Build.VERSION.SDK_INT + " | target 35 | min 23");
        addResult("SYSTEM", "Bản dựng / 系统版本", STATUS_INFO,
                Build.DISPLAY + " | build=" + Build.ID + " | type=" + Build.TYPE + " | tags=" + Build.TAGS);
        addResult("SYSTEM", "Security patch / 安全补丁", empty(Build.VERSION.SECURITY_PATCH) ? STATUS_WARN : STATUS_INFO,
                empty(Build.VERSION.SECURITY_PATCH) ? "Không công bố / 未提供" : Build.VERSION.SECURITY_PATCH);
        addResult("SYSTEM", "Build fingerprint", STATUS_INFO, Build.FINGERPRINT);
        addResult("SYSTEM", "Ngôn ngữ và múi giờ / 语言与时区", STATUS_INFO,
                Locale.getDefault().toLanguageTag() + " | " + TimeZone.getDefault().getID() + " | " + now());
        addResult("SYSTEM", "Hiển thị chữ / 字体显示", STATUS_INFO,
                "Tiếng Việt: Trà sữa, hóa đơn, Nguyễn | 繁體：訂單、發票 | 简体：订单、发票");
    }

    /**
     * Collect the compatibility facts normally requested through adb/getprop, without USB.
     * Deliberately excludes unique identifiers such as IMEI, serial numbers and MAC addresses.
     */
    private void testSystemDiagnosticsNoAdb() {
        addResult("SYSTEM", "Phần cứng hệ thống / 系统硬件", STATUS_INFO,
                "board=" + Build.BOARD + " | hardware=" + Build.HARDWARE +
                        " | bootloader=" + Build.BOOTLOADER + " | radio=" + Build.getRadioVersion());
        addResult("SYSTEM", "Sản phẩm ROM / ROM 产品", STATUS_INFO,
                "brand=" + Build.BRAND + " | manufacturer=" + Build.MANUFACTURER +
                        " | device=" + Build.DEVICE + " | product=" + Build.PRODUCT);
        addResult("SYSTEM", "Kernel / Linux 内核", STATUS_INFO,
                readFirstLine(new File("/proc/version")));

        String[] safeProperties = new String[]{
                "ro.product.model", "ro.product.device", "ro.product.name",
                "ro.product.board", "ro.hardware", "ro.board.platform",
                "ro.build.display.id", "ro.build.version.incremental",
                "ro.build.version.security_patch", "ro.product.cpu.abilist",
                "ro.sf.lcd_density", "ro.opengles.version"
        };
        List<String> values = new ArrayList<>();
        for (String key : safeProperties) {
            String property = readSystemProperty(key);
            if (!empty(property)) values.add(key + "=" + property);
        }
        addResult("SYSTEM", "Thông tin getprop không cần USB / 无需 USB 的 getprop", STATUS_INFO,
                values.isEmpty() ? "Firmware chặn đọc thuộc tính / 固件限制读取" : values.toString());
    }

    private void testCpuAndMemory() {
        String abi = join(Build.SUPPORTED_ABIS);
        String abi32 = Build.VERSION.SDK_INT >= 21 ? join(Build.SUPPORTED_32_BIT_ABIS) : "n/a";
        String abi64 = Build.VERSION.SDK_INT >= 21 ? join(Build.SUPPORTED_64_BIT_ABIS) : "n/a";
        addResult("CPU", "ABI", empty(abi) ? STATUS_FAIL : STATUS_PASS,
                "all=" + abi + " | 32-bit=" + abi32 + " | 64-bit=" + abi64);

        int cores = Runtime.getRuntime().availableProcessors();
        addResult("CPU", "Số lõi CPU / CPU 核心", cores >= 4 ? STATUS_PASS : STATUS_WARN, String.valueOf(cores));
        String cpuInfo = readCpuSummary();
        addResult("CPU", "CPU info", empty(cpuInfo) ? STATUS_WARN : STATUS_INFO,
                empty(cpuInfo) ? "/proc/cpuinfo bị giới hạn / 读取受限" : cpuInfo);

        ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        long totalMb = mi.totalMem / 1024 / 1024;
        long availableMb = mi.availMem / 1024 / 1024;
        String ramStatus = totalMb >= 1500 ? STATUS_PASS : STATUS_WARN;
        addResult("MEMORY", "RAM", ramStatus,
                "total=" + totalMb + " MB | available=" + availableMb + " MB | lowMemory=" + mi.lowMemory);
        addResult("MEMORY", "App heap", am.getMemoryClass() >= 128 ? STATUS_PASS : STATUS_WARN,
                "memoryClass=" + am.getMemoryClass() + " MB | largeMemoryClass=" + am.getLargeMemoryClass() + " MB");

        try {
            byte[] block = new byte[16 * 1024];
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long start = System.nanoTime();
            for (int i = 0; i < 3000; i++) {
                block[i % block.length] = (byte) i;
                md.update(block);
            }
            md.digest();
            long ms = elapsedMs(start);
            addResult("CPU", "CPU workload", ms < 5000 ? STATUS_PASS : STATUS_WARN,
                    "SHA-256 workload=" + ms + " ms");
        } catch (Exception e) {
            addResult("CPU", "CPU workload", STATUS_FAIL, safeMessage(e));
        }
    }

    @SuppressWarnings("deprecation")
    private void testDisplay() {
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
        Configuration c = getResources().getConfiguration();
        float refresh = getWindowManager().getDefaultDisplay().getRefreshRate();
        int widthDp = Math.round(metrics.widthPixels / metrics.density);
        int heightDp = Math.round(metrics.heightPixels / metrics.density);
        String status = widthDp >= 320 && heightDp >= 480 ? STATUS_PASS : STATUS_WARN;
        addResult("DISPLAY", "Màn hình / 屏幕", status,
                metrics.widthPixels + "×" + metrics.heightPixels + " px | " + widthDp + "×" + heightDp +
                        " dp | density=" + metrics.density + " | dpi=" + metrics.densityDpi + " | " + round(refresh) + " Hz");
        addResult("DISPLAY", "Cấu hình UI / UI 配置", STATUS_INFO,
                "fontScale=" + c.fontScale + " | smallestWidthDp=" + c.smallestScreenWidthDp +
                        " | orientation=" + (c.orientation == Configuration.ORIENTATION_PORTRAIT ? "portrait" : "landscape") +
                        " | touch=" + getPackageManager().hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN));
    }

    private void testStorage() {
        try {
            StatFs fs = new StatFs(getFilesDir().getAbsolutePath());
            long total = fs.getTotalBytes();
            long free = fs.getAvailableBytes();
            String status = free >= 1024L * 1024 * 1024 ? STATUS_PASS : (free >= 512L * 1024 * 1024 ? STATUS_WARN : STATUS_FAIL);
            addResult("STORAGE", "Dung lượng nội bộ / 内部存储", status,
                    "total=" + formatBytes(total) + " | free=" + formatBytes(free) + " | appDir=" + getFilesDir().getAbsolutePath());
        } catch (Throwable t) {
            addResult("STORAGE", "Dung lượng nội bộ / 内部存储", STATUS_FAIL, safeMessage(t));
        }

        File test = new File(getCacheDir(), "lotus_io_test.bin");
        byte[] data = new byte[64 * 1024];
        for (int i = 0; i < data.length; i++) data[i] = (byte) (i * 31);
        MessageDigest writeHash = null;
        MessageDigest readHash = null;
        try {
            writeHash = MessageDigest.getInstance("SHA-256");
            long startWrite = System.nanoTime();
            try (FileOutputStream fos = new FileOutputStream(test);
                 BufferedOutputStream bos = new BufferedOutputStream(fos)) {
                for (int i = 0; i < 64; i++) {
                    bos.write(data);
                    writeHash.update(data);
                }
                bos.flush();
                fos.getFD().sync();
            }
            long writeMs = Math.max(1, elapsedMs(startWrite));
            long startRead = System.nanoTime();
            readHash = MessageDigest.getInstance("SHA-256");
            try (BufferedInputStream bis = new BufferedInputStream(new FileInputStream(test))) {
                byte[] buf = new byte[64 * 1024];
                int read;
                while ((read = bis.read(buf)) != -1) readHash.update(buf, 0, read);
            }
            long readMs = Math.max(1, elapsedMs(startRead));
            boolean valid = Arrays.equals(writeHash.digest(), readHash.digest());
            double writeSpeed = 4.0 * 1000 / writeMs;
            double readSpeed = 4.0 * 1000 / readMs;
            addResult("STORAGE", "Đọc/ghi vùng app / 应用存储读写", valid ? STATUS_PASS : STATUS_FAIL,
                    "4 MB | write=" + round(writeSpeed) + " MB/s | read=" + round(readSpeed) + " MB/s | hash=" + valid);
        } catch (Exception e) {
            addResult("STORAGE", "Đọc/ghi vùng app / 应用存储读写", STATUS_FAIL, safeMessage(e));
        } finally {
            if (test.exists() && !test.delete()) test.deleteOnExit();
        }
    }

    private void testDatabase() {
        File dbFile = new File(getCacheDir(), "lotus_check.db");
        SQLiteDatabase db = null;
        try {
            long start = System.nanoTime();
            db = SQLiteDatabase.openOrCreateDatabase(dbFile, null);
            db.execSQL("CREATE TABLE IF NOT EXISTS check_rows(id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
            db.beginTransaction();
            try {
                for (int i = 0; i < 500; i++) {
                    db.execSQL("INSERT INTO check_rows(value) VALUES(?)", new Object[]{"lotus-" + i});
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            long count = DatabaseUtils.queryNumEntries(db, "check_rows");
            long ms = elapsedMs(start);
            addResult("DATABASE", "SQLite", count == 500 ? STATUS_PASS : STATUS_FAIL,
                    "insert+verify 500 rows=" + ms + " ms | count=" + count);
        } catch (Exception e) {
            addResult("DATABASE", "SQLite", STATUS_FAIL, safeMessage(e));
        } finally {
            if (db != null) db.close();
            SQLiteDatabase.deleteDatabase(dbFile);
        }
    }

    private void testBatteryAndPower() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) {
            addResult("POWER", "Pin / 电池", STATUS_FAIL, "Không đọc được broadcast / 无法读取");
            return;
        }
        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        int percent = scale > 0 ? Math.round(level * 100f / scale) : -1;
        int temp = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0);
        int voltage = battery.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0);
        int health = battery.getIntExtra(BatteryManager.EXTRA_HEALTH, BatteryManager.BATTERY_HEALTH_UNKNOWN);
        int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        String status = percent >= 20 && temp < 450 ? STATUS_PASS : STATUS_WARN;
        addResult("POWER", "Pin / 电池", status,
                percent + "% | temp=" + (temp / 10f) + "°C | voltage=" + voltage + " mV | health=" + health + " | plugged=" + plugged);

        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        boolean optimized = !power.isIgnoringBatteryOptimizations(getPackageName());
        String thermal = "unsupported";
        if (Build.VERSION.SDK_INT >= 29) thermal = String.valueOf(power.getCurrentThermalStatus());
        addResult("POWER", "Nguồn và nhiệt / 电源与温度", STATUS_INFO,
                "batteryOptimization=" + optimized + " | powerSave=" + power.isPowerSaveMode() + " | thermalStatus=" + thermal);
    }

    private void testSecurityAndPolicy() {
        try {
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            addResult("SECURITY", "Khóa thiết bị / 设备锁", km.isDeviceSecure() ? STATUS_PASS : STATUS_WARN,
                    "deviceSecure=" + km.isDeviceSecure() + " | keyguardLocked=" + km.isKeyguardLocked());
        } catch (Throwable t) {
            addResult("SECURITY", "Khóa thiết bị / 设备锁", STATUS_WARN, safeMessage(t));
        }

        int adb = 0;
        int dev = 0;
        try { adb = Settings.Global.getInt(getContentResolver(), Settings.Global.ADB_ENABLED, 0); } catch (Throwable ignored) { }
        try { dev = Settings.Global.getInt(getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0); } catch (Throwable ignored) { }
        addResult("SECURITY", "Chế độ phát triển / 开发者模式", STATUS_INFO,
                "developerOptions=" + dev + " | adb=" + adb);

        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
            List<ComponentName> admins = dpm.getActiveAdmins();
            int count = admins == null ? 0 : admins.size();
            int encryption = dpm.getStorageEncryptionStatus();
            addResult("POLICY", "Quản trị thiết bị / 设备管理", count == 0 ? STATUS_INFO : STATUS_WARN,
                    "activeAdmins=" + count + " | thisAppDeviceOwner=" + dpm.isDeviceOwnerApp(getPackageName()) +
                            " | encryptionStatus=" + encryption);
        } catch (Throwable t) {
            addResult("POLICY", "Quản trị thiết bị / 设备管理", STATUS_WARN, safeMessage(t));
        }

        try {
            UserManager um = (UserManager) getSystemService(USER_SERVICE);
            String[] restrictions = new String[]{
                    UserManager.DISALLOW_INSTALL_APPS,
                    UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
                    UserManager.DISALLOW_DEBUGGING_FEATURES,
                    UserManager.DISALLOW_CONFIG_WIFI
            };
            List<String> active = new ArrayList<>();
            for (String restriction : restrictions) {
                if (um.hasUserRestriction(restriction)) active.add(restriction);
            }
            addResult("POLICY", "Giới hạn người dùng / 用户限制", active.isEmpty() ? STATUS_PASS : STATUS_WARN,
                    active.isEmpty() ? "Không phát hiện giới hạn chính / 未发现主要限制" : active.toString());
        } catch (Throwable t) {
            addResult("POLICY", "Giới hạn người dùng / 用户限制", STATUS_WARN, safeMessage(t));
        }
    }

    private void testNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        Network active = cm.getActiveNetwork();
        if (active == null) {
            addResult("NETWORK", "Kết nối mạng / 网络连接", STATUS_FAIL, "Không có mạng hoạt động / 无活动网络");
        } else {
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            if (caps == null) {
                addResult("NETWORK", "Kết nối mạng / 网络连接", STATUS_WARN, "Không đọc được capabilities");
            } else {
                List<String> transports = new ArrayList<>();
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transports.add("Wi-Fi");
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transports.add("Cellular");
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transports.add("Ethernet");
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transports.add("VPN");
                boolean internet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                addResult("NETWORK", "Kết nối mạng / 网络连接", internet && validated ? STATUS_PASS : STATUS_WARN,
                        "transport=" + transports + " | internet=" + internet + " | validated=" + validated +
                                " | metered=" + cm.isActiveNetworkMetered());
            }
        }

        try {
            long start = System.nanoTime();
            InetAddress[] addresses = InetAddress.getAllByName("www.sunmi.com");
            long ms = elapsedMs(start);
            addResult("NETWORK", "DNS", addresses.length > 0 ? STATUS_PASS : STATUS_FAIL,
                    "www.sunmi.com | answers=" + addresses.length + " | " + ms + " ms");
        } catch (Exception e) {
            addResult("NETWORK", "DNS", STATUS_FAIL, safeMessage(e));
        }

        HttpsURLConnection connection = null;
        try {
            long start = System.nanoTime();
            URL url = new URL("https://www.sunmi.com/");
            connection = (HttpsURLConnection) url.openConnection();
            connection.setRequestMethod("HEAD");
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "LotusDeviceCheck/" + APP_VERSION);
            int code = connection.getResponseCode();
            long ms = elapsedMs(start);
            String tls = connection.getCipherSuite();
            addResult("NETWORK", "HTTPS/TLS", code >= 200 && code < 500 ? STATUS_PASS : STATUS_WARN,
                    "https://www.sunmi.com | HTTP " + code + " | " + ms + " ms | " + tls);
        } catch (Exception e) {
            addResult("NETWORK", "HTTPS/TLS", STATUS_FAIL, safeMessage(e));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void testHardwareCapabilities() {
        PackageManager pm = getPackageManager();
        String[][] features = new String[][]{
                {"Touchscreen", PackageManager.FEATURE_TOUCHSCREEN},
                {"Wi-Fi", PackageManager.FEATURE_WIFI},
                {"Bluetooth", PackageManager.FEATURE_BLUETOOTH},
                {"Bluetooth LE", PackageManager.FEATURE_BLUETOOTH_LE},
                {"Telephony", PackageManager.FEATURE_TELEPHONY},
                {"GPS", PackageManager.FEATURE_LOCATION_GPS},
                {"Camera", PackageManager.FEATURE_CAMERA_ANY},
                {"NFC", PackageManager.FEATURE_NFC},
                {"USB host", PackageManager.FEATURE_USB_HOST},
                {"USB accessory", PackageManager.FEATURE_USB_ACCESSORY}
        };
        List<String> present = new ArrayList<>();
        List<String> absent = new ArrayList<>();
        for (String[] feature : features) {
            if (pm.hasSystemFeature(feature[1])) present.add(feature[0]); else absent.add(feature[0]);
        }
        addResult("HARDWARE", "Tính năng hệ thống / 系统功能", STATUS_INFO,
                "present=" + present + " | absent=" + absent);

        try {
            SensorManager sm = (SensorManager) getSystemService(SENSOR_SERVICE);
            List<Sensor> sensors = sm.getSensorList(Sensor.TYPE_ALL);
            List<String> names = new ArrayList<>();
            for (Sensor sensor : sensors) {
                if (names.size() >= 20) break;
                names.add(sensor.getName() + "(type " + sensor.getType() + ")");
            }
            addResult("HARDWARE", "Cảm biến / 传感器", STATUS_INFO,
                    "count=" + sensors.size() + " | " + names);
        } catch (Throwable t) {
            addResult("HARDWARE", "Cảm biến / 传感器", STATUS_WARN, safeMessage(t));
        }

        try {
            CameraManager cameras = (CameraManager) getSystemService(CAMERA_SERVICE);
            String[] ids = cameras.getCameraIdList();
            List<String> details = new ArrayList<>();
            for (String id : ids) {
                CameraCharacteristics cc = cameras.getCameraCharacteristics(id);
                Integer facing = cc.get(CameraCharacteristics.LENS_FACING);
                Integer level = cc.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
                Boolean flash = cc.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                details.add("id=" + id + ", facing=" + facing + ", level=" + level + ", flash=" + flash);
            }
            addResult("CAMERA", "Camera", ids.length > 0 ? STATUS_PASS : STATUS_INFO,
                    "count=" + ids.length + " | " + details);
        } catch (Throwable t) {
            addResult("CAMERA", "Camera", STATUS_WARN, safeMessage(t));
        }

        try {
            NfcAdapter nfc = NfcAdapter.getDefaultAdapter(this);
            boolean feature = pm.hasSystemFeature(PackageManager.FEATURE_NFC);
            boolean hce = pm.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION);
            boolean hcef = Build.VERSION.SDK_INT >= 24 &&
                    pm.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION_NFCF);
            addResult("NFC", "NFC + HCE", nfc == null ? STATUS_WARN : (nfc.isEnabled() ? STATUS_PASS : STATUS_WARN),
                    nfc == null
                            ? "Không có adapter; có thể máy không phải bản V2s Label & NFC / 无 NFC 适配器"
                            : "feature=" + feature + " | enabled=" + nfc.isEnabled() +
                            " | HCE-A/B=" + hce + " | HCE-F=" + hcef +
                            " | reader test=A/B/F/V");
        } catch (Throwable t) {
            addResult("NFC", "NFC", STATUS_WARN, safeMessage(t));
        }

        try {
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            addResult("BLUETOOTH", "Bluetooth", bt == null ? STATUS_INFO : STATUS_PASS,
                    bt == null ? "Không có adapter / 无蓝牙" : "available=true | enabled=" + bt.isEnabled());
        } catch (Throwable t) {
            addResult("BLUETOOTH", "Bluetooth", STATUS_WARN, safeMessage(t));
        }

        try {
            UsbManager usb = (UsbManager) getSystemService(USB_SERVICE);
            addResult("USB", "Thiết bị USB / USB 设备", STATUS_INFO,
                    "connectedDevices=" + usb.getDeviceList().size());
        } catch (Throwable t) {
            addResult("USB", "Thiết bị USB / USB 设备", STATUS_WARN, safeMessage(t));
        }
    }

    private void testWebView() {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                PackageInfo web = WebView.getCurrentWebViewPackage();
                addResult("WEBVIEW", "Android System WebView", web == null ? STATUS_WARN : STATUS_PASS,
                        web == null ? "Không có provider / 无提供程序" : web.packageName + " " + web.versionName);
            } catch (Throwable t) {
                addResult("WEBVIEW", "Android System WebView", STATUS_WARN, safeMessage(t));
            }
        } else {
            addResult("WEBVIEW", "Android System WebView", STATUS_INFO, "API < 26");
        }
    }

    @SuppressWarnings("deprecation")
    private void testPrintEnvironment() {
        PackageManager pm = getPackageManager();
        boolean printFeature = pm.hasSystemFeature("android.software.print");
        Intent printServiceIntent = new Intent("android.printservice.PrintService");
        List<ResolveInfo> services = pm.queryIntentServices(printServiceIntent, PackageManager.GET_META_DATA);
        List<String> names = new ArrayList<>();
        for (ResolveInfo ri : services) {
            if (ri.serviceInfo != null) names.add(ri.serviceInfo.packageName + "/" + ri.serviceInfo.name);
        }
        addResult("PRINT", "Android Print Framework", printFeature && !services.isEmpty() ? STATUS_PASS : STATUS_WARN,
                "feature=" + printFeature + " | services=" + names);

        String[] candidates = new String[]{
                "woyou.aidlservice.jiuiv5",
                "com.sunmi.extprinterservice",
                "com.sunmi.printservice",
                "com.sunmi.scanner"
        };
        List<String> installed = new ArrayList<>();
        for (String candidate : candidates) {
            try {
                ApplicationInfo ai = pm.getApplicationInfo(candidate, 0);
                PackageInfo pi = pm.getPackageInfo(candidate, 0);
                installed.add(candidate + "(enabled=" + ai.enabled + ", version=" +
                        pi.versionName + "/" + versionCode(pi) + ")");
            } catch (PackageManager.NameNotFoundException ignored) { }
        }

        Intent sunmi = new Intent("woyou.aidlservice.jiuiv5.IWoyouService");
        sunmi.setPackage("woyou.aidlservice.jiuiv5");
        ResolveInfo resolved = pm.resolveService(sunmi, PackageManager.MATCH_DEFAULT_ONLY);
        addResult("PRINT", "Dịch vụ SUNMI / SUNMI 打印服务",
                resolved != null || !installed.isEmpty() ? STATUS_PASS : STATUS_WARN,
                "knownPackages=" + installed + " | AIDL resolved=" + (resolved != null));

        if (sunmiPrinterService != null) {
            try {
                int state = sunmiPrinterService.updatePrinterState();
                addResult("PRINT", "SUNMI SDK 1.0.18", state == 1 ? STATUS_PASS : STATUS_WARN,
                        printerIdentityWithoutSerial() + " | state=" + state + " (" + printerStateText(state) + ")");
            } catch (Throwable t) {
                addResult("PRINT", "SUNMI SDK 1.0.18", STATUS_WARN, safeMessage(t));
            }
        } else {
            addResult("PRINT", "SUNMI SDK 1.0.18", STATUS_INFO,
                    "Nhấn Kết nối dịch vụ in để kiểm tra API trực tiếp / 请连接打印服务以测试直接 API");
        }
    }

    private void testPreviousCrash() {
        File crash = new File(getFilesDir(), "last_crash.txt");
        if (!crash.exists()) {
            addResult("STABILITY", "Crash trước đó / 上次崩溃", STATUS_PASS, "Không có crash được ghi nhận / 无记录");
            return;
        }
        String first = readFirstLine(crash);
        addResult("STABILITY", "Crash trước đó / 上次崩溃", STATUS_WARN,
                first + " — báo cáo đầy đủ nằm trong vùng riêng của app");
    }

    private void testSunmiPrinterBinding() {
        registerPrinterStatusReceiver();
        if (printerBound && sunmiPrinterService != null) {
            readSunmiPrinterStatus(true);
            return;
        }
        sunmiPrinterCallback = new InnerPrinterCallback() {
            @Override
            protected void onConnected(SunmiPrinterService service) {
                sunmiPrinterService = service;
                printerBound = true;
                boolean hasPrinter = true;
                try { hasPrinter = InnerPrinterManager.getInstance().hasPrinter(service); }
                catch (Throwable ignored) { }
                int state = -1;
                try { state = service.updatePrinterState(); } catch (Throwable ignored) { }
                addResult("PRINT", "SUNMI SDK kết nối / SUNMI SDK 已连接",
                        hasPrinter ? STATUS_PASS : STATUS_FAIL,
                        "library=printerlibrary 1.0.18 | hasPrinter=" + hasPrinter +
                                " | " + printerIdentityWithoutSerial() +
                                " | state=" + state + " (" + printerStateText(state) + ")");
                updateSummary();
                toast("SUNMI SDK đã kết nối / SUNMI SDK 已连接");
            }

            @Override
            protected void onDisconnected() {
                sunmiPrinterService = null;
                printerBound = false;
                addResult("PRINT", "Dịch vụ máy in bị ngắt / 打印服务断开", STATUS_WARN,
                        "SUNMI InnerPrinter service disconnected");
                updateSummary();
            }
        };
        try {
            boolean requested = InnerPrinterManager.getInstance().bindService(this, sunmiPrinterCallback);
            if (!requested) {
                addResult("PRINT", "Bind máy in SUNMI / 连接 SUNMI 打印机", STATUS_FAIL,
                        "SUNMI InnerPrinterManager.bindService trả về false");
                updateSummary();
            } else {
                toast("Đang kết nối… / 正在连接…");
            }
        } catch (Throwable t) {
            addResult("PRINT", "Bind máy in SUNMI / 连接 SUNMI 打印机", STATUS_FAIL, safeMessage(t));
            updateSummary();
        }
    }

    private void readSunmiPrinterStatus(boolean userInitiated) {
        if (sunmiPrinterService == null) {
            addResult("PRINT", "Trạng thái máy in / 打印机状态", STATUS_WARN,
                    "Chưa kết nối SDK; đang thử kết nối / SDK 未连接，正在连接");
            if (userInitiated) testSunmiPrinterBinding();
            updateSummary();
            return;
        }
        worker.execute(() -> {
            try {
                int state = sunmiPrinterService.updatePrinterState();
                addResult("PRINT", "Trạng thái giấy và lỗi / 纸张与错误状态",
                        printerStateStatus(state),
                        "code=" + state + " | " + printerStateText(state) +
                                " | " + printerIdentityWithoutSerial());
            } catch (Throwable t) {
                addResult("PRINT", "Trạng thái giấy và lỗi / 纸张与错误状态", STATUS_FAIL,
                        safeMessage(t));
            }
            runOnUiThread(this::updateSummary);
        });
    }

    private void startPrintTest() {
        if (sunmiPrinterService == null) {
            addResult("PRINT", "In trực tiếp SUNMI SDK / SUNMI SDK 直接打印", STATUS_WARN,
                    "Chưa kết nối; bấm lại sau khi thấy SUNMI SDK đã kết nối / 尚未连接，请连接后重试");
            testSunmiPrinterBinding();
            updateSummary();
            return;
        }
        worker.execute(() -> {
            try {
                final int stateBefore = sunmiPrinterService.updatePrinterState();
                if (stateBefore != 1) {
                    addResult("PRINT", "In trực tiếp SUNMI SDK / SUNMI SDK 直接打印",
                            printerStateStatus(stateBefore),
                            "Không gửi lệnh vì state=" + stateBefore + " — " + printerStateText(stateBefore));
                    runOnUiThread(this::updateSummary);
                    return;
                }

                sunmiPrinterService.enterPrinterBuffer(true);
                sunmiPrinterService.printerInit(null);
                sunmiPrinterService.setAlignment(1, null);
                sunmiPrinterService.printTextWithFont("LOTUS DEVICE CHECK\n", null, 32f, null);
                sunmiPrinterService.printTextWithFont("SUNMI SDK / AIDL DIRECT TEST\n", null, 22f, null);
                sunmiPrinterService.setAlignment(0, null);
                sunmiPrinterService.printText("--------------------------------\n", null);
                sunmiPrinterService.printText("Tiếng Việt: Trà sữa - Hóa đơn\n", null);
                sunmiPrinterService.printText("中文：打印测试 - 订单 - 发票\n", null);
                sunmiPrinterService.printText("Amount: 123,456 VND\n", null);
                sunmiPrinterService.printColumnsString(
                        new String[]{"ITEM", "QTY", "TOTAL"},
                        new int[]{14, 4, 10}, new int[]{0, 1, 2}, null);
                sunmiPrinterService.printColumnsString(
                        new String[]{"Milk tea", "2", "98,000"},
                        new int[]{14, 4, 10}, new int[]{0, 1, 2}, null);
                sunmiPrinterService.setAlignment(1, null);
                sunmiPrinterService.printQRCode("LOTUS-SUNMI-SDK-OK", 6, 2, null);
                sunmiPrinterService.printBarCode("LOTUS123", 8, 70, 2, 2, null);
                sunmiPrinterService.lineWrap(3, null);
                sunmiPrinterService.commitPrinterBufferWithCallback(new InnerResultCallback() {
                    @Override public void onRunResult(boolean success) { }
                    @Override public void onReturnString(String value) { }
                    @Override public void onRaiseException(int code, String message) {
                        addResult("PRINT", "Callback ngoại lệ / 打印异常回调", STATUS_FAIL,
                                "code=" + code + " | " + value(message));
                        runOnUiThread(DiagnosticsActivity.this::updateSummary);
                    }
                    @Override public void onPrintResult(int code, String message) {
                        int stateAfter = -1;
                        try { stateAfter = sunmiPrinterService.updatePrinterState(); }
                        catch (Throwable ignored) { }
                        addResult("PRINT", "Kết quả in thực tế / 实际打印结果",
                                code == 0 && stateAfter == 1 ? STATUS_PASS : STATUS_FAIL,
                                "transactionCode=" + code + " | message=" + value(message) +
                                        " | stateBefore=" + stateBefore + " | stateAfter=" + stateAfter +
                                        " (" + printerStateText(stateAfter) + ")");
                        runOnUiThread(DiagnosticsActivity.this::updateSummary);
                    }
                });
                addResult("PRINT", "Lệnh in đã gửi / 打印命令已提交", STATUS_INFO,
                        "Đang chờ callback giao dịch; đây là API trực tiếp, không mở hộp thoại Android Print");
            } catch (Throwable t) {
                try { sunmiPrinterService.exitPrinterBuffer(false); } catch (Throwable ignored) { }
                addResult("PRINT", "In trực tiếp SUNMI SDK / SUNMI SDK 直接打印", STATUS_FAIL,
                        safeMessage(t));
            }
            runOnUiThread(this::updateSummary);
        });
    }

    private String printerIdentityWithoutSerial() {
        if (sunmiPrinterService == null) return "service=null";
        List<String> info = new ArrayList<>();
        try { info.add("model=" + sunmiPrinterService.getPrinterModal()); } catch (Throwable ignored) { }
        try { info.add("firmware=" + sunmiPrinterService.getPrinterVersion()); } catch (Throwable ignored) { }
        try { info.add("service=" + sunmiPrinterService.getServiceVersion()); } catch (Throwable ignored) { }
        try { info.add("paper=" + (sunmiPrinterService.getPrinterPaper() == 1 ? "58mm" : "80mm")); }
        catch (Throwable ignored) { }
        try { info.add("mode=" + sunmiPrinterService.getPrinterMode()); } catch (Throwable ignored) { }
        try { info.add("density=" + sunmiPrinterService.getPrinterDensity()); } catch (Throwable ignored) { }
        return info.toString();
    }

    private static String printerStateStatus(int state) {
        if (state == 1) return STATUS_PASS;
        if (state == 2 || state == 8) return STATUS_WARN;
        return STATUS_FAIL;
    }

    private static String printerStateText(int state) {
        switch (state) {
            case 1: return "Bình thường / 正常";
            case 2: return "Đang khởi tạo / 准备中";
            case 3: return "Lỗi giao tiếp hoặc lỗi cơ cấu; kiểm tra kẹt giấy / 通信或机构异常";
            case 4: return "Hết giấy / 缺纸";
            case 5: return "Đầu in quá nhiệt / 打印头过热";
            case 6: return "Nắp mở (không bắt buộc với máy cầm tay) / 机盖打开";
            case 7: return "Dao cắt kẹt; thường không áp dụng V2s / 切刀异常";
            case 8: return "Dao cắt đã phục hồi / 切刀恢复";
            case 9: return "Không thấy black mark / 未检测到黑标";
            case 505: return "Không phát hiện máy in / 未检测到打印机";
            case 507: return "Cập nhật firmware máy in thất bại / 固件升级失败";
            default: return "Không xác định / 未知";
        }
    }

    private void registerPrinterStatusReceiver() {
        if (printerStatusReceiverRegistered) return;
        printerStatusReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                String action = intent == null ? "" : value(intent.getAction());
                String status = action.contains("NORMAL_ACTION") || action.contains("NORMAL_HEATING")
                        ? STATUS_PASS : (action.contains("INIT_ACTION") || action.contains("COVER_OPEN")
                        ? STATUS_WARN : STATUS_FAIL);
                addResult("PRINT", "Broadcast máy in / 打印机广播", status,
                        action + " | " + printerBroadcastText(action));
                updateSummary();
            }
        };
        IntentFilter filter = new IntentFilter();
        String[] actions = new String[]{
                "woyou.aidlservice.jiuv5.INIT_ACTION",
                "woyou.aidlservice.jiuv5.NORMAL_ACTION",
                "woyou.aidlservice.jiuv5.ERROR_ACTION",
                "woyou.aidlservice.jiuv5.OUT_OF_PAPER_ACTION",
                "woyou.aidlservice.jiuv5.OVER_HEATING_ACITON",
                "woyou.aidlservice.jiuv5.NORMAL_HEATING_ACITON",
                "woyou.aidlservice.jiuv5.COVER_OPEN_ACTION",
                "woyou.aidlservice.jiuv5.COVER_ERROR_ACTION",
                "woyou.aidlservice.jiuv5.KNIFE_ERROR_ACTION_1",
                "woyou.aidlservice.jiuv5.KNIFE_ERROR_ACTION_2",
                "woyou.aidlservice.jiuv5.FIRMWARE_UPDATING_ACITON",
                "woyou.aidlservice.jiuv5.FIRMWARE_FAILURE_ACITON",
                "woyou.aidlservice.jiuv5.PRINTER_NON_EXISTENT_ACITON",
                "woyou.aidlservice.jiuv5.BLACKLABEL_NON_EXISTENT_ACITON"
        };
        for (String action : actions) filter.addAction(action);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(printerStatusReceiver, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(printerStatusReceiver, filter);
        printerStatusReceiverRegistered = true;
    }

    private static String printerBroadcastText(String action) {
        if (action.contains("OUT_OF_PAPER")) return "Hết giấy / 缺纸";
        if (action.contains("KNIFE_ERROR_ACTION_1")) return "Kẹt dao cắt / 切刀卡住";
        if (action.contains("ERROR_ACTION") || action.contains("COVER_ERROR"))
            return "Lỗi cơ cấu/giao tiếp; kiểm tra kẹt giấy / 机构或通信错误，请检查卡纸";
        if (action.contains("OVER_HEATING")) return "Quá nhiệt / 过热";
        if (action.contains("NORMAL_ACTION")) return "Sẵn sàng / 正常";
        if (action.contains("PRINTER_NON_EXISTENT")) return "Không phát hiện máy in / 未检测到打印机";
        return "Sự kiện trạng thái SUNMI / SUNMI 状态事件";
    }

    private void startCameraTest() {
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (camera.resolveActivity(getPackageManager()) == null) {
            addResult("CAMERA", "Mở camera / 打开相机", STATUS_FAIL, "Không có camera activity / 无相机应用");
            updateSummary();
            return;
        }
        try {
            cameraOutputUri = null;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, "lotus_camera_test_" + System.currentTimeMillis() + ".jpg");
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/LotusDeviceCheck");
                cameraOutputUri = getContentResolver().insert(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (cameraOutputUri != null) {
                    camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
                    camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    camera.setClipData(ClipData.newRawUri("Lotus camera test", cameraOutputUri));
                }
            }
            startActivityForResult(camera, CAMERA_REQUEST);
        } catch (Throwable t) {
            deleteCameraTestImage();
            addResult("CAMERA", "Mở camera / 打开相机", STATUS_FAIL, safeMessage(t));
            updateSummary();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CAMERA_REQUEST) {
            if (resultCode == RESULT_OK) {
                String validation = validateCameraResult(data);
                addResult("CAMERA", "Chụp ảnh thật / 实际拍照",
                        validation.startsWith("PASS") ? STATUS_PASS : STATUS_WARN, validation);
            } else {
                addResult("CAMERA", "Chụp ảnh thật / 实际拍照", STATUS_WARN,
                        "Đã hủy hoặc camera không trả ảnh / 已取消或无结果");
            }
            deleteCameraTestImage();
            updateSummary();
        }
    }

    private String validateCameraResult(Intent data) {
        try {
            if (cameraOutputUri != null) {
                long size = 0;
                try (Cursor cursor = getContentResolver().query(cameraOutputUri,
                        new String[]{MediaStore.Images.Media.SIZE}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) size = cursor.getLong(0);
                }
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                try (java.io.InputStream input = getContentResolver().openInputStream(cameraOutputUri)) {
                    BitmapFactory.decodeStream(input, null, options);
                }
                if (size > 0 && options.outWidth > 0 && options.outHeight > 0) {
                    return "PASS | JPEG=" + size + " bytes | " + options.outWidth + "×" + options.outHeight +
                            " px | ảnh test sẽ bị xóa / 测试图像将删除";
                }
                return "WARN | Camera trả RESULT_OK nhưng file ảnh không hợp lệ / 返回成功但图像无效";
            }
            Bundle extras = data == null ? null : data.getExtras();
            Object thumbnail = extras == null ? null : extras.get("data");
            return thumbnail == null
                    ? "WARN | RESULT_OK nhưng không có file/thumbnail / 无图像数据"
                    : "PASS | Camera trả thumbnail hợp lệ / 相机返回有效缩略图";
        } catch (Throwable t) {
            return "WARN | " + safeMessage(t);
        }
    }

    private void deleteCameraTestImage() {
        if (cameraOutputUri == null) return;
        try { getContentResolver().delete(cameraOutputUri, null, null); } catch (Throwable ignored) { }
        cameraOutputUri = null;
    }

    private void prepareNfc() {
        try {
            nfcAdapter = NfcAdapter.getDefaultAdapter(this);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
            Intent intent = new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            nfcPendingIntent = PendingIntent.getActivity(this, 0, intent, flags);
        } catch (Throwable ignored) { }
    }

    private void armNfcTest() {
        if (nfcAdapter == null) {
            addResult("NFC", "Quét thẻ NFC / 扫描 NFC 卡", STATUS_FAIL,
                    "Thiết bị không có NFC; đối chiếu biến thể V2s Label & NFC / 设备无 NFC，请核对设备版本");
            updateSummary();
            return;
        }
        if (!nfcAdapter.isEnabled()) {
            addResult("NFC", "Quét thẻ NFC / 扫描 NFC 卡", STATUS_WARN, "NFC đang tắt / NFC 未开启");
            updateSummary();
            return;
        }
        nfcTestArmed = true;
        enableNfcReaderMode();
        toast("Đưa thẻ A/B, Mifare, FeliCa hoặc ISO15693 lại gần máy / 请将 NFC 卡靠近设备");
    }

    private void enableNfcReaderMode() {
        if (!nfcTestArmed || nfcAdapter == null || !nfcAdapter.isEnabled()) return;
        int flags = NfcAdapter.FLAG_READER_NFC_A |
                NfcAdapter.FLAG_READER_NFC_B |
                NfcAdapter.FLAG_READER_NFC_F |
                NfcAdapter.FLAG_READER_NFC_V |
                NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
        try {
            nfcAdapter.enableReaderMode(this, tag -> runOnUiThread(() -> {
                addResult("NFC", "Đọc thẻ NFC thật / 实际读取 NFC 卡", STATUS_PASS,
                        "tech=" + Arrays.toString(tag.getTechList()) +
                                " | chuẩn thử=A/B/F/V | không lưu UID / 不保存卡片 UID");
                nfcTestArmed = false;
                try { nfcAdapter.disableReaderMode(this); } catch (Throwable ignored) { }
                updateSummary();
            }), flags, null);
        } catch (Throwable t) {
            addResult("NFC", "Bật reader mode / 启用读卡模式", STATUS_FAIL, safeMessage(t));
            updateSummary();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null || !nfcTestArmed) return;
        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        if (tag != null) {
            addResult("NFC", "Quét thẻ NFC / 扫描 NFC 卡", STATUS_PASS,
                    "tech=" + Arrays.toString(tag.getTechList()) + " | ID không được lưu / 未保存卡片 ID");
            nfcTestArmed = false;
            updateSummary();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfcTestArmed && nfcAdapter != null && nfcAdapter.isEnabled()) {
            enableNfcReaderMode();
        }
    }

    @Override
    protected void onPause() {
        if (nfcAdapter != null) {
            try { nfcAdapter.disableReaderMode(this); } catch (Throwable ignored) { }
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (printerBound && sunmiPrinterCallback != null) {
            try { InnerPrinterManager.getInstance().unBindService(this, sunmiPrinterCallback); }
            catch (Throwable ignored) { }
        }
        if (printerStatusReceiverRegistered && printerStatusReceiver != null) {
            try { unregisterReceiver(printerStatusReceiver); } catch (Throwable ignored) { }
        }
        deleteCameraTestImage();
        worker.shutdownNow();
        super.onDestroy();
    }

    private void shareReport() {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_SUBJECT, "Lotus Device Check — " + Build.MANUFACTURER + " " + Build.MODEL);
        share.putExtra(Intent.EXTRA_TEXT, buildReport());
        startActivity(Intent.createChooser(share, "Chia sẻ báo cáo / 分享报告"));
    }

    private void copyReport() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Lotus Device Check", buildReport()));
        toast("Đã sao chép / 已复制");
    }

    private void saveReport() {
        String fileName = "Lotus_Device_Check_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".txt";
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/LotusDeviceCheck");
                android.net.Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("MediaStore insert returned null");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("Cannot open output stream");
                    out.write(buildReport().getBytes(StandardCharsets.UTF_8));
                }
                toast("Đã lưu Downloads/LotusDeviceCheck/" + fileName);
            } else {
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                if (dir == null) throw new IOException("External files unavailable");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create report directory");
                File output = new File(dir, fileName);
                try (FileOutputStream fos = new FileOutputStream(output)) {
                    fos.write(buildReport().getBytes(StandardCharsets.UTF_8));
                }
                MediaScannerConnection.scanFile(this, new String[]{output.getAbsolutePath()}, new String[]{"text/plain"}, null);
                toast("Đã lưu: " + output.getAbsolutePath());
            }
        } catch (Throwable t) {
            addResult("REPORT", "Lưu báo cáo / 保存报告", STATUS_FAIL, safeMessage(t));
            updateSummary();
        }
    }

    private String buildReport() {
        StringBuilder out = new StringBuilder();
        out.append("LOTUS DEVICE CHECK REPORT\n");
        out.append("App: ").append(APP_VERSION).append("\n");
        out.append("Generated: ").append(now()).append("\n");
        out.append("Privacy: no IMEI, phone number, serial or MAC collected.\n");
        out.append("Device: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append("\n");
        out.append("Android: ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n\n");
        synchronized (results) {
            for (ResultItem item : results) {
                out.append('[').append(item.status).append("] [").append(item.category).append("] ")
                        .append(item.name).append("\n  ").append(item.detail).append("\n");
            }
        }
        out.append("\nEND OF REPORT\n");
        return out.toString();
    }

    private void addResult(String category, String name, String status, String detail) {
        ResultItem item = new ResultItem(category, name, status, sanitize(detail));
        synchronized (results) { results.add(item); }
        runOnUiThread(() -> renderResult(item));
    }

    private void renderResult(ResultItem item) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(11), dp(9), dp(11), dp(9));
        card.setBackgroundColor(statusBackground(item.status));

        TextView heading = new TextView(this);
        heading.setText("[" + item.status + "] " + item.category + " — " + item.name);
        heading.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        heading.setTextColor(statusColor(item.status));
        heading.setTypeface(Typeface.DEFAULT_BOLD);
        card.addView(heading);

        TextView detail = new TextView(this);
        detail.setText(item.detail);
        detail.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        detail.setTextColor(Color.rgb(45, 48, 57));
        detail.setPadding(0, dp(3), 0, 0);
        detail.setTextIsSelectable(true);
        card.addView(detail);
        resultList.addView(card, margins(0, 0, 0, dp(7)));
    }

    private void updateSummary() {
        int pass = 0, warn = 0, fail = 0, info = 0;
        synchronized (results) {
            for (ResultItem item : results) {
                if (STATUS_PASS.equals(item.status)) pass++;
                else if (STATUS_WARN.equals(item.status)) warn++;
                else if (STATUS_FAIL.equals(item.status)) fail++;
                else info++;
            }
        }
        summary.setText("PASS " + pass + "   WARN " + warn + "   FAIL " + fail + "   INFO " + info +
                "\nKết quả cuối cùng phải được đối chiếu trên máy thật / 最终结果须在真机确认");
        summary.setTextColor(fail > 0 ? Color.rgb(155, 25, 35) : (warn > 0 ? Color.rgb(130, 82, 0) : Color.rgb(0, 105, 74)));
    }

    private void setCheckProgress(int value) {
        runOnUiThread(() -> progress.setProgress(value));
    }

    private void installCrashRecorder() {
        previousCrashHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            File file = new File(getFilesDir(), "last_crash.txt");
            try (FileOutputStream out = new FileOutputStream(file)) {
                String text = now() + " | " + throwable.getClass().getName() + ": " + safeMessage(throwable) + "\n";
                out.write(text.getBytes(StandardCharsets.UTF_8));
                for (StackTraceElement element : throwable.getStackTrace()) {
                    out.write(("  at " + element + "\n").getBytes(StandardCharsets.UTF_8));
                }
            } catch (Throwable ignored) { }
            if (previousCrashHandler != null) previousCrashHandler.uncaughtException(thread, throwable);
        });
    }

    private void incrementLaunchCounter() {
        SharedPreferences prefs = getSharedPreferences("device_check", MODE_PRIVATE);
        prefs.edit().putInt("launch_count", prefs.getInt("launch_count", 0) + 1).apply();
    }

    private String readCpuSummary() {
        File cpu = new File("/proc/cpuinfo");
        if (!cpu.canRead()) return "";
        List<String> selected = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(cpu))) {
            String line;
            int seen = 0;
            while ((line = reader.readLine()) != null && seen < 120) {
                seen++;
                String lower = line.toLowerCase(Locale.US);
                if (lower.startsWith("hardware") || lower.startsWith("model name") || lower.startsWith("processor")) {
                    selected.add(line.trim());
                    if (selected.size() >= 5) break;
                }
            }
        } catch (IOException ignored) { }
        return selected.toString();
    }

    private String readFirstLine(File file) {
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            return value(reader.readLine());
        } catch (IOException e) {
            return safeMessage(e);
        }
    }

    private String readSystemProperty(String key) {
        Process process = null;
        try {
            process = new ProcessBuilder("/system/bin/getprop", key).redirectErrorStream(true).start();
            try (BufferedReader reader = new BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line = reader.readLine();
                process.waitFor();
                return sanitize(line);
            }
        } catch (Throwable ignored) {
            return "";
        } finally {
            if (process != null) process.destroy();
        }
    }

    private Button actionButton(String text, boolean primary) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, primary ? 14 : 12);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setTextColor(primary ? Color.WHITE : Color.rgb(25, 28, 36));
        button.setBackgroundColor(primary ? Color.rgb(183, 25, 46) : Color.WHITE);
        button.setMinHeight(dp(primary ? 52 : 46));
        button.setPadding(dp(8), dp(6), dp(8), dp(6));
        button.setLayoutParams(margins(0, dp(4), 0, dp(4)));
        return button;
    }

    private TextView sectionTitle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        view.setTextColor(Color.rgb(92, 98, 113));
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setPadding(dp(2), dp(16), dp(2), dp(7));
        return view;
    }

    private TextView cardText(String text, int background, int foreground) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(foreground);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        view.setLineSpacing(0, 1.12f);
        view.setPadding(dp(12), dp(10), dp(12), dp(10));
        view.setBackgroundColor(background);
        view.setTextIsSelectable(true);
        view.setLayoutParams(margins(0, 0, 0, dp(8)));
        return view;
    }

    private LinearLayout.LayoutParams margins(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(left, top, right, bottom);
        return p;
    }

    private int statusBackground(String status) {
        if (STATUS_PASS.equals(status)) return Color.rgb(231, 248, 240);
        if (STATUS_WARN.equals(status)) return Color.rgb(255, 246, 222);
        if (STATUS_FAIL.equals(status)) return Color.rgb(255, 232, 235);
        return Color.WHITE;
    }

    private int statusColor(String status) {
        if (STATUS_PASS.equals(status)) return Color.rgb(0, 112, 77);
        if (STATUS_WARN.equals(status)) return Color.rgb(135, 83, 0);
        if (STATUS_FAIL.equals(status)) return Color.rgb(165, 20, 40);
        return Color.rgb(54, 72, 120);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static long elapsedMs(long startNano) {
        return (System.nanoTime() - startNano) / 1_000_000L;
    }

    private static String formatBytes(long bytes) {
        double gb = bytes / 1024d / 1024d / 1024d;
        return new DecimalFormat("0.00").format(gb) + " GB";
    }

    private static String round(double value) {
        return new DecimalFormat("0.0").format(value);
    }

    private static String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US).format(new Date());
    }

    private static String formatTime(long time) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(time));
    }

    private static String safeMessage(Throwable t) {
        String message = t.getMessage();
        return t.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private static String sanitize(String text) {
        if (text == null) return "";
        return text.replace('\r', ' ').replace('\u0000', ' ').trim();
    }

    private static String value(String text) {
        return text == null ? "unknown" : text;
    }

    private static boolean empty(String text) {
        return text == null || text.trim().isEmpty();
    }

    private static String join(String[] values) {
        return values == null || values.length == 0 ? "none" : Arrays.toString(values);
    }

    private static final class ResultItem {
        final String category;
        final String name;
        final String status;
        final String detail;

        ResultItem(String category, String name, String status, String detail) {
            this.category = category;
            this.name = name;
            this.status = status;
            this.detail = detail;
        }
    }

    private static final class ThermalPrintAdapter extends PrintDocumentAdapter {
        private final Context context;
        private PrintedPdfDocument document;

        ThermalPrintAdapter(Context context) {
            this.context = context;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                             android.os.CancellationSignal cancellationSignal,
                             LayoutResultCallback callback, Bundle extras) {
            document = new PrintedPdfDocument(context, newAttributes);
            PrintDocumentInfo info = new PrintDocumentInfo.Builder("Lotus_Device_Check.pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(1)
                    .build();
            callback.onLayoutFinished(info, !newAttributes.equals(oldAttributes));
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                            android.os.CancellationSignal cancellationSignal,
                            WriteResultCallback callback) {
            android.graphics.pdf.PdfDocument.Page page = document.startPage(0);
            Canvas canvas = page.getCanvas();
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.BLACK);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(16);
            float x = 12;
            float y = 28;
            canvas.drawText("LOTUS DEVICE CHECK", x, y, paint);
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextSize(11);
            y += 24;
            canvas.drawText("SUNMI printer compatibility test", x, y, paint);
            y += 18;
            canvas.drawText("Tiếng Việt: Trà sữa - Hóa đơn", x, y, paint);
            y += 18;
            canvas.drawText("中文: 打印测试 - 订单 - 发票", x, y, paint);
            y += 18;
            canvas.drawText("Amount: 123,456 VND", x, y, paint);
            y += 12;
            float qrSize = drawFixedQr(canvas, canvas.getWidth() / 2f, y, paint);
            y += qrSize + 12;
            drawCode39(canvas, "*LOTUS123*", 12, y, canvas.getWidth() - 24, 46, paint);
            y += 58;
            paint.setStrokeWidth(2);
            canvas.drawLine(x, y, canvas.getWidth() - 12, y, paint);
            y += 20;
            canvas.drawText("Result: [  ] PASS   [  ] FAIL", x, y, paint);
            y += 20;
            canvas.drawText(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()), x, y, paint);
            document.finishPage(page);
            try (FileOutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                document.writeTo(out);
                callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
            } catch (IOException e) {
                callback.onWriteFailed(e.getMessage());
            } finally {
                document.close();
                document = null;
            }
        }

        private static float drawFixedQr(Canvas canvas, float centerX, float top, Paint paint) {
            String[] matrix = new String[]{
                    "1111111011010001101111111",
                    "1000001001110110101000001",
                    "1011101011111011101011101",
                    "1011101000111010001011101",
                    "1011101001111111001011101",
                    "1000001011101001001000001",
                    "1111111010101010101111111",
                    "0000000000011011100000000",
                    "1010001101110110100100101",
                    "0110010100100110000001101",
                    "0110101100011001101010001",
                    "1010010101110100010111001",
                    "1110101000101100110011110",
                    "0100000101001000000101010",
                    "1101001011001111101010110",
                    "0000000110111010010101000",
                    "1111001110100110111110100",
                    "0000000010100110100010011",
                    "1111111010110000101011010",
                    "1000001000000100100010101",
                    "1011101001111100111110010",
                    "1011101001001000101001100",
                    "1011101011101110010010111",
                    "1000001000011010000100101",
                    "1111111010000111100011111"
            };
            float module = 4f;
            float size = matrix.length * module;
            float left = centerX - size / 2f;
            paint.setColor(Color.BLACK);
            paint.setStyle(Paint.Style.FILL);
            for (int row = 0; row < matrix.length; row++) {
                for (int col = 0; col < matrix[row].length(); col++) {
                    if (matrix[row].charAt(col) == '1') {
                        canvas.drawRect(left + col * module, top + row * module,
                                left + (col + 1) * module, top + (row + 1) * module, paint);
                    }
                }
            }
            return size;
        }

        private static void drawCode39(Canvas canvas, String text, float left, float top,
                                       float availableWidth, float height, Paint paint) {
            int units = text.length() * 16;
            float unit = Math.max(1f, availableWidth / units);
            float x = left;
            paint.setColor(Color.BLACK);
            paint.setStyle(Paint.Style.FILL);
            for (int c = 0; c < text.length(); c++) {
                String pattern = code39Pattern(text.charAt(c));
                boolean bar = true;
                for (int i = 0; i < pattern.length(); i++) {
                    float width = pattern.charAt(i) == 'w' ? unit * 3f : unit;
                    if (bar) canvas.drawRect(x, top, x + width, top + height, paint);
                    x += width;
                    bar = !bar;
                }
                x += unit;
            }
        }

        private static String code39Pattern(char value) {
            switch (value) {
                case '*': return "nwnnwnwnn";
                case 'L': return "nnwnnnnww";
                case 'O': return "wnnnwnnwn";
                case 'T': return "nnnnwnwwn";
                case 'U': return "wwnnnnnnw";
                case 'S': return "nnwnnnwwn";
                case '1': return "wnnwnnnnw";
                case '2': return "nnwwnnnnw";
                case '3': return "wnwwnnnnn";
                default: return "nnnnnnnnn";
            }
        }
    }
}
