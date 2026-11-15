package com.mema.journey;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class WidgetData {
    static final String APP_URL = "https://journey-london.ademola-584.workers.dev/";
    static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("Europe/London"));
    static final DateTimeFormatter CHECKED = DateTimeFormatter.ofPattern("d MMM yyyy HH:mm", Locale.UK).withZone(ZoneId.of("Europe/London"));
    static final DateTimeFormatter SHORT_CHECKED = DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.UK).withZone(ZoneId.of("Europe/London"));
    static final String[][] LINES = {{"windrush","Windrush","#E4572E"},{"victoria","Victoria","#0098D4"},{"jubilee","Jubilee","#6D7780"},{"northern","Northern","#202A35"},{"elizabeth","Elizabeth","#6950A1"},{"bakerloo","Bakerloo","#B36305"},{"central","Central","#E32017"},{"circle","Circle","#B38F00"},{"district","District","#00782A"},{"hammersmith-city","Hammersmith & City","#BA6883"},{"metropolitan","Metropolitan","#9B0056"},{"piccadilly","Piccadilly","#003688"},{"waterloo-city","Waterloo & City","#009D8F"},{"dlr","DLR","#008A85"},{"tram","Tram","#568A24"},{"liberty","Liberty","#61686B"},{"lioness","Lioness","#A68500"},{"mildmay","Mildmay","#006EAE"},{"suffragette","Suffragette","#49852B"},{"weaver","Weaver","#9A3161"}};
    static String[] line(String id) { for (String[] line : LINES) if (line[0].equals(id)) return line; return null; }
    record Departure(String line, String destination, String platform, long at, String mode, String lineId) { }
    static List<Departure> departures(JSONArray rows, Set<String> allowedStops, long now) {
        List<Departure> all = allDepartures(rows,allowedStops,now);
        return new ArrayList<>(all.subList(0,Math.min(3,all.size())));
    }
    static List<Departure> allDepartures(JSONArray rows, Set<String> allowedStops, long now) {
        List<Departure> result = new ArrayList<>(); Set<String> seen = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            try {
                JSONObject o = rows.getJSONObject(i);
                long at = Instant.parse(o.getString("expectedArrival")).toEpochMilli();
                long source = Instant.parse(o.getString("timestamp")).toEpochMilli();
                if (!allowedStops.contains(o.optString("naptanId")) || at < now || at > now + 90 * 60_000L || source < now - 3 * 60_000L || source > now + 30_000) continue;
                String dest = clean(o.optString("destinationName")), line = clean(o.optString("lineName"));
                if (dest.isEmpty() || line.isEmpty()) continue;
                String key = o.optString("vehicleId") + ":" + line + ":" + dest + ":" + at;
                if (seen.add(key)) result.add(new Departure(line, dest, clean(o.optString("platformName")), at, clean(o.optString("modeName")), clean(o.optString("lineId"))));
            } catch (Exception ignored) { }
        }
        result.sort(Comparator.comparingLong(Departure::at));
        return new ArrayList<>(result.subList(0, Math.min(30, result.size())));
    }
    static String clean(String s) { String value = s.replaceAll("[\\p{Cntrl}]", " ").trim(); return value.substring(0, Math.min(120, value.length())); }
    static String clock(long time) { return CLOCK.format(Instant.ofEpochMilli(time)); }
    static String checked(long time) { return CHECKED.format(Instant.ofEpochMilli(time)); }
    static String shortChecked(long time) { return SHORT_CHECKED.format(Instant.ofEpochMilli(time)); }
    static boolean fresh(JSONObject snapshot, long now) { long at = snapshot.optLong("checkedAt"); return at > 0 && at <= now + 30_000 && now - at < 180_000; }
    static long expiresAt(JSONObject snapshot) { return snapshot.optLong("checkedAt") + 180_000; }
    static int minutes(long millis) { return (int)Math.max(0,(millis + 59_999)/60_000); }
    static boolean validPhoneFix(double lat,double lon,float accuracy,long ageMillis) {
        return Double.isFinite(lat) && Double.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180 && Float.isFinite(accuracy) && accuracy>=0 && accuracy<=500 && ageMillis>=0 && ageMillis<=120_000;
    }
    static String modeLabel(String mode) {
        return mode.equals("walking") ? "Walk" : mode.equals("bus") ? "Bus" : mode.equals("tube") ? "Tube" : mode.equals("tram") ? "Tram" : "Train";
    }
    static String homeSummary(JSONObject snapshot) {
        JSONArray legs = snapshot.optJSONArray("legs"); Set<String> modes = new LinkedHashSet<>();
        if (legs != null) for (int i=0;i<legs.length();i++) { JSONObject leg=legs.optJSONObject(i); if(leg!=null) modes.add(modeLabel(leg.optString("mode"))); }
        return modes.isEmpty() ? "Checked route estimate" : String.join(" + ",modes);
    }
    static long tflInstant(String value) {
        try { return OffsetDateTime.parse(value).toInstant().toEpochMilli(); } catch (Exception ignored) { }
        try {
            LocalDateTime local = LocalDateTime.parse(value); ZoneId zone = ZoneId.of("Europe/London");
            if (zone.getRules().getValidOffsets(local).size() != 1) return 0;
            return local.atZone(zone).toInstant().toEpochMilli();
        } catch (Exception ignored) { return 0; }
    }
    static JSONObject routeSnapshot(JSONObject response, long now) throws Exception {
        JSONArray journeys = response.optJSONArray("journeys"); JSONObject chosen = null; long best = Long.MAX_VALUE;
        if (journeys != null) for (int i = 0; i < Math.min(30, journeys.length()); i++) {
            JSONObject journey = journeys.optJSONObject(i); if (journey == null) continue;
            long dep = tflInstant(journey.optString("startDateTime")), arr = tflInstant(journey.optString("arrivalDateTime"));
            JSONArray legs = journey.optJSONArray("legs");
            if (dep < now || arr <= now || arr <= dep || arr - now > 36 * 3600_000L || legs == null || legs.length() == 0 || legs.length() > 30) continue;
            boolean valid = true, walkingKnown = true; List<String> services = new ArrayList<>(); int walks = 0; JSONArray stages = new JSONArray();
            for (int j = 0; j < legs.length(); j++) {
                JSONObject leg = legs.optJSONObject(j), mode = leg == null ? null : leg.optJSONObject("mode");
                if (mode == null || mode.optString("id").isEmpty()) { valid = false; break; }
                String modeId = mode.optString("id");
                if (!Set.of("walking","bus","tube","overground","dlr","elizabeth-line","national-rail","tram").contains(modeId)) { valid = false; break; }
                int duration=leg.optInt("duration",-1);
                stages.put(new JSONObject().put("mode",modeId).put("minutes",duration>=0 ? duration : JSONObject.NULL));
                if (modeId.equals("walking")) { if (duration < 0) walkingKnown = false; else walks += duration; }
                else { JSONObject instruction = leg.optJSONObject("instruction"); services.add(clean(instruction == null ? mode.optString("name", modeId) : instruction.optString("summary", mode.optString("name", modeId)))); }
            }
            if (valid && arr < best) {
                best = arr; chosen = new JSONObject().put("departureAt", dep).put("arrivalAt", arr).put("durationMinutes",minutes(arr-dep)).put("legs",stages).put("services", services.size()).put("walkingMinutes", walkingKnown ? walks : JSONObject.NULL)
                        .put("summary", services.isEmpty() ? "Walking route" : String.join(" \u00b7 ", services.subList(0, Math.min(2, services.size()))) + (services.size() > 2 ? " +" + (services.size()-2) + " more" : ""));
            }
        }
        if (chosen == null) throw new IllegalArgumentException("No verified returned journey");
        return chosen.put("checkedAt", now);
    }
    static JSONObject lineSnapshot(JSONArray response, String lineId, long now) throws Exception {
        if (line(lineId) == null) throw new IllegalArgumentException("Unknown line");
        for (int i = 0; i < Math.min(30, response.length()); i++) {
            JSONObject item = response.optJSONObject(i); if (item == null || !lineId.equals(item.optString("id"))) continue;
            JSONArray statuses = item.optJSONArray("lineStatuses"); JSONObject chosen = null;
            if (statuses != null) for (int j = 0; j < statuses.length(); j++) {
                JSONObject status = statuses.optJSONObject(j);
                if (status == null || !status.has("statusSeverity") || status.optString("statusSeverityDescription").isEmpty()) continue;
                if (chosen == null || (chosen.optInt("statusSeverity") == 10 && status.optInt("statusSeverity") != 10)) chosen = status;
            }
            if (chosen != null) return new JSONObject().put("checkedAt", now).put("lineId", lineId).put("status", clean(chosen.optString("statusSeverityDescription")))
                    .put("good", chosen.optInt("statusSeverity") == 10).put("reason", clean(chosen.optString("reason")));
        }
        throw new IllegalArgumentException("No verified line status");
    }
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
    static String homeLink(Station destination) {
        if (destination == null) return APP_URL;
        return APP_URL + "?widget=1&from=phone&to=" + encode(destination.name) + "&toId=" + encode(destination.icsId.isEmpty() ? destination.id : destination.icsId);
    }
    static String lineLink(String lineId) { return line(lineId) == null ? APP_URL : APP_URL + "?widget=1&line=" + encode(lineId); }
    static String encode(String value) { try { return URLEncoder.encode(value, "UTF-8"); } catch (java.io.UnsupportedEncodingException e) { throw new AssertionError(e); } }
}
