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
        try {
            JSONObject config = new JSONObject().put("station", station.json());
            if (destination != null) config.put("destination", destination.json());
            prefs.edit().putString(id + ":config", config.toString()).remove(id + ":snapshot").remove(id + ":error").remove(id + ":attempt").apply();
        } catch (Exception e) { throw new IllegalArgumentException("Invalid configuration", e); }
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
