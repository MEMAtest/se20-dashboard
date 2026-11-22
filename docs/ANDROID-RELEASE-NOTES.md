# Journey Android 0.1.0 - early access

Native Android app and home-screen departures widget for Android 8 or newer. The app opens the existing Journey interface; the widget shows a timestamped TfL departures snapshot, service warnings, manual Refresh and an optional saved-destination shortcut.

## Install on your Android phone

1. Download `Journey-Android-0.1.0.apk` from this release and open it on your Android phone. Review the normal Android installer prompts yourself. This is a directly installed APK, not a Play Store release; do not turn off Play Protect.
2. Long-press your home screen and choose **Widgets > Journey**. The app header no longer contains an Add widget button.
3. Choose an exact departure station/stop and optionally a destination (such as your home station), then **Save widget**.
4. Tap **Refresh** before travel. Tap the destination to open the selected journey, then confirm your route. **Edit** changes this widget's settings.

Widget and native-app settings are separate from Chrome/PWA favourites and do not overwrite your existing Home. The widget uses no background location. Foreground location in the full app is optional and requests the normal Android permission when used.

## Important limits

Departure times and checked times are London time. This is a snapshot, not a continuously live countdown. Android may delay the roughly 30-minute background updates; use manual Refresh. TfL predictions do not cover every National Rail service. Empty, partial, stale and failed reads are not silently treated as healthy or replaced with invented departures.

Build/unit/lint and bounded installed-runtime/provider checks have been performed. A physical Android phone's launcher placement, widget buttons, GPS permissions and unattended battery-restricted updates have not yet been accepted. This is why this release is marked **early access**. It does not add voice commands or guaranteed turn-by-turn/background tracking.

Verify the APK SHA-256 in `release-manifest.json`. The release uses a dedicated Journey signing key, not a debug key. Android source and the acceptance boundary are included in the repository under `android/` and `docs/ANDROID-ACCEPTANCE.md`. No new paid service is required.
