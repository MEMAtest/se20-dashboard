# Journey Live Data And Tube Map Repair

## Confirmed Production Findings

- Live app: https://tremaine-159cf.web.app/. The signed browser showed all four home rail boards unavailable while nearby buses worked.
- The rail service returned HTTP 503 for Anerley. Its health metadata reported `kafkaConnected:false`, `lastUpdate:null`, `messageCount:0` despite liveness `status:ok`.
- A bounded read-only inspection of the existing `darwin-api` container confirmed Kafka username/password/broker and alternative National Rail token were not configured. No credential values were printed or changed. Its bounded logs showed repeated public Huxley fallback HTTP 500 errors.
- TfL's independent live Anerley endpoint returned current Windrush predictions; Birkbeck's verified tram child is `940GZZCRBIR`, not its National Rail stop ID.
- The previous frontend used Darwin exclusively for the home rail boards and reused saved clock-only departures without an age bound. The worker could replay cached live API replies offline. The Lines page had status only, with no Tube map implementation; Nearby was a street map.

## Local Repair

National Rail remains preferred when its upstream data is current. On failure, home boards and their detail views use independently fetched, validated TfL predictions, explicitly labelled TfL services only / National Rail unavailable. This does not restore Southern, Southeastern or Thameslink coverage. No guessed times or scheduled journeys are relabelled as live departures. Stale saved boards expire after 90 seconds, failed refreshes do not retain old rows, and arrival instants remain absolute to prevent next-day clock revival. Live API requests no longer fall back to service-worker caches. Versioned static assets and cache-reload precaching prevent mixed old/new script bundles.

Lines now contains separate Line status and Tube map panels. The map is a geographic Tube network rendered from TfL route geometry, not a reproduction or substitute for the official schematic. It loads eleven line geometries in batches of three, validates coordinates and line binding, reports partial coverage, includes interchanges and provides a station selector plus station-to-live-arrivals navigation. Official TfL schematic and accessibility-map links remain available independently. A PDF-only embed was rejected after browser inspection found a blank panel.

## Verification And Limits

- `node --test tests/transit-data.test.js tests/journey-guidance.test.js`: 70 passed, zero failed.
- Syntax checks passed for app, transit helper, service worker and network map; `git diff --check` passed.
- Real network probes of the repaired helper returned TfL predictions for Anerley and Birkbeck, with `partial:true`.
- Local browser rehearsal showed all eleven Tube lines loading, Brixton/interchange inclusion, the official PDF fallback link, and eight live rows when Oxford Circus was selected. Anerley's detail board displayed real platform-bearing TfL rows with partial-source labelling.
- Actual DOM layout measured 520 CSS pixels with equal document scroll width. Although a 390-pixel browser override was requested, the measured layout remained 520; this is not claimed as physical iPhone or verified 390-pixel acceptance.
- Production changes have NOT been deployed. The user was asked whether to publish the tested frontend repair; no response was received during preparation. No server restart, credential edit, plan change or paid service was made. Full National Rail remains an unresolved feed-connection gate.

## Resources

Reused the canonical checkout on branch `fix/journey-live-data-20261111`; no worktree, clone, dependency installation, model or map-asset download. Small source/tests/this report only. Existing alternate Journey worktree and unrelated projects were left untouched. The bounded local HTTP test server and temporary browser override are retired after rehearsal; original production and listening/account state are unchanged.

## Primary Sources

- TfL network map: https://content.tfl.gov.uk/standard-tube-map.pdf (HTTP 200 verified).
- TfL API: https://api.tfl.gov.uk/StopPoint/910GANERLEY/Arrivals and https://api.tfl.gov.uk/Line/victoria/Route/Sequence/all (real public responses inspected).
