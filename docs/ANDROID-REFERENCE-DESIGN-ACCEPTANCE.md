# Approved reference design implementation, Android 0.3.0

15 November 2026. This implements the second user-approved generated concept in working native RemoteViews, not raster images placed over old controls. White cards, cobalt timings, transport glyphs, service-number pill, tinted footers, Home check action, exact-line status and verified journey-leg tiles share one compact visual system. Existing provider identities/settings and the optional original board are preserved.

## Functional differences from the concept

- Native departure/leave counters use Android Chronometer min:sec, rather than a frozen rounded-minute label. Following predictions are explicitly at-check values and filtered to the same service/destination.
- Source-age chronometers tick separately. A local non-waking inexact alarm requests expiry/departure invalidation without polling TfL; Android may defer it. No guarantee of exact-time clearing during Doze/force-stop is made. Age remains explicit while the host runs; expired/failed estimates are removed on render.
- Home fetches a genuine estimate after an explicit foreground action. Phone position is requested only after the button and Android permission, never in the background. Invalid, old or imprecise fixes are rejected; stopping the activity stops location updates. No coordinates are retained in widget storage. Fixed-origin Home needs no GPS and can use normal background updates. Its dated estimate includes waiting before departure; a small optional label such as SE20 does not change the actual destination.
- Walk/train/Tube tiles represent actual provider legs and durations. Unknown durations remain unknown, absent legs are not invented, and longer itineraries show a More tile instead of pretending to be walk-train-walk.
- Real TfL bus detail can return a parent stop pair even for an individual stop request. The reader resolves only the selected child ID; it never merges opposing directions. Bus-pair search results are expanded to separately selectable stops.

## Verification

The Node suite covers endpoint preservation, security/staging and internal foreground Home/expiry contracts. JVM tests cover prediction identity/deduplication, exact bus direction, route selection/legs, source expiry, London/DST clocks and phone accuracy/age. Native API 35 instrumentation renders all four types at minimum, standard and wide sizes at 1.0x and 1.3x text. It checks vertical text bounds, horizontal countdown fit, error/expiry fallbacks, ticking source-age configuration and no fabricated leg tiles. Actual renders were visually inspected against the reference, including the corrected smallest large-text route variant.

Explicit live checks read a real High Street / Maple Road Stop E bus board, London Bridge-to-Victoria and reverse fixed-origin Home estimates, and exact Jubilee status. All four native views are rendered with those real returned values and the live counter base/text is checked. The fixture design overview and real-data render are labelled separately; point-in-time results are not current travel advice.

Canonical evidence: `/Users/omosanya_main/storage-audit/journey-20261111/android-reference-20261115/`. Exact final counts, source/release hashes, hosted CI, public APK integrity and website verification are recorded there. No new checkout or dependency installation is required.

## Unverified physical-device boundaries

No physical Android phone is connected. Actual launcher placement/taps, device GPS denial/grant, battery-constrained inexact alarm delivery and unattended periodic refresh remain unverified by these programmatic native tests. The current hosted app integration and prior manual fixtures are not a substitute for those tests. Release remains early access, not Play Store-certified or fully physical-phone accepted. Android 26 is the declared minimum; the runtime visual/live rehearsal here is API 35 only.

References: Android [RemoteViews](https://developer.android.com/reference/android/widget/RemoteViews), [Chronometer](https://developer.android.com/reference/android/widget/Chronometer), [AlarmManager](https://developer.android.com/reference/android/app/AlarmManager).
