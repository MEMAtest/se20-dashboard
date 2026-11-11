# Journey Location And Cloudflare Release

## Scope

Reuse existing Cloudflare account `58457ba44c5d8179b1982f81a1bb1944`, confirmed in the signed-in dashboard as Ademola@memaconsultants.com's Account. Publish static Journey assets as `journey-london`; no R2 bucket, database, paid plan, domain transfer or change to the existing Hetzner rail API is needed. Retain the Firebase site unchanged as rollback/old installation entry until the new origin is accepted. Browser storage and push/location permissions are origin-bound, so a new installation does not silently inherit them.

## Location Behaviour

Nearby and Tube map expose separate Home and Near me controls. Saved home remains separate from the active area; GPS never replaces the saved home. Nearby results combine buses, Tube, tram, DLR, Overground, Elizabeth line and National Rail, sorted by straight-line distance, with mode filters and estimated walking times. Discovery is TfL/London coverage, not a claim of worldwide stop coverage. Location coordinates are sent to TfL for discovery but are not persisted in the nearby cache. No background location watch or recurring job is introduced. Returning to the foreground after a minute refreshes a previously selected phone area; otherwise tap Near me after moving.

GPS denial, unavailable providers, coarse/old/invalid fixes and source partial failures remain explicit. Late GPS or nearby responses cannot overwrite an explicit newer area selection. Only already granted location permissions auto-follow on launch; new permission is requested on an explicit user action. Device/browser permission decisions still belong to the user.

## Deployment Integrity

Wrangler stages exactly thirteen allowlisted public assets in `.deploy-assets`, including internal `_headers` metadata. Backend code, tests, docs, credentials and repository metadata are never included. This small generated asset-only folder is not a full project copy. Tests and staging run as the custom build; GitHub CI also runs tests without dependencies. The account and app names are pinned in `wrangler.jsonc`.

At preparation: 77 Node tests pass. Local real-data browser confirms Home, mixed nearest-first results, tram filtering, all eleven Tube lines and an explicit location-denied fallback. A simulated geolocation override was attempted but the browser does not permit the required permission grant; it was removed. Do not claim physical iPhone or a successful real device GPS fix from these tests. Production acceptance and automatic GitHub deployment remain separate gates until recorded with the actual published URL and build evidence.

## Resources

Reused canonical checkout and existing cached Wrangler 4.157.0. No new worktree, dependency installation, downloaded browser or new VM. Local free disk was 36 GiB; assets and compact acceptance evidence are bounded below 2 MiB, excluding existing shared dependencies. The native local HTTP test server and any temporary viewport/geolocation override must be stopped/reset at handoff. Keep source commits and unique acceptance evidence; no existing project data is deleted.
