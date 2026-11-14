# Live Tube-planner rehearsal correction

The requested rehearsal was typed station entry for Anerley to Victoria and London Bridge to Victoria, using the real public application, not fixture routes.

## Failures Found

1. Main Plan correctly accepted Anerley Rail Station and Victoria, but its default Fastest option was an overall bus/rail route, not a claim of quickest Tube. A Tube-containing alternative also appeared.
2. Opening Quickest Tube connection lost the explicit origin/destination and reverted to Phone location / no destination. The separate origin dropdown only listed Tube stations, excluding Anerley.
3. Selecting London Bridge and Victoria in that form returned a provider error. The schematic parent IDs HUBLBG/HUBVIC were sent as journey endpoint text. A direct bounded provider probe returned HTTP 300 with unrelated disambiguation matches. Exact Tube IDs 940GZZLULNB/940GZZLUVIC returned HTTP 200 and three journeys. No suggested disambiguation place was accepted.

## Correction

Preserve verified child routing IDs separately from schematic parent hub IDs. Prefer the verified child for JourneyResults; a parent without a child can use its selected real coordinates, never the bare HUB string. HTTP 300 stays an explicit endpoint error, not an automatic place substitution.

The Tube form now accepts verified network rail origins while retaining Tube-only destination choices. The Plan shortcut carries the explicit origin choice, selected coordinates/name and exact destination through asynchronous map loading. It never acquires GPS or substitutes Home during that handoff. Existing estimates are invalidated before the new selection is used.

The returned route must actually contain a Tube leg; rail/bus feeder legs are allowed only when Tube + walking only is unticked. Results are ranked by earliest returned arrival, including waiting and walking. This is quickest among the provider's returned qualifying routes, not a mathematical guarantee over every possible journey. The original initial failures remain part of the evidence; a later success does not erase them.

## Verification

154 local Node regressions pass, including six new journey endpoint, rail-origin, disambiguation and handoff tests. The 63 travel regressions also pass under America/New_York. Local browser testing against real TfL data at 21:14 London retained Anerley and Victoria through the shortcut and returned a 49-minute connection via bus 432 to Brixton and the Victoria line. London Bridge to Victoria returned a 16-minute connection via Jubilee to Westminster and District to Victoria. These are time-specific estimates including initial wait, not promises for later journeys. Exact publication and fresh public UI rehearsal outcomes are recorded separately. Browser rehearsal does not prove physical travel, GPS navigation or voice-command support.

Bundle 20261114c; service-worker cache v53. No new service, worktree, dependency or paid run. Existing 13-public-file static release process retained.
