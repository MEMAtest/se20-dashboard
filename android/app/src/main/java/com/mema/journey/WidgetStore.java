package com.mema.journey;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

final class WidgetStore {
    final SharedPreferences prefs;
    WidgetStore(Context context) { prefs = context.getSharedPreferences("journey-widgets", Context.MODE_PRIVATE); }
    JSONObject read(int id, String key) {
        try { return new JSONObject(prefs.getString(id + ":" + key, "{}")); }
        catch (Exception e) { return new JSONObject(); }
    }
    Station station(int id, String key) {
        try { return Station.fromJson(read(id, "config").getJSONObject(key)); } catch (Exception e) { return null; }
    }
    void configure(int id, Station station, Station destination) {
        configure(id, WidgetKind.BOARD, station, destination, false, "");
    }
    void configure(int id, WidgetKind kind, Station station, Station destination, boolean phone, String lineId) {
        if (kind == WidgetKind.LINE ? WidgetData.line(lineId) == null : kind == WidgetKind.HOME ? destination == null || (!phone && station == null) : station == null || (kind == WidgetKind.ROUTE && destination == null)) throw new IllegalArgumentException("Choose the required widget settings");
        try {
            JSONObject config = new JSONObject().put("kind", kind.name()).put("phone", kind == WidgetKind.HOME && phone).put("lineId", lineId);
            if (station != null) config.put("station", station.json());
            if (destination != null) config.put("destination", destination.json());
            prefs.edit().putString(id + ":config", config.toString()).remove(id + ":snapshot").remove(id + ":error").remove(id + ":attempt").apply();
        } catch (Exception e) { throw new IllegalArgumentException("Invalid configuration", e); }
    }
    boolean configured(int id, WidgetKind kind) {
        JSONObject config = read(id, "config");
        if (kind == WidgetKind.LINE) return WidgetData.line(config.optString("lineId")) != null;
        if (kind == WidgetKind.HOME) return station(id, "destination") != null && (config.optBoolean("phone") || station(id, "station") != null);
        return station(id, "station") != null && (kind != WidgetKind.ROUTE || station(id, "destination") != null);
    }
    void homeLabel(int id,String label) {
        if(label.length()>24 || !WidgetData.clean(label).equals(label.trim())) throw new IllegalArgumentException("Use a plain home label, up to 24 characters");
        try { JSONObject config=read(id,"config"); config.put("homeLabel",label.trim()); prefs.edit().putString(id+":config",config.toString()).apply(); }
        catch(org.json.JSONException e) { throw new IllegalArgumentException("Invalid home label",e); }
    }
    void remove(int id) {
        SharedPreferences.Editor edit = prefs.edit();
        for (String key : prefs.getAll().keySet()) if (key.startsWith(id + ":")) edit.remove(key);
        edit.apply();
    }
    void restore(int oldId, int newId) {
        String config = prefs.getString(oldId + ":config", null);
        if (config != null) prefs.edit().putString(newId + ":config", config).apply();
        remove(oldId);
    }
}
