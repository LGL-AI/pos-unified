package vn.lotusai.pos.cloudpilot;

import android.graphics.*;
import android.text.*;
import org.json.*;

/** Android font fallback supplies Vietnamese and Chinese; printer code pages are not used. */
public final class TicketBitmap {
    public static Bitmap render(JSONObject p,int width,boolean receipt) throws Exception {
        StringBuilder t=new StringBuilder();
        if(p.optBoolean("reprint"))t.append("*** IN LẠI / 重印 ***\n");
        t.append(receipt?"HÓA ĐƠN / 收款小票":"PHIẾU BẾP / 厨房单").append('\n');
        t.append(p.optString("storeName","PHÁT TÀI POS")).append('\n');
        if(receipt&&!p.optString("address").isEmpty())t.append(p.optString("address")).append('\n');
        if(receipt&&!p.optString("taxNumber").isEmpty())t.append("MST: ").append(p.optString("taxNumber")).append('\n');
        t.append("BÀN / 桌: ").append(p.optString("table")).append('\n');
        t.append("Đơn / 订单: ").append(p.optString("orderCode")).append('\n');
        if(!receipt)t.append(p.optString("kind")).append(" · lần / 次 ").append(p.optInt("revision",1)).append('\n');
        t.append(p.optString("createdAt",p.optString("paidAt"))).append('\n');
        if(!p.optString("jobId").isEmpty())t.append("ID: ").append(p.optString("jobId")).append('\n');
        if(!p.optString("reason").isEmpty())t.append("Lý do / 原因: ").append(p.optString("reason")).append('\n');
        t.append("--------------------------------\n");
        JSONArray items=p.optJSONArray("items");
        if(items!=null)for(int i=0;i<items.length();i++){
            JSONObject x=items.getJSONObject(i);
            t.append(x.optInt("qty",1)).append(" × ").append(x.optString("name")).append('\n');
            if(!x.optString("nameCn").isEmpty())t.append(x.optString("nameCn")).append('\n');
            if(!x.optString("mods").isEmpty())t.append("  ").append(x.optString("mods")).append('\n');
            if(receipt)t.append(MainActivity.money(Math.round(x.optDouble("price")*x.optInt("qty",1)))).append(" đ\n");
            t.append("--------------------------------\n");
        }
        if(receipt){
            t.append("Tạm tính / 小计: ").append(MainActivity.money(Math.round(p.optDouble("subtotal")))).append('\n');
            t.append("Giảm / 优惠: ").append(MainActivity.money(Math.round(p.optDouble("discount")))).append('\n');
            if(p.optLong("taxAmount")>0)t.append("EXCLUSIVE".equals(p.optString("taxMode"))?"Thuế cộng thêm / 税: ":"Thuế đã gồm / 税: ").append(MainActivity.money(p.optLong("taxAmount"))).append('\n');
            t.append("TỔNG / 合计: ").append(MainActivity.money(Math.round(p.optDouble("total")))).append(" đ\n");
            if(p.optLong("refundedAmount")>0)t.append("ĐÃ HOÀN / 已退款: −").append(MainActivity.money(p.optLong("refundedAmount"))).append(" đ\n");
            t.append("Thanh toán / 支付: ").append(p.optString("paymentMethod")).append('\n');
            if("CASH".equals(p.optString("paymentMethod"))){
                t.append("Khách đưa / 实收: ").append(MainActivity.money(Math.round(p.optDouble("received")))).append('\n');
                t.append("Tiền thối / 找零: ").append(MainActivity.money(Math.round(p.optDouble("change")))).append('\n');
            }
            t.append("Biên nhận nội bộ, không thay hóa đơn VAT\n");
        }else t.append("CHƯA PHẢI HÓA ĐƠN THANH TOÁN\n非付款凭证\n");
        return renderText(t.toString(),width);
    }
    public static Bitmap renderText(String t,int width)throws Exception{
        TextPaint paint=new TextPaint(Paint.ANTI_ALIAS_FLAG);paint.setColor(Color.BLACK);
        paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));paint.setTextSize(width==384?23:28);
        StaticLayout layout=StaticLayout.Builder.obtain(t,0,t.length(),paint,width-24)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(4,1).setIncludePad(true).build();
        if(layout.getHeight()>12000)throw new Exception("TICKET_TOO_LONG: Phiếu quá dài, cần chia nhỏ");
        Bitmap b=Bitmap.createBitmap(width,layout.getHeight()+24,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(b);canvas.drawColor(Color.WHITE);canvas.translate(12,12);layout.draw(canvas);return b;
    }
}
