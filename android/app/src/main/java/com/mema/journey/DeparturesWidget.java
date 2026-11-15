package com.mema.journey;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

public final class DeparturesWidget extends AppWidgetProvider {
    static final String REFRESH = "com.mema.journey.REFRESH";
    static int[] ids(Context c) { return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, DeparturesWidget.class)); }
    static boolean owns(Context c, int id) { for (int value : ids(c)) if (value == id) return true; return false; }
    @Override public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) { render(c, id); WidgetRefreshService.schedule(c, id, false); WidgetRefreshService.schedule(c, id, true); }
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) { render(c, id); }
    @Override public void onDeleted(Context c, int[] ids) { for (int id : ids) { WidgetRefreshService.cancel(c, id); new WidgetStore(c).remove(id); } }
    @Override public void onRestored(Context c, int[] oldIds, int[] newIds) {
        for (int i = 0; i < oldIds.length; i++) { WidgetRefreshService.cancel(c, oldIds[i]); new WidgetStore(c).restore(oldIds[i], newIds[i]); }
    }
    @Override public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (REFRESH.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            if (owns(c, id)) WidgetRefreshService.schedule(c, id, true);
        }
    }
    static PendingIntent activity(Context c, int id, Class<?> type) {
        Intent intent = new Intent(c, type).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .setData(Uri.parse("journey-widget://" + type.getSimpleName() + "/" + id));
        return PendingIntent.getActivity(c, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static RemoteViews views(Context c, int id, long now) {
        WidgetStore store = new WidgetStore(c); Station station = store.station(id, "station"), destination = store.station(id, "destination");
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.departures_widget);
        v.setTextViewText(R.id.widget_station, station == null ? "Choose your station" : station.name);
        JSONObject snapshot = store.read(id, "snapshot"); JSONArray ids = snapshot.optJSONArray("ids"), rows = snapshot.optJSONArray("arrivals");
        Set<String> allowed = new HashSet<>();
        if (ids != null) for (int i = 0; i < ids.length(); i++) allowed.add(ids.optString(i));
        long checked = snapshot.optLong("checkedAt", 0);
        String error = store.prefs.getString(id + ":error", "");
        String checkedText = checked > 0 && checked <= now + 30_000
                ? "Snapshot " + WidgetData.checked(checked) + " London - refresh before travel"
                : "No verified update yet - tap Refresh";
        if (!error.isEmpty()) checkedText = (error.equals("RATE_LIMITED") ? "TfL rate limit" : "Update unavailable") + ". " + checkedText;
        v.setTextViewText(R.id.widget_departures, rows == null ? "Tap Refresh to check TfL departures." : WidgetData.departuresText(rows, allowed, now));
        v.setTextViewText(R.id.widget_checked, checkedText);
        v.setTextViewText(R.id.widget_alert, snapshot.optString("alert", "TfL only; National Rail coverage is limited"));
        v.setTextViewText(R.id.widget_route, destination == null ? "Open Journey" : "To " + destination.name);
        PendingIntent open = activity(c, id, MainActivity.class);
        v.setOnClickPendingIntent(R.id.widget_station, open); v.setOnClickPendingIntent(R.id.widget_route, open);
        v.setOnClickPendingIntent(R.id.widget_settings, activity(c, id, WidgetConfigActivity.class));
        Intent refresh = new Intent(c, DeparturesWidget.class).setAction(REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .setData(Uri.parse("journey-widget://refresh/" + id));
        v.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(c, id, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
    static void render(Context c, int id) { AppWidgetManager.getInstance(c).updateAppWidget(id, views(c, id, System.currentTimeMillis())); }
}
