package vn.lotusai.pos.counter;

import android.content.pm.ActivityInfo;

final class LayoutProfiles {
    static final String DEFAULT="landscape-standard";
    static final String[] IDS={
        "portrait-compact","portrait-standard","portrait-large",
        "landscape-compact","landscape-standard","landscape-large"
    };
    static final String[] LABELS={
        "Dọc gọn · 720 × 1280", "Dọc vừa · 800 × 1280", "Dọc rộng · 1080 × 1920",
        "Ngang gọn · 1280 × 720", "Ngang vừa · 1280 × 800", "Ngang rộng · 1920 × 1080"
    };
    static boolean valid(String id){for(String value:IDS)if(value.equals(id))return true;return false;}
    static int orientation(String id){return id.startsWith("portrait-")?ActivityInfo.SCREEN_ORIENTATION_PORTRAIT:ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;}
    private LayoutProfiles(){}
}
