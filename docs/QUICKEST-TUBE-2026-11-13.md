# Quickest Tube Connection

## Feature

Plan now has a Quickest Tube connection entry, also available directly in Lines / Tube map. Choose Phone location, Saved Home or a named Tube station, then a destination Tube station. The Tube + walking only option excludes feeders; otherwise TfL may use buses, trams, National Rail, Overground, DLR or Elizabeth line connections into the Tube. Every displayed result must contain a Tube leg. Map-station popups can preselect a destination through Quickest route here.

Requests use exact selected station IDs or validated origin coordinates, `journeyPreference=leasttime` and the next London minute as departure. No ambiguous text destination is silently selected. Phone location denial does not substitute Home. Ranking is by earliest estimated arrival from the check time, including the wait before departure, rather than by the shortest train ride. Repeated departures on the same itinerary are not presented as distinct alternatives. Provider walking durations, change counts, lines and change-station instructions are displayed. London timestamps do not depend on the phone's current timezone; ambiguous clock-change timestamps are refused.

Changing inputs cancels the previous request and clears its results; late responses cannot overwrite the new selection. Provider calls have a twenty-second timeout. Results expire after two minutes and are not stored as location history. Estimates are explicitly not guaranteed live connections; an independent TfL Journey Planner link remains available.

## Verification

- All 92 Node tests passed, including full controller success/error/input-change/expiry paths, station-picker/map-action wiring and escaped provider text.
- The fourteen routing tests also passed with `TZ=America/New_York`.
- Real TfL API and helper acceptance at 08:50 UTC on 13 November returned Oxford Circus to Kings Cross via Victoria, plus a mixed-mode SE20 Home to Oxford Circus journey. The latter included walking, National Rail and Tube changes. These were live provider estimates at the recorded check time, not promised future travel times.
- Canonical compact evidence: `/Users/omosanya_main/storage-audit/journey-20261111/quickest-tube-20261113.json`.
- No real browser UI or physical iPhone acceptance is claimed: local browser control is unavailable in this chat. Cloudflare CLI authentication is also unavailable, so source, CI/merge and production publication remain distinct gates. Do not call this feature live until the versioned bundle has actually been published and checked.

## Resources

Reused the canonical checkout and cached tools; no new worktree, dependency installation, provider, bucket or paid service. Thirteen allowlisted public assets are staged in the existing `.deploy-assets` folder; no full-project copy or backend/test upload. Source/tests and one bounded metadata receipt are retained. No listening/account/provider state or production resources were changed.
