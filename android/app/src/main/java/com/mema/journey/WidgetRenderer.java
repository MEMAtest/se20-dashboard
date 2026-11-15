package com.mema.journey;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class WidgetRenderer {
    static String stationName(Station station) { return station == null ? "Choose a station" : station.name.replaceAll(" (Underground|Rail|DLR) Station$| Tram Stop$", ""); }
    static String stamp(JSONObject snapshot, String error, long now) {
        long at = snapshot.optLong("checkedAt");
        String time = at > 0 && at <= now + 30_000 ? WidgetData.shortChecked(at) : "No update yet";
        return (!error.isEmpty() ? "Failed / " : !WidgetData.fresh(snapshot, now) && at > 0 ? "Old / " : at > 0 ? "As of " : "") + time;
    }
    static RemoteViews create(Context c, int id, WidgetKind kind, int width, int height, long now) {
        if (kind == WidgetKind.BOARD) return DeparturesWidget.boardViews(c, id, now);
        WidgetStore store = new WidgetStore(c); JSONObject config = store.read(id, "config"), snapshot = store.read(id, "snapshot");
        Station origin = store.station(id, "station"), destination = store.station(id, "destination");
        String error = store.prefs.getString(id + ":error", ""); float font = c.getResources().getConfiguration().fontScale;
        boolean tiny = kind == WidgetKind.LINE ? width < 145 || height < 70 : width < 145 || height < 145 || font > 1.2f;
        boolean flatRoute = kind == WidgetKind.ROUTE && (height < 150 || (font > 1.2f && height < 200));
        int layout = kind == WidgetKind.NEXT ? R.layout.widget_next : kind == WidgetKind.HOME ? R.layout.widget_home : kind == WidgetKind.LINE ? R.layout.widget_line : flatRoute ? R.layout.widget_route_compact : R.layout.widget_route;
        RemoteViews v = new RemoteViews(c.getPackageName(), layout);
        boolean configured = store.configured(id, kind), fresh = WidgetData.fresh(snapshot, now) && error.isEmpty();
        v.setOnClickPendingIntent(R.id.compact_root, DeparturesWidget.activity(c, id, configured ? MainActivity.class : WidgetConfigActivity.class));
        if (kind != WidgetKind.HOME) {
            v.setTextViewText(R.id.compact_meta, stamp(snapshot, error, now));
            v.setContentDescription(R.id.compact_meta, "TfL snapshot: " + (snapshot.optLong("checkedAt") > 0 ? WidgetData.checked(snapshot.optLong("checkedAt")) + " London. Refresh before travel." : "not yet verified."));
        }
        if (kind == WidgetKind.HOME) {
            v.setTextViewText(R.id.compact_title, "GO HOME");
            v.setTextViewText(R.id.compact_value, destination == null ? "Choose home" : stationName(destination));
            v.setTextViewText(R.id.compact_subtitle, config.optBoolean("phone") ? "From phone, on tap" : "From " + stationName(origin));
            if (height < 80 || font > 1.2f) { v.setViewPadding(R.id.compact_root,dp(c,10),dp(c,4),dp(c,10),dp(c,4)); v.setViewVisibility(R.id.compact_title, View.GONE); v.setTextViewTextSize(R.id.compact_value, TypedValue.COMPLEX_UNIT_SP, 15); v.setTextViewTextSize(R.id.compact_subtitle, TypedValue.COMPLEX_UNIT_SP, 10); }
            v.setContentDescription(R.id.compact_root, "Plan home to " + stationName(destination) + (config.optBoolean("phone") ? ". Phone location is requested only after you open Journey and find a route." : " from " + stationName(origin)));
            return v;
        }
        if (!flatRoute) v.setOnClickPendingIntent(R.id.compact_refresh, DeparturesWidget.refresh(c, id));
        if (kind == WidgetKind.NEXT) {
            v.setOnClickPendingIntent(R.id.compact_root, configured ? DeparturesWidget.refresh(c, id) : DeparturesWidget.activity(c, id, WidgetConfigActivity.class));
            v.setOnClickPendingIntent(R.id.compact_title, DeparturesWidget.activity(c, id, MainActivity.class));
            v.setTextViewText(R.id.compact_title, tiny ? stationName(origin) : "NEXT / " + stationName(origin));
            JSONArray ids = snapshot.optJSONArray("ids"), rows = snapshot.optJSONArray("arrivals"); Set<String> allowed = new HashSet<>();
            if (ids != null) for (int i = 0; i < ids.length(); i++) allowed.add(ids.optString(i));
            List<WidgetData.Departure> departures = rows == null ? java.util.Collections.emptyList() : WidgetData.departures(rows, allowed, now);
            WidgetData.Departure next = fresh && !departures.isEmpty() ? departures.get(0) : null;
            v.setTextViewText(R.id.compact_value, next == null ? "--:--" : WidgetData.clock(next.at()));
            v.setTextViewText(R.id.compact_subtitle, next != null ? next.destination() : !configured ? "Choose your station" : !fresh ? "Tap to refresh" : "No TfL departures");
            v.setTextViewText(R.id.compact_extra, next == null ? "Not all National Rail services" : next.line() + (next.platform().isEmpty() ? "" : " / " + next.platform()));
            v.setContentDescription(R.id.compact_root, "Next departures at " + stationName(origin) + ". " + (next == null ? "No current verified departure." : WidgetData.clock(next.at()) + " " + next.line() + " to " + next.destination()) + ". Tap to refresh; long-press to reconfigure.");
            if (tiny) {
                v.setViewPadding(R.id.compact_root, dp(c,6), dp(c,6), dp(c,6), dp(c,6)); v.setViewVisibility(R.id.compact_refresh, View.GONE); v.setViewVisibility(R.id.compact_extra, View.GONE);
                v.setTextViewTextSize(R.id.compact_title,TypedValue.COMPLEX_UNIT_SP,11); v.setTextViewTextSize(R.id.compact_meta,TypedValue.COMPLEX_UNIT_SP,9);
                v.setViewPadding(R.id.compact_meta,0,dp(c,2),0,0);
                v.setTextViewTextSize(R.id.compact_value, TypedValue.COMPLEX_UNIT_SP, font > 1.2f ? 22 : 24); v.setInt(R.id.compact_subtitle, "setMaxLines", 1); v.setTextViewTextSize(R.id.compact_subtitle, TypedValue.COMPLEX_UNIT_SP, 11);
                v.setInt(R.id.compact_meta, "setMaxLines", 1);
            }
        } else if (kind == WidgetKind.LINE) {
            String lineId = config.optString("lineId"); String[] line = WidgetData.line(lineId);
            v.setTextViewText(R.id.compact_title, line == null ? "Line watch" : line[1]);
            boolean verified = fresh && lineId.equals(snapshot.optString("lineId")) && !snapshot.optString("status").isEmpty();
            String value = verified ? snapshot.optString("status") : !configured ? "Choose a line" : "Tap to check";
            if (tiny && verified) value = snapshot.optBoolean("good") ? "Good service" : "Disruption";
            v.setTextViewText(R.id.compact_value, value);
            v.setInt(R.id.compact_value, "setTextColor", verified && !snapshot.optBoolean("good") ? 0xff9a4d00 : 0xff244268);
            v.setInt(R.id.line_colour, "setBackgroundColor", line == null ? 0xff6d7780 : Color.parseColor(line[2]));
            v.setContentDescription(R.id.compact_root, (line == null ? "Line watch" : line[1]) + ": " + (verified ? snapshot.optString("status") : "status not currently verified") + ". Tap for line details.");
            v.setInt(R.id.compact_value,"setMaxLines",1);
            if (tiny) {
                v.setViewVisibility(R.id.compact_refresh, View.GONE); v.setViewPadding(R.id.compact_root,dp(c,8),dp(c,2),dp(c,8),dp(c,2));
                v.setTextViewTextSize(R.id.compact_title,TypedValue.COMPLEX_UNIT_SP,font > 1.2f ? 10 : 11); v.setTextViewTextSize(R.id.compact_value,TypedValue.COMPLEX_UNIT_SP,font > 1.2f ? 10 : 11); v.setTextViewTextSize(R.id.compact_meta,TypedValue.COMPLEX_UNIT_SP,font > 1.2f ? 8 : 9);
            }
        } else {
            v.setTextViewText(R.id.compact_title, stationName(origin) + " \u2192 " + stationName(destination));
            long departure = snapshot.optLong("departureAt"), arrival = snapshot.optLong("arrivalAt");
            boolean valid = fresh && departure >= now && arrival > departure;
            if (flatRoute) {
                v.setTextViewText(R.id.compact_value, valid ? WidgetData.clock(departure) + " \u2192 " + WidgetData.clock(arrival) : "Tap to refresh route");
                v.setOnClickPendingIntent(R.id.compact_root, configured ? DeparturesWidget.refresh(c, id) : DeparturesWidget.activity(c, id, WidgetConfigActivity.class));
                v.setOnClickPendingIntent(R.id.compact_title, DeparturesWidget.activity(c, id, MainActivity.class));
                if (width < 280 || font > 1.2f) v.setTextViewTextSize(R.id.compact_value,TypedValue.COMPLEX_UNIT_SP,16);
            } else {
                v.setTextViewText(R.id.route_departure, valid ? WidgetData.clock(departure) : "--:--"); v.setTextViewText(R.id.route_arrival, valid ? WidgetData.clock(arrival) : "--:--");
                v.setTextViewText(R.id.compact_subtitle, valid ? snapshot.optString("summary", "Open Journey for the route") : "Refresh for a checked route estimate");
            }
            v.setContentDescription(R.id.compact_root, "Journey from " + stationName(origin) + " to " + stationName(destination) + ". " + (valid ? "Leave " + WidgetData.clock(departure) + ", arrive " + WidgetData.clock(arrival) + ". " + snapshot.optString("summary") : "Refresh for a current estimate.") + " Times include walking and transfers; estimates, not guaranteed connections.");
        }
        return v;
    }
    static int dp(Context c, int n) { return Math.round(c.getResources().getDisplayMetrics().density * n); }
}
