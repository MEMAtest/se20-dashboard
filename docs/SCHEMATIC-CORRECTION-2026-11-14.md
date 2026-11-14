# Tube schematic correction

## What Was Wrong

The previous release used OpenStreetMap tiles with geographic rail geometry. This did not match the requested schematic Tube/network-map UI. The earlier NETWORK-HUBS document describes that release's functionality, not visual acceptance of the reference design.

## Correction

- The Lines map now uses a white diagram canvas, coloured horizontal/vertical/45-degree connections, labelled stations and interchange rings. No street tiles or geographic rail polylines are requested or drawn by this module.
- Underground is the default selection. Other modes remain optional. Journey and Nearby retain geographic maps for walking, real-world location and route geometry.
- TfL orderedLineRoutes defines adjacency. Child station IDs in stopPointSequences resolve to their declared parent hubs. Missing intermediate stops do not become invented direct links. A closed service remains part of the reference diagram when its topology is returned.
- Hand-authored central diagram anchors and bounded stop-spacing produce the diagram positions. These are original Journey layout positions, not TfL artwork. The schematic is explicitly not to scale; the river is schematic context, not a navigable geographic boundary.
- Real station coordinates remain separate and unchanged for journey planning and live hub requests. Home/Near me focus the nearest station in the selected schematic, not an exact position on a street map. No passive GPS request is added.
- Expand/Close map, keyboard Escape, pinch/drag/zoom, filtered station lookup, line focus and the existing station popup actions are retained. Horizontal labels alternate above/below the track. An accessible station selector remains available independently of map markers.
- Loading/failed line coverage is explicit. No street-map fallback or fabricated geometry is substituted. National Rail remains limited to the three selected London-area operators.

## Verification Boundaries

148 local Node regressions pass, including 12 new schematic tests: ordered adjacency, child/parent interchanges, absent-node gaps, navigation coordinate separation, octilinear segments, parallel lines, deterministic network response order, absent topology/no street tiles, Tube defaults, stable Tube metadata, label placement and mobile label collisions. Travel-timezone subset: 57 tests under America/New_York.

A bounded live topology audit resolved 270 Tube parent hubs with no isolated Tube hub, including connected Tottenham Court Road, Waterloo, Bank, Canada Water and Battersea Power Station. Two non-Tube source requests timed out in that audit; subsequent individual reads returned valid ordered routes. This is not a claim that every provider request always succeeds.

Native Chrome local walkthrough showed 11/11 Tube lines, expanded schematic rendering and Canada Water map tap to current source-labelled departures. A 400px phone-width check exposed label crowding; the collision-prioritised label correction was rechecked at that width before release. Final publication/browser evidence is recorded separately; physical iPhone GPS, every outer-branch label and all accessibility journeys are not certified by these tests.

Bundle 20261114b, service-worker cache v52. Reuses the existing 13-public-file staging allowlist, existing Leaflet and existing Cloudflare Worker. No new dependency, worktree, external schematic artwork or paid service.
