package vn.lotusai.pos.counter;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.ArrayList;

final class PrintText {
    static String modifiers(JSONObject mods){
        if(mods==null)return "";
        ArrayList<String> parts=new ArrayList<>();
        for(String key:new String[]{"size","spice","note"}){String text=mods.optString(key,"").trim();if(!text.isEmpty())parts.add(text);}
        JSONObject options=mods.optJSONObject("options");
        if(options!=null){Iterator<String> groups=options.keys();while(groups.hasNext()){
            JSONArray values=options.optJSONArray(groups.next());if(values==null)continue;
            for(int i=0;i<values.length();i++){JSONObject item=values.optJSONObject(i);
                if(item==null){parts.add(values.optString(i));continue;}
                String name=item.optString("name",item.optString("code","")),zh=item.optString("nameCn","");
                parts.add(name+(zh.isEmpty()?"":" / "+zh));
            }
        }}
        StringBuilder out=new StringBuilder();for(String part:parts){if(out.length()>0)out.append(" · ");out.append(part);}return out.toString();
    }
    private PrintText(){}
}
