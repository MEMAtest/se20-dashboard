package com.mema.journey;

import android.Manifest;
import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Explicit foreground-only home estimate; no location is kept in widget storage. */
public final class HomeEstimateActivity extends Activity {
    private int id=-1;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private Future<?> work;
    private LocationManager locations;
    private LocationListener listener;
    private TextView status;
    private Button check;
    private boolean locating,busy;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); id=getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1);
        if(!DeparturesWidget.owns(this,id) || DeparturesWidget.kind(this,id)!=WidgetKind.HOME) { finish(); return; }
        WidgetStore store=new WidgetStore(this); boolean phone=store.read(id,"config").optBoolean("phone");
        LinearLayout root=NativeUi.column(this); int p=NativeUi.dp(this,22); root.setPadding(p,p,p,p);
        root.addView(NativeUi.text(this,"HOME / JOURNEY",12,0xff224ae7));
        root.addView(NativeUi.text(this,"To "+WidgetRenderer.stationName(store.station(id,"destination")),27,0xff11182c));
        root.addView(NativeUi.text(this,phone ? "Use your current phone position once to check a TfL route estimate. No background tracking. Coordinates are sent to TfL for this request, not stored in the widget." : "Check a route from your configured departure station. This does not use phone location.",15,0xff505d7a));
        status=NativeUi.text(this,"Tap below to check. Nothing has been requested yet.",15,0xff505d7a); root.addView(status);
        check=new Button(this); check.setText(phone ? "Use phone location & update" : "Update home estimate"); check.setOnClickListener(v -> startCheck()); root.addView(check);
        Button open=new Button(this); open.setText("Open full journey planner"); open.setOnClickListener(v -> startActivity(new Intent(this,MainActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id))); root.addView(open); setContentView(root);
    }
    private void startCheck() {
        if(busy || !DeparturesWidget.owns(this,id)) return;
        WidgetStore store=new WidgetStore(this);
        if(!store.read(id,"config").optBoolean("phone")) { Station origin=store.station(id,"station"); if(origin==null) { fail("Choose a departure station first."); return; } fetch(origin.lat,origin.lon,0); return; }
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},41); return;
        }
        busy=true; check.setEnabled(false); status.setText("Getting one fresh phone position..."); locations=getSystemService(LocationManager.class); locating=true;
        listener=new LocationListener() {
            @Override public void onLocationChanged(Location fix) {
                if(!locating) return;
                long age=SystemClock.elapsedRealtime()-fix.getElapsedRealtimeNanos()/1_000_000;
                if(!fix.hasAccuracy() || !WidgetData.validPhoneFix(fix.getLatitude(),fix.getLongitude(),fix.getAccuracy(),age)) return;
                stopLocation(); fetch(fix.getLatitude(),fix.getLongitude(),System.currentTimeMillis()-age);
            }
            @Override public void onProviderEnabled(String provider) { }
            @Override public void onProviderDisabled(String provider) { }
            @Override public void onStatusChanged(String provider,int status,Bundle extras) { }
        };
        try {
            boolean requested=false;
            for(String provider:new String[]{LocationManager.NETWORK_PROVIDER,LocationManager.GPS_PROVIDER}) if(locations.isProviderEnabled(provider)) { locations.requestLocationUpdates(provider,0,0,listener,Looper.getMainLooper()); requested=true; }
            if(!requested) { fail("Location is switched off. Turn it on, or configure a fixed starting station."); return; }
            handler.postDelayed(() -> { if(locating) fail("No sufficiently precise fresh fix. Retry outside or use a fixed station. Home was not substituted."); },12000);
        } catch(SecurityException e) { fail("Location permission unavailable. Choose a fixed station instead."); }
    }
    private void fetch(double lat,double lon,long locationAt) {
        if(isFinishing() || isDestroyed()) return;
        busy=true; check.setEnabled(false); status.setText("Checking TfL journey estimates...");
        WidgetStore store=new WidgetStore(this); long now=System.currentTimeMillis(), attempt=store.prefs.getLong(id+":attempt",0);
        if(now>=attempt && now-attempt<30_000) { busy=false; check.setEnabled(true); status.setText("Please wait 30 seconds between checks. The previous result keeps its original check time."); return; }
        store.prefs.edit().putLong(id+":attempt",now).apply();
        String config=store.read(id,"config").toString(); Station destination=store.station(id,"destination");
        work=executor.submit(() -> {
            try {
                org.json.JSONObject result=new TflClient().journey(lat,lon,destination); if(locationAt>0) result.put("locationAt",locationAt);
                runOnUiThread(() -> {
                    if(isDestroyed() || isFinishing() || !DeparturesWidget.owns(this,id) || !config.equals(store.read(id,"config").toString())) return;
                    store.prefs.edit().putString(id+":snapshot",result.toString()).remove(id+":error").apply(); DeparturesWidget.render(this,id);
                    busy=false; check.setEnabled(true); status.setText("Widget updated: "+WidgetData.minutes(result.optLong("arrivalAt")-result.optLong("checkedAt"))+" minute estimate from the check time, including waiting. Checked "+WidgetData.checked(result.optLong("checkedAt"))+" London. Open the planner to confirm the full route before travel.");
                });
            } catch(Exception e) { runOnUiThread(() -> { if(!isDestroyed() && !isFinishing() && config.equals(store.read(id,"config").toString())) fail("TfL estimate unavailable. No new time was published; retry or open the full planner."); }); }
        });
    }
    private void stopLocation() { locating=false; handler.removeCallbacksAndMessages(null); if(locations!=null && listener!=null) try { locations.removeUpdates(listener); } catch(SecurityException ignored) { } listener=null; }
    private void fail(String message) {
        stopLocation(); busy=false; if(check!=null) check.setEnabled(true); if(status!=null) status.setText(message);
        if(DeparturesWidget.owns(this,id)) { new WidgetStore(this).prefs.edit().putString(id+":error","HOME_CHECK_UNAVAILABLE").apply(); DeparturesWidget.render(this,id); }
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants) {
        super.onRequestPermissionsResult(code,permissions,grants); if(code!=41) return;
        boolean granted=false; for(int grant:grants) if(grant==PackageManager.PERMISSION_GRANTED) granted=true;
        if(granted) startCheck(); else fail("Location permission denied. Configure a fixed station instead; no Home or stale position was substituted.");
    }
    @Override protected void onStop() { if(locating) { stopLocation(); busy=false; check.setEnabled(true); status.setText("Location stopped while the app was not visible. Tap to retry."); } super.onStop(); }
    @Override public void onDestroy() { stopLocation(); if(work!=null) work.cancel(true); executor.shutdownNow(); super.onDestroy(); }
}
