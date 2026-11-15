# Compact widget family, 15 November 2026

This extends, rather than replaces, the original 0.1.0 acceptance record. Version 0.2.0 / code 2 uses the existing Journey signing identity and preserves the original board provider and per-widget settings. Four separately registered native providers have their own configuration and actions: Next up, Go home, My journey and Line watch. The 4 x 4 board is optional, not the default sole choice.

## Observed candidate evidence

- 163 Node regressions pass, including station/phone/line handoff validation, Home preservation and deferred exact-line opening.
- 13 JVM tests pass; native debug build, instrumentation APK and lint pass. Lint warnings remain, including deliberate English-only native strings; zero errors is not zero warnings.
- API 35 installed-runtime checks passed 231 assertions, including 24 native fixture renders at minimum/standard/wide bounds and 1.0x/1.3x text, plus error/expired states and three bounded live source checks. The native contact sheet was visually inspected. The first matrix exposed clipped large-text clocks/timestamps; the corrected matrix passed vertical bounds checks. Horizontal ellipses at minimum bounds are intentional; full labels remain in accessibility descriptions/opened details.
- Real public TfL reads at 09:35 London returned 11 London Bridge departure rows, a London Bridge to Victoria route estimate (Jubilee to Westminster, Circle to Victoria), and the exact Windrush Part Closure status. These are point-in-time source checks, not current travel advice or a claim of complete National Rail coverage.
- Fixture times/statuses in the render sheet are explicitly labelled. They are not real departure predictions or screenshots of a phone launcher. The instrumentation test app is not included in the signed release.

Canonical release evidence: `/Users/omosanya_main/storage-audit/journey-20261111/android-widgets-20261115/`. Source and final APK hashes, hosted CI, distribution and website verification are recorded separately there after release. No repository copy or new worktree was created.

## Remaining boundaries

No physical phone is connected. Actual launcher placement, taps, foreground location grant/denial, per-launcher resizing and unattended Android battery-constrained updates are not accepted from programmatic RemoteViews rendering. Native minimum widths and cell counts are hints, not a guarantee of identical pixel bounds on every launcher. This remains early access, not a Play Store listing or full phone certification.

All clocks/statuses are dated snapshots. The view does not autonomously become a live countdown, and can age between Android updates. Refresh before travel. Home is a shortcut with no background jobs/location; Find route in the opened planner requests location explicitly. Failed/expired source data clears the apparent current answer on the next render. There is no new paid service or continuously running model.
