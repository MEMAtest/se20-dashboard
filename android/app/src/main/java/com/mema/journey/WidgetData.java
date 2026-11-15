package com.mema.journey;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class WidgetData {
    static final String APP_URL = "https://journey-london.ademola-584.workers.dev/";
    static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("Europe/London"));
    static final DateTimeFormatter CHECKED = DateTimeFormatter.ofPattern("d MMM yyyy HH:mm", Locale.UK).withZone(ZoneId.of("Europe/London"));
    record Departure(String line, String destination, String platform, long at) { }
    static List<Departure> departures(JSONArray rows, Set<String> allowedStops, long now) {
        List<Departure> result = new ArrayList<>(); Set<String> seen = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            try {
                JSONObject o = rows.getJSONObject(i);
                long at = Instant.parse(o.getString("expectedArrival")).toEpochMilli();
                long source = Instant.parse(o.getString("timestamp")).toEpochMilli();
                if (!allowedStops.contains(o.optString("naptanId")) || at < now || at > now + 90 * 60_000L || source < now - 3 * 60_000L || source > now + 30_000) continue;
                String dest = clean(o.optString("destinationName")), line = clean(o.optString("lineName"));
                if (dest.isEmpty() || line.isEmpty()) continue;
                String key = o.optString("vehicleId") + ":" + dest + ":" + at;
                if (seen.add(key)) result.add(new Departure(line, dest, clean(o.optString("platformName")), at));
            } catch (Exception ignored) { }
        }
        result.sort(Comparator.comparingLong(Departure::at));
        return new ArrayList<>(result.subList(0, Math.min(3, result.size())));
    }
    static String clean(String s) { String value = s.replaceAll("[\\p{Cntrl}]", " ").trim(); return value.substring(0, Math.min(120, value.length())); }
    static String clock(long time) { return CLOCK.format(Instant.ofEpochMilli(time)); }
    static String checked(long time) { return CHECKED.format(Instant.ofEpochMilli(time)); }
    static String departuresText(JSONArray rows, Set<String> allowedStops, long now) {
        List<Departure> departures = departures(rows, allowedStops, now);
        if (departures.isEmpty()) return "No current TfL predictions. Open Journey for National Rail or other options.";
        List<String> lines = new ArrayList<>();
        for (Departure d : departures) lines.add(clock(d.at) + "  " + d.line + " > " + d.destination + (d.platform.isEmpty() ? "" : " (" + d.platform + ")"));
        return String.join("\n", lines);
    }
    static String link(Station origin, Station destination) {
        if (origin == null) return APP_URL;
        String url = APP_URL + "?widget=1&fromLat=" + origin.lat + "&fromLon=" + origin.lon + "&fromName=" + encode(origin.name);
        return destination == null ? url : url + "&to=" + encode(destination.name) + "&toId=" + encode(destination.icsId.isEmpty() ? destination.id : destination.icsId);
    }
    static String encode(String value) { try { return URLEncoder.encode(value, "UTF-8"); } catch (java.io.UnsupportedEncodingException e) { throw new AssertionError(e); } }
}
