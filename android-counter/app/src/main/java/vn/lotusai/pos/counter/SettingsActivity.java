package vn.lotusai.pos.counter;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public final class SettingsActivity extends Activity {
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private Config config;private PrintEngine engine;private LinearLayout form,retryActions;private TextView feedback,serverFeedback;
    @Override public void onCreate(Bundle state){super.onCreate(state);config=new Config(this);setRequestedOrientation(LayoutProfiles.orientation(config.layoutProfile()));engine=new PrintEngine(this,s->runOnUiThread(()->feedback.setText(s)),false);ScrollView scroll=new ScrollView(this);form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(24,16,24,40);scroll.addView(form);setContentView(scroll);heading("Cài đặt · Lotus POS Counter");feedback=new TextView(this);feedback.setTextSize(17);form.addView(feedback);layoutSettings();serverSettings();field("Tên tiệm", "storeName","Lotus POS");
        heading("Máy in đơn USB · phiếu bếp → cắt → hóa đơn → cắt");field("Bật receipt (true/false)","receiptEnabled","true");selector("receipt");button("Thử in hóa đơn",()->engine.test("RECEIPT"));
        heading("Máy in tem USB · TSPL thử nghiệm");field("Bật label (true/false)","labelEnabled","true");selector("label");field("DPI", "labelDpi","203");field("Rộng mm","labelWidth","38");field("Cao mm","labelHeight","40");field("Gap mm","labelGap","2");field("Speed","labelSpeed","5");button("Thử in tem",()->engine.test("LABEL"));
        heading("Tuyến phiếu bếp");field("In bếp: RECEIPT_USB (mặc định) hoặc LAN","kitchenRoute","RECEIPT_USB");field("Bật kitchen (true/false)","kitchenEnabled","true");field("IP KV804 (chỉ dùng khi chọn LAN)","kitchenHost","");field("Port KV804","kitchenPort","9100");button("Thử in bếp",()->engine.test("KITCHEN"));field("Mở két với tiền mặt (true/false)","drawerEnabled","false");
        heading("Chẩn đoán & hàng đợi");button("Giả lập PAID → tem → bếp/cắt → hóa đơn/cắt (không gửi máy in)",()->engine.simulate());button("Làm mới USB / danh sách job",this::queue);retryActions=new LinearLayout(this);retryActions.setOrientation(LinearLayout.VERTICAL);form.addView(retryActions);queue();}
    private void heading(String title){TextView t=new TextView(this);t.setText(title);t.setTextSize(21);t.setPadding(0,20,0,12);form.addView(t);}
    private Button button(String text,Runnable r){Button b=new Button(this);b.setText(text);form.addView(b);b.setOnClickListener(v->r.run());return b;}
    private void layoutSettings(){heading("Chiều và cỡ giao diện quầy");TextView note=new TextView(this);note.setText("Chọn một kiểu để xoay app và đổi cỡ nút, chữ, bố cục bán hàng. Màn hình khách thứ hai giữ bố cục riêng. Các số là cỡ tham chiếu; độ phân giải thật do Android quyết định.");form.addView(note);
        RadioGroup choices=new RadioGroup(this);choices.setOrientation(LinearLayout.VERTICAL);String selected=config.layoutProfile();
        for(int i=0;i<LayoutProfiles.IDS.length;i++){RadioButton item=new RadioButton(this);item.setId(View.generateViewId());item.setText(LayoutProfiles.LABELS[i]);item.setTextSize(17);item.setPadding(7,5,7,5);item.setTag(LayoutProfiles.IDS[i]);choices.addView(item);if(selected.equals(LayoutProfiles.IDS[i]))item.setChecked(true);}
        form.addView(choices);TextView selectedText=new TextView(this);selectedText.setText("Đang dùng: "+labelForProfile(selected));form.addView(selectedText);
        choices.setOnCheckedChangeListener((group,id)->{View choice=group.findViewById(id);if(choice==null)return;String profile=(String)choice.getTag();config.setLayoutProfile(profile);selectedText.setText("Đã lưu: "+labelForProfile(profile)+" · Quay về Bán hàng để xem giao diện");int orientation=LayoutProfiles.orientation(profile);if(getRequestedOrientation()!=orientation)setRequestedOrientation(orientation);});
    }
    private String labelForProfile(String profile){for(int i=0;i<LayoutProfiles.IDS.length;i++)if(LayoutProfiles.IDS[i].equals(profile))return LayoutProfiles.LABELS[i];return LayoutProfiles.LABELS[4];}
    private void serverSettings(){heading("Máy chủ POS · Internet");TextView label=new TextView(this);label.setText("Địa chỉ HTTPS chung cho quầy, POS cầm tay, QR và màn hình khách");form.addView(label);EditText address=new EditText(this);address.setSingleLine();address.setText(config.origin());address.setHint("https://pos.example.com");form.addView(address);serverFeedback=new TextView(this);serverFeedback.setTextSize(16);form.addView(serverFeedback);
        button("Kiểm tra kết nối",()->checkServer(address.getText().toString(),false,null));
        Button save=button("Kiểm tra và lưu máy chủ",()->{});save.setOnClickListener(v->checkServer(address.getText().toString(),true,save));
        checkServer(config.origin(),false,null);
    }
    private void checkServer(String input,boolean save,Button trigger){final String origin;try{origin=Config.validOrigin(input);}catch(IllegalArgumentException e){serverFeedback.setText(e.getMessage());return;}if(trigger!=null)trigger.setEnabled(false);serverFeedback.setText("Đang kiểm tra "+origin+" …");network.execute(()->{JSONObject health=null;String error=null;try{health=CloudApi.health(origin);}catch(Exception e){error=e.getMessage();}final JSONObject result=health;final String problem=error;runOnUiThread(()->{if(isFinishing()||isDestroyed())return;if(trigger!=null)trigger.setEnabled(true);if(problem!=null){serverFeedback.setText("Không kết nối được "+origin+": "+problem);return;}if(!CloudApi.ready(result)){serverFeedback.setText("Máy chủ chưa sẵn sàng: version="+result.optString("version","?")+", D1="+result.optString("d1","?")+", display="+result.optString("display","?")+", autoPrint="+result.optBoolean("autoPrintReady")+". Cần API RC5.1 và D1 đủ migration 0014, 0015.");return;}if(save)config.setOrigin(origin);serverFeedback.setText((save?"Đã lưu và sẽ mở ":"Kết nối OK: ")+origin+" · RC5.1, D1, QR bàn, màn hình khách và tự in OK · QR "+(result.optBoolean("acceptingOrders")?"đang nhận đơn":"chưa bật nhận đơn"));});});}
    private void field(String title,String key,String defaultValue){TextView label=new TextView(this);label.setText(title);form.addView(label);EditText input=new EditText(this);input.setSingleLine();input.setText(config.get(key,defaultValue));form.addView(input);button("Lưu "+title,()->{config.set(key,input.getText().toString().trim());feedback.setText("Đã lưu "+title);});}
    private void selector(String role){button("Chọn USB "+role,()->{JSONArray list=engine.printers().devices();String[] options=new String[list.length()];for(int i=0;i<options.length;i++){JSONObject d=list.optJSONObject(i);options[i]=d.optString("manufacturer")+" "+d.optString("product")+" · VID "+d.optInt("vendorId")+" PID "+d.optInt("productId")+" · "+d.optString("name");}if(options.length==0){feedback.setText("Chưa thấy USB device");return;}new AlertDialog.Builder(this).setTitle("USB "+role).setItems(options,(dialog,which)->{JSONObject d=list.optJSONObject(which);config.set(role+"Vid",""+d.optInt("vendorId"));config.set(role+"Pid",""+d.optInt("productId"));try{engine.printers().request(role);}catch(Exception e){feedback.setText(e.getMessage());}feedback.setText("Đã chọn "+options[which]+". Cho phép quyền USB nếu hệ thống hỏi.");}).show();});}
    private void queue(){retryActions.removeAllViews();JSONArray list=engine.queue();StringBuilder result=new StringBuilder("Android "+android.os.Build.VERSION.RELEASE+" · API "+android.os.Build.VERSION.SDK_INT+" · "+android.os.Build.MODEL+"\nUSB: "+engine.printers().devices()+"\n");for(int i=0;i<list.length();i++){JSONObject job=list.optJSONObject(i);String id=job.optString("id"),s=job.optString("status");result.append("\n").append(job.optString("kind")).append(" · ").append(s).append(" · ").append(id).append(" · ").append(job.optString("error"));if("FAILED".equals(s)||"UNKNOWN".equals(s)){Button retry=new Button(this);retry.setText("Kiểm tra giấy rồi thử lại: "+id);retryActions.addView(retry);retry.setOnClickListener(v->new AlertDialog.Builder(this).setMessage("Đã kiểm tra giấy thực tế? Lệnh có thể đã in rồi. Chỉ gửi lại job này.").setNegativeButton("Hủy",null).setPositiveButton("Gửi lại",(d,w)->{engine.retry(id,true);queue();}).show());}}feedback.setText(result.toString());}
    @Override protected void onDestroy(){network.shutdownNow();engine.shutdown();super.onDestroy();}
}
