package vn.lotusai.pos.cloudpilot;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.net.Inet4Address;

/** Internet follows Android's default route; the kitchen printer always uses Wi-Fi. */
public final class CloudNetwork {
    private CloudNetwork() {}

    public static Network wifi(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return null;
        Network fallback = null;
        for (Network network : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            if (fallback == null) fallback = network;
            LinkProperties props = cm.getLinkProperties(network);
            if (props == null) continue;
            for (LinkAddress address : props.getLinkAddresses()) {
                if (address.getAddress() instanceof Inet4Address &&
                    EscPosTransport.privateIp(address.getAddress().getHostAddress())) return network;
            }
        }
        return fallback;
    }

    public static String status(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return "Không đọc được trạng thái mạng";
        Network internet = cm.getActiveNetwork();
        NetworkCapabilities caps = internet == null ? null : cm.getNetworkCapabilities(internet);
        String route = caps == null ? "Chưa có mạng mặc định" :
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "Wi-Fi" :
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "4G/5G" : "Mạng khác";
        boolean validated = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        Network wifi = wifi(context);
        String wifiAddress = "không thấy Wi-Fi";
        if (wifi != null) {
            wifiAddress = "đã kết nối";
            LinkProperties props = cm.getLinkProperties(wifi);
            if (props != null) for (LinkAddress address : props.getLinkAddresses()) {
                if (address.getAddress() instanceof Inet4Address) {
                    wifiAddress = address.getAddress().getHostAddress();
                    break;
                }
            }
        }
        return "Internet mặc định: " + route + (validated ? " · Android báo đã xác minh" : " · chưa xác minh") +
            "\nWi-Fi tới máy in bếp: " + wifiAddress +
            "\nSUNMI tích hợp in độc lập với Internet.";
    }
}
