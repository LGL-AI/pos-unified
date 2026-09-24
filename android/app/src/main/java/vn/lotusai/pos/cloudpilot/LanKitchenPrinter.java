package vn.lotusai.pos.cloudpilot;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.net.*;
import android.text.InputType;
import android.widget.*;
import org.json.*;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public final class LanKitchenPrinter {
    public interface Events { void emit(String code,String severity,String message,String id); }
    private final Activity activity;
    private final SharedPreferences prefs;
    private final Events events;
    private final ExecutorService queue=Executors.newSingleThreadExecutor();
    private final Set<String> active=Collections.synchronizedSet(new HashSet<>());
    private final Set<String> queued=Collections.synchronizedSet(new HashSet<>());
    private volatile boolean scanning=false;
    public LanKitchenPrinter(Activity a,Events e){activity=a;events=e;prefs=a.getSharedPreferences("lotus_kitchen_lan",0);}
    public String config(){
        try{return new JSONObject().put("ip",prefs.getString("ip","")).put("port",prefs.getInt("port",9100))
            .put("width",prefs.getInt("width",576)).put("cut",prefs.getBoolean("cut",true)).toString();}catch(Exception e){return "{}";}
    }
    public String status(String id){
        String value=prefs.getString("status:"+id,"QUEUED");
        return "SENDING".equals(value)&&!active.contains(id)?"UNKNOWN":value;
    }
    public void submit(String id,String raw){
        if(id==null||!id.matches("[A-Za-z0-9:_-]{1,180}")||raw==null||raw.length()>262144){events.emit("LAN-001","FAIL","Dữ liệu phiếu không hợp lệ",id);return;}
        String prior=prefs.getString("payload:"+id,null);
        if(prior!=null&&!prior.equals(raw)){events.emit("LAN-009","FAIL","Mã phiếu đã gắn với nội dung khác",id);return;}
        if(!queued.add(id))return;
        if(!prefs.edit().putString("payload:"+id,raw).commit()){queued.remove(id);events.emit("LAN-010","FAIL","Không lưu được phiếu. Chưa gửi in",id);return;}
        queue.execute(()->{try{send(id,raw);}finally{queued.remove(id);}});
    }
    private void state(String id,String value)throws IOException {
        if(!prefs.edit().putString("status:"+id,value).commit())throw new IOException("LAN-010: Không lưu được trạng thái in");
    }
    private void send(String id,String raw){
        String previous=status(id);
        if("SENT".equals(previous)||"SENDING".equals(previous)||"UNKNOWN".equals(previous)||"CONFIRMED".equals(previous)){
            events.emit("LAN-008","WARN","Đã chặn gửi trùng. Trạng thái: "+previous+". Kiểm tra giấy trước khi in lại",id);return;
        }
        boolean[] started={false};
        Bitmap bitmap=null;
        try {
            String ip=prefs.getString("ip","");int port=prefs.getInt("port",9100);
            if(!EscPosTransport.privateIp(ip))throw new IOException("LAN-001: Chưa cấu hình IP máy in bếp. Vào Cá nhân → Máy in bếp LAN");
            JSONObject data=new JSONObject(raw);data.put("jobId",id);
            bitmap=TicketBitmap.render(data,prefs.getInt("width",576),false);
            final Bitmap image=bitmap;
            byte[] bytes=EscPosTransport.rasterRows(bitmap.getWidth(),bitmap.getHeight(),(start,rows,pixels)->image.getPixels(pixels,0,image.getWidth(),0,start,image.getWidth(),rows),prefs.getBoolean("cut",true));
            active.add(id);
            EscPosTransport.send(CloudNetwork.wifi(activity),ip,port,bytes,()->{state(id,"SENDING");started[0]=true;});
            state(id,"SENT");
            events.emit("LAN-000","INFO","Đã gửi TCP tới "+ip+":"+port+". Cần kiểm tra phiếu giấy; đây không phải xác nhận đã in",id);
        } catch(Exception ex){
            try{state(id,started[0]?"UNKNOWN":"FAILED");}catch(IOException ignored){}
            events.emit(started[0]?"LAN-007":"LAN-002","FAIL",(started[0]?"Chưa rõ đã in; không tự gửi lại. ":"Chưa gửi phiếu. ")+ex.getMessage(),id);
        } finally {active.remove(id);if(bitmap!=null)bitmap.recycle();}
    }
    public void retry(String id){
        String raw=prefs.getString("payload:"+id,null);
        if(raw==null){toast("Không tìm thấy nội dung phiếu");return;}
        if(active.contains(id)||queued.contains(id)){toast("Đang gửi phiếu, vui lòng chờ");return;}
        String state=status(id);
        activity.runOnUiThread(()->new AlertDialog.Builder(activity).setTitle("Kiểm tra trước khi gửi lại / 重印检查")
            .setMessage("Phiếu "+id+"\nTrạng thái: "+state+"\nHãy kiểm tra giấy và hỏi bếp trước. Bản gửi lại có nhãn IN LẠI, giữ nội dung của lần thay đổi này.")
            .setNegativeButton("Không",null).setPositiveButton("Đã kiểm tra — in lại",(d,w)->{
                try{JSONObject p=new JSONObject(raw);p.put("reprint",true);p.put("originalJobId",id);submit(id.split(":copy:")[0]+":copy:"+System.currentTimeMillis(),p.toString());}catch(Exception e){toast(e.getMessage());}
            }).show());
    }
    private void toast(String s){activity.runOnUiThread(()->Toast.makeText(activity,s,Toast.LENGTH_LONG).show());}
    private EditText field(LinearLayout layout,String label,String value,int input){
        TextView l=new TextView(activity);l.setText(label);layout.addView(l);
        EditText e=new EditText(activity);e.setSingleLine(true);e.setInputType(input);e.setText(value);layout.addView(e);return e;
    }
    private Button button(LinearLayout l,String text,Runnable action){Button b=new Button(activity);b.setText(text);l.addView(b);b.setOnClickListener(v->action.run());return b;}
    public void openSettings(){activity.runOnUiThread(()->{
        LinearLayout l=new LinearLayout(activity);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(20,12,20,20);
        TextView info=new TextView(activity);info.setText("KV804 • 80 mm • LAN/ESC-POS\nSUNMI dùng Wi-Fi cùng LAN với dây mạng KV804, không phải chỉ cùng có Internet.\n9100 là cổng thử mặc định. Tìm thấy cổng mở chưa chứng minh đó là máy in.");l.addView(info);
        EditText ip=field(l,"IP máy in",prefs.getString("ip",""),InputType.TYPE_CLASS_PHONE);
        EditText port=field(l,"Cổng TCP",String.valueOf(prefs.getInt("port",9100)),InputType.TYPE_CLASS_NUMBER);
        Spinner width=new Spinner(activity);width.setAdapter(new ArrayAdapter<String>(activity,android.R.layout.simple_spinner_dropdown_item,new String[]{"576 dots (80 mm)","512 dots (nếu bị cắt mép)"}));width.setSelection(prefs.getInt("width",576)==512?1:0);l.addView(width);
        CheckBox cut=new CheckBox(activity);cut.setText("Cắt giấy sau in / 自动切纸");cut.setChecked(prefs.getBoolean("cut",true));l.addView(cut);
        Runnable save=()->{
            try{String host=ip.getText().toString().trim();int p=Integer.parseInt(port.getText().toString());if(!EscPosTransport.privateIp(host)||p<1||p>65535)throw new Exception("Chỉ nhập IPv4 LAN (10.x, 172.16–31.x, 192.168.x), cổng 1–65535");
                if(!prefs.edit().putString("ip",host).putInt("port",p).putInt("width",width.getSelectedItemPosition()==1?512:576).putBoolean("cut",cut.isChecked()).commit())throw new Exception("Không lưu được cấu hình");
                info.setText("Đã lưu "+host+":"+p+". In thử và kiểm tra giấy trước khi dùng.");
            }catch(Exception e){toast(e.getMessage());}
        };
        button(l,"Lưu cấu hình / 保存",save);
        button(l,"Tìm trên LAN (không in) / 搜索",()->{
            int p;try{p=Integer.parseInt(port.getText().toString());if(p<1||p>65535)throw new Exception();}catch(Exception e){toast("Cổng không hợp lệ");return;}
            new AlertDialog.Builder(activity).setMessage("Dò kết nối TCP tối đa 254 địa chỉ trong LAN hiện tại, cổng "+p+". Không gửi lệnh in, không sửa máy in. Tiếp tục?")
                .setNegativeButton("Không",null).setPositiveButton("Tìm",(d,w)->discover(p,ip,info)).show();
        });
        button(l,"In thử cấu hình ĐÃ LƯU / 测试打印",()->{
            try{JSONObject p=new JSONObject().put("orderCode","TEST").put("table","THỬ / 测试").put("kind","IN THỬ / 测试").put("createdAt",new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss",Locale.US).format(new Date()));
                p.put("items",new JSONArray().put(new JSONObject().put("qty",1).put("name","Cơm giò heo — Độ cay: nhỏ, vừa, lớn").put("nameCn","猪脚饭 · 辣度 小中大 · 份量 中大").put("mods","Tiếng Việt có dấu / 中文测试")));
                String id="test:"+System.currentTimeMillis();submit(id,p.toString());info.setText("Đang gửi phiếu thử. Xem Nhật ký và kiểm tra giấy thực tế.");
            }catch(Exception e){toast(e.getMessage());}
        });
        button(l,"Nhật ký / Gửi lại phiếu bếp",this::openJobs);
        ScrollView scroll=new ScrollView(activity);scroll.addView(l);
        new AlertDialog.Builder(activity).setTitle("Máy in bếp LAN / 厨房打印机").setView(scroll).setNegativeButton("Đóng",null).show();
    });}
    private void discover(int port,EditText ip,TextView info){
        if(scanning){toast("Đang tìm, vui lòng chờ");return;}scanning=true;info.setText("Đang tìm trên LAN… tối đa khoảng 20 giây");
        new Thread(()->{
            ExecutorService pool=Executors.newFixedThreadPool(12);List<String> hosts=Collections.synchronizedList(new ArrayList<>());
            try{
                ConnectivityManager cm=(ConnectivityManager)activity.getSystemService(Context.CONNECTIVITY_SERVICE);
                Network wifi=CloudNetwork.wifi(activity);
                if(wifi==null)throw new IOException("Không có Wi-Fi quán để tìm máy in bếp");
                LinkProperties props=cm.getLinkProperties(wifi);LinkAddress selected=null;
                if(props!=null)for(LinkAddress a:props.getLinkAddresses())if(a.getAddress() instanceof Inet4Address&&EscPosTransport.privateIp(a.getAddress().getHostAddress())){selected=a;break;}
                if(selected==null)throw new IOException("Không có IPv4 LAN. Kiểm tra Wi-Fi; không dùng mạng khách/VPN");
                byte[] b=selected.getAddress().getAddress();int local=((b[0]&255)<<24)|((b[1]&255)<<16)|((b[2]&255)<<8)|(b[3]&255);
                int prefix=Math.max(24,selected.getPrefixLength());if(prefix>30)throw new IOException("Subnet không phù hợp để dò, hãy nhập IP thủ công");
                int base=local&(-1<<(32-prefix)),count=(1<<(32-prefix))-1;
                for(int n=1;n<count;n++){final int target=base+n;if(target==local)continue;final String host=((target>>>24)&255)+"."+((target>>>16)&255)+"."+((target>>>8)&255)+"."+(target&255);
                    pool.submit(()->{try(Socket s=wifi.getSocketFactory().createSocket()){s.connect(new InetSocketAddress(host,port),500);hosts.add(host);}catch(IOException ignored){}});
                }
                pool.shutdown();pool.awaitTermination(20,TimeUnit.SECONDS);
                activity.runOnUiThread(()->{
                    info.setText("Tìm thấy "+hosts.size()+" địa chỉ mở cổng "+port+". Chỉ dò tối đa /24 gần máy; IP ngoài vùng này cần nhập tay. Phải in thử để xác minh.");
                    if(!hosts.isEmpty()){String[] found=hosts.toArray(new String[0]);new AlertDialog.Builder(activity).setTitle("Chọn IP rồi Lưu và In thử").setItems(found,(d,w)->ip.setText(found[w])).show();}
                });
            }catch(Exception e){toast(e.getMessage());activity.runOnUiThread(()->info.setText("Không dò được. Có thể nhập IP thủ công."));}
            finally{pool.shutdownNow();scanning=false;}
        },"lotus-lan-discovery").start();
    }
    public void openJobs(){activity.runOnUiThread(()->{
        List<String> ids=new ArrayList<>();for(String k:prefs.getAll().keySet())if(k.startsWith("payload:"))ids.add(k.substring(8));
        Collections.sort(ids,Collections.reverseOrder());
        LinearLayout l=new LinearLayout(activity);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(16,8,16,8);
        TextView tip=new TextView(activity);tip.setText("SENT = đã gửi TCP, CHƯA xác nhận ra giấy. UNKNOWN = có thể đã in; hỏi bếp trước khi in lại. FAILED = chưa gửi dữ liệu in. Không tự gửi lại sau lỗi.");l.addView(tip);
        for(String id:ids){button(l,id+"\n"+status(id),()->retry(id));}
        if(ids.isEmpty()){TextView empty=new TextView(activity);empty.setText("Chưa có phiếu");l.addView(empty);}
        ScrollView scroll=new ScrollView(activity);scroll.addView(l);new AlertDialog.Builder(activity).setTitle("Phiếu bếp / 打印记录").setView(scroll).setNegativeButton("Đóng",null).show();
    });}
    public void close(){queue.shutdown();}
}
