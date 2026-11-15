# Journey Android companion

Small Java/framework Android application (Android 8 / API 26 or newer), with no runtime third-party dependencies. The main interface is the existing HTTPS Journey application in a restricted WebView. The home-screen widget is a real Android AppWidget using native RemoteViews, not a web shortcut.

## Use

1. Install the signed early-access APK from the `android-v0.1.0` GitHub release on your Android phone. The APK is not a Play Store listing. Review Android's installer prompts yourself; do not disable Play Protect.
2. Open Journey and tap **Add widget**, then accept your launcher's placement prompt. Alternatively, long-press the home screen, choose Widgets, then Journey.
3. Search and select an exact departure station/stop. Optionally select an exact shortcut destination, such as your home station. Typed text alone cannot be saved as a selected station.
4. Tap **Save widget**. Use **Refresh** before travel. Tap **Edit** to reconfigure. Tap the destination button to open Journey with your chosen endpoints, then confirm a route or use Quickest Tube connection.

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

The nine JVM tests cover source filtering, deduplication, ordering, London clocks, endpoint encoding, selected stations, entrance exclusion and honest no-data states. The Node suite covers widget URL validation, no automatic provider request/GPS lookup, Home preservation and invalid-link rejection.

`DeviceChecks` is a separate instrumentation test APK, not part of the release app. With a named, task-owned emulator, install the debug app and its test APK, then run `com.mema.journey.debug.test/com.mema.journey.DeviceChecks`. `-e live true` explicitly enables a bounded real TfL check; optional `-e station london-bridge -e render true` renders actual native RemoteViews into a test-only PNG. This is not a launcher-placement, button-tap, physical-phone GPS or unattended-scheduler acceptance test. Do not silently turn these checks into recurring runs.

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
