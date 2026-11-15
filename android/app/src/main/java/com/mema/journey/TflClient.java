package com.mema.journey;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class TflClient {
    static final class SourceException extends Exception {
        final String code;
        SourceException(String code) { super(code); this.code = code; }
    }
    Object get(String path) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new SourceException("CANCELLED");
        HttpURLConnection c = (HttpURLConnection) new URL("https://api.tfl.gov.uk/" + path).openConnection();
        c.setConnectTimeout(3500); c.setReadTimeout(3500); c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Accept", "application/json"); c.setRequestProperty("User-Agent", "Journey-Android/0.1");
        try {
            int status = c.getResponseCode();
            if (status != 200) throw new SourceException(status == 429 ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE");
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[8192]; int n;
                while ((n = in.read(bytes)) != -1) {
                    if (out.size() + n > 524288) throw new SourceException("RESPONSE_TOO_LARGE");
                    if (Thread.currentThread().isInterrupted()) throw new SourceException("CANCELLED");
                    out.write(bytes, 0, n);
                }
                String body = out.toString(StandardCharsets.UTF_8.name());
                return body.trim().startsWith("[") ? new JSONArray(body) : new JSONObject(body);
            }
        } finally { c.disconnect(); }
    }
    List<Station> search(String query) throws Exception {
        if (query.trim().isEmpty() || query.length() > 80) throw new SourceException("INVALID_SEARCH");
        return Station.searchResults((JSONObject) get("StopPoint/Search?query=" + WidgetData.encode(query) + "&modes=tube,overground,dlr,elizabeth-line,tram,national-rail,bus&maxResults=8"));
    }
    JSONObject snapshot(Station station) throws Exception {
        JSONObject detail = (JSONObject) get("StopPoint/" + station.id);
        Set<String> ids = new LinkedHashSet<>(), lines = new LinkedHashSet<>();
        collect(detail, ids, lines, 0);
        if (ids.isEmpty()) throw new SourceException("NO_PREDICTION_BOARD");
        JSONArray arrivals = new JSONArray(); int failedBoards = 0, fetchedBoards = 0;
        for (String id : ids) {
            try {
                JSONArray board = (JSONArray) get("StopPoint/" + id + "/Arrivals"); fetchedBoards++;
                for (int i = 0; i < board.length() && arrivals.length() < 500; i++) arrivals.put(board.get(i));
            } catch (Exception e) { failedBoards++; }
        }
        if (fetchedBoards == 0) throw new SourceException("DEPARTURES_UNAVAILABLE");
        String alert = "TfL predictions; not all National Rail services";
        boolean statusVerified = false;
        if (!lines.isEmpty()) {
            try {
                JSONArray statuses = (JSONArray) get("Line/" + String.join(",", lines) + "/Status");
                List<String> warnings = new ArrayList<>();
                for (int i = 0; i < statuses.length(); i++) {
                    JSONObject line = statuses.getJSONObject(i); JSONArray values = line.optJSONArray("lineStatuses");
                    if (values != null) for (int j = 0; j < values.length(); j++) {
                        JSONObject value = values.getJSONObject(j);
                        if (value.optInt("statusSeverity", 0) != 10) warnings.add(WidgetData.clean(line.optString("name")) + ": " + WidgetData.clean(value.optString("statusSeverityDescription", "Check service")));
                    }
                }
                statusVerified = statuses.length() > 0;
                if (!warnings.isEmpty()) alert = String.join("; ", warnings);
            } catch (Exception e) { alert = "Service alerts unavailable; check before travel"; }
        }
        if (!statusVerified && alert.startsWith("TfL")) alert = "Service alerts unverified; TfL predictions only";
        if (failedBoards > 0) alert = "Partial departures: " + failedBoards + " board(s) unavailable. " + alert;
        return new JSONObject().put("checkedAt", System.currentTimeMillis()).put("arrivals", arrivals).put("ids", new JSONArray(ids)).put("alert", alert);
    }
    static void collect(JSONObject stop, Set<String> ids, Set<String> lines, int depth) {
        if (depth > 2) return;
        String id = stop.optString("id");
        String type = stop.optString("stopType");
        boolean board = type.matches("Naptan(?:MetroStation|RailStation)") || (depth == 0 && type.equals("NaptanPublicBusCoachTram"));
        if (id.matches("(?:940G|910G|490)[A-Za-z0-9]{1,70}") && board && ids.size() < 4) ids.add(id);
        JSONArray served = stop.optJSONArray("lines");
        if (served != null) for (int i = 0; i < served.length() && lines.size() < 8; i++) {
            JSONObject line = served.optJSONObject(i); String name = line == null ? "" : line.optString("id");
            if (name.matches("[a-z0-9-]{1,60}")) lines.add(name);
        }
        JSONArray children = stop.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length() && ids.size() < 4; i++) { JSONObject child = children.optJSONObject(i); if (child != null) collect(child, ids, lines, depth + 1); }
    }
}
