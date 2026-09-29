package vn.lotusai.pos.counter;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

final class Printers {
    static final String USB_PERMISSION="vn.lotusai.pos.counter.USB_PERMISSION";
    private final Context context;private final Config config;private final UsbManager usb;
    Printers(Context context,Config config){this.context=context;this.config=config;usb=(UsbManager)context.getSystemService(Context.USB_SERVICE);}
    JSONArray devices(){JSONArray a=new JSONArray();for(UsbDevice d:usb.getDeviceList().values())try{JSONObject j=new JSONObject();j.put("vendorId",d.getVendorId());j.put("productId",d.getProductId());j.put("name",d.getDeviceName());j.put("manufacturer",d.getManufacturerName());j.put("product",d.getProductName());j.put("permission",usb.hasPermission(d));a.put(j);}catch(Exception ignored){}return a;}
    private UsbDevice find(String role)throws Exception{
        int vid=config.number(role+"Vid",-1),pid=config.number(role+"Pid",-1);
        if(vid<0||pid<0)throw new Exception("Select USB device for "+role+" in Settings");
        for(UsbDevice d:usb.getDeviceList().values())if(d.getVendorId()==vid&&d.getProductId()==pid)return d;
        throw new Exception("USB "+role+" disconnected ("+vid+":"+pid+")");
    }
    void request(String role)throws Exception{UsbDevice d=find(role);if(!usb.hasPermission(d)){PendingIntent pi=PendingIntent.getBroadcast(context,0,new Intent(USB_PERMISSION).setPackage(context.getPackageName()),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE);usb.requestPermission(d,pi);}}
    private String kitchenRoute()throws Exception{String route=config.get("kitchenRoute","RECEIPT_USB").trim().toUpperCase(java.util.Locale.ROOT);if(!"RECEIPT_USB".equals(route)&&!"LAN".equals(route))throw new Exception("Kitchen route must be RECEIPT_USB or LAN");return route;}
    void preflight(String kind)throws Exception{if("RECEIPT".equals(kind)||"DRAWER".equals(kind)||"KITCHEN".equals(kind)&&"RECEIPT_USB".equals(kitchenRoute())){UsbDevice d=find("receipt");if(!usb.hasPermission(d)){request("receipt");throw new Exception("Receipt USB permission pending");}}else if("LABEL".equals(kind)){UsbDevice d=find("label");if(!usb.hasPermission(d)){request("label");throw new Exception("Label USB permission pending");}}else if("KITCHEN".equals(kind)&&config.get("kitchenHost","").isEmpty())throw new Exception("Kitchen IP not configured");}
    private void usbWrite(String role,byte[] data)throws Exception{
        UsbDevice device=find(role);if(!usb.hasPermission(device)){request(role);throw new Exception("USB permission requested; retry after granting access");}
        UsbInterface iface=null;UsbEndpoint endpoint=null;
        for(int i=0;i<device.getInterfaceCount();i++){UsbInterface candidate=device.getInterface(i);for(int n=0;n<candidate.getEndpointCount();n++){UsbEndpoint ep=candidate.getEndpoint(n);if(ep.getType()==UsbConstants.USB_ENDPOINT_XFER_BULK&&ep.getDirection()==UsbConstants.USB_DIR_OUT){iface=candidate;endpoint=ep;break;}}if(endpoint!=null)break;}
        if(endpoint==null)throw new Exception("No USB bulk OUT endpoint for "+role);
        UsbDeviceConnection conn=usb.openDevice(device);if(conn==null)throw new Exception("USB open failed");
        try {if(!conn.claimInterface(iface,true))throw new Exception("USB interface busy");
            for(int at=0;at<data.length;){int size=Math.min(2048,data.length-at);byte[] chunk=new byte[size];System.arraycopy(data,at,chunk,0,size);int sent=conn.bulkTransfer(endpoint,chunk,size,4000);if(sent<=0)throw new Exception("USB write failed at byte "+at);at+=sent;}
        }finally{conn.releaseInterface(iface);conn.close();}
    }
    private byte[] preview(String kind,JSONObject payload)throws Exception{
        if("RECEIPT".equals(kind))return escpos(ticket(payload,"HÓA ĐƠN THANH TOÁN",576),true);
        if("KITCHEN".equals(kind))return escpos(ticket(payload,"PHIẾU BẾP",576),true);
        if("LABEL".equals(kind))return tspl(payload);
        if("DRAWER".equals(kind))return new byte[]{27,112,0,50,100};
        throw new Exception("Unsupported job kind");
    }
    void send(String kind,JSONObject payload)throws Exception{
        if("RECEIPT".equals(kind)){if(!config.enabled("receiptEnabled",true))throw new Exception("Receipt disabled");usbWrite("receipt",preview(kind,payload));}
        else if("KITCHEN".equals(kind)){if(!config.enabled("kitchenEnabled",true))throw new Exception("Kitchen disabled");byte[] bytes=preview(kind,payload);if("RECEIPT_USB".equals(kitchenRoute()))usbWrite("receipt",bytes);else{String host=config.get("kitchenHost","");int port=config.number("kitchenPort",9100);if(host.isEmpty()||port<1||port>65535)throw new Exception("Kitchen IP/port not configured");try(Socket socket=new Socket()){socket.connect(new InetSocketAddress(host,port),3500);socket.setSoTimeout(4000);OutputStream out=socket.getOutputStream();out.write(bytes);out.flush();}}}
        else if("LABEL".equals(kind)){if(!config.enabled("labelEnabled",true))throw new Exception("Label disabled");usbWrite("label",preview(kind,payload));}
        else if("DRAWER".equals(kind)){if(!config.enabled("drawerEnabled",false))return;usbWrite("receipt",preview(kind,payload));}
        else throw new Exception("Unsupported job kind");
    }
    String simulatePayment()throws Exception{
        JSONObject item=new JSONObject().put("name","Món thử").put("qty",1).put("price",25000);
        JSONObject kitchen=new JSONObject().put("storeName","Lotus POS").put("code","LOTUS-TEST").put("table","T01").put("items",new JSONArray().put(item));
        JSONObject receipt=new JSONObject(kitchen.toString()).put("subtotal",25000).put("total",25000).put("paymentMethod","CASH").put("cashReceived",25000).put("cashChange",0);
        JSONObject label=new JSONObject().put("code","LOTUS-TEST").put("table","T01").put("name","Món thử");
        StringBuilder trace=new StringBuilder("GIẢ LẬP PAID · không ghi D1/không gửi USB/LAN\n");
        byte[] receiptBytes=preview("RECEIPT",receipt);
        boolean complete=PrintFlow.afterPayment(()->trace(trace,"LABEL",label),()->trace(trace,"KITCHEN",kitchen),()->trace(trace,"RECEIPT",receipt));
        if(!complete)trace.append("RECEIPT · ").append(receiptBytes.length).append(" byte đã dựng · GIỮ LẠI vì bếp chưa in/cắt; không gửi hóa đơn\n");
        return trace.toString();
    }
    private boolean trace(StringBuilder trace,String kind,JSONObject payload)throws Exception{
        byte[] bytes=preview(kind,payload);
        boolean paper=!"LABEL".equals(kind);
        if(paper&&!PrintFlow.endsWithCut(bytes))throw new Exception(kind+" thiếu lệnh cắt ESC/POS");
        if(!paper&&!new String(bytes,Math.max(0,bytes.length-11),Math.min(11,bytes.length),StandardCharsets.US_ASCII).endsWith("PRINT 1,1\r\n"))throw new Exception("LABEL thiếu lệnh TSPL PRINT");
        String role="LABEL".equals(kind)?"label":"receipt";
        String destination="KITCHEN".equals(kind)&&"LAN".equals(kitchenRoute())?"KV804 LAN":"LABEL".equals(kind)?"USB tem":"USB hóa đơn";
        trace.append(kind).append(" → ").append(destination).append(" · ").append(bytes.length).append(" byte · ").append(paper?"CẮT GIẤY":"TSPL PRINT");
        boolean ready=false;
        if("KV804 LAN".equals(destination))trace.append(" · LAN chưa kiểm tra, không gửi");
        else try{UsbDevice d=find(role);ready=usb.hasPermission(d);trace.append(ready?" · USB sẵn sàng (giả lập không gửi)":" · USB chưa cấp quyền → giả định FAILED");}catch(Exception e){trace.append(" · USB chưa kết nối/cấu hình → giả định FAILED: ").append(e.getMessage());}
        trace.append('\n');
        return ready;
    }
    private static java.util.ArrayList<String> wrapText(String text,Paint paint,int width){
        java.util.ArrayList<String> lines=new java.util.ArrayList<>();
        for(String paragraph:text.split("\\n",-1)){
            String rest=paragraph;
            while(!rest.isEmpty()){
                int n=paint.breakText(rest,true,width,null);
                if(n<=0)n=Character.charCount(rest.codePointAt(0));
                if(n<rest.length()&&Character.isHighSurrogate(rest.charAt(n-1)))n--;
                if(n<=0)n=Character.charCount(rest.codePointAt(0));
                lines.add(rest.substring(0,n));rest=rest.substring(n);
            }
            if(paragraph.isEmpty())lines.add("");
        }
        return lines;
    }
    private Bitmap ticket(JSONObject p,String title,int width){
        java.util.ArrayList<String> lines=new java.util.ArrayList<>();lines.add(p.optString("storeName","Lotus POS"));lines.add(title);lines.add(p.optString("code"));lines.add("Bàn: "+p.optString("table"));
        JSONArray items=p.optJSONArray("items");if(items!=null)for(int i=0;i<items.length();i++){JSONObject item=items.optJSONObject(i);if(item!=null){int qty=item.optInt("qty",1),price=item.optInt("price");lines.add(qty+" × "+item.optString("name"));if(!item.optString("nameCn").isEmpty())lines.add(item.optString("nameCn"));String m=PrintText.modifiers(item.optJSONObject("mods"));if(!m.isEmpty())lines.add("  "+m);if(!"PHIẾU BẾP".equals(title))lines.add("  "+price+" × "+qty+" = "+(price*qty)+" đ");}}
        if(!"PHIẾU BẾP".equals(title)){lines.add("Tạm tính: "+p.optInt("subtotal")+" đ");lines.add("Voucher/giảm: -"+p.optInt("discount")+" đ");lines.add("Thuế "+p.optString("taxMode","INCLUSIVE")+": "+p.optInt("taxAmount")+" đ");lines.add("TỔNG: "+p.optInt("total")+" đ");lines.add("Thanh toán: "+p.optString("paymentMethod"));if("CASH".equals(p.optString("paymentMethod"))){lines.add("Đã nhận: "+p.optInt("cashReceived")+" đ");lines.add("Tiền thối: "+p.optInt("cashChange")+" đ");}if(!p.optString("memberName").isEmpty())lines.add("Hội viên: "+p.optString("memberName"));lines.add(p.optString("paidAt"));lines.add("Xin cảm ơn quý khách!");}
        lines.add(" ");lines.add(" ");
        Paint paint=new Paint(3);paint.setColor(Color.BLACK);paint.setTextSize(30);java.util.ArrayList<String> wrapped=new java.util.ArrayList<>();for(String line:lines)wrapped.addAll(wrapText(line,paint,width-32));
        if(wrapped.size()*42+24>4000)throw new IllegalArgumentException("Ticket exceeds 4000 raster rows; split or shorten items");Bitmap image=Bitmap.createBitmap(width,Math.max(120,wrapped.size()*42+24),Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(image);canvas.drawColor(Color.WHITE);int y=40;for(String line:wrapped){canvas.drawText(line,16,y,paint);y+=42;}return image;
    }
    private byte[] escpos(Bitmap image,boolean cut)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(new byte[]{27,64});int bytesPerRow=(image.getWidth()+7)/8;int y=0;while(y<image.getHeight()){int h=Math.min(128,image.getHeight()-y);out.write(new byte[]{29,118,48,0,(byte)bytesPerRow,(byte)(bytesPerRow>>8),(byte)h,(byte)(h>>8)});out.write(raster(image,y,h));y+=h;}out.write(new byte[]{10,10,10});if(cut)out.write(PrintFlow.cut());image.recycle();return out.toByteArray();}
    private byte[] raster(Bitmap image,int start,int rows){int width=image.getWidth(),stride=(width+7)/8;byte[] bits=new byte[stride*rows];for(int y=0;y<rows;y++)for(int x=0;x<width;x++){int pixel=image.getPixel(x,start+y);int lum=(Color.red(pixel)*299+Color.green(pixel)*587+Color.blue(pixel)*114)/1000;if(lum<140)bits[y*stride+(x>>3)]|=128>>(x&7);}return bits;}
    private byte[] tspl(JSONObject p)throws Exception{int dpi=config.number("labelDpi",203),widthMm=config.number("labelWidth",38),heightMm=config.number("labelHeight",40),gap=config.number("labelGap",2),speed=config.number("labelSpeed",5);if(dpi<150||dpi>600||widthMm<25||widthMm>110||heightMm<20||heightMm>120)throw new Exception("Invalid label dimensions/DPI");int width=((widthMm*dpi/25)/8)*8,height=Math.min(1000,heightMm*dpi/25);Bitmap image=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(image);canvas.drawColor(Color.WHITE);Paint pen=new Paint(3);pen.setColor(Color.BLACK);String text=p.optString("code")+" · "+p.optString("table")+"\n"+p.optString("name")+"\n"+p.optString("nameCn")+"\n"+p.optString("note");java.util.ArrayList<String> lines=null;int font=Math.max(16,dpi/9),lineHeight=0;for(;font>=12;font--){pen.setTextSize(font);lineHeight=font+5;lines=wrapText(text,pen,width-16);if(lines.size()*lineHeight<=height-16)break;}if(font<12){image.recycle();throw new Exception("Nội dung vượt khổ tem; tăng khổ tem hoặc rút ngắn ghi chú");}int y=8+font;for(String line:lines){canvas.drawText(line,8,y,pen);y+=lineHeight;}
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(("SIZE "+widthMm+" mm,"+heightMm+" mm\r\nGAP "+gap+" mm,0 mm\r\nSPEED "+speed+"\r\nDIRECTION 0\r\nCLS\r\nBITMAP 0,0,"+(width/8)+","+height+",0,").getBytes(StandardCharsets.US_ASCII));out.write(raster(image,0,height));out.write("\r\nPRINT 1,1\r\n".getBytes(StandardCharsets.US_ASCII));image.recycle();return out.toByteArray();}
}
