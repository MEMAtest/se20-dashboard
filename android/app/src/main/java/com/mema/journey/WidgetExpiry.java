package com.mema.journey;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import org.json.JSONObject;

/** One local invalidation per snapshot, never a provider poll or wake-up alarm. */
public final class WidgetExpiry extends BroadcastReceiver {
    static PendingIntent intent(Context c,int id) {
        return PendingIntent.getBroadcast(c,id,new Intent(c,WidgetExpiry.class).setData(Uri.parse("journey-widget://expiry/"+id)).putExtra("widget",id),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void cancel(Context c,int id) { c.getSystemService(AlarmManager.class).cancel(intent(c,id)); }
    static void schedule(Context c,int id,long now) {
        cancel(c,id); if(!DeparturesWidget.owns(c,id)) return;
        JSONObject snapshot=new WidgetStore(c).read(id,"snapshot"); long expires=WidgetData.expiresAt(snapshot);
        long departure=snapshot.optLong("departureAt"); if(departure>now) expires=Math.min(expires,departure+1);
        org.json.JSONArray rows=snapshot.optJSONArray("arrivals"), ids=snapshot.optJSONArray("ids"); java.util.Set<String> allowed=new java.util.HashSet<>();
        if(ids!=null) for(int i=0;i<ids.length();i++) allowed.add(ids.optString(i));
        if(rows!=null) { java.util.List<WidgetData.Departure> next=WidgetData.allDepartures(rows,allowed,now); if(!next.isEmpty()) expires=Math.min(expires,next.get(0).at()+1); }
        if(snapshot.optLong("locationAt")>0) expires=Math.min(expires,snapshot.optLong("locationAt")+180_000);
        if(expires>now && expires<=now+180_000) c.getSystemService(AlarmManager.class).set(AlarmManager.ELAPSED_REALTIME,SystemClock.elapsedRealtime()+expires-now,intent(c,id));
    }
    @Override public void onReceive(Context c,Intent intent) {
        int id=intent.getIntExtra("widget",-1);
        if(DeparturesWidget.owns(c,id)) DeparturesWidget.render(c,id);
    }
}
