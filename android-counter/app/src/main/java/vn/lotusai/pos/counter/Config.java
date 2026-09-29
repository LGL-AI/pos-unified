package vn.lotusai.pos.counter;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

final class Config {
    static final String DEFAULT_ORIGIN="https://pos-unified.lgl247-ai.workers.dev";
    private final SharedPreferences p;
    Config(Context c) { p=c.getSharedPreferences("hardware",Context.MODE_PRIVATE); }
    String get(String key,String fallback) { return p.getString(key,fallback); }
    int number(String key,int fallback) { try { return Integer.parseInt(get(key,""+fallback)); } catch(Exception e) { return fallback; } }
    boolean enabled(String key,boolean fallback) { return Boolean.parseBoolean(get(key,""+fallback)); }
    void set(String key,String value) { p.edit().putString(key,value).apply(); }
    String layoutProfile() { String id=get("layoutProfile",LayoutProfiles.DEFAULT);return LayoutProfiles.valid(id)?id:LayoutProfiles.DEFAULT; }
    void setLayoutProfile(String id) { if(!LayoutProfiles.valid(id))throw new IllegalArgumentException("Cấu hình màn hình không hợp lệ");set("layoutProfile",id); }
    String origin() { try { return validOrigin(get("serverOrigin",DEFAULT_ORIGIN)); } catch(IllegalArgumentException e) { return DEFAULT_ORIGIN; } }
    void setOrigin(String value) { set("serverOrigin",validOrigin(value)); }
    String serverSuffix() {
        if(DEFAULT_ORIGIN.equals(origin()))return ""; // Keep the v4 print queue after a normal upgrade.
        try { byte[] bytes=MessageDigest.getInstance("SHA-256").digest(origin().getBytes(StandardCharsets.UTF_8));StringBuilder s=new StringBuilder("_");for(int i=0;i<8;i++)s.append(String.format(Locale.ROOT,"%02x",bytes[i]&255));return s.toString(); }
        catch(Exception e) { throw new IllegalStateException("Cannot scope print queue",e); }
    }
    static String validOrigin(String value) {
        try {
            URI url=new URI(value.trim());
            if(!"https".equalsIgnoreCase(url.getScheme())||url.getHost()==null||url.getRawUserInfo()!=null||
               url.getRawQuery()!=null||url.getRawFragment()!=null||
               !(url.getRawPath()==null||url.getRawPath().isEmpty()||"/".equals(url.getRawPath()))||
               url.getPort()>65535||url.getPort()==0||url.getRawAuthority()==null)
                throw new IllegalArgumentException("Chỉ nhập địa chỉ HTTPS của máy chủ POS, ví dụ https://pos.example.com");
            return "https://"+url.getRawAuthority().toLowerCase(Locale.ROOT);
        } catch(Exception e) { throw new IllegalArgumentException("Chỉ nhập địa chỉ HTTPS của máy chủ POS, ví dụ https://pos.example.com"); }
    }
}
