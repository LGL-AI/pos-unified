package vn.lotusai.pos.counter;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

// Host-side fake USB ports. The Android Settings simulator renders real
// ESC/POS rasters and TSPL bytes without sending them to a physical device.
public final class PrintFlowSimulation {
    private static byte[] paper(String title)throws Exception{
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(new byte[]{27,64});
        out.write(title.getBytes(StandardCharsets.UTF_8));out.write(new byte[]{10,10,10});out.write(PrintFlow.cut());return out.toByteArray();
    }
    private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        List<String> events=new ArrayList<>();
        boolean sent=PrintFlow.afterPayment(
            ()->events.add("USB tem: TSPL PRINT 1,1"),
            ()->{byte[] bytes=paper("PHIEU BEP");check(PrintFlow.endsWithCut(bytes),"Kitchen cut missing");events.add("USB hóa đơn: phiếu bếp → GS V A 0 (cắt rời)");return true;},
            ()->{byte[] bytes=paper("HOA DON");check(PrintFlow.endsWithCut(bytes),"Receipt cut missing");events.add("USB hóa đơn: hóa đơn → GS V A 0 (cắt rời)");}
        );
        check(sent&&events.equals(Arrays.asList("USB tem: TSPL PRINT 1,1","USB hóa đơn: phiếu bếp → GS V A 0 (cắt rời)","USB hóa đơn: hóa đơn → GS V A 0 (cắt rời)")),"Wrong port/order");
        System.out.println("PAID, máy in giả lập kết nối:");for(String event:events)System.out.println("  "+event);

        events.clear();
        sent=PrintFlow.afterPayment(
            ()->events.add("USB tem: chưa kết nối → job FAILED"),
            ()->{events.add("USB hóa đơn: chưa kết nối → phiếu bếp FAILED");return false;},
            ()->events.add("KHÔNG ĐƯỢC GỬI HÓA ĐƠN")
        );
        check(!sent&&events.size()==2,"Receipt must wait for a successfully cut kitchen ticket");
        System.out.println("PAID, máy in chưa kết nối:");for(String event:events)System.out.println("  "+event);
        System.out.println("  Hóa đơn được giữ lại, nhân viên kiểm tra hàng đợi trước khi thử in lại.");
    }
}
