package com.mema.journey;

import android.app.Instrumentation;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONObject;

/** Bounded installed-runtime checks; this does not simulate a user's launcher/GPS acceptance. */
public final class DeviceChecks extends Instrumentation {
    private Bundle args;
    @Override public void onCreate(Bundle arguments) { args = arguments; start(); }
    private void require(boolean condition, String label) { if (!condition) throw new AssertionError(label); }
    @Override public void onStart() {
        Bundle result = new Bundle(); int id = 987654;
        try {
            Context c = getTargetContext(); WidgetStore store = new WidgetStore(c);
            Station a = new Station("910GANERLEY", "Anerley Rail Station", 51.412153, -.065886, "");
            Station b = new Station("HUBVIC", "Victoria", 51.496, -.144, "1000248");
            store.configure(id, a, b); require(store.station(id, "station").id.equals(a.id), "station persistence");
            require(store.station(id, "destination").id.equals(b.id), "destination persistence");
            require(store.station(id + 1, "station") == null, "widget isolation");
            require(MainActivity.trusted(Uri.parse(WidgetData.APP_URL)), "app origin");
            require(!MainActivity.trusted(Uri.parse("https://journey-london.ademola-584.workers.dev.evil.test/")), "host suffix rejected");
            require(!MainActivity.trusted(Uri.parse("http://journey-london.ademola-584.workers.dev/")), "cleartext rejected");
            require(!MainActivity.trusted(Uri.parse("https://user@journey-london.ademola-584.workers.dev/")), "userinfo rejected");
            PackageInfo info = c.getPackageManager().getPackageInfo(c.getPackageName(), PackageManager.GET_PERMISSIONS);
            for (String permission : info.requestedPermissions) require(!permission.equals("android.permission.ACCESS_BACKGROUND_LOCATION"), "no background location");
            runOnMainSync(() -> {
                android.view.View view = DeparturesWidget.views(c, id, System.currentTimeMillis()).apply(c, new FrameLayout(c));
                require(((TextView)view.findViewById(R.id.widget_station)).getText().toString().equals(a.name), "RemoteViews station");
                require(((TextView)view.findViewById(R.id.widget_checked)).getText().toString().contains("No verified update"), "honest no-data state");
                require(((TextView)view.findViewById(R.id.widget_route)).getText().toString().contains("Victoria"), "saved route CTA");
            });
            store.prefs.edit().putString(id + ":error", "RATE_LIMITED").apply();
            runOnMainSync(() -> {
                android.view.View view = DeparturesWidget.views(c, id, System.currentTimeMillis()).apply(c, new FrameLayout(c));
                require(((TextView)view.findViewById(R.id.widget_checked)).getText().toString().startsWith("TfL rate limit"), "source error retained");
            });
            if ("true".equals(args.getString("live"))) {
                Station live = "london-bridge".equals(args.getString("station")) ? new Station("940GZZLULNB", "London Bridge", 51.505881, -.086807, "1000139") : a;
                JSONObject snapshot = new TflClient().snapshot(live);
                require(snapshot.optLong("checkedAt") > System.currentTimeMillis() - 30_000, "real source timestamp");
                require(snapshot.optJSONArray("arrivals") != null, "real source array");
                result.putInt("providerReturnedRows", snapshot.getJSONArray("arrivals").length());
                result.putString("providerAlert", snapshot.optString("alert"));
                result.putString("providerStop", live.id);
                store.configure(id, live, b);
                store.prefs.edit().putString(id + ":snapshot", snapshot.toString()).remove(id + ":error").apply();
                if ("true".equals(args.getString("render"))) runOnMainSync(() -> {
                    try {
                        android.view.View view = DeparturesWidget.views(c, id, System.currentTimeMillis()).apply(c, new FrameLayout(c));
                        float density = c.getResources().getDisplayMetrics().density; int width = (int)(360 * density), height = (int)(300 * density);
                        view.measure(android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY)); view.layout(0, 0, width, height);
                        android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888); view.draw(new android.graphics.Canvas(bitmap));
                        java.io.File file = new java.io.File(c.getExternalFilesDir(null), "widget-runtime.png");
                        try (java.io.FileOutputStream stream = new java.io.FileOutputStream(file)) { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream); }
                        bitmap.recycle(); result.putString("nativeRender", file.getAbsolutePath());
                    } catch (Exception e) { throw new AssertionError(e); }
                });
            }
            result.putString("result", "PASS: 14 installed-runtime assertions; live=" + args.getString("live", "false"));
            store.remove(id); finish(0, result);
        } catch (Throwable error) { new WidgetStore(getTargetContext()).remove(id); result.putString("result", "FAIL " + error.getClass().getSimpleName() + ": " + error.getMessage()); finish(1, result); }
    }
}
