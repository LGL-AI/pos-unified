package vn.lotusai.pos.counter;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.content.ContentValues;
import org.json.JSONArray;
import org.json.JSONObject;

final class JobStore extends SQLiteOpenHelper {
    JobStore(Context c,String serverSuffix){super(c,"counter_print_queue"+serverSuffix+".db",null,1);}
    @Override public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_attempt_at INTEGER, last_error TEXT)");}
    @Override public void onUpgrade(SQLiteDatabase db,int a,int b){}
    synchronized boolean add(String id,String kind,JSONObject payload){ContentValues v=new ContentValues();v.put("id",id);v.put("kind",kind);v.put("payload",payload.toString());v.put("status","PENDING");v.put("created_at",System.currentTimeMillis());return getWritableDatabase().insertWithOnConflict("jobs",null,v,SQLiteDatabase.CONFLICT_IGNORE)!=-1;}
    synchronized String status(String id){try(Cursor c=getReadableDatabase().rawQuery("SELECT status FROM jobs WHERE id=?",new String[]{id})){return c.moveToFirst()?c.getString(0):"MISSING";}}
    synchronized JSONObject payload(String id)throws Exception{try(Cursor c=getReadableDatabase().rawQuery("SELECT payload FROM jobs WHERE id=?",new String[]{id})){if(!c.moveToFirst())throw new Exception("Missing print job");return new JSONObject(c.getString(0));}}
    synchronized void state(String id,String state,String error){ContentValues v=new ContentValues();v.put("status",state);v.put("last_error",error);if("PRINTING".equals(state)){v.put("last_attempt_at",System.currentTimeMillis());getWritableDatabase().execSQL("UPDATE jobs SET attempt_count=attempt_count+1 WHERE id=?",new Object[]{id});}getWritableDatabase().update("jobs",v,"id=?",new String[]{id});}
    synchronized void updatePayload(String id,JSONObject payload){ContentValues v=new ContentValues();v.put("payload",payload.toString());getWritableDatabase().update("jobs",v,"id=?",new String[]{id});}
    synchronized void markInterrupted(){ContentValues v=new ContentValues();v.put("status","UNKNOWN");v.put("last_error","Interrupted during device write; check paper before retry");getWritableDatabase().update("jobs",v,"status='PRINTING'",null);}
    synchronized JSONArray list(){JSONArray a=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT id,kind,status,attempt_count,last_error FROM jobs ORDER BY created_at DESC LIMIT 100",null)){while(c.moveToNext()){JSONObject j=new JSONObject();try{j.put("id",c.getString(0));j.put("kind",c.getString(1));j.put("status",c.getString(2));j.put("attempts",c.getInt(3));j.put("error",c.getString(4));a.put(j);}catch(Exception ignored){}}}return a;}
}
