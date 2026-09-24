package vn.lotusai.pos.cloudpilot;

import android.net.Network;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;

/** Raw TCP is delivery to a socket, NOT acknowledgement that paper was printed. */
public final class EscPosTransport {
    public interface BeforeWrite { void run() throws IOException; }
    public static boolean privateIp(String ip) {
        if(ip==null || !ip.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}"))return false;
        String[] p=ip.split("\\.");int[] n=new int[4];
        for(int i=0;i<4;i++){n[i]=Integer.parseInt(p[i]);if(n[i]>255)return false;}
        return n[0]==10 || (n[0]==172&&n[1]>=16&&n[1]<=31) || (n[0]==192&&n[1]==168);
    }
    public static void send(String ip,int port,byte[] bytes,BeforeWrite beforeWrite) throws IOException {
        if(!privateIp(ip)||port<1||port>65535)throw new IOException("LAN-001: IP LAN hoặc cổng không hợp lệ");
        sendValidated(ip,port,bytes,beforeWrite);
    }
    public static void send(Network wifi,String ip,int port,byte[] bytes,BeforeWrite beforeWrite) throws IOException {
        if(wifi==null)throw new IOException("LAN-011: Chưa có Wi-Fi quán để tới máy bếp; 4G không thay được mạng LAN");
        if(!privateIp(ip)||port<1||port>65535)throw new IOException("LAN-001: IP LAN hoặc cổng không hợp lệ");
        sendValidated(wifi.getSocketFactory().createSocket(),ip,port,bytes,beforeWrite);
    }
    static void sendValidated(String ip,int port,byte[] bytes,BeforeWrite beforeWrite) throws IOException {
        sendValidated(new Socket(),ip,port,bytes,beforeWrite);
    }
    static void sendValidated(Socket socket,String ip,int port,byte[] bytes,BeforeWrite beforeWrite) throws IOException {
        ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
        timer.schedule(()->{try{socket.close();}catch(IOException ignored){}},15,TimeUnit.SECONDS);
        try {
            socket.connect(new InetSocketAddress(ip,port),3000);
            socket.setSoTimeout(1200);
            // Status query is optional: many clones do not answer. Never require ACK support.
            try {
                socket.getOutputStream().write(new byte[]{0x10,0x04,0x04});
                socket.getOutputStream().flush();
                int status=socket.getInputStream().read();
                if(status>=0&&(status&0x93)==0x12&&(status&0x60)!=0)
                    throw new IOException("LAN-004: Máy in báo hết giấy");
            } catch(SocketTimeoutException ignored) { }
            beforeWrite.run(); // persist uncertain state BEFORE first printable byte
            OutputStream out=socket.getOutputStream();
            for(int off=0;off<bytes.length;off+=4096)out.write(bytes,off,Math.min(4096,bytes.length-off));
            out.flush();
        } finally {try{socket.close();}finally{timer.shutdownNow();}}
    }
    public static byte[] raster(int width,int height,int[] pixels,boolean cut) throws IOException {
        if(width<=0||width%8!=0||height<=0||pixels.length!=width*height)throw new IOException("RASTER_SIZE");
        return rasterRows(width,height,(start,rows,dest)->System.arraycopy(pixels,start*width,dest,0,rows*width),cut);
    }
    public interface Rows {void read(int start,int rows,int[] dest);}
    public static byte[] rasterRows(int width,int height,Rows source,boolean cut)throws IOException {
        if(width<=0||width%8!=0||height<=0)throw new IOException("RASTER_SIZE");
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        out.write(new byte[]{27,64,27,97,0});
        int stride=width/8;
        int[] pixels=new int[width*128];
        for(int start=0;start<height;start+=128){
            int rows=Math.min(128,height-start);
            source.read(start,rows,pixels);
            out.write(new byte[]{29,118,48,0,(byte)stride,(byte)(stride>>8),(byte)rows,(byte)(rows>>8)});
            for(int y=0;y<rows;y++)for(int x=0;x<width;x+=8){
                int bits=0;
                for(int bit=0;bit<8;bit++){
                    int c=pixels[y*width+x+bit];
                    int luminance=(((c>>16)&255)*299+((c>>8)&255)*587+(c&255)*114)/1000;
                    if(luminance<180)bits|=128>>bit;
                }
                out.write(bits);
            }
        }
        out.write(new byte[]{27,100,4});
        if(cut)out.write(new byte[]{29,86,1});
        return out.toByteArray();
    }
}
