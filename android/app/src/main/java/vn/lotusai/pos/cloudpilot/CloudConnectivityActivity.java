package vn.lotusai.pos.cloudpilot;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Separate Cloud pilot launcher. It never marks an order paid or sends a print job. */
public final class CloudConnectivityActivity extends Activity {
    private static final String PROBE = "https://www.cloudflare.com/cdn-cgi/trace";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final int ink = Color.rgb(21, 47, 67), accent = Color.rgb(21, 94, 117);
    private SharedPreferences prefs;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback callback;
    private TextView route, internetResult, workerResult, lanResult;
    private EditText workerUrl, printerIp, printerPort;
    private Button internetButton, workerButton, lanButton;
    private LanKitchenPrinter kitchen;
    private boolean firstOpen = true;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("lotus_cloud_pilot", MODE_PRIVATE);
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        kitchen = new LanKitchenPrinter(this, (code, severity, message, id) ->
            runOnUiThread(() -> Toast.makeText(this, code + ": " + message, Toast.LENGTH_LONG).show()));
        draw();
    }

    private int dp(int n) { return (int) (n * getResources().getDisplayMetrics().density + 0.5f); }
    private GradientDrawable bg(int color) {
        GradientDrawable b = new GradientDrawable();
        b.setColor(color);
        b.setCornerRadius(dp(16));
        return b;
    }
    private TextView text(String value, int size, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(ink);
        t.setTextSize(size);
        if (bold) t.setTypeface(null, Typeface.BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }
    private LinearLayout card(LinearLayout parent, String title) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(16), dp(14), dp(16), dp(16));
        c.setBackground(bg(Color.WHITE));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(12);
        parent.addView(c, params);
        c.addView(text(title, 17, true));
        return c;
    }
    private Button button(LinearLayout parent, String name, Runnable task) {
        Button b = new Button(this);
        b.setText(name);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackground(bg(accent));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(50));
        params.topMargin = dp(9);
        parent.addView(b, params);
        b.setOnClickListener(v -> task.run());
        return b;
    }
    private EditText input(LinearLayout parent, String hint, String value) {
        EditText e = new EditText(this);
        e.setSingleLine(true);
        e.setTextSize(15);
        e.setHint(hint);
        e.setText(value);
        parent.addView(e, new LinearLayout.LayoutParams(-1, dp(50)));
        return e;
    }
    private TextView result(LinearLayout parent) {
        TextView t = text("Chưa kiểm tra", 14, false);
        t.setTextIsSelectable(true);
        t.setPadding(0, dp(10), 0, 0);
        parent.addView(t);
        return t;
    }
    private void draw() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(239, 246, 248));
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(15), dp(18), dp(15), dp(24));
        scroll.addView(body);
        setContentView(scroll);

        body.addView(text("LOTUS POS · CLOUD", 21, true));
        body.addView(text("Ứng dụng riêng: vn.lotusai.pos.cloudpilot\nKhông dùng dữ liệu của POS local đang chạy.", 13, false));
        LinearLayout warning = card(body, "THỬ NGHIỆM KẾT NỐI");
        warning.addView(text("Đơn cloud sẽ lưu trên D1. Kiểm tra Worker, mạng Wi-Fi tới máy bếp và máy in SUNMI trước khi nhận đơn.", 14, false));

        LinearLayout network = card(body, "1 · SUNMI đang dùng đường mạng nào?");
        route = text("Đang đọc trạng thái mạng…", 14, false);
        route.setTextIsSelectable(true);
        network.addView(route);
        button(network, "Làm mới trạng thái Wi-Fi / 4G", this::refreshRoute);

        LinearLayout internet = card(body, "2 · Đường Internet tới Cloudflare");
        internet.addView(text("Kiểm tra DNS, chứng chỉ HTTPS và mã HTTP. Dùng Wi-Fi hoặc 4G đang là đường Internet mặc định.", 13, false));
        internetButton = button(internet, "Kiểm tra Internet", () -> runCheck(internetButton, internetResult, this::checkInternet));
        internetResult = result(internet);

        LinearLayout cloud = card(body, "3 · Worker + D1 của cửa hàng");
        cloud.addView(text("APK này chỉ kết nối Worker bên dưới; tránh nhập nhầm miền hoặc gửi tài khoản POS sang máy chủ khác.", 13, false));
        workerUrl = input(cloud, "Worker cố định", "https://pos-unified.lgl247-ai.workers.dev");
        workerUrl.setEnabled(false);
        workerUrl.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        workerButton = button(cloud, "Kiểm tra Worker và D1", () -> {
            final String endpoint;
            try { endpoint = healthUrl(workerUrl.getText().toString()); }
            catch (Exception e) { workerResult.setText("Chưa thử: " + e.getMessage()); return; }
            runCheck(workerButton, workerResult, () -> checkWorker(endpoint));
        });
        workerResult = result(cloud);

        LinearLayout lan = card(body, "4 · Wi-Fi tới máy in bếp LAN");
        lan.addView(text("Máy in bếp cần Wi-Fi quán, kể cả khi Internet của SUNMI đi qua 4G. Thử TCP không gửi lệnh in.", 13, false));
        SharedPreferences lp = getSharedPreferences("lotus_kitchen_lan", MODE_PRIVATE);
        printerIp = input(lan, "IP máy in bếp, ví dụ 192.168.1.50", lp.getString("ip", ""));
        printerPort = input(lan, "Cổng, thường là 9100", String.valueOf(lp.getInt("port", 9100)));
        printerPort.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        lanButton = button(lan, "Kiểm tra Wi-Fi → máy in bếp", () -> {
            String ip = printerIp.getText().toString().trim();
            int port;
            try { port = Integer.parseInt(printerPort.getText().toString().trim()); }
            catch (NumberFormatException e) { lanResult.setText("Cổng phải là số 1–65535"); return; }
            if (!EscPosTransport.privateIp(ip) || port < 1 || port > 65535) {
                lanResult.setText("Cần địa chỉ IPv4 riêng của máy in và cổng 1–65535"); return;
            }
            if (!lp.edit().putString("ip", ip).putInt("port", port).commit()) {
                lanResult.setText("Không lưu được cấu hình LAN"); return;
            }
            final int chosenPort = port;
            runCheck(lanButton, lanResult, () -> checkLan(ip, chosenPort));
        });
        lanResult = result(lan);
        button(lan, "Cài đặt / in thử phiếu bếp", kitchen::openSettings);

        LinearLayout device = card(body, "5 · Máy in SUNMI tích hợp");
        device.addView(text("Máy in tích hợp không cần Wi-Fi hoặc 4G. Mở công cụ kiểm tra để xem trạng thái và in thử trực tiếp trên máy.", 13, false));
        button(device, "Mở kiểm tra SUNMI", () -> startActivity(new Intent(this, DiagnosticsActivity.class)));
        button(device, "Mở Lotus POS Cloud", () -> startActivity(new Intent(this, MainActivity.class)));
        button(device, "Sao chép kết quả", this::copyReport);
    }

    @Override protected void onResume() {
        super.onResume();
        refreshRoute();
        if (connectivity != null && callback == null) {
            callback = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { runOnUiThread(() -> networkChanged()); }
                @Override public void onLost(Network n) { runOnUiThread(() -> networkChanged()); }
                @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) {
                    runOnUiThread(() -> networkChanged());
                }
            };
            try { connectivity.registerNetworkCallback(new NetworkRequest.Builder().build(), callback); }
            catch (Exception e) { callback = null; }
        }
        if (firstOpen) { firstOpen = false; runCheck(internetButton, internetResult, this::checkInternet); }
    }
    @Override protected void onPause() {
        if (callback != null && connectivity != null) {
            try { connectivity.unregisterNetworkCallback(callback); } catch (Exception ignored) {}
            callback = null;
        }
        super.onPause();
    }
    @Override protected void onDestroy() {
        worker.shutdownNow();
        kitchen.close();
        super.onDestroy();
    }
    private void refreshRoute() { route.setText(CloudNetwork.status(this)); }
    private void networkChanged() {
        refreshRoute();
        for (TextView label : new TextView[]{internetResult,workerResult,lanResult}) {
            if (label != null && label.getText().toString().startsWith("ĐẠT"))
                label.setText("Đường mạng đã thay đổi. Bấm kiểm tra lại để xác nhận kết quả hiện tại.");
        }
    }
    private void requireInternet() throws IOException {
        Network n = connectivity == null ? null : connectivity.getActiveNetwork();
        NetworkCapabilities caps = n == null ? null : connectivity.getNetworkCapabilities(n);
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
            throw new IOException("Không có mạng mặc định có khả năng truy cập Internet");
    }
    private interface Check { String run() throws Exception; }
    private void runCheck(Button button, TextView output, Check check) {
        button.setEnabled(false);
        output.setText("Đang kiểm tra…");
        worker.execute(() -> {
            String value;
            try { value = check.run(); }
            catch (Exception e) { value = "KHÔNG ĐẠT · " + e.getClass().getSimpleName() + ": " + e.getMessage(); }
            final String message = value;
            runOnUiThread(() -> { if (!isFinishing()) { output.setText(message); button.setEnabled(true); refreshRoute(); } });
        });
    }
    private static String healthUrl(String raw) throws Exception {
        URI uri = new URI(raw.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null ||
            uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("Nhập URL https:// của Worker, không kèm tài khoản hoặc token");
        }
        String base = uri.toASCIIString().replaceAll("/+$", "");
        return base.endsWith("/api/health") ? base : base + "/api/health";
    }
    private static String fetch(String endpoint, StringBuilder body) throws Exception {
        URL url = new URL(endpoint);
        // Resolving here separates DNS errors from HTTPS errors in the report.
        java.net.InetAddress.getByName(url.getHost());
        long start = System.nanoTime();
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(6000);
        conn.setRequestProperty("Accept", "application/json, text/plain");
        conn.setRequestProperty("User-Agent", "LotusPOSCloudPilot/0.1.0");
        try {
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream != null) try (InputStream input = stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] part = new byte[512]; int n;
                while (bytes.size() < 4096 && (n = input.read(part, 0, Math.min(part.length, 4096 - bytes.size()))) != -1)
                    bytes.write(part, 0, n);
                body.append(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            }
            long millis = (System.nanoTime() - start) / 1000000;
            return "HTTP " + code + " · " + millis + " ms";
        } finally { conn.disconnect(); }
    }
    private String checkInternet() throws Exception {
        requireInternet();
        StringBuilder body = new StringBuilder();
        String code = fetch(PROBE, body);
        return code.startsWith("HTTP 200 ") ? "ĐẠT · Cloudflare qua HTTPS · " + code +
            "\n" + CloudNetwork.status(this) : "CHƯA ĐẠT · Cloudflare trả " + code;
    }
    private String checkWorker(String endpoint) throws Exception {
        requireInternet();
        StringBuilder body = new StringBuilder();
        String code = fetch(endpoint, body);
        if (!code.startsWith("HTTP 200 ")) return "Worker HTTPS: " + code +
            "\nChưa xác minh D1. Kiểm tra URL và route /api/health.";
        try {
            JSONObject json = new JSONObject(body.toString());
            boolean service = "lotus-pos-cloud".equals(json.optString("service"));
            boolean ok = json.optBoolean("ok", false);
            String d1 = json.optString("d1", "");
            if (service && ok && "ok".equalsIgnoreCase(d1)) return "ĐẠT · Worker HTTPS và D1 xác nhận hoạt động · " + code;
            return "Worker HTTPS trả JSON · " + code + "\nD1 CHƯA XÁC MINH: cần {\"service\":\"lotus-pos\",\"ok\":true,\"d1\":\"ok\"}.";
        } catch (Exception e) {
            return "Worker HTTPS có phản hồi · " + code + "\nD1 CHƯA XÁC MINH: /api/health chưa trả JSON đúng định dạng.";
        }
    }
    private String checkLan(String ip, int port) throws IOException {
        Network wifi = CloudNetwork.wifi(this);
        if (wifi == null) throw new IOException("SUNMI chưa kết nối Wi-Fi quán. 4G không tới IP máy in LAN.");
        long start = System.nanoTime();
        try (Socket socket = wifi.getSocketFactory().createSocket()) {
            socket.connect(new InetSocketAddress(ip, port), 2500);
            long millis = (System.nanoTime() - start) / 1000000;
            return String.format(Locale.US, "ĐẠT · TCP %s:%d qua Wi-Fi · %d ms\nChỉ xác nhận cổng mở; hãy in thử và kiểm tra giấy.", ip, port, millis);
        }
    }
    private void copyReport() {
        String report = "Lotus POS Cloud Test · " + getPackageName() + "\n" + route.getText() +
            "\nInternet: " + internetResult.getText() + "\nWorker: " + workerResult.getText() +
            "\nMáy bếp: " + lanResult.getText();
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Lotus POS Cloud Test", report));
        Toast.makeText(this, "Đã sao chép kết quả kiểm tra", Toast.LENGTH_SHORT).show();
    }
}
