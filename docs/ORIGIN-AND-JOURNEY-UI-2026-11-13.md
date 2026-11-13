# Starting Point and Journey UI

## Scope

The supplied images inform the blue summary card, Journey/Route map switch, numbered itinerary and prominent journey actions. Their fictional times, platforms, traffic, crowding and completed travel states are not imported. This is a London/TfL journey improvement, not a claim of UK-wide transport-feed coverage.

Starting from is now an explicit picker, not a hidden Home/phone toggle. Phone, saved Home, configured Work, saved places, station results and confirmed full-postcode centres are separate choices. Station/postcode lookup does not change saved Home. Changing or editing the origin invalidates old results and cancels outstanding searches. GPS must have valid coordinates, a recent timestamp and accuracy within 500 m. Failure requires retry or an explicit alternative; it never substitutes Home.

Destination suggestions are keyboard buttons bound to validated TfL interchange IDs. Ambiguous free-text destinations require an explicit choice, with station results placed first. Dismissed or obsolete lookups cannot reopen the dropdown or overwrite newer input.

All searches send an explicit next-minute London departure date/time, including Now and offset searches while the device is abroad. Departed and malformed provider itineraries are refused. Route requests time out after 25 seconds and origin lookup after 12 seconds. A cached result is not restored under another origin; only matching saved-Home results with future departures are eligible, and restoration does not renew their original timestamp. Phone/custom origins require fresh selection after reload.

The journey view shows planned arrival, London travel date/time, available fare and walking information, numbered boarding/change/alighting instructions, and a dedicated map with numbered stop popups. Walking distance is labelled as such: observed provider transit-distance values were not credible enough to present as total distance. Unknown metrics remain unavailable. Missing geometry is dashed and labelled approximate. Maps refit when their container changes size. This is not GPS vehicle tracking or proof that a step was completed.

The service worker refuses opaque cached responses for CORS/SRI map/font requests. Leaflet asset URLs are versioned for the update. Existing live-board network-only safeguards remain in place. Bundle version is 20261113b, service-worker cache v50.

## Verification

- 115 Node tests, including 23 new origin/UI/cache/time/controller regressions, pass.
- The origin and Tube controller tests are also checked with America/New_York as the device timezone.
- Real TfL station search and postcodes.io lookup returned selectable London Bridge stations and the SE20 7UA postcode centre.
- Native Chrome walkthroughs exercised real station selection, explicit postcode confirmation, destination disambiguation, journey results, summary, instructions and route map. Desktop and a 390 x 844 emulated viewport were visually inspected. Direct browser-tab automation was unavailable; native controls were used instead. Emulation is not physical iPhone acceptance, and phone GPS success was not established by a live device test.
- A bounded real-provider check at 16:57 UTC returned three future itineraries for an explicitly timed Home-area to London Bridge request, with provider geometry and walking distances. Estimates are not promises about later services.
- No live production publication is implied by these local checks. Exact-head CI, merge and public asset verification are separate gates.

## Resources and Release

Canonical checkout reused; no new worktree, dependency installation, paid service, bucket, account permission or backend deployment. Thirteen allowlisted public files are staged in the existing .deploy-assets directory, not a project copy. Keep one compact acceptance receipt in /Users/omosanya_main/storage-audit/journey-20261111. The local QA server and task-only browser tab should be stopped at handoff.

At implementation time Cloudflare CLI authentication remained unavailable, and the live site still served 20261111c. Do not call this release published until public asset hashes match the accepted candidate. No GitHub app security grant was made.
