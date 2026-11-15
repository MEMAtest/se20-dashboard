package com.mema.journey;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import static org.junit.Assert.*;

public class WidgetDataTest {
    final long now = Instant.parse("2026-11-15T09:00:00Z").toEpochMilli();
    JSONObject row(String stop, String at, String source, String vehicle) throws Exception {
        return new JSONObject().put("naptanId", stop).put("expectedArrival", at).put("timestamp", source).put("vehicleId", vehicle).put("destinationName", "Victoria").put("lineName", "Victoria").put("platformName", "Northbound");
    }
    @Test public void sortsDeduplicatesAndBoundsPredictions() throws Exception {
        JSONArray rows = new JSONArray();
        rows.put(row("940GTEST", "2026-11-15T09:04:00Z", "2026-11-15T08:59:50Z", "a"));
        rows.put(row("940GTEST", "2026-11-15T09:02:00Z", "2026-11-15T08:59:50Z", "b")); rows.put(rows.get(1));
        assertEquals(2, WidgetData.departures(rows, Set.of("940GTEST"), now).size());
        assertEquals("09:02", WidgetData.clock(WidgetData.departures(rows, Set.of("940GTEST"), now).get(0).at()));
    }
    @Test public void rejectsPastWrongStationStaleSourceAndFutureSource() throws Exception {
        JSONArray rows = new JSONArray().put(row("940GOTHER", "2026-11-15T09:02:00Z", "2026-11-15T08:59:50Z", "a"))
                .put(row("940GTEST", "2026-11-15T08:59:00Z", "2026-11-15T08:59:50Z", "b"))
                .put(row("940GTEST", "2026-11-15T09:02:00Z", "2026-11-15T08:50:50Z", "c"))
                .put(row("940GTEST", "2026-11-15T09:02:00Z", "2026-11-15T09:05:50Z", "d"));
        assertTrue(WidgetData.departures(rows, Set.of("940GTEST"), now).isEmpty());
    }
    @Test public void rejectsMissingProvenanceAndInvalidTimes() throws Exception {
        JSONArray rows = new JSONArray().put(new JSONObject().put("expectedArrival", "wrong"));
        assertTrue(WidgetData.departures(rows, Set.of("940GTEST"), now).isEmpty());
        assertTrue(WidgetData.departuresText(rows, Set.of("940GTEST"), now).contains("No current TfL predictions"));
    }
    @Test public void clocksAlwaysUseLondonIncludingSummerTime() {
        assertEquals("10:00", WidgetData.clock(Instant.parse("2026-07-01T09:00:00Z").toEpochMilli()));
        assertEquals("09:00", WidgetData.clock(now));
        assertEquals("15 Nov 2026 09:00", WidgetData.checked(now));
    }
    @Test public void linkUsesChosenPublicCoordinatesAndExactDestinationIcs() {
        Station origin = new Station("910GANERLEY", "Anerley Rail Station", 51.412153, -.065886, "");
        Station destination = new Station("HUBVIC", "Victoria", 51.496, -.144, "1000248");
        String url = WidgetData.link(origin, destination);
        assertTrue(url.startsWith(WidgetData.APP_URL + "?widget=1")); assertTrue(url.contains("fromName=Anerley+Rail+Station")); assertTrue(url.contains("toId=1000248"));
        assertFalse(WidgetData.link(origin, null).contains("&to=")); assertEquals(WidgetData.APP_URL, WidgetData.link(null, destination));
    }
    @Test public void invalidStationIdsCoordinatesAndEmptyNamesAreRejected() {
        for (String id : new String[]{"https://evil.test", "../bad", "HUBVIC&key=secret", ""}) {
            assertThrows(IllegalArgumentException.class, () -> new Station(id, "Station", 51, -.1, ""));
        }
        assertThrows(IllegalArgumentException.class, () -> new Station("HUBVIC", "", 51, -.1, ""));
        assertThrows(IllegalArgumentException.class, () -> new Station("HUBVIC", "Victoria", Double.NaN, -.1, ""));
        assertThrows(IllegalArgumentException.class, () -> new Station("HUBVIC", "Victoria", 91, -.1, ""));
    }
    @Test public void searchDoesNotGuessOrAutoSelectAndDropsInvalidMatches() throws Exception {
        JSONObject response = new JSONObject().put("matches", new JSONArray().put(new JSONObject().put("id", "HUBVIC").put("name", "Victoria").put("lat", 51.496).put("lon", -.144)).put(new JSONObject().put("id", "evil")));
        assertEquals(1, Station.searchResults(response).size()); assertEquals("HUBVIC", Station.searchResults(response).get(0).id);
    }
    @Test public void stopTreeRetainsOnlyBoundedValidEndpoints() throws Exception {
        Set<String> stops = new LinkedHashSet<>(), lines = new LinkedHashSet<>();
        JSONArray children = new JSONArray().put(new JSONObject().put("id", "4900ANERLEY1").put("stopType", "NaptanRailEntrance"));
        for (int i = 0; i < 20; i++) children.put(new JSONObject().put("id", "940GSTOP" + i).put("stopType", "NaptanMetroStation").put("lines", new JSONArray().put(new JSONObject().put("id", "jubilee"))));
        TflClient.collect(new JSONObject().put("id", "HUBTEST").put("children", children).put("lines", new JSONArray().put(new JSONObject().put("id", "133"))), stops, lines, 0);
        assertEquals(4, stops.size()); assertFalse(stops.contains("HUBTEST")); assertFalse(stops.contains("4900ANERLEY1")); assertTrue(lines.contains("jubilee"));
        assertFalse(lines.contains("133"));
    }
    @Test public void clockTextIsNotAFrozenLiveCountdown() throws Exception {
        String text = WidgetData.departuresText(new JSONArray().put(row("940GTEST", "2026-11-15T09:02:00Z", "2026-11-15T08:59:50Z", "a")), Set.of("940GTEST"), now);
        assertTrue(text.startsWith("09:02")); assertFalse(text.contains("min"));
    }
    @Test public void ambiguousLocalClocksAndStaleSnapshotsStayUnverified() throws Exception {
        assertEquals(0,WidgetData.tflInstant("2026-10-25T01:30:00"));
        assertEquals(0,WidgetData.tflInstant("2026-03-29T01:30:00"));
        assertEquals(now,WidgetData.tflInstant("2026-11-15T09:00:00"));
        assertTrue(WidgetData.fresh(new JSONObject().put("checkedAt",now),now));
        assertFalse(WidgetData.fresh(new JSONObject().put("checkedAt",now-181000),now));
        assertFalse(WidgetData.fresh(new JSONObject().put("checkedAt",now+31000),now));
    }
    @Test public void routesSelectEarliestReturnedArrivalAndRejectUnverifiedOrPastResults() throws Exception {
        JSONObject leg = new JSONObject().put("mode",new JSONObject().put("id","tube")).put("instruction",new JSONObject().put("summary","Jubilee to Westminster"));
        JSONObject journey = new JSONObject().put("startDateTime","2026-11-15T09:03:00Z").put("arrivalDateTime","2026-11-15T09:20:00Z").put("legs",new JSONArray().put(leg));
        JSONObject later = new JSONObject(journey.toString()).put("arrivalDateTime","2026-11-15T09:40:00Z");
        JSONObject result = WidgetData.routeSnapshot(new JSONObject().put("journeys",new JSONArray().put(later).put(journey)),now);
        assertEquals("09:20",WidgetData.clock(result.getLong("arrivalAt"))); assertEquals("Jubilee to Westminster",result.getString("summary"));
        assertThrows(IllegalArgumentException.class,() -> WidgetData.routeSnapshot(new JSONObject().put("journeys",new JSONArray().put(new JSONObject(journey.toString()).put("startDateTime","bad"))),now));
        assertThrows(IllegalArgumentException.class,() -> WidgetData.routeSnapshot(new JSONObject(),now));
    }
    @Test public void lineWatchRequiresExactIdentityAndDoesNotHideAnAdverseStatus() throws Exception {
        JSONArray statuses = new JSONArray().put(new JSONObject().put("statusSeverity",10).put("statusSeverityDescription","Good Service")).put(new JSONObject().put("statusSeverity",5).put("statusSeverityDescription","Part Closure"));
        JSONArray response = new JSONArray().put(new JSONObject().put("id","windrush").put("lineStatuses",statuses));
        assertEquals("Part Closure",WidgetData.lineSnapshot(response,"windrush",now).getString("status"));
        assertFalse(WidgetData.lineSnapshot(response,"windrush",now).getBoolean("good"));
        assertThrows(IllegalArgumentException.class,() -> WidgetData.lineSnapshot(response,"victoria",now));
        assertThrows(IllegalArgumentException.class,() -> WidgetData.lineSnapshot(response,"../evil",now));
    }
    @Test public void fourCompactKindsHaveDistinctPurposesAndHomeNeverRefreshesInBackground() {
        assertEquals(5,WidgetKind.values().length); assertFalse(WidgetKind.HOME.refreshes);
        assertEquals(WidgetKind.LINE,WidgetKind.provider("com.mema.journey.LineWatchWidget"));
        Station home = new Station("910GANERLEY","Anerley",51.412153,-.065886,"");
        assertTrue(WidgetData.homeLink(home).contains("from=phone&to=Anerley&toId=910GANERLEY"));
        assertEquals(WidgetData.APP_URL,WidgetData.lineLink("bad"));
        assertTrue(WidgetData.lineLink("windrush").endsWith("?widget=1&line=windrush"));
    }
}
