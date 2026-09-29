package vn.lotusai.pos.counter;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class PrintEngine {
    interface Listener {void onStatus(String message);}
    private final Config config;private final CloudApi api;private final JobStore jobs;private final Printers printers;private final Listener listener;private final SharedPreferences recovery;
    private final ExecutorService executor=Executors.newSingleThreadExecutor(),statusExecutor=Executors.newSingleThreadExecutor();
    PrintEngine(Context c,Listener listener){this(c,listener,true);}
    PrintEngine(Context c,Listener listener,boolean recoverInterrupted){config=new Config(c);api=new CloudApi(config);jobs=new JobStore(c,config.serverSuffix());printers=new Printers(c,config);recovery=c.getSharedPreferences("payment_recovery"+config.serverSuffix(),Context.MODE_PRIVATE);this.listener=listener;if(recoverInterrupted)jobs.markInterrupted();}
    void shutdown(){executor.execute(jobs::close);executor.shutdown();statusExecutor.shutdown();}
    JSONArray queue(){return jobs.list();}
    Printers printers(){return printers;}
    void paid(String orderId,String token){paid(orderId,"",token);}
    void paid(String orderId,String billId,String token){
        if(!validOrder(orderId)||token==null||!token.matches("[A-Za-z0-9_-]{32,100}"))return;
        if(billId==null)billId="";
        if(!billId.isEmpty()&&!billId.matches(java.util.regex.Pattern.quote(orderId)+":[1-9][0-9]*"))return;
        String key=billId.isEmpty()?orderId:billId,part=billId;
        remember(key);executor.execute(()->verifyAndPrint(orderId,part,token,key));
    }
    synchronized void resume(String token){if(token==null||!token.matches("[A-Za-z0-9_-]{32,100}"))return;try{JSONArray pending=new JSONArray(recovery.getString("pending","[]"));for(int i=0;i<pending.length();i++){String key=pending.optString(i),order=key.split(":")[0],bill=key.contains(":")?key:"";if(validOrder(order))executor.execute(()->verifyAndPrint(order,bill,token,key));}}catch(Exception ignored){}}
    void syncPaidJob(String orderId,String jobId,String token){
        if(!validOrder(orderId)||jobId==null||!jobId.matches("kitchen:"+java.util.regex.Pattern.quote(orderId)+":[0-9]+")||token==null||!token.matches("[A-Za-z0-9_-]{32,100}"))return;
        executor.execute(()->{try{
            JSONObject detail=api.call("GET","/api/staff/orders/"+orderId,token,null),order=detail.getJSONObject("order");
            if(!"PAID".equals(order.optString("paymentStatus")))return;
            requirePermissions(token,false,true);
            JSONArray jobsArray=detail.optJSONArray("jobs");
            if(jobsArray!=null)for(int n=0;n<jobsArray.length();n++){JSONObject job=jobsArray.getJSONObject(n);if(jobId.equals(job.optString("id"))){enqueueLabels(job,order);enqueueKitchen(job,order,token);break;}}
        }catch(Exception e){listener.onStatus("Đồng bộ tem/bếp: "+e.getMessage());}});
    }
    private static boolean validOrder(String id){return id!=null&&id.matches("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}");}
    private void requirePermissions(String token,boolean receipt,boolean kitchen)throws Exception{
        JSONObject staff=api.call("GET","/api/staff/me",token,null).getJSONObject("staff");
        JSONArray permissions=staff.optJSONArray("permissions");boolean canReceipt=false,canKitchen=false;
        if(permissions!=null)for(int i=0;i<permissions.length();i++){String p=permissions.optString(i);if("PAYMENT_CONFIRM".equals(p))canReceipt=true;if("PRINT_KITCHEN".equals(p))canKitchen=true;}
        if(receipt&&!canReceipt||kitchen&&!canKitchen)throw new Exception("Tài khoản hiện tại không có quyền in loại phiếu này");
    }
    private synchronized void remember(String id){try{JSONArray pending=new JSONArray(recovery.getString("pending","[]"));for(int i=0;i<pending.length();i++)if(id.equals(pending.optString(i)))return;pending.put(id);recovery.edit().putString("pending",pending.toString()).commit();}catch(Exception ignored){}}
    private synchronized void forget(String id){try{JSONArray old=new JSONArray(recovery.getString("pending","[]")),next=new JSONArray();for(int i=0;i<old.length();i++)if(!id.equals(old.optString(i)))next.put(old.optString(i));recovery.edit().putString("pending",next.toString()).commit();}catch(Exception ignored){}}
    private void verifyAndPrint(String orderId,String billId,String token,String recoveryKey){
        try {
            JSONObject detail=api.call("GET","/api/staff/orders/"+orderId,token,null),order=detail.getJSONObject("order");
            JSONArray bills=detail.optJSONArray("bills");
            JSONObject found=null;
            if(!billId.isEmpty()){
                if(bills!=null)for(int i=0;i<bills.length();i++)if(billId.equals(bills.getJSONObject(i).optString("id"))){found=bills.getJSONObject(i);break;}
                if(found==null||!"PAID".equals(found.optString("paymentStatus"))){listener.onStatus("Bill chưa PAID trên D1: không in");return;}
            }else if(!"PAID".equals(order.optString("paymentStatus"))){listener.onStatus("Đơn chưa PAID trên D1: không in");return;}
            final JSONObject selected=found;
            final boolean wholePaid="PAID".equals(order.optString("paymentStatus"));
            final JSONArray kitchen=wholePaid?detail.optJSONArray("jobs"):null;
            requirePermissions(token,true,kitchen!=null&&kitchen.length()>0);
            boolean complete=PrintFlow.afterPayment(
                ()->{if(kitchen!=null)for(int n=0;n<kitchen.length();n++)enqueueLabels(kitchen.getJSONObject(n),order);},
                ()->{boolean sent=true;if(kitchen!=null)for(int n=0;n<kitchen.length();n++)if(!enqueueKitchen(kitchen.getJSONObject(n),order,token))sent=false;return sent;},
                ()->{if(selected!=null)enqueueReceipt(order,selected,billId);
                    else if(bills==null||bills.length()==0)enqueueReceipt(order,null,orderId+":"+order.optString("paidAt","PAID"));
                    else for(int i=0;i<bills.length();i++){JSONObject bill=bills.getJSONObject(i);if("PAID".equals(bill.optString("paymentStatus")))enqueueReceipt(order,bill,bill.getString("id"));}}
            );
            if(!complete){listener.onStatus("Chưa in hóa đơn: phiếu bếp chưa gửi/cắt thành công. Kiểm tra máy in và hàng đợi.");return;}
            forget(recoveryKey);
        }catch(Exception e){listener.onStatus("Không xác minh/in được đơn: "+e.getMessage());}
    }
    private void enqueueReceipt(JSONObject order,JSONObject bill,String base)throws Exception{
        JSONObject receipt=new JSONObject(order.toString());
        if(bill!=null){for(String key:new String[]{"code","items","subtotal","discount","taxAmount","taxMode","taxRate","total","paymentMethod","cashReceived","cashChange","paidAt"})if(bill.has(key))receipt.put(key,bill.get(key));}
        receipt.put("storeName",config.get("storeName","Lotus POS"));
        enqueue(base+":RECEIPT","RECEIPT",receipt);
        if("CASH".equals(receipt.optString("paymentMethod"))&&config.enabled("drawerEnabled",false))enqueue(base+":DRAWER","DRAWER",receipt);
    }
    private void enqueueLabels(JSONObject job,JSONObject order)throws Exception{
        if("VOID".equals(job.optString("status")))return;
        String remoteId=job.getString("id"),code=order.optString("code"),table=order.optString("table");
        JSONArray items=job.getJSONArray("items");for(int i=0;i<items.length();i++){
            JSONObject item=items.getJSONObject(i);if(item.optBoolean("noLabel",false))continue;
            int qty=Math.min(60,item.optInt("qty",1));for(int unit=0;unit<qty;unit++){
                JSONObject label=new JSONObject();label.put("code",code);label.put("table",table);label.put("name",item.optString("name"));label.put("nameCn",item.optString("nameCn"));label.put("note",PrintText.modifiers(item.optJSONObject("mods")));
                enqueue(remoteId+":LABEL:"+i+":"+unit,"LABEL",label);
            }
        }
    }
    private boolean enqueueKitchen(JSONObject job,JSONObject order,String token)throws Exception{
        String status=job.optString("status");if("VOID".equals(status))return true;
        String remoteId=job.getString("id"),localId=remoteId+":KITCHEN";
        if("PENDING".equals(status)||"FAILED".equals(status)){
            JSONObject payload=new JSONObject();payload.put("remoteId",remoteId);payload.put("token",token);payload.put("code",order.optString("code"));payload.put("table",order.optString("table"));payload.put("items",job.getJSONArray("items"));payload.put("storeName",config.get("storeName","Lotus POS"));
            enqueue(localId,"KITCHEN",payload);
        }
        return "SUCCESS".equals(jobs.status(localId))||"SENT".equals(status)||"CONFIRMED".equals(status);
    }
    private void enqueue(String id,String kind,JSONObject payload){if(jobs.add(id,kind,payload))run(id,kind,payload);}
    private void run(String id,String kind,JSONObject payload){
        try {
            String remote=payload.optString("remoteId");String token=payload.optString("token");
            printers.preflight(kind);
            if("KITCHEN".equals(kind)){
                if(!"RETRYING".equals(jobs.status(id))||!"UNKNOWN".equals(payload.optString("remoteState")))api.call("POST","/api/staff/jobs/"+remote+"/claim",token,new JSONObject());
                jobs.state(id,"PRINTING",null);
                api.call("POST","/api/staff/jobs/"+remote+"/status",token,new JSONObject().put("status","UNKNOWN"));
                payload.put("remoteState","UNKNOWN");
                jobs.updatePayload(id,payload);
            }
            // Once writing begins, a crash is ambiguous. Never replay it automatically.
            if(!"KITCHEN".equals(kind))jobs.state(id,"PRINTING",null);
            printers.send(kind,payload);
            jobs.state(id,"SUCCESS",null);
            if("KITCHEN".equals(kind))statusExecutor.execute(()->{try{api.call("POST","/api/staff/jobs/"+remote+"/status",token,new JSONObject().put("status","SENT"));}catch(Exception e){listener.onStatus("Bếp đã gửi giấy; cập nhật D1 lỗi: "+e.getMessage());}});
        }catch(Exception e){String error=e.getMessage();String status="PRINTING".equals(jobs.status(id))?"UNKNOWN":"FAILED";jobs.state(id,status,error);listener.onStatus(kind+" "+status+": "+error);
            // Preserve server UNKNOWN after a possible write. Other terminals must not reclaim it.
        }
    }
    void retry(String id,boolean paperChecked){if(!paperChecked)return;executor.execute(()->{try{String s=jobs.status(id);if(!"FAILED".equals(s)&&!"UNKNOWN".equals(s))return;JSONObject payload=jobs.payload(id);if("UNKNOWN".equals(s))payload.put("remoteState","UNKNOWN");jobs.state(id,"RETRYING",null);run(id,payload.has("remoteId")?"KITCHEN":id.contains(":LABEL:")?"LABEL":id.endsWith(":DRAWER")?"DRAWER":"RECEIPT",payload);if(payload.has("remoteId")&&"SUCCESS".equals(jobs.status(id)))resume(payload.optString("token"));}catch(Exception e){listener.onStatus(e.getMessage());}});}
    void test(String kind){executor.execute(()->{try{JSONObject p=new JSONObject();p.put("code","LOTUS TEST");p.put("table","POS QUẦY");p.put("name","Thử in tem");p.put("storeName","Lotus POS");p.put("items",new JSONArray());printers.send(kind,p);listener.onStatus("Đã gửi test "+kind);}catch(Exception e){listener.onStatus("Test "+kind+": "+e.getMessage());}});}
    void simulate(){executor.execute(()->{try{listener.onStatus(printers.simulatePayment());}catch(Exception e){listener.onStatus("Giả lập in: "+e.getMessage());}});}
}
