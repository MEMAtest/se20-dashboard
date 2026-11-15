# Android companion acceptance - 15 November 2026

## Implemented

Restricted HTTPS Journey WebView app; native per-widget station/destination configuration; departures/service-alert snapshot; explicit manual refresh; Android JobScheduler background refresh; immutable per-widget actions; saved station/destination handoff into the web planner without automatic routing, GPS or Home changes; dedicated release signing and phone-download distribution; Android build/test CI.

## Observed before publication

- 160 Node regressions pass, including three new widget-link validation/controller checks and three Android security/staging guards.
- Nine Android JVM tests pass. Debug/release compilation and Android lint pass with zero errors. Warnings include deliberate English-only strings, newer optional widget attributes ignored on older Android versions, pinned compatible tooling, and the reviewed JavaScript-enabled WebView needed by Journey. This is not a claim of zero lint warnings.
- Installed debug runtime on the reused, read-only API 36 ARM emulator passed 14 bounded assertions: local settings/isolation, exact WebView origin restrictions, absence of background location, actual RemoteViews inflation/labels/no-data/error state, and a real TfL response. An overnight Anerley check returned zero predictions; that is retained as empty source coverage, not a fabricated positive departure or health claim.
- The first real provider check exposed an HTTP 404 from combined IDs and entrance IDs. That failed check remains part of the evidence. The correction fetches real prediction boards individually and excludes entrances/access areas. Later source success does not erase the first failure.
- Local browser widget-link handoff loaded Anerley Rail Station and Victoria correctly, with an unchanged saved Home and no automatic routing. Explicit Find routes returned real overnight TfL options (including N3 and Victoria line) at approximately 03:21 London. This is browser integration proof, not Android launcher proof.

## Unverified gates

The computer-use tool cannot bind the SDK emulator's Qt window. Installed-runtime assertions and programmatic native widget rendering must not be described as ordinary launcher placement or button taps. No physical Android phone is connected. Physical phone installation, launcher's Add widget/configuration flow, real widget Refresh/Edit/destination taps, foreground location denial/grant, battery restrictions, resize/font scaling and an observed unattended periodic refresh remain unverified. The release is explicitly early access, not Play Store-certified or fully phone-accepted.

The main website publication and exact APK hash/signature are recorded separately in the release receipt. Never describe a source merge or successful build as proof that a phone has received it.

## Storage

One canonical checkout reused; no worktree/clone/dependency-directory copies. Existing Java/SDK/Gradle/system image reused. The emulator is read-only with snapshots disabled and temporary growth bounded to approximately 3 GiB; stop it after the bounded checks. Retain one canonical signed APK, its compact metadata, relevant failure/acceptance metadata and one representative native render. Do not retain another copy of the project or a system image. Dedicated signing material is retained outside Git, never as a public artifact.
