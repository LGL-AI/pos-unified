package vn.lotusai.pos.cloudpilot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.nfc.NfcAdapter;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.InnerResultCallback;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import java.io.OutputStream;
import android.content.ContentValues;
import android.provider.MediaStore;
import android.os.Environment;
import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends Activity {
    private static final String STAFF_URL = "file:///android_asset/staff/index.html";
    private static final String CLOUD = "https://pos-unified.lgl247-ai.workers.dev";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Set<String> pending = Collections.synchronizedSet(new HashSet<>());
    private WebView webView;
    private SunmiPrinterService printer;
    private InnerPrinterCallback printerCallback;
    private SharedPreferences preferences;
    private LanKitchenPrinter kitchen;
    private PosAuth auth;
    private void requireRole(String permission){if(!auth.allowed(permission))throw new SecurityException("Không có quyền / 无权限");}

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("lotus_pos_print", Context.MODE_PRIVATE);
        auth = new PosAuth(this);
        kitchen = new LanKitchenPrinter(this,(code,severity,message,id)->emit("KITCHEN",code,severity,message,id));
        buildWebView();
        bindPrinter();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void buildWebView() {
        webView = new WebView(this);
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        TextView pilot = new TextView(this);
        pilot.setText("LOTUS POS CLOUD · D1 trực tuyến · Chạm để kiểm tra mạng");
        pilot.setTextSize(12);
        pilot.setTextColor(Color.WHITE);
        pilot.setGravity(Gravity.CENTER);
        pilot.setBackgroundColor(Color.rgb(21,94,117));
        int height = (int)(32 * getResources().getDisplayMetrics().density + 0.5f);
        screen.addView(pilot, new LinearLayout.LayoutParams(-1,height));
        pilot.setOnClickListener(v -> startActivity(new Intent(this,CloudConnectivityActivity.class)));
        screen.addView(webView,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(screen);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        s.setUserAgentString(s.getUserAgentString() + " LotusPOSCloud/2.3.0");
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsAlert(WebView v,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("Xác nhận / 确认",(d,w)->result.confirm()).setNegativeButton("Không / 取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsPrompt(WebView v,String url,String message,String value,JsPromptResult result){
                android.widget.EditText input=new android.widget.EditText(MainActivity.this);input.setText(value);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input).setPositiveButton("OK",(d,w)->result.confirm(input.getText().toString())).setNegativeButton("Không",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
        });
        webView.addJavascriptInterface(new Bridge(), "NativePOS");
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url=request.getUrl().toString();
                if(url.startsWith("file:///android_asset/staff/"))return null;
                return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return external(request.getUrl());
            }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return external(Uri.parse(url));
            }
        });
        webView.loadUrl(STAFF_URL);
    }

    private boolean external(Uri uri) {
        String value = uri == null ? "" : uri.toString();
        if (value.startsWith("file:///android_asset/staff/") || "about:blank".equals(value)) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (Throwable t) { Toast.makeText(this, "Không mở được liên kết", Toast.LENGTH_SHORT).show(); }
        return true;
    }

    // The packaged staff HTML calls this bridge. Every request is pinned to the single
    // Worker origin; there is no file:// CORS exception and no arbitrary URL proxy.
    private void cloudApi(String requestId,String method,String path,String raw,String token) {
        if(requestId==null||!requestId.matches("[a-fA-F0-9-]{36}")||path==null||
           !path.matches("/api/(staff/[A-Za-z0-9_/?=&%:-]*|catalog)")||
           !("GET".equals(method)||"POST".equals(method))||raw==null||raw.length()>20000||
           token==null||token.length()>100){returnApi(requestId,0,"{\"ok\":false,\"message\":\"Yêu cầu không hợp lệ\"}");return;}
        worker.execute(()->{
            HttpsURLConnection conn=null;
            try{
                conn=(HttpsURLConnection)new URL(CLOUD+path).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(8000);conn.setReadTimeout(8000);
                conn.setRequestMethod(method);conn.setRequestProperty("Accept","application/json");
                if(!token.isEmpty())conn.setRequestProperty("Authorization","Bearer "+token);
                if("POST".equals(method)){
                    conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json");
                    try(OutputStream os=conn.getOutputStream()){os.write(raw.getBytes(StandardCharsets.UTF_8));}
                }
                int status=conn.getResponseCode();
                if(status>=300&&status<400)throw new Exception("Worker trả về chuyển hướng; không gửi token tới host khác");
                InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();
                if(stream==null)throw new Exception("Không nhận được phản hồi từ Worker");
                ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buf=new byte[4096];int read;
                try(InputStream input=stream){while((read=input.read(buf))!=-1){output.write(buf,0,read);if(output.size()>524288)throw new Exception("Dữ liệu Worker quá lớn");}}
                String responseText=output.toString("UTF-8");
                if(status>=200&&status<300&&path.equals("/api/staff/login")){
                    JSONObject response=new JSONObject(responseText);
                    auth.cloudLogin(response.getJSONObject("staff"),response.getLong("expiresAt"));
                }else if(status>=200&&status<300&&path.equals("/api/staff/me")){
                    auth.cloudRefresh(new JSONObject(responseText).getJSONObject("staff"));
                }else if(status==401&&path.startsWith("/api/staff/"))auth.logout();
                returnApi(requestId,status,responseText);
            }catch(Exception ex){
                String reason=ex.getClass().getSimpleName()+": "+String.valueOf(ex.getMessage());
                try{returnApi(requestId,0,new JSONObject().put("ok",false).put("code","NETWORK_ERROR").put("message","Không kết nối được Worker: "+reason).toString());}catch(Exception ignored){}
            }finally{if(conn!=null)conn.disconnect();}
        });
    }

    private void returnApi(String requestId,int status,String text){
        if(requestId==null||!requestId.matches("[a-fA-F0-9-]{36}"))return;
        String js="window.LotusCloud&&window.LotusCloud.onApi("+JSONObject.quote(requestId)+","+status+","+JSONObject.quote(text)+")";
        runOnUiThread(()->{if(webView!=null)webView.evaluateJavascript(js,null);});
    }

    private void savePng(String filename,String base64){
        if(filename==null||!filename.matches("[A-Za-z0-9_-]{1,90}\\.png")||base64==null||
           !base64.startsWith("data:image/png;base64,")||base64.length()>2800000)return;
        worker.execute(()->{
            try{
                byte[] png=android.util.Base64.decode(base64.substring("data:image/png;base64,".length()),android.util.Base64.DEFAULT);
                if(png.length>2000000||png.length<8||png[0]!=(byte)137||png[1]!=80||png[2]!=78||png[3]!=71)throw new Exception("PNG không hợp lệ");
                String dest;
                if(Build.VERSION.SDK_INT>=29){
                    ContentValues v=new ContentValues();v.put(MediaStore.Images.Media.DISPLAY_NAME,filename);v.put(MediaStore.Images.Media.MIME_TYPE,"image/png");v.put(MediaStore.Images.Media.RELATIVE_PATH,Environment.DIRECTORY_PICTURES+"/LotusPOS");v.put(MediaStore.Images.Media.IS_PENDING,1);
                    Uri uri=getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,v);if(uri==null)throw new Exception("Không tạo được ảnh");
                    try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new Exception("Không mở được ảnh");out.write(png);}
                    ContentValues finished=new ContentValues();finished.put(MediaStore.Images.Media.IS_PENDING,0);getContentResolver().update(uri,finished,null,null);dest="Thư viện ảnh / Pictures/LotusPOS";
                }else{
                    File dir=getExternalFilesDir(Environment.DIRECTORY_PICTURES);if(dir==null)throw new Exception("Không có bộ nhớ ảnh");
                    File file=new File(dir,filename);try(FileOutputStream out=new FileOutputStream(file)){out.write(png);}dest=file.getAbsolutePath();
                }
                String notice="Đã lưu PNG: "+dest;runOnUiThread(()->Toast.makeText(this,notice,Toast.LENGTH_LONG).show());
            }catch(Exception e){runOnUiThread(()->Toast.makeText(this,"Không lưu được QR PNG: "+e.getMessage(),Toast.LENGTH_LONG).show());}
        });
    }

    private void bindPrinter() {
        if (printer != null) return;
        printerCallback = new InnerPrinterCallback() {
            @Override protected void onConnected(SunmiPrinterService service) {
                printer = service;
                emit("PRINTER", "OK", "PASS", "SUNMI SDK đã kết nối", "bind");
            }
            @Override protected void onDisconnected() {
                printer = null;
                emit("PRINTER", "PRT-002", "FAIL", "Dịch vụ in SUNMI bị ngắt", "bind");
            }
        };
        try {
            if (!InnerPrinterManager.getInstance().bindService(this, printerCallback))
                emit("PRINTER", "PRT-002", "FAIL", "Không bind được dịch vụ in SUNMI", "bind");
        } catch (Throwable t) {
            emit("PRINTER", "PRT-002", "FAIL", "Không bind được SUNMI: " + t.getClass().getSimpleName(), "bind");
        }
    }

    private void submitPrint(String requestId, String type, String raw) {
        requireRole("REPORT".equals(type)?"reports":"PRODUCTION".equals(type)?"kitchen":"receipt");
        if (requestId == null || requestId.isEmpty() || raw == null || raw.length() > 262144) {
            emit("PRINTER", "BRG-002", "FAIL", "Dữ liệu in không hợp lệ", requestId);
            return;
        }
        Set<String> done = preferences.getStringSet("done", Collections.emptySet());
        if (done.contains(requestId) || preferences.contains("started:"+requestId) || !pending.add(requestId)) {
            emit("PRINTER", "PRT-014", "WARN", "Đã chặn lệnh in trùng", requestId);
            return;
        }
        if (printer == null) {
            pending.remove(requestId);
            emit("PRINTER", "PRT-002", "FAIL", "Máy in chưa kết nối", requestId);
            runOnUiThread(this::bindPrinter);
            return;
        }
        worker.execute(() -> {
            try {
                final int before = printer.updatePrinterState();
                if (before != 1) {
                    pending.remove(requestId);
                    emit("PRINTER", printerCode(before), "FAIL", stateText(before), requestId);
                    return;
                }
                JSONObject data = new JSONObject(raw);
                if(!preferences.edit().putBoolean("started:"+requestId,true).commit())throw new Exception("Không lưu được mã chống trùng");
                printer.enterPrinterBuffer(true);
                printer.printerInit(null);
                if ("RECEIPT".equals(type)||"REPORT".equals(type)) {
                    Bitmap bitmap="REPORT".equals(type)?TicketBitmap.renderText(data.getString("text"),384):TicketBitmap.render(data,384,true);
                    try {
                        for(int y=0;y<bitmap.getHeight();y+=256){
                            Bitmap strip=Bitmap.createBitmap(bitmap,0,y,384,Math.min(256,bitmap.getHeight()-y));
                            printer.printBitmap(strip,null);if(strip!=bitmap)strip.recycle();
                        }
                    } finally {bitmap.recycle();}
                } else printTicketData(data);
                printer.lineWrap(4, null);
                printer.commitPrinterBufferWithCallback(new InnerResultCallback() {
                    @Override public void onRunResult(boolean success) { }
                    @Override public void onReturnString(String value) { }
                    @Override public void onRaiseException(int code, String message) {
                        pending.remove(requestId);
                        emit("PRINTER", "PRT-013", "FAIL", "SDK error " + code + ": " + message, requestId);
                    }
                    @Override public void onPrintResult(int code, String message) {
                        pending.remove(requestId);
                        int after;
                        try { after = printer.updatePrinterState(); } catch (Throwable ignored) { after = -1; }
                        if (code == 0 && after == 1) {
                            Set<String> next = new HashSet<>(preferences.getStringSet("done", Collections.emptySet()));
                            next.add(requestId);
                            preferences.edit().putStringSet("done", next).apply();
                            emit("PRINTER", "OK", "PASS", "In hóa đơn thành công", requestId);
                        } else emit("PRINTER", after == 1 ? "PRT-012" : printerCode(after), "FAIL",
                                "In thất bại: callback=" + code + ", state=" + after, requestId);
                    }
                });
                emit("PRINTER", "OK", "INFO", "Đã gửi lệnh in, đang chờ callback", requestId);
            } catch (Throwable t) {
                pending.remove(requestId);
                try { printer.exitPrinterBuffer(false); } catch (Throwable ignored) { }
                emit("PRINTER", "PRT-013", "FAIL", "Lỗi SUNMI SDK: " + t.getClass().getSimpleName(), requestId);
            }
        });
    }

    private void printReceiptData(JSONObject p) throws Exception {
        printer.setAlignment(1, null);
        printer.printTextWithFont(p.optString("storeName", "LOTUS POS") + "\n", null, 30f, null);
        if(!p.optString("address").isEmpty())printer.printText(p.optString("address") + "\n", null);
        if(!p.optString("taxNumber").isEmpty())printer.printText("MST: " + p.optString("taxNumber") + "\n", null);
        printer.printTextWithFont("PHIEU THANH TOAN / 收款小票\n", null, 23f, null);
        printer.setAlignment(0, null);
        rule(); pair("DON / 订单", p.optString("orderCode")); pair("BAN / 桌", p.optString("table"));
        pair("NGUON / 来源", p.optString("source")); rule();
        JSONArray items = p.optJSONArray("items");
        if (items != null) for (int i=0;i<items.length();i++) {
            JSONObject x=items.optJSONObject(i); if(x==null)continue;
            printer.printText(x.optString("name") + " / " + x.optString("nameCn") + "\n", null);
            int qty=Math.max(1,x.optInt("qty",1)); long price=Math.round(x.optDouble("price",0));
            pair(qty+" x "+money(price),money(price*qty));
            if(!x.optString("mods").isEmpty())printer.printText("  "+x.optString("mods")+"\n",null);
        }
        rule(); pair("TAM TINH / 小计",money(Math.round(p.optDouble("subtotal",0))));
        pair("GIAM / 优惠","-"+money(Math.round(p.optDouble("discount",0))));
        if(p.optLong("taxAmount")>0)pair("EXCLUSIVE".equals(p.optString("taxMode"))?"THUE THEM / 税":"THUE DA GOM / 税",money(p.optLong("taxAmount")));
        printer.printTextWithFont("TONG / 合计: "+money(Math.round(p.optDouble("total",0)))+" VND\n",null,27f,null);
        pair("THANH TOAN / 支付",p.optString("paymentMethod"));
        if("CASH".equals(p.optString("paymentMethod"))){pair("KHACH DUA / 实收",money(Math.round(p.optDouble("received",0))));pair("TIEN THOI / 找零",money(Math.round(p.optDouble("change",0))));}
        rule(); printer.setAlignment(1,null); printer.printText("Cam on quy khach / 谢谢惠顾\n",null);
    }

    private void printTicketData(JSONObject p) throws Exception {
        printer.printTextWithFont("PHIẾU BẾP / 厨房单\n",null,22f,null);
        printer.setAlignment(1,null); printer.printTextWithFont("PHIEU SAN XUAT / 制作单\n",null,25f,null);
        printer.printTextWithFont(p.optString("station")+"\n",null,28f,null); printer.setAlignment(0,null);
        rule(); pair("ORDER",p.optString("orderCode")); pair("BAN / 桌",p.optString("table")); rule();
        JSONArray items=p.optJSONArray("items"); if(items!=null)for(int i=0;i<items.length();i++){JSONObject x=items.optJSONObject(i);if(x!=null){printer.printTextWithFont(x.optInt("qty",1)+" x "+x.optString("name")+"\n",null,24f,null);if(!x.optString("mods").isEmpty())printer.printText("  "+x.optString("mods")+"\n",null);}}
    }

    private void pair(String left,String right)throws Exception{printer.printColumnsString(new String[]{left,right},new int[]{19,13},new int[]{0,2},null);}
    private void rule()throws Exception{printer.printText("--------------------------------\n",null);}
    static String money(long n){return String.format(Locale.US,"%,d",n);}
    private int printerState(){try{return printer==null?505:printer.updatePrinterState();}catch(Throwable t){return -1;}}
    private static String printerCode(int s){if(s==3)return"PRT-004";if(s==4)return"PRT-005";if(s==5)return"PRT-006";if(s==505)return"PRT-010";return"PRT-013";}
    private static String stateText(int s){if(s==1)return"Máy in sẵn sàng";if(s==3)return"Lỗi cơ cấu/giao tiếp; kiểm tra kẹt giấy";if(s==4)return"Hết giấy";if(s==5)return"Đầu in quá nhiệt";if(s==505)return"Không phát hiện máy in";return"Printer state="+s;}

    private void emit(String category,String code,String severity,String message,String requestId){
        try{JSONObject e=new JSONObject().put("category",category).put("code",code).put("severity",severity).put("message",message).put("requestId",requestId);String js="window.LotusNativeBridge&&window.LotusNativeBridge.onNativeEvent("+e.toString()+")";runOnUiThread(()->{if(webView!=null)webView.evaluateJavascript(js,null);});}catch(Throwable ignored){}
    }

    public final class Bridge {
        @JavascriptInterface public void apiRequest(String id,String method,String path,String raw,String token){cloudApi(id,method,path,raw,token);}
        @JavascriptInterface public void savePng(String filename,String base64){MainActivity.this.savePng(filename,base64);}
        @JavascriptInterface public String getAuthState(){return auth.state();}
        @JavascriptInterface public void logout(){auth.logout();}
        @JavascriptInterface public boolean authorize(String permission){return auth.allowed(permission);}
        @JavascriptInterface public void printDailyReport(String id,String raw){submitPrint(id,"REPORT",raw);}
        @JavascriptInterface public String getAppInfo(){return "{\"native\":true,\"version\":\"2.3.0-cloud\",\"sunmiSdk\":\"1.0.18\"}";}
        @JavascriptInterface public void openCloudConnectivity(){runOnUiThread(()->startActivity(new Intent(MainActivity.this,CloudConnectivityActivity.class)));}
        @JavascriptInterface public void openKitchenSettings(){requireRole("printer_config");kitchen.openSettings();}
        @JavascriptInterface public void openKitchenJobs(){requireRole("kitchen");kitchen.openJobs();}
        @JavascriptInterface public String getKitchenConfig(){requireRole("printer_config");return kitchen.config();}
        @JavascriptInterface public String getKitchenJobStatus(String id){return kitchen.status(id);}
        @JavascriptInterface public void printKitchen(String id,String payload){requireRole("kitchen");kitchen.submit(id,payload);}
        @JavascriptInterface public void retryKitchen(String id){requireRole("kitchen");kitchen.retry(id);}
        @JavascriptInterface public String getReceiptState(String id){return preferences.getStringSet("done",Collections.emptySet()).contains(id)?"DONE":preferences.contains("started:"+id)?"UNKNOWN":"NEW";}
        @JavascriptInterface public void reprintReceipt(String id,String payload){requireRole("receipt");runOnUiThread(()->new AlertDialog.Builder(MainActivity.this)
            .setMessage("Đã kiểm tra giấy chưa? Bản in lại có nhãn IN LẠI / 重印. Không thu tiền thêm.")
            .setPositiveButton("In lại",(d,w)->{try{JSONObject p=new JSONObject(payload);p.put("reprint",true);submitPrint(id,"RECEIPT",p.toString());}catch(Exception e){emit("PRINTER","BRG-002","FAIL",e.getMessage(),id);}})
            .setNegativeButton("Không",(d,w)->emit("PRINTER","CANCELLED","WARN","Đã hủy in lại",id))
            .setOnCancelListener(d->emit("PRINTER","CANCELLED","WARN","Đã hủy in lại",id)).show());}
        @JavascriptInterface public String getCapabilities(){try{return new JSONObject().put("android",new JSONObject().put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL).put("release",Build.VERSION.RELEASE).put("sdk",Build.VERSION.SDK_INT)).put("printer",new JSONObject().put("connected",printer!=null).put("state",printerState()).put("code",printerCode(printerState()))).put("nfc",new JSONObject().put("present",NfcAdapter.getDefaultAdapter(MainActivity.this)!=null)).toString();}catch(Throwable t){return"{}";}}
        @JavascriptInterface public String getPrinterStatus(){int s=printerState();try{return new JSONObject().put("connected",printer!=null).put("state",s).put("code",s==1?"OK":printerCode(s)).put("message",stateText(s)).toString();}catch(Throwable t){return"{}";}}
        @JavascriptInterface public String printReceipt(String id,String payload){submitPrint(id,"RECEIPT",payload);return"{\"accepted\":true}";}
        @JavascriptInterface public String printProductionTicket(String id,String payload){submitPrint(id,"PRODUCTION",payload);return"{\"accepted\":true}";}
        @JavascriptInterface public void checkPrinter(String id){requireRole("diagnostics");int s=printerState();emit("PRINTER",s==1?"OK":printerCode(s),s==1?"PASS":"FAIL",stateText(s),id);}
        @JavascriptInterface public void reconnectPrinter(){requireRole("diagnostics");runOnUiThread(MainActivity.this::bindPrinter);}
        @JavascriptInterface public void openDiagnostics(){requireRole("diagnostics");runOnUiThread(()->startActivity(new Intent(MainActivity.this,DiagnosticsActivity.class)));}
        @JavascriptInterface public void exportDiagnostics(){openDiagnostics();}
        @JavascriptInterface public String capturePhoto(String id){openDiagnostics();return"{\"accepted\":true}";}
        @JavascriptInterface public String startNfcRead(String id){openDiagnostics();return"{\"accepted\":true}";}
        @JavascriptInterface public void recordWebEvent(String c,String s,String m,String d){}
    }

    @Override public void onBackPressed(){if(webView!=null)webView.evaluateJavascript("window.LotusHandheld&&window.LotusHandheld.back()",result->{if(!"true".equals(result))new AlertDialog.Builder(this).setMessage("Trở về bảng kiểm tra kết nối mạng?").setPositiveButton("Về kiểm tra",(d,w)->finish()).setNegativeButton("Ở lại",null).show();});}
    @Override protected void onDestroy(){if(printerCallback!=null)try{InnerPrinterManager.getInstance().unBindService(this,printerCallback);}catch(Throwable ignored){}worker.shutdown();if(kitchen!=null)kitchen.close();if(webView!=null)webView.destroy();super.onDestroy();}
}
