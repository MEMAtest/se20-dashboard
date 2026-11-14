# Journey network and station hubs

## Scope

Implements the supplied Lines, network-map, line-detail and station-hub UI references within the existing Journey design. No backend, account, billing, authentication or saved Home migration.

- Shared filters: Underground, Overground, DLR, Elizabeth line, Tram, National Rail and local favourites.
- Grouped line cards, provider disruption detail, station directory, line map focus and mode-based journey planning.
- Geographic map: 11 Tube routes, DLR, Elizabeth line, six named Overground lines, Tram, plus Southern, Southeastern and Thameslink clipped to the London area. The official schematic Tube PDF remains linked. This is not all-UK or complete National Rail geometry.
- Station hub: actual reported modes, source-grouped departures, station information, registered facilities, current station warnings and reported service connections.
- First map opening centres on saved Home. Mode selection fits its routes; Home and Near me remain explicit separate controls. No implicit GPS request or saved Home rewrite.
- Departed route cards expire in an app left open, using the existing countdown loop without a new provider poll.

## Data Boundaries

Mock-up interchange, platform, access, walking-time and disruption-end claims are not source data. Canada Water's verified parent hub supplies Tube, Overground and bus services, not DLR or National Rail. Registered lifts do not prove operational step-free access. Current Canada Water station warnings correctly report the lift replacement/access restriction.

Station metadata must contain the requested station ID, either directly or within its bounded parent hub. Arrival IDs are bounded child rail stops. Live predictions reject wrong stops, stale timestamps, already-departed rows and bus predictions in the rail board. Boards expire within 90 seconds without silent cache reuse. Known National Rail boards additionally bind the returned CRS to the requested station. Other stations explicitly retain partial National Rail coverage.

Station directories are alphabetical, not train stopping order or proof of a direct connection. Line planning selects a mode, not a guaranteed operator. Unknown/failed/cached source states are not an all-clear. Late responses cannot replace a newer station or line selection.

## Verification

Local Node regression suite: 136 tests passed. Travel-timezone subset under America/New_York: 58 tests passed. Syntax and whitespace checks passed. Added 21 hub/network/ageing regressions; existing contracts updated to the multimode hub UI without relaxing Tube-only route pickers.

Native Chrome real-data walkthrough covered grouped services, Southern's station directory, Norwood Junction's National Rail board, Jubilee's station directory, Canada Water's actual services/access warning, map-to-hub navigation and all 23 map sources loading. Responsive phone layout inspected at 390 px width. The mode-zoom issue found during that walkthrough was corrected and rechecked with DLR. Existing quickest Tube routing tests remain green.

This is browser and emulated-phone evidence, not physical iPhone, GPS, installed-old-icon or offline end-to-end acceptance. Night-mode layout was observed. No claim of every route/provider failure path or complete UK network coverage.

Release target remains the existing journey-london Cloudflare Worker, using the 13-file public asset allowlist. Bundle 20261114a and service-worker cache v51. Exact source, CI, merge, publication and live hash results belong in the separate acceptance receipt; this document alone does not assert deployment.

## Storage

Reused the canonical checkout and existing dependencies. No worktree, dependency installation, corpus or full-project backup created. Reuse the existing sub-1-MiB public staging folder and retain one compact metadata acceptance receipt outside the repository.
