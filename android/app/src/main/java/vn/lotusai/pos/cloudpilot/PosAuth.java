package vn.lotusai.pos.cloudpilot;

import android.content.*;
import android.os.Build;
import android.util.Base64;
import org.json.*;
import java.security.*;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Local credentials/session. Never accepts a role supplied by the WebView as authority. */
public final class PosAuth {
    private final SharedPreferences prefs;
    private int sessionId=0;
    private JSONObject cloudUser=null;
    private Set<String> cloudPermissions=Collections.emptySet();
    private long cloudExpiresAt=0;
    public PosAuth(Context context){prefs=context.getSharedPreferences("lotus_auth_v2",0);}
    private JSONArray accounts()throws Exception{return new JSONArray(prefs.getString("accounts","[]"));}
    private JSONObject account(int id)throws Exception{JSONArray a=accounts();for(int i=0;i<a.length();i++)if(a.getJSONObject(i).getInt("id")==id)return a.getJSONObject(i);return null;}
    public synchronized boolean allowed(String permission){
        if(cloudUser==null||System.currentTimeMillis()>=cloudExpiresAt)return false;
        if("kitchen".equals(permission))return cloudPermissions.contains("PRINT_KITCHEN");
        if("receipt".equals(permission)||"pay".equals(permission))return cloudPermissions.contains("PAYMENT_CONFIRM");
        if("printer_config".equals(permission)||"diagnostics".equals(permission))return cloudPermissions.contains("INVENTORY_MANAGE");
        if("reports".equals(permission))return cloudPermissions.contains("INVENTORY_VIEW");
        return cloudPermissions.contains("ROLE_MANAGE");
    }
    /** Called only for a successful response from the pinned Worker HTTPS connection. */
    public synchronized void cloudLogin(JSONObject staff,long expiresAt)throws Exception{
        if(staff==null||!staff.has("permissions"))throw new Exception("Worker chưa cung cấp quyền nhân viên");
        JSONArray perms=staff.getJSONArray("permissions");Set<String> parsed=new HashSet<>();
        for(int i=0;i<perms.length();i++)parsed.add(perms.getString(i));
        cloudUser=new JSONObject().put("id",staff.getString("id")).put("name",staff.getString("name"))
            .put("username",staff.getString("username")).put("role",staff.getString("role"));
        cloudPermissions=parsed;cloudExpiresAt=expiresAt;
    }
    public synchronized void cloudRefresh(JSONObject staff)throws Exception{
        if(cloudUser!=null)cloudLogin(staff,cloudExpiresAt);
    }
    public synchronized String state(){try{
        JSONObject current=System.currentTimeMillis()<cloudExpiresAt?cloudUser:null;
        return new JSONObject().put("ok",true).put("needsSetup",false).put("user",current==null?JSONObject.NULL:current)
            .put("accounts",new JSONArray()).toString();
    }catch(Exception e){return error(e);}}
    private static String error(Exception e){try{return new JSONObject().put("ok",false).put("error",e.getMessage()).toString();}catch(Exception ignored){return "{\"ok\":false}";}}
    private static void password(JSONObject a,String pass)throws Exception{
        if(pass==null||pass.length()<6||pass.length()>128)throw new Exception("Mật khẩu cần 6–128 ký tự / 密码至少6位");
        byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);
        String algorithm=Build.VERSION.SDK_INT>=26?"PBKDF2WithHmacSHA256":"PBKDF2WithHmacSHA1";
        a.put("algorithm",algorithm).put("iterations",180000).put("salt",Base64.encodeToString(salt,Base64.NO_WRAP));
        a.put("hash",Base64.encodeToString(derive(pass,salt,algorithm,180000),Base64.NO_WRAP));
    }
    private static byte[] derive(String p,byte[] salt,String algorithm,int count)throws Exception{
        PBEKeySpec spec=new PBEKeySpec(p.toCharArray(),salt,count,256);try{return SecretKeyFactory.getInstance(algorithm).generateSecret(spec).getEncoded();}finally{spec.clearPassword();}
    }
    private boolean verify(JSONObject a,String pass)throws Exception{
        if(a==null||pass==null||pass.length()>128)return false;
        return MessageDigest.isEqual(Base64.decode(a.getString("hash"),Base64.NO_WRAP),derive(pass,Base64.decode(a.getString("salt"),Base64.NO_WRAP),a.getString("algorithm"),a.getInt("iterations")));
    }
    public synchronized String setup(String pass){try{
        if(accounts().length()!=0)throw new Exception("Đã có chủ tiệm / 已设置店主");
        JSONObject a=new JSONObject().put("id",1).put("username","huang").put("name","Huang").put("role","STORE_OWNER").put("active",true);password(a,pass);
        if(!prefs.edit().putString("accounts",new JSONArray().put(a).toString()).commit())throw new Exception("Không lưu được tài khoản");sessionId=1;return state();
    }catch(Exception e){return error(e);}}
    public synchronized String login(String username,String pass){try{
        if(System.currentTimeMillis()<prefs.getLong("lockedUntil",0))throw new Exception("Sai quá nhiều lần, thử lại sau 30 giây");
        JSONObject found=null;JSONArray a=accounts();for(int i=0;i<a.length();i++)if(a.getJSONObject(i).getString("username").equalsIgnoreCase(username.trim()))found=a.getJSONObject(i);
        if(found==null||!found.optBoolean("active",true)||!verify(found,pass)){
            int failures=prefs.getInt("failures",0)+1;prefs.edit().putInt("failures",failures>=5?0:failures).putLong("lockedUntil",failures>=5?System.currentTimeMillis()+30000:0).commit();throw new Exception("Sai tài khoản/mật khẩu hoặc tài khoản bị khóa / 登录失败");
        }
        prefs.edit().putInt("failures",0).remove("lockedUntil").commit();sessionId=found.getInt("id");return state();
    }catch(Exception e){return error(e);}}
    public synchronized void logout(){sessionId=0;cloudUser=null;cloudPermissions=Collections.emptySet();cloudExpiresAt=0;}
    public synchronized String saveAccount(String raw){try{
        if(!allowed("accounts"))throw new Exception("Không có quyền / 无权限");JSONObject data=new JSONObject(raw);JSONArray list=accounts();int id=data.optInt("id",0),index=-1,max=100;
        for(int i=0;i<list.length();i++){JSONObject x=list.getJSONObject(i);max=Math.max(max,x.getInt("id"));if(x.getInt("id")==id)index=i;}
        if(id!=0&&index<0)throw new Exception("Không tìm thấy tài khoản");
        JSONObject a=index>=0?list.getJSONObject(index):new JSONObject().put("id",max+1);
        String username=data.optString("username").trim().toLowerCase(Locale.US),name=data.optString("name").trim(),role=data.optString("role");
        if(!username.matches("[a-z0-9._-]{3,40}")||name.isEmpty()||name.length()>80||!Arrays.asList("STORE_OWNER","MANAGER","CASHIER").contains(role))throw new Exception("Tên đăng nhập/vai trò không hợp lệ");
        if(a.getInt("id")==1&&(!role.equals("STORE_OWNER")||!data.optBoolean("active",true)))throw new Exception("Không thể khóa/hạ quyền tài khoản Huang");
        for(int i=0;i<list.length();i++)if(i!=index&&list.getJSONObject(i).getString("username").equals(username))throw new Exception("Tên đăng nhập đã tồn tại");
        a.put("username",username).put("name",name).put("role",role).put("active",data.optBoolean("active",true));
        String pass=data.optString("password");if(index<0||!pass.isEmpty())password(a,pass);
        if(index<0)list.put(a);else list.put(index,a);
        if(!prefs.edit().putString("accounts",list.toString()).commit())throw new Exception("Không lưu được tài khoản");
        // Force fresh login after changing the currently authenticated account.
        if(a.getInt("id")==sessionId)sessionId=0;
        return state();
    }catch(Exception e){return error(e);}}
    public synchronized String license(String key){try{
        if(!allowed("license"))throw new Exception("Không có quyền");
        if(key!=null){key=key.trim();if(key.length()<8||key.length()>256||key.contains("\n"))throw new Exception("Key cần 8–256 ký tự");if(!prefs.edit().putString("licenseKey",key).commit())throw new Exception("Không lưu được key");}
        String stored=prefs.getString("licenseKey","");return new JSONObject().put("ok",true).put("configured",!stored.isEmpty()).put("masked",stored.isEmpty()?"":"••••"+stored.substring(Math.max(0,stored.length()-4))).put("status","PENDING_SERVER_VALIDATION").toString();
    }catch(Exception e){return error(e);}}
}
