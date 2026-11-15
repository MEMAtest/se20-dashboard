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

public class DeparturesWidget extends AppWidgetProvider {
    static final String REFRESH = "com.mema.journey.REFRESH";
    static final java.util.List<Class<? extends DeparturesWidget>> PROVIDERS = java.util.Arrays.asList(NextUpWidget.class, HomeWidget.class, JourneyWidget.class, LineWatchWidget.class, DeparturesWidget.class);
    static int[] ids(Context c) {
        java.util.List<Integer> ids = new java.util.ArrayList<>();
        for (Class<?> type : PROVIDERS) for (int id : AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, type))) ids.add(id);
        int[] result = new int[ids.size()]; for (int i = 0; i < result.length; i++) result[i] = ids.get(i); return result;
    }
    static WidgetKind kind(Context c, int id) {
        android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(c).getAppWidgetInfo(id);
        return info == null ? WidgetKind.BOARD : WidgetKind.provider(info.provider.getClassName());
    }
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
    static PendingIntent refresh(Context c, int id) {
        android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(c).getAppWidgetInfo(id);
        Intent intent = new Intent().setComponent(info == null ? new ComponentName(c, DeparturesWidget.class) : info.provider).setAction(REFRESH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(Uri.parse("journey-widget://refresh/" + id));
        return PendingIntent.getBroadcast(c,id,intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static RemoteViews views(Context c, int id, long now) {
        Bundle options = AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
        return WidgetRenderer.create(c,id,kind(c,id),options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,180),options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,170),now);
    }
    static RemoteViews boardViews(Context c, int id, long now) {
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
    static void render(Context c, int id) {
        WidgetKind kind = kind(c,id); long now = System.currentTimeMillis(); RemoteViews view = views(c,id,now);
        if (android.os.Build.VERSION.SDK_INT >= 31 && kind != WidgetKind.BOARD) {
            java.util.Map<android.util.SizeF,RemoteViews> sizes = new java.util.LinkedHashMap<>();
            int[][] bounds = kind == WidgetKind.NEXT ? new int[][]{{110,110},{170,170},{300,170}} : kind == WidgetKind.ROUTE ? new int[][]{{250,110},{300,170},{300,220}} : new int[][]{{110,56},{180,90},{300,90}};
            for (int[] b : bounds) sizes.put(new android.util.SizeF(b[0],b[1]),WidgetRenderer.create(c,id,kind,b[0],b[1],now));
            view = new RemoteViews(sizes);
        }
        AppWidgetManager.getInstance(c).updateAppWidget(id,view);
    }
}
