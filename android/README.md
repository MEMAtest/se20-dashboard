# Journey Android companion

Small Java/framework Android application (Android 8 / API 26 or newer), with no runtime third-party dependencies. The main interface is the existing HTTPS Journey application in a restricted WebView. The home-screen widget is a real Android AppWidget using native RemoteViews, not a web shortcut.

## Use

1. Install the signed early-access APK from the `android-v0.2.0` GitHub release. Install over 0.1.0 to retain widget settings; the signing identity is unchanged. It is not a Play Store listing. Review Android's prompts; do not disable Play Protect.
2. Open Journey and tap **Add widget**, choose a type, then accept your launcher's placement prompt. Or long-press the home screen, choose Widgets, then Journey.
3. Choose exact station search results, or a line for Line watch. Go home requires a home station; My journey requires both endpoints. Typed text alone is not a selected station.
4. Tap **Save widget**. Long-press to reconfigure. Next up's body refreshes, its station title opens Journey. My journey's refresh checks times; its body opens the selected route (in the flat layout the clocks refresh and the title opens). Line watch opens that exact line; wider layouts also have refresh. Go home opens the planner; tap Find route before phone location is requested.

| Widget | Starting size | Purpose |
| --- | --- | --- |
| Next up | 2 x 2 | Next verified TfL departure at your exact station, including its direction |
| Go home | 2 x 1 | Phone-to-home-station shortcut, or an optional fixed start; no background work |
| My journey | 4 x 2 | Earliest arrival among returned TfL route estimates; leave/arrive clocks and service summary |
| Line watch | 2 x 1 | One chosen line's checked status; opens full details |
| Departures board | 4 x 4 | Optional original larger board, preserved for existing users |

Cell dimensions vary by launcher. Native responsive layouts adapt to available bounds, including a flat route view and compact large-text variants. These are snapshots, not continuously live navigation. A line's generic compact Disruption label opens the provider's precise status. Widget previews contain placeholders, not live predictions.

Widget settings are per widget, stored locally and separate from browser favourites/Home. Native WebView storage is also separate from Chrome's PWA storage. No existing Home, favourites or listening data is imported or overwritten. A saved destination is a selected station, not automatic discovery of your home address. The widget never requests location. The full app requests foreground location only when its location feature is used; there is no background-location permission or location history service.

## Data and update boundaries

- Public TfL HTTPS reads only: search, verified station detail, at most four actual prediction boards individually, and at most eight line-status IDs. Entrances/access areas are not prediction boards; hub IDs are not treated as guessed journey endpoints.
- TfL predictions do not include every National Rail service. Use the main app for its separate National Rail source and wider journey choices. Empty predictions do not mean all services are healthy or that no train exists.
- Absolute London departure times, a checked timestamp and explicit errors. No frozen countdown masquerading as live. Past, wrong-stop, missing-provenance and stale-source rows are excluded when rendered. Refresh before travel; snapshots can become stale between Android updates.
- Approximately 30-minute network-constrained background jobs while widgets exist, subject to Android battery/network quotas. Manual refresh is rate-limited to one attempt per widget per 30 seconds. No exact alarms, foreground service, push subscription, paid backend or continuously running model.
- Partial-board failures and unavailable line alerts stay explicit. HTTP 429 / other source errors never create fabricated departures. Cached successes retain their original checked time after a failed refresh.
- Deleting a widget removes its settings and cancels its jobs. Reboot/package replacement restores jobs only for existing configured widgets.

## Build and tests

Use Java 17, Android SDK platform/build-tools 36, and the checked-in Gradle 8.14.3 wrapper (distribution SHA-256 pinned). AGP 8.13.0 is pinned. Do not install into another project's SDK or dependencies.

```sh
cd android
./gradlew --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

JVM tests cover source filtering, deduplication, London/DST clocks, earliest returned arrival, exact line identity, adverse statuses, endpoint encoding, entrance exclusion and honest no-data states. Node tests cover phone/line/station widget URLs, deferred exact-line opening, no automatic widget GPS lookup, Home preservation and invalid-link rejection.

`DeviceChecks` is a separate instrumentation test APK, not part of the release app. With a named, task-owned emulator, install the debug app and its test APK, then run `com.mema.journey.debug.test/com.mema.journey.DeviceChecks`. `-e live true` explicitly enables a bounded real TfL check; optional `-e station london-bridge -e render true` renders actual native RemoteViews into a test-only PNG. This is not a launcher-placement, button-tap, physical-phone GPS or unattended-scheduler acceptance test. Do not silently turn these checks into recurring runs.

`-e family true` runs 24 native fixture renders: four compact types at minimum, standard and wide bounds, each at 1.0x and 1.3x text, plus failure/expired-state checks. It checks vertical text bounds and writes a labelled contact sheet. With explicit `-e live true`, it additionally performs one bounded departure, route and exact-line read. Fixtures are not live predictions; the instrumentation is not physical-launcher acceptance.

## Signing and distribution

From the repository root, set `JAVA_HOME`, `ANDROID_HOME` and an absolute canonical `JOURNEY_OUTPUT_DIR`, then run `node scripts/build-android-release.mjs`. It builds/tests and signs a release APK with a dedicated local Journey key. It never reuses another app's key. Preserve `~/.android/journey-signing/` securely: both the key and its password are needed for future compatible updates. They are outside the repository with restrictive permissions and must not be uploaded, printed, committed or included in website staging.

Only the signed APK and non-secret release manifest/checksums belong on the GitHub release. The existing 13-file Cloudflare website staging allowlist remains unchanged; Android source, build outputs, tests, private keys and Gradle files are not served by the website.

## Security choices

No JavaScript-to-native bridge; only the exact Journey HTTPS origin is navigated inside WebView. Other HTTP(S) destinations open the system browser; non-web schemes are rejected. File/content access and mixed content are disabled; TLS errors are not bypassed. PendingIntents are explicit and immutable. Widget refresh receiver is not exported, configuration IDs must belong to this provider, and the job service requires Android's BIND_JOB_SERVICE permission. Backups/device transfer are excluded. Release builds are not debuggable. The app uses no analytics, advertising ID or payment account.

## References

- https://developer.android.com/develop/ui/views/appwidgets/advanced
- https://developer.android.com/develop/ui/views/appwidgets/configuration
- https://developer.android.com/develop/ui/views/layout/webapps/webview

See `../docs/ANDROID-ACCEPTANCE.md` for the observed proof and remaining physical-device gates.
