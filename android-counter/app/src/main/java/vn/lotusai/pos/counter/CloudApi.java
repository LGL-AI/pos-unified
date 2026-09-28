package vn.lotusai.pos.counter;

import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.OutputStream;

final class CloudApi {
    private final String origin;
    CloudApi(Config config) { this.origin=config.origin(); }
    static JSONObject health(String origin) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(Config.validOrigin(origin)+"/api/health").openConnection();
        c.setRequestMethod("GET");c.setConnectTimeout(5000);c.setReadTimeout(7000);
        c.setRequestProperty("Accept","application/json");c.setRequestProperty("Cache-Control","no-store");
        try {
            int status=c.getResponseCode();
            if(status!=200)throw new Exception("Máy chủ trả HTTP "+status+" tại /api/health");
            try(InputStream in=c.getInputStream()) {return new JSONObject(new String(read(in),StandardCharsets.UTF_8));}
        } finally {c.disconnect();}
    }
    static boolean ready(JSONObject h) {
        return h.optBoolean("ok")&&"lotus-pos-cloud".equals(h.optString("service"))&&
            "2.6.0-rc.5.1".equals(h.optString("version"))&&"ok".equals(h.optString("d1"))&&
            "ok".equals(h.optString("display"))&&h.optBoolean("echoReady")&&h.optBoolean("autoPrintReady")&&h.optBoolean("qrTableReady");
    }
    JSONObject call(String method,String path,String token,JSONObject body) throws Exception {
        if(!path.matches("/api/staff/(?:orders/[a-fA-F0-9-]{36}|jobs/kitchen:[a-fA-F0-9-]{36}:[0-9]+/(?:claim|status)|display(?:/[a-fA-F0-9-]{36})?)")) throw new SecurityException("API path denied");
        HttpURLConnection c=(HttpURLConnection)new URL(origin+path).openConnection();
        c.setRequestMethod(method);c.setConnectTimeout(7000);c.setReadTimeout(10000);
        c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Cache-Control","no-store");
        if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
        int status=c.getResponseCode();InputStream stream=status<400?c.getInputStream():c.getErrorStream();byte[] bytes=stream==null?new byte[0]:read(stream);c.disconnect();
        JSONObject json=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        if(status<200||status>=300||!json.optBoolean("ok"))throw new Exception("Worker "+status+": "+json.optString("message",json.optString("code")));
        return json;
    }
    private static byte[] read(InputStream in) throws Exception {try(InputStream src=in;java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] buf=new byte[8192];int n;while((n=src.read(buf))!=-1)out.write(buf,0,n);return out.toByteArray();}}
}
