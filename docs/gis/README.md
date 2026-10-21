# GIS implementation and real-data evidence

**Start with the [Lane D handoff](HANDOFF.md)**: station findings, rights gate, next steps and the review trail.

Lane D / Issue #10. Every normalized result is **UNVERIFIED**. Geometry is NOT_FOR_ROUTING; candidate graphs have `routable: false`. These files record observed source contents and processing checks. They do not accept station coverage, currency, access, redistribution into a product or passenger navigation.

- [Tool setup, commands and limitations](../../tools/gis/README.md)
- [Generated real-data summary](real-data-summary.md): every acquisition SHA-256, geometry/conversion counts and network anomalies
- [Current ordered CLI receipt](real-run.json)
- [Current serial validation receipt](validation.json): frozen installation, typecheck, default/real test counts and offline verification
- [Finding dispositions, including Phase 3](fix-pass.md); the lead owns the independent review
- [Current Phase 3 handoff audit](phase3-handoff.json): candidate digest, completed checks and comparison with the Phase 2 reports
- [Acquisitions](acquisitions/): exact URL, catalog resolution pointer/hash, timestamps, headers, size and store-relative path
- [CityGML inventories](inventory/): root/semantic summaries plus a hashed external pointer to every gml:id and its metadata
- [CRS evidence](crs/): explicit arbitrary processing origins, unchanged TP heights, numerical roundtrips and the supplied official GSI independent controls
- [Conversion receipts](conversions/): bounded/full counts, filters, serialization validation, measured time/RSS and external GLB/sidecar pointers
- [Walking-network inventories](networks/): literal columns/properties, source-only anomalies and station-map layers
- [Spatial bbox comparisons](overlap/): source layer bboxes, geographic bbox relations and projected boundary-distance approximations; no feature-alignment or connectivity claim
- [Blender import checks](evidence/README.md): independent import, bbox and axis check of both full GLBs
- [Ikebukuro UNKNOWN/HOLD packet](gaps/ikebukuro.md)
- [Shinjuku UNKNOWN/HOLD packet](gaps/shinjuku.md)
- [Operator permission and field-survey question template](gaps/operator-survey-questions.md), to use with either station packet
- [Historical evidence index](history/README.md): superseded receipts/reports, initial failures and earlier review text; [sanitized historical review receipt](review.json) is explicitly superseded by the lead's three read-only Codex reviews (final verdict APPROVE; see [HANDOFF.md](HANDOFF.md#review-trail))

All downloaded bytes and real derived geometry/graphs/detail tables are outside Git under `$GTEKI_GIS_STORE` or `~/.gteki/gis-store`. Only human-auditable summaries and provenance records are stored here. The tool README explains the deliberate full-detail placement needed to meet the small-metadata boundary.

No source outside the manifest was downloaded, no station/shared-core files were changed, and no PR, merge, release or navigation acceptance is implied.
