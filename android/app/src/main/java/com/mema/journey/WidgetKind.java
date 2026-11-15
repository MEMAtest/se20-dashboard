package com.mema.journey;

enum WidgetKind {
    NEXT("Next up", "2 x 2", true), HOME("Go home", "2 x 1", false),
    ROUTE("My journey", "4 x 2", true), LINE("Line watch", "2 x 1", true),
    BOARD("Departures board", "4 x 4", true);
    final String title, size;
    final boolean refreshes;
    WidgetKind(String title, String size, boolean refreshes) { this.title = title; this.size = size; this.refreshes = refreshes; }
    static WidgetKind provider(String name) {
        if (name.endsWith(".NextUpWidget")) return NEXT;
        if (name.endsWith(".HomeWidget")) return HOME;
        if (name.endsWith(".JourneyWidget")) return ROUTE;
        if (name.endsWith(".LineWatchWidget")) return LINE;
        return BOARD;
    }
}
