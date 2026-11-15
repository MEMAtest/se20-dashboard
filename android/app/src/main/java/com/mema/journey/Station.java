package com.mema.journey;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

final class Station {
    final String id, name, icsId;
    final double lat, lon;
    Station(String id, String name, double lat, double lon, String icsId) {
        if (id == null || !id.matches("(?:HUB|940G|910G|490)[A-Za-z0-9]{1,70}") || name == null || name.trim().isEmpty() || name.length() > 120
                || !Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
            throw new IllegalArgumentException("Invalid station");
        this.id = id; this.name = name; this.lat = lat; this.lon = lon;
        this.icsId = icsId != null && icsId.matches("[0-9]{1,12}") ? icsId : "";
    }
    static Station fromJson(JSONObject o) {
        return new Station(o.optString("id"), o.optString("name", o.optString("commonName")), o.optDouble("lat", Double.NaN), o.optDouble("lon", Double.NaN), o.optString("icsId"));
    }
    JSONObject json() {
        try { return new JSONObject().put("id", id).put("name", name).put("lat", lat).put("lon", lon).put("icsId", icsId); }
        catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }
    static List<Station> searchResults(JSONObject response) {
        List<Station> result = new ArrayList<>(); JSONArray matches = response.optJSONArray("matches");
        if (matches != null) for (int i = 0; i < matches.length() && result.size() < 8; i++) {
            try { result.add(fromJson(matches.getJSONObject(i))); } catch (Exception ignored) { }
        }
        return result;
    }
}
