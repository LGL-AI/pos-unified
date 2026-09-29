package vn.lotusai.pos.counter;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Presentation;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class MainActivity extends Activity implements DisplayManager.DisplayListener {
    private static final Set<String> UI_PATHS=new HashSet<>(Arrays.asList(
        "/counter/index.html","/counter/counter.css","/counter/poc-counter.css","/counter/shift-ui.css","/counter/analytics.css","/counter/layout-profiles.css",
        "/counter/devices.js","/counter/shift-ui.js","/counter/analytics.js",
        "/staff/staff.css","/staff/staff.js","/staff/qrcode.js","/staff/scanner.js","/staff/barcode.js",
        "/display/index.html","/display/display.css","/display/display.js","/assets/qrcode.js","/brands/echo-coffee.jpg"));
    private final Handler ui=new Handler(Looper.getMainLooper());private final ExecutorService tasks=Executors.newSingleThreadExecutor();
    private WebView web;private Presentation customer;private DisplayManager displays;private Config config;private CloudApi cloud;private PrintEngine engine;private TextView status,gateMessage;private LinearLayout gate;private boolean webReady=false;
    private String pairId,pairToken,sessionToken,visibleOrder,latestDraft,lastSentDraft,loadedOrigin;private int revision=0;private volatile int pairingEpoch=0;private long pairExpiresAt=0,lastSettingsOpenAt=0,lastPairRetryAt=0;private boolean pairing=false;
    @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON|WindowManager.LayoutParams.FLAG_FULLSCREEN);config=new Config(this);setRequestedOrientation(LayoutProfiles.orientation(config.layoutProfile()));cloud=new CloudApi(config);engine=new PrintEngine(this,this::showStatus);displays=(DisplayManager)getSystemService(DISPLAY_SERVICE);displays.registerDisplayListener(this,ui);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);LinearLayout toolbar=new LinearLayout(this);status=new TextView(this);status.setText("Lotus Counter · Đang kết nối");status.setTextSize(15);status.setPadding(12,8,8,8);toolbar.addView(status,new LinearLayout.LayoutParams(0,52,1));Button settings=new Button(this);settings.setText("⚙ Thiết bị");settings.setOnClickListener(v->openHardwareSettings());toolbar.addView(settings);root.addView(toolbar);web=new WebView(this);setup(web,true);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));gate=new LinearLayout(this);gate.setOrientation(LinearLayout.VERTICAL);gate.setPadding(26,36,26,18);gateMessage=new TextView(this);gateMessage.setTextSize(18);gateMessage.setText("Đang kiểm tra máy chủ POS…");gate.addView(gateMessage);Button retry=new Button(this);retry.setText("Kiểm tra lại kết nối");retry.setOnClickListener(v->verifyHealth());gate.addView(retry);Button configure=new Button(this);configure.setText("Mở cài đặt máy chủ");configure.setOnClickListener(v->openHardwareSettings());gate.addView(configure);root.addView(gate,new LinearLayout.LayoutParams(-1,0,1));web.setVisibility(View.GONE);setContentView(root);loadedOrigin=config.origin();refreshDisplay();}
    @SuppressLint("SetJavaScriptEnabled") private void setup(WebView w,boolean main){WebSettings s=w.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSafeBrowsingEnabled(true);
        w.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){if(!trusted(request.getUrl().toString()))return null;String path=request.getUrl().getPath();if("/counter/".equals(path))path="/counter/index.html";if("/display/".equals(path))path="/display/index.html";if(!UI_PATHS.contains(path)||main&&path.startsWith("/display/")||!main&&path.startsWith("/counter/"))return null;String mime=path.endsWith(".html")?"text/html":path.endsWith(".css")?"text/css":path.endsWith(".jpg")?"image/jpeg":"application/javascript";try{WebResourceResponse response=new WebResourceResponse(mime,path.endsWith(".jpg")?null:"UTF-8",getAssets().open("ui"+path));if(path.endsWith(".html")){Map<String,String> headers=new HashMap<>();headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");headers.put("Referrer-Policy","no-referrer");response.setResponseHeaders(headers);}return response;}catch(Exception e){showStatus("Thiếu giao diện trong APK: "+path);return null;}}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame()||trustedUiPage(request.getUrl().toString(),main))return false;String scheme=request.getUrl().getScheme();if("https".equals(scheme)||"http".equals(scheme))try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(Exception e){showStatus("Không mở được liên kết: "+e.getMessage());}return true;}
            @Override public void onPageFinished(WebView view,String url){if(main&&trustedUiPage(url,true)){paintProfile();try(InputStream in=getAssets().open("hook.js");ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);view.evaluateJavascript(new String(out.toByteArray(),StandardCharsets.UTF_8),null);}catch(Exception e){showStatus("Bridge: "+e.getMessage());}}}});
        // WebView suppresses prompt/confirm/alert without a WebChromeClient.
        // Use Android's default dialogs; cancel/back always resolves the JS dialog.
        w.setWebChromeClient(new WebChromeClient());
        if(main)w.addJavascriptInterface(new Bridge(),"LotusNative");}
    private boolean trusted(String url){return url!=null&&(url.equals(config.origin())||url.startsWith(config.origin()+"/"));}
    private boolean trustedUiPage(String url,boolean main){if(!trusted(url))return false;String path=android.net.Uri.parse(url).getPath();return main?("/counter/".equals(path)||"/counter/index.html".equals(path)):("/display/".equals(path)||"/display/index.html".equals(path));}
    private void paintProfile(){if(web!=null)web.evaluateJavascript("document.documentElement.setAttribute('data-counter-profile',"+JSONObject.quote(config.layoutProfile())+")",null);}
    private void applyLayoutProfile(){int orientation=LayoutProfiles.orientation(config.layoutProfile());if(getRequestedOrientation()!=orientation)setRequestedOrientation(orientation);if(webReady&&trusted(web.getUrl()))paintProfile();}
    private void showStatus(String text){ui.post(()->{if(status!=null)status.setText(text);});}
    private void verifyHealth(){final String origin=config.origin();tasks.execute(()->{try{JSONObject h=CloudApi.health(origin);ui.post(()->{if(!origin.equals(config.origin())||isFinishing())return;if(CloudApi.ready(h)){showStatus("Đã kết nối · RC5.1/D1 "+(h.optBoolean("acceptingOrders")?"· QR nhận đơn":"· QR chưa bật nhận đơn"));gate.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);if(!webReady){webReady=true;web.loadUrl(origin+"/counter/");}}else{webReady=false;web.setVisibility(View.GONE);gate.setVisibility(View.VISIBLE);gateMessage.setText("Máy chủ "+origin+" đang chạy "+h.optString("version","?")+"; D1="+h.optString("d1","?")+", QR bàn="+h.optBoolean("qrTableReady")+", tự in="+h.optBoolean("autoPrintReady")+".\n\nCần triển khai Worker 2.6.0-rc.5.1 và D1 migration 0014, 0015 trên GitHub/Cloudflare trước khi thử luồng bán hàng.");showStatus("Máy chủ chưa cập nhật · Mở Thiết bị");}});}catch(Exception e){ui.post(()->{if(!origin.equals(config.origin())||isFinishing())return;webReady=false;web.setVisibility(View.GONE);gate.setVisibility(View.VISIBLE);gateMessage.setText("Không kết nối được máy chủ "+origin+".\n"+e.getMessage()+"\nKiểm tra Internet hoặc địa chỉ HTTPS trong Thiết bị.");showStatus("Mất kết nối máy chủ · Mở Thiết bị");});}});}
    private void openHardwareSettings(){long now=android.os.SystemClock.uptimeMillis();if(now-lastSettingsOpenAt<900)return;lastSettingsOpenAt=now;startActivity(new Intent(this,SettingsActivity.class));}
    private final class Bridge {
        // JavascriptInterface methods run off the UI thread. WebView.getUrl() must run on the UI thread.
        @JavascriptInterface public void paymentRecorded(String order,String bill,String token){ui.post(()->{if(trustedUiPage(web.getUrl(),true)){engine.paid(order,bill,token);session(token);syncOrder(order,token);}});}
        @JavascriptInterface public void syncPaidJob(String order,String job,String token){ui.post(()->{if(trustedUiPage(web.getUrl(),true))engine.syncPaidJob(order,job,token);});}
        @JavascriptInterface public void displaySession(String token){ui.post(()->{if(trustedUiPage(web.getUrl(),true))session(token);});}
        @JavascriptInterface public void displayDraft(String draft,String token){ui.post(()->{if(trustedUiPage(web.getUrl(),true)&&validToken(token)&&draft!=null&&draft.length()<20000){session(token);visibleOrder=null;latestDraft=draft;syncDraft(token);}});}
        @JavascriptInterface public void openSettings(){ui.post(()->{if(trustedUiPage(web.getUrl(),true))openHardwareSettings();});}
        @JavascriptInterface public void reconnectDisplay(){ui.post(()->{if(!trustedUiPage(web.getUrl(),true))return;resetDisplayPair(false);refreshDisplay();if(customer!=null&&validToken(sessionToken))session(sessionToken);else showStatus("Chưa thấy màn hình phụ hoặc chưa đăng nhập POS");});}
        @JavascriptInterface public void clearDisplaySession(){ui.post(()->{if(!trustedUiPage(web.getUrl(),true))return;resetDisplayPair(true);refreshDisplay();showStatus("Màn hình khách đã ngắt khi đăng xuất");});}
        @JavascriptInterface public String getDisplays(){org.json.JSONArray list=new org.json.JSONArray();Set<Integer> presentationIds=new HashSet<>();for(Display d:displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION))presentationIds.add(d.getDisplayId());for(Display d:displays.getDisplays()){try{org.json.JSONObject j=new org.json.JSONObject();j.put("id",d.getDisplayId());j.put("name",d.getName());j.put("width",d.getMode().getPhysicalWidth());j.put("height",d.getMode().getPhysicalHeight());j.put("presentation",presentationIds.contains(d.getDisplayId()));list.put(j);}catch(Exception ignored){}}return list.toString();}
    }
    private boolean validToken(String t){return t!=null&&t.matches("[A-Za-z0-9_-]{32,100}");}
    private void resetDisplayPair(boolean logout){pairingEpoch++;pairing=false;pairId=null;pairToken=null;pairExpiresAt=0;revision=0;lastSentDraft=null;lastPairRetryAt=0;if(logout){sessionToken=null;visibleOrder=null;latestDraft=null;}if(customer!=null){customer.dismiss();customer=null;}}
    private void session(String token){
        if(!validToken(token))return;
        if(!token.equals(sessionToken)){
            resetDisplayPair(true);sessionToken=token;engine.resume(token);refreshDisplay();
        }
        // A counter with one screen does not need a remote display session.
        if(customer==null)return;
        if(pairId!=null&&pairExpiresAt>System.currentTimeMillis()+300000){
            if(visibleOrder==null)syncDraft(token);
            return;
        }
        if(pairing||android.os.SystemClock.uptimeMillis()<lastPairRetryAt)return;
        pairing=true;
        final String origin=config.origin();final int epoch=pairingEpoch;final CloudApi pairingApi=cloud;
        tasks.execute(()->{
            if(epoch!=pairingEpoch)return;
            try{
                JSONObject pair=pairingApi.call("POST","/api/staff/display",token,new JSONObject());
                ui.post(()->{
                    if(epoch!=pairingEpoch||!token.equals(sessionToken)||!origin.equals(config.origin()))return;
                    pairing=false;
                    if(customer==null)return;
                    pairId=pair.optString("id");pairToken=pair.optString("token");pairExpiresAt=pair.optLong("expiresAt");
                    revision=0;lastSentDraft=null;
                    if(customer!=null){customer.dismiss();customer=null;}
                    refreshDisplay();showStatus("Màn hình khách đã ghép với D1");
                    if(visibleOrder!=null)syncOrder(visibleOrder,token);
                    else if(latestDraft!=null)syncDraft(token);
                    else{
                        final String displayId=pairId;final int firstRevision=++revision;
                        tasks.execute(()->{
                            if(epoch!=pairingEpoch)return;
                            try{JSONObject empty=new JSONObject().put("revision",firstRevision).put("table","T01").put("items",new org.json.JSONArray());pairingApi.call("PUT","/api/staff/display/"+displayId,token,empty);}
                            catch(Exception e){if(epoch==pairingEpoch)showStatus("Màn hình khách: "+e.getMessage());}
                        });
                    }
                });
            }catch(Exception e){ui.post(()->{if(epoch!=pairingEpoch)return;pairing=false;lastPairRetryAt=android.os.SystemClock.uptimeMillis()+30000;showStatus("Màn hình khách: "+e.getMessage());});}
        });
    }
    private void syncDraft(String token){
        if(pairId==null||!token.equals(sessionToken)||latestDraft==null||latestDraft.equals(lastSentDraft))return;
        final String sent=latestDraft,displayId=pairId;final int epoch=pairingEpoch,nextRevision=++revision;
        lastSentDraft=sent;
        tasks.execute(()->{
            if(epoch!=pairingEpoch)return;
            try{JSONObject data=new JSONObject(sent).put("revision",nextRevision);cloud.call("PUT","/api/staff/display/"+displayId,token,data);}
            catch(Exception e){ui.post(()->{if(epoch!=pairingEpoch||!displayId.equals(pairId))return;if(sent.equals(lastSentDraft))lastSentDraft=null;showStatus("Đồng bộ giỏ: "+e.getMessage());});}
        });
    }
    private void syncOrder(String order,String token){
        if(order==null||!order.matches("[0-9a-fA-F-]{36}")||!validToken(token))return;
        visibleOrder=order;
        if(pairId==null||!token.equals(sessionToken))return;
        final String displayId=pairId;final int epoch=pairingEpoch,nextRevision=++revision;
        tasks.execute(()->{
            if(epoch!=pairingEpoch)return;
            try{JSONObject data=new JSONObject().put("revision",nextRevision).put("orderId",order);cloud.call("PUT","/api/staff/display/"+displayId,token,data);}
            catch(Exception e){if(epoch==pairingEpoch)showStatus("Đồng bộ màn hình: "+e.getMessage());}
        });
    }
    private void refreshDisplay(){if(displays==null)return;Display chosen=null;for(Display d:displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)){if(d.getDisplayId()!=getWindowManager().getDefaultDisplay().getDisplayId()){chosen=d;break;}}
        if(customer!=null&&(chosen==null||customer.getDisplay().getDisplayId()!=chosen.getDisplayId())){customer.dismiss();customer=null;}
        if(chosen!=null&&customer==null){final Display target=chosen;try{customer=new Presentation(this,target){WebView content;@Override protected void onCreate(Bundle state){super.onCreate(state);content=new WebView(getContext());setup(content,false);setContentView(content);load();}void load(){if(content!=null)content.loadUrl(pairId!=null?config.origin()+"/display/?id="+pairId+"#token="+pairToken:config.origin()+"/display/?native=1");}@Override public void dismiss(){if(content!=null){content.destroy();content=null;}super.dismiss();}};customer.show();}catch(WindowManager.InvalidDisplayException e){customer=null;showStatus("Màn hình khách đã ngắt kết nối");}}
    }
    @Override public void onDisplayAdded(int id){refreshDisplay();if(customer!=null&&validToken(sessionToken))session(sessionToken);}@Override public void onDisplayRemoved(int id){refreshDisplay();}@Override public void onDisplayChanged(int id){refreshDisplay();if(customer!=null&&validToken(sessionToken))session(sessionToken);}
    @Override protected void onResume(){super.onResume();applyLayoutProfile();String origin=config.origin();if(loadedOrigin!=null&&!loadedOrigin.equals(origin)){loadedOrigin=origin;pairingEpoch++;pairing=false;engine.shutdown();engine=new PrintEngine(this,this::showStatus);cloud=new CloudApi(config);sessionToken=null;pairId=null;pairToken=null;pairExpiresAt=0;visibleOrder=null;latestDraft=null;lastSentDraft=null;revision=0;lastPairRetryAt=0;webReady=false;web.clearHistory();web.loadUrl("about:blank");if(customer!=null){customer.dismiss();customer=null;}}if(sessionToken!=null)engine.resume(sessionToken);refreshDisplay();verifyHealth();}@Override protected void onDestroy(){displays.unregisterDisplayListener(this);if(customer!=null)customer.dismiss();engine.shutdown();web.destroy();tasks.shutdownNow();super.onDestroy();}
    @Override public void onBackPressed(){if(!webReady){super.onBackPressed();return;}web.evaluateJavascript("Boolean(window.LotusCounterBack && window.LotusCounterBack())",handled->{if(!"true".equals(handled)){if(web.canGoBack())web.goBack();else MainActivity.super.onBackPressed();}});}
}
