# Ikebukuro navmesh spike

2026-10-30 00:25 JST. The initial experiment covered a synthetic scene. The app has not been integrated with this spike.

## Step 1: public scene bake

2026-10-30 00:39 JST. The public Ikebukuro scene was baked in an OrbStack container limited to 3 GB. The `.bin` is local and gitignored at `.qa/navmesh/ikebukuro.bin`; it contains no greybox or off-mesh links.

- Raw size **852,328 bytes**; gzip **234,717 bytes**; Recast generation including WASM initialization **794 ms**.
- **479 non-empty tiles**, **4,809 polygons**; peak process RSS **285,196 KiB** (Node `process.resourceUsage().maxRSS`, Linux high-water mark, includes scene loading and the rest of the process).
- Cell size 0.15 m, cell height 0.1 m; 64-cell tiles (9.6 m wide) bound per-tile work while reducing tile count relative to 32 cells. Radius 0.3 m, height 1.7 m, climb 0.3 m, slope 40°.
- Input: 717 ground meshes, 656 collider meshes, 0 wall segments and 41,819 triangles. Meshes use world transforms and instance transforms. Collider triangles are rasterized using a winding-based obstacle approximation; meshes present in both sets cause the bake to fail because their surface semantics are ambiguous (there were none in this run). Walls, if present, are 5 cm thick boxes across the segment and its vertical range. This approximation and shared mesh handling need collision parity validation.
- The scene loader reported that 68 of 69 decorative stair-nosing strips were skipped due to unavailable or incompatible assets. This bake uses the headless low-quality scene; do not infer full visual asset coverage from it.
- Greybox was not built or measured in this step-1 run; the step-4 flag and public measurements are documented below.

The public graph has **25 stair edges**, **0 escalator edges**, and **0 elevator edges**. Both endpoints of 24 stairs snap within 0.5 m; 21 of those have a complete navmesh path. Of the 21, **20** paths stay within 2 m in plan of the graph edge geometry (sampled every 0.5 m), making them local connector candidates; **5** stairs lack such evidence. This heuristic rejects an obvious detour but does not prove the actual stair is traversed or that each of the five needs a link: missing endpoints, geometry, or alternative routing can also explain a failure. No off-mesh links have been added. Further connector inspection is required to determine the true link count.

## Step 2: public route audit

2026-10-30 00:57 JST. With the default profile, 33 POIs have connectors; of 1,056 ordered distinct pairs, **1,054** produced routes and two did not. Of those, 760 use only navmesh edge queries and 294 use at least one graph stair fallback. These are complete audit polylines, not proven continuous navmesh journeys. The fallbacks are graph edge polylines, not validated off-mesh connections. Across all routes, 592 joins have nonzero gaps (maximum 0.145 m); the audit includes the straight segments across those gaps. The routes use 67 unique edges (134 directed edge queries; 9,846 edge uses). Directed edge queries are cached.

| Sampled result | Navmesh with stair fallbacks | Graph polyline, same routes |
| --- | ---: | ---: |
| Samples | 580,788 | 580,808 |
| Off floor | 28,102 | 1,216 |
| No floor | 0 | 0 |
| Wall hits | 1,384 | 0 |

The navmesh result does not meet the zero-wall-hit target. Off-floor samples are 4.84% of navmesh samples and 0.21% of graph samples; sample totals differ with geometry and vertex density. `auditPolyline` samples every 0.5 m and tests two body-height rays and wall segments; it is not a swept-body proof. Straight navmesh path segments and transitions between snapped endpoints and fallback stair polylines are included in these counts. Root causes have not been isolated.

Three unique edges (six directed queries) have no navmesh path; all six failed as no-path queries rather than failed snaps or paths over the two-times-edge-length threshold. Each is a stair whose fallback is counted as needing a link under the requested rule. These are public edge IDs. Gap is the straight 3D node-to-node distance, not a measured missing-floor gap.

| Edge | Mode | From floor | Direction | Gap m |
| --- | --- | --- | --- | ---: |
| ne_e__x33 | stairs | b1 | forward | 21.85 |
| ne_e__x33 | stairs | street | reverse | 21.85 |
| c_s__x37 | stairs | b1 | forward | 18.18 |
| c_s__x37 | stairs | street | reverse | 18.18 |
| n_e__ne_j | stairs | b1 | forward | 13.52 |
| n_e__ne_j | stairs | b1 | reverse | 13.52 |

Among 66 distinct successfully snapped nodes, total 3D snap distance is p50 **0.100 m**, p95 **0.317 m**, max **0.603 m**; the separate height limit is 0.6 m. Median walked-path length / graph-polyline length is **0.997** across the 1,054 complete routes. Snaps use renderer half extents (1, 0.6, 1) m. The height check cannot prove floor identity or wall-side correctness. Search extents do not bound total horizontal snap distance to 0.6 m. A complete query can use a different nearby corridor, so edge-local traversability is not established.

The source `route-clip-audit.ts --all` iterates graph edges, not POI pairs. This audit enumerates ordered pairs directly with `routeBetween` and the default profile, and compares the same route set. Unsuccessful `routeBetween` results are not counted as routes. For future cases with an unresolved non-stair edge, the comparable graph total excludes that incomplete navmesh route; `graphAllRoutableTotals` also records the full graph baseline separately.

## Step 3: height and wall diagnosis

2026-10-30 01:18 JST. The same 1,054 routes were sampled at identical positions using the step-2 0.5 m sampler. Detail-mesh heights come from `getPolyHeight` on polygons in the queried edge corridor; when overlapping corridor polygons yield heights more than 0.05 m apart, the height is treated as ambiguous and left unchanged. The corridor is reconstructed with a second query, and its equivalence to the original path is not independently established. Graph stair fallbacks and join gaps have no corridor and retain raw height. The scene variant uses the checker's nearest scene-floor ray hit within ±3 m of the raw sample height. The latter is a diagnostic against the same geometry used by the checker, so its zero off-floor count is not independent validation.

| Audit | Samples | Off floor | No floor | Wall hits |
| --- | ---: | ---: | ---: | ---: |
| Before: raw straight corner segments | 580,788 | 28,102 | 0 | 1,384 |
| After: detail height where available | 580,788 | 960 | 0 | 0 |
| Scene-floor raycast height | 580,788 | 0 | 0 | 0 |
| Graph baseline (same routes) | 580,808 | 1,216 | 0 | 0 |

Absolute sample-height minus the nearest scene-floor height selected independently for each variant, in metres; the selected floor can differ between variants:

| Variant | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| Raw | 0.070 | 0.287 | 2.191 |
| Detail where available | 0.060 | 0.100 | 0.512 |

Detail heights were unavailable for 36,675 samples (12,568 on stair fallbacks, 592 on joins, 640 with conflicting polygon heights, and 22,875 others); these retain raw heights in the detail row and its distribution. Of the 960 detail-row off-floor samples, 640 have a detail height and 320 retain raw height. Of 544,113 available detail heights, the absolute change from raw is p50 0 m, p95 0.234 m, maximum 2.058 m. The detail variant contains 2,908 consecutive sample pairs with a height change above 0.3 m, maximum 0.442 m; this is a diagnostic, not a movement simulation.

There are **zero variant-b wall-hit samples**, so each requested wall-hit class has count zero and there are no top ten hit walls to list. This does not prove wall avoidance: the checker uses two rays rather than a swept radius, heights can change substantially, 36,675 samples lack detail heights, and sampled routes include unverified joins and stair fallbacks. Public `scene.walls` contains zero 2D wall segments; collider meshes supply the wall checks. All collider meshes were submitted to the bake, using the winding-based obstacle approximation described above. There is no evidence from this run to attribute remaining problems to unbaked wall segments, rasterized corners, joins, or a different corridor.

The method change is per-sample detail-height evaluation before the full audit; it materially changes the counts without changing graph routing or bake geometry. A per-sample scene-floor raycast is useful as a diagnostic but cannot independently prove floor fidelity. No radius inset was added: no variant-b hit established that as a valid fix. The 0.3 m agent radius is already rounded up to two 0.15 m cells in the bake. The same public route set, stair fallbacks and sampling checker were retained.

## Step 4: runtime and greybox input

2026-10-30 01:34 JST. Public Node measurements were taken inside a 3 GB OrbStack container. Load time includes reading the binary, WASM initialization and import; memory is total process RSS immediately after load, before scene loading. The edge measurement makes one fresh query per directed route-used edge with two successful snaps. The route measurement makes fresh queries for each route's edge sequence; it includes query-loop overhead but excludes graph routing, scene loading, ground probes, rendering and guidance. Failed paths are timed as queries; edges without both snaps are skipped. These are single-run measurements, not device benchmarks.

| Public station | Load ms | RSS after load MiB | Edge p50 / p95 ms | Route p50 / p95 ms | Routes timed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ikebukuro | 39.71 | 115.5 | 0.0194 / 0.3471 | 0.1060 / 0.4396 | 1,054 |
| Shinjuku | 37.76 | 102.4 | 0.0081 / 0.0341 | 0.1551 / 0.3773 | 238 |

Phone estimates are the Node times multiplied by **4**, not phone measurements: Ikebukuro load 158.82 ms, edge p50/p95 0.0776/1.3885 ms, route p50/p95 0.4241/1.7585 ms. Shinjuku load 151.03 ms, edge p50/p95 0.0325/0.1365 ms, route p50/p95 0.6203/1.5093 ms. The estimate excludes the costs listed above.

At step 4, `--with-greybox` built the explorer's then-current low-tier greybox. The optional bake capture records its generated floor triangles separately from its shell obstacles, clips selected scene collider triangles at portal volumes, and includes split wall segments. The audit adds greybox floors and walls and filters portal collider hits using the explorer's opening rule. The binary and audit must be built with matching flag and input. Both scripts use `GTEKI_PRIVATE_DIR` to build an overlay from a temporary copy; the source private directory is not written. No private station data was run or recorded here. At that time a shell-truncated greybox was rejected; step 5 replaces this with the updated non-truncating generator.

Both public runs generated **zero greybox passages**. Synthetic tests exercise a non-empty passage, a cut portal and preservation of surrounding wall collision; private overlays and real non-empty station passages have not been validated. Greybox clipping and the winding-based Recast obstacle approximation remain experimental, not a runtime collision guarantee.

Public Shinjuku, with the greybox flag, baked in **1.83 s**, with **341,056 raw / 101,740 gzip bytes**, **111 tiles**, **1,924 polygons** and **589,976 KiB** peak process RSS. It completed within the 3 GB and 20-minute bake limits. Of 238 routable ordered pairs, 36 yielded constructed audit paths and 202 had unresolved non-stair edges; the comparable 36-route scene-height audit reported **0 off-floor / 1 no-floor / 0 wall hits**, as did its graph baseline. There were 19 unique edges without acceptable paths. The 238 route-query timings include partial query sequences for incomplete routes, so they are not complete Shinjuku journey timings.

## Step 5: greybox update and public Shinjuku diagnosis

2026-10-30 01:45 JST. Merged `origin/claude/greybox-passages` at `c7b963e0`. Nav floor capture follows its simplified emitted passage quads and junction discs; the old truncation rejection is removed. Bake and audit now use the updated Explorer rule: every wall-like scene-collider hit within an opening is exempt. A synthetic private overlay forced a non-empty greybox and successfully ran both CLIs with `GTEKI_PRIVATE_DIR` and `--with-greybox`, without writing an overlay to the input directory. No real private data was run.

The public baseline has 238 graph-routable ordered POI pairs, 36 constructed audit paths and **202 incomplete routes**. Failure counts below are **directed edge queries**, not routes. Mode counts of affected routes overlap because one route can contain several failed modes: walk 94, gate 174, escalator 140, elevator 28. The three unique gate edges appear in both directions.

| Non-stair edge class | Directed queries | Both endpoints snap? | Detour result |
| --- | ---: | --- | --- |
| Escalator | 7 | Yes | Destination polygon not reached |
| Elevator | 4 | No, at least one missing | Unknown |
| Walk | 2 | Yes | Destination polygon not reached |
| Walk | 3 | No, at least one missing | Unknown |
| Gate | 6 | Yes | Destination polygon not reached |

The unreached rows are labelled disconnected by the audit when Detour does not report a node or output-buffer limit; this is a bounded path-query result, not an independently computed polygon-component proof. A successful snap also does not prove correct floor or wall side. In addition, six directed stair failures use the existing graph fallback: four have a missing snap and two have a connected path rejected as over twice the graph edge length.

For same-floor failures, the diagnostic samples wall segments at 0.5 m intervals along the graph edge and measures the smallest perpendicular cross-section with a wall within 5 m on each side. This is an **approximate wall-only cross-section**, not a verified doorway width or full body clearance; other mesh obstacles and the actual navmesh path are not measured. Cross-floor results and samples without walls on both sides are unknown. Ten public examples, with endpoint snap state in the listed direction:

| Public edge ID | Mode | From / to snapped | Detour | Sampled wall section m |
| --- | --- | --- | --- | ---: |
| e:06a78a8f616c4a75a7b4eece6a295c4c | escalator | yes / yes | destination unreached | unknown |
| e:203cbf0c5d724f7fa48027cf741e7628 | walk | yes / yes | destination unreached | 2.33 |
| e:2692fe08625f4a3f92d69a1380a58ccd | escalator | yes / yes | destination unreached | unknown |
| e:2768d162a2d648cf9df2fc76ca89257f | escalator | yes / yes | destination unreached | unknown |
| e:27d3ed498cc9423683ee7f502c5d2460 | escalator | yes / yes | destination unreached | unknown |
| e:3763bee44e4740ac86216e99e212f8d1 | gate | yes / yes | destination unreached | 1.24 |
| e:4fc06b0d45184e66aaa3bb1ea9ddcd62 | escalator | yes / yes | destination unreached | unknown |
| e:5ce3f318ea6947d293e646157109d628 | walk | yes / no | unknown | 2.31 |
| e:65edd7ca50844b609d4dcb25bd296936 | elevator | no / no | unknown | 1.55 |
| e:80b372f586204d5cbe5769beffcfbf56 | gate | yes / yes | destination unreached | 0.62 |

The 0.62 m section is only about 0.02 m wider than the 0.60 m walker diameter, but the sample alone cannot establish that it is the limiting opening or why the mesh disconnects.

| Experiment | Effective erosion | Incomplete routes | Unique failed edges | Directed failures |
| --- | ---: | ---: | ---: | ---: |
| Baseline radius 0.30 m, round up | 0.30 m (2 cells) | 202 | 19 | 28 |
| Radius 0.25 m, round up | 0.30 m (2 cells) | 202 | 19 | 28 |
| Radius 0.25 m, round down | 0.15 m (1 cell) | 92 | 11 | 15 |
| Gate obstacles removed | 0.30 m (2 cells) | 202 | 19 | 28 |

Rounding down admits paths with only 0.15 m of Recast erosion and **does not satisfy the 0.30 m walker radius**. In the round-down run, remaining incomplete-route mode counts are escalator 75 and elevator 28 (overlapping). Gate-machine source walls are tagged for the experiment: eight bands exist, but all eight have empty effective height bands and were already excluded from the baseline obstacle input. The visible gate machines are not themselves scene collider meshes; the gate-off result is therefore a no-op for those eight bands, not evidence that real gates have no effect. All four runs used public data, the same scene and 3 GB container limit.

Each bake now records the binary SHA-256, effective erosion and gate exclusion counts, and the audit checks its accompanying metadata and records it in the output. The gate-off audit still checks collisions against the original scene; in this run no active gate obstacle was removed. The metadata does not fingerprint the full input scene or overlay, so rebake after changing either. Zero-cell erosion is rejected.

## Step 6: hybrid transition, work in progress

2026-10-30 02:02 JST. The director's transition rule makes the navmesh primary and permits graph-polyline fallback only for edges on a committed list, which must only shrink; the proposed CI gate also requires zero navmesh-segment clips. At this point the step was **not complete**. No fallback list or passing CI gate has been established.

| Public station | Earlier unique failed edges | After links | After parameter choice |
| --- | ---: | ---: | ---: |
| Ikebukuro | 3 (step 2, all stairs) | not measured | not measured |
| Shinjuku | 19 (step 5, including 4 stairs) | not measured | not measured |

These earlier failure counts are not committed fallback-list lengths. At that point the two-pass link candidate helper was not connected to the station CLI or route audit; step 7 below implements that integration. Stair/escalator kit classification and landing clearance remain unverified.

The bake accepts experimental cell size and climb values and records their effective quantised values. With the existing 0.1 m cell height, climbs of 0.40 m and 0.45 m both quantise to 0.40 m. No full parameter sweep or default selection has been completed; in particular the existing ray-based audit does not perform the required swept `WALKER_BODY` radius check. A fallback set-diff helper and unit test exist, but list generation, public lists, private destination handling, comparison against the PR base, and the CI gate are still outstanding.

As a preliminary **pre-link** check, both public stations were baked at 0.10 m cell size, 0.30 m radius, 0.40 m climb in a single 3 GB container at 2026-10-30 02:04 JST. These are not the requested post-link or swept-radius results, and the audit excludes incomplete routes from its scene totals.

| Station | Incomplete routes | Unique failed edges, including vertical | Scene-height off floor / no floor / wall hits | Bake ms | Gzip bytes |
| --- | ---: | ---: | --- | ---: | ---: |
| Ikebukuro | 0 / 1,054 | 1 | 0 / 0 / 0 | 1,151 | 353,721 |
| Shinjuku | 28 / 238 | 6 | 0 / 92 / 0 | 3,178 | 160,552 |

The headless Ikebukuro scene load reported that some stair kit assets were skipped, so this run does not validate the effect of modelled stair meshes on landings.

Oracle advised a two-pass bake, checking actual Detour link IDs and direction after export/import, reconstructing authored link polylines rather than straight Detour links, and testing long links across tiles. A route can otherwise appear connected through the wrong connector or an unattached link. In a subsequent review Oracle identified cross-wall snaps and output symlinks as blockers. Bake and audit output reject symlinks that escape `.qa` or occupy the output file.

## Step 7: off-mesh connectors

2026-10-30 02:18 JST. Public bakes use 0.10 m cells, 0.30 m radius and 0.40 m climb. The earlier comparison used 64-cell tiles; this run uses 256-cell tiles (25.6 m) to permit a longer Ikebukuro stair link to attach. A 64-cell linked trial still left that stair disconnected. The bake builds the mesh twice and checks that each emitted link polygon has both endpoint attachments; one-way direction follows the graph. Snaps are checked against scene floor and wall crossings, with the approach floor sampled at 0.5 m. The audit checks that a vertical edge uses its own link, reconstructs connector geometry from its graph polyline, and reports connector samples separately.

| Public station | Incomplete routes before | Incomplete routes after | Unique failed edges before | Unique failed edges after | Attached link polygons |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ikebukuro | 0 / 1,054 | 0 / 1,054 | 1 | 0 | 25 |
| Shinjuku | 28 / 238 | 88 / 238 | 6 | 7 | 50 |

The before audit allowed failed stairs to use graph fallback while counting the edge as failed. The after audit requires the actual link and has no implicit stair fallback; it also rejects joins with detected floor or wall violations. Thus the route totals are not strictly like-for-like, and the tile size also changed. A complete Detour corridor can choose a different route even when the assigned link is attached; rejecting such a corridor is conservative and can overstate failed edges.

Ikebukuro had no rejected endpoint snaps. Shinjuku had **3 endpoint snap failures** (no suitable polygon within the search) across two edges and **14 floor-validation rejections** across 12 more edges; no wall-validation rejections were observed. Validation of the other endpoint is skipped when either endpoint does not snap. All 25 and 50 respective candidates were emitted and had links to both endpoint polygons; this attachment check alone does not prove every connector is used by a route.

For complete routes only, the raw connector audit is Ikebukuro **1,216 off-floor / 0 no-floor / 0 wall hits**, Shinjuku **0 / 0 / 0**. Raw navmesh segments are **13,202 / 0 / 0** and **0 / 0 / 0**, respectively. Scene-floor-height projection gives **0 / 0 / 0** for both segment classes on both stations, but is circular with the floor check and does not establish swept-body clearance. Incomplete routes are excluded from these totals.

The independent review found risks in link attachment, floor gaps, wrong-connector paths, joins and provenance. After review, the code checks attachment, sampled approach floors, connector identity, joins and bundle identity; these changes have not received another independent review. Scene geometry itself is not fingerprinted, approach samples can miss a narrow gap, and private QA outputs contain detailed private graph information and must not be published. The station bake does not selectively reclassify stair-kit meshes, and the headless Ikebukuro loader reported skipped kit assets; landing geometry still needs validation.

## Step 8: endpoint diagnostics and neighbour experiment

2026-10-30 02:36 JST. The audit now reports aggregate diagnostics for failed endpoints of distinct vertical edges used by the public route set. It searches for the nearest polygon in a 1.5 m horizontal box with a wide height range, records signed and absolute height differences, and classifies missing polygons, height mismatches, floor validation and wall validation. The 3 m floor-presence result samples downward rays on a 0.5 m grid at the node's floor elevation; a negative result is not proof that no small floor patch exists. IDs remain in the local detailed audit, not in this public report; stdout contains an aggregate-only summary.

| Public station | Failed endpoints | No polygon / height / floor / wall | Sampled floor within 3 m | Absolute height difference p50 / p95 / max |
| --- | ---: | --- | ---: | --- |
| Ikebukuro | 0 | 0 / 0 / 0 / 0 | 0 | no samples |
| Shinjuku | 10 | 0 / 3 / 7 / 0 | 10 | 0.303 / 7.766 / 7.766 m |

The ten Shinjuku values have signed Δz p50 0.034 m and p95/max 0.382 m; the absolute distribution exposes the large negative floor mismatch. These endpoint counts are not edge or route counts. Ikebukuro has no failed endpoint samples, rather than a measured zero height difference.

`--snap-fallback` must be supplied to **both** bake and audit. Since a Detour off-mesh link cannot terminate at a point without a polygon, the experiment creates a composite connector from a neighbouring attached polygon to the opposite vertical landing. It preserves the graph approach and vertical geometry, and consumes an adjacent graph approach and connector as a pair. It considers only traversable, bidirectional, same-floor neighbour edges with at most 3 m of approach, and rejects approaches with sampled floor or wall violations. This deliberately conservative subset does not cover every possible neighbour. The report distinguishes attached composite candidates, distinct fallback edges used, and completed routes using them.

The composite link is only meaningful to a consumer that interprets its metadata and follows the authored approach and connector geometry: a generic Detour consumer would traverse the straight link and could cut through a wall. It is an audit experiment and is not ready for application movement. The independent review also identified join connectivity and early recovery counting; the audit now requires both join endpoints within 0.02 m of their snapped polys and an ordinary navmesh path no more than 0.3 m longer than the direct join, and counts fallback edges used only after a route completes. These conservative checks can reject a usable join. The fixes and atomic graph-step pairing postdate the review and have not received another independent review. Private-derived detailed JSON and binaries remain under `.qa` and must not be published; bake and audit stdout now print aggregate summaries. Earlier gate-obstacle exclusion counters may undercount instanced triangles and degenerate walls.

| Public station | Incomplete routes, baseline / fallback | Failed edges, baseline / fallback | Fallback links attached / used | Completed routes using fallback |
| --- | --- | --- | --- | ---: |
| Ikebukuro | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| Shinjuku | 88 / 88 | 7 / 7 | 0 / 0 | 0 |

At 0.10 m cells, 0.30 m radius, 0.40 m climb and 256-cell tiles, both the default detail-height and scene-raycast-height navmesh segment audits report **0 off-floor / 0 no-floor / 0 wall hits** on the completed public routes for both stations. Incomplete routes are excluded. The scene-height result is the requested gate number, but is not a swept-body clearance test.

## Step 9: landing pads and floor diagnostics

2026-10-30 02:55 JST. The runtime greybox now emits a square landing at each traversable vertical endpoint whose scene floor probe fails, using the node render elevation and at least 1.5 m width. Where an adjacent traversable non-vertical edge reaches a scene floor within 3 m, its sampled geometry supplies a short strip. Pads share shell tags and budget handling with runs; `stats.landingPads` counts distinct nodes. The bake captures pad floor triangles through the existing greybox floor input. A synthetic test finds the pad in the baked navmesh.

Both public stations were measured in the same 3 GB container at 0.10 m cell size, 0.30 m radius, 0.40 m climb and 256-cell tiles, with greybox enabled. The before runs used the previous greybox source inside the isolated container.

| Station | Landing pads before → after | Failed edges before → after | Incomplete routes before → after | Failed vertical endpoints before → after |
| --- | ---: | ---: | ---: | ---: |
| Ikebukuro | 0 → 0 | 0 → 0 | 0 / 1,054 → 0 / 1,054 | 0 → 0 |
| Shinjuku | 0 → 8 | 7 → 6 | 88 / 238 → 72 / 238 | 10 → 6 |

For Shinjuku after pads, the six failed vertical endpoints are three height mismatches and three floor-validation failures. All three nearest mismatched polys are below the node; two of those nodes have a greybox floor at their position within 0.6 m height. Of the three floor failures, the snap-point floor ray hits scene floor twice and greybox floor once; all three fail the approach off-floor rule. Before pads, the three mismatches were all below with no greybox floor at the node; seven floor failures were one missing snap floor, four missing approach floors and two off-floor approaches. Both stations' completed navmesh segments remain **0 off-floor / 0 no-floor / 0 wall hits** for both default and scene-raycast heights. Incomplete routes are excluded, and the check is not swept-body validation.

These public figures do not determine the private result. The lead must rerun the private build. Floor-source and failure-rule diagnostics are aggregate only; detailed outputs remain under `.qa` and must not be published for private builds.

Oracle's static review identified narrower overlapping corridor footprints and horizontal graph edges taking unrelated vertical links as concrete risks. The emitter now retains a wider overlapping run and clips pad side walls against corridor coverage; the audit rejects off-mesh detours on non-vertical edges. These changes postdate that review. The requested trigger checks the node's floor, so partial support elsewhere in a landing remains a follow-up. Earlier short-gap detection and thick-wall portal handling also need separate investigation. Pad orientation, ceilings and overlapping branches need scene-level validation; the synthetic tests do not prove stairwell clearance.

## Evidence and missing measurements

- `recast-navigation` 0.43.1 is installed only in `@gteki/godot`; its package licence is MIT. It uses WebAssembly and includes the 0.43.1 core and generators packages.
- In the 3 GB OrbStack test container, two synthetic rooms connected by a 1.6 m doorway produced a path; closing the wall produced no complete path. The helper checks the path endpoint because Detour may return a partial path. The agent parameters are radius 0.3 m, height 1.7 m, climb 0.3 m and slope 40°, with 0.1 m voxels.
- The earlier synthetic-only run did not measure a station bake; the public step 1 measurements are above.
- The earlier synthetic-only run did not measure routes; the public step 2 comparison is above.
- The earlier steps did not measure runtime; the public Node measurements and ×4 estimates are in step 4 above.
- The earlier combined bake-and-audit command failed because `navmesh-audit.ts` did not yet exist; subsequent steps added and ran it.

## Query-capacity diagnostic, 2026-10-30 03:03 JST

The audit query now allocates 8,192 Detour nodes and distinguishes the out-of-nodes or corridor-buffer limit from query errors. A reached corridor is still rejected if it takes a different connector from the graph edge; the new aggregate diagnosis counts that case separately from an absent attached link and reports the distance from the end of a partial corridor to its goal. A partial corridor remains a failure, even when its end is near the goal.

Public data, with greybox, 0.10 m cells, 0.30 m radius, 0.40 m climb and 256-cell tiles:

| Station | Routes | Incomplete | Unique failed edges | Directed failures | Connected but rejected: missing / wrong connector | Query limit / error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ikebukuro | 1,054 | 0 | 0 | 0 | 0 / 0 | 0 / 0 |
| Shinjuku | 238 | 72 | 6 | 9 | 3 / 2 | 0 / 0 |

Both stations have 0 off-floor, 0 no-floor and 0 wall-hit samples on completed navmesh segments, under the scene-raycast audit. These public counts match the preceding run; they do not show whether the increased capacity recovers private failures. No partial corridors occurred in these public failures.

This is a partial diagnostic. Direction and tile-region checks, gap sampling and classification, and a safe bridge-and-rebake pass are not implemented. The missing- and wrong-connector diagnoses do not themselves fix the rejected routes. In particular, do not use these numbers as evidence that a generated bridge clears walls or is walkable at runtime.

Oracle static review at 2026-10-30 03:07 JST identified a partial-path property error, missed straight-path buffer exhaustion, and link anchors being reported as snapped nodes. These were corrected after review; the reviewer did not independently run the tests or review the fixes. Full query-stage diagnostics and targeted synthetic tests for partial corridors and straight-path exhaustion remain follow-ups.

## Integration sketch

- Guide: `apps/web/src/ui/app.ts` creates `routePolyline` and passes it to `Explorer.startGuide`; `Explorer.stepGuide` follows it. Supply per-edge navmesh geometry while preserving step-to-point spans, instructions, floor and lift semantics. Risk: a partial or disconnected path must stop guidance, and snapping can select the wrong floor.
- Free walking: `Explorer.stepWalk`, `bodyCollision.ts` and `walker.ts` `resolveWalls` currently resolve motion. A navmesh nearest-poly and move-along-surface query could constrain motion, but retaining collision checks until geometry parity is demonstrated avoids assuming the bake covers dynamic and authored obstacles.
- Follow camera: `followCamera.ts` `followPose` and `Explorer.placeCamera` can stay collision-based initially. A corridor only describes walking space, not camera clearance.
- Ribbon and minimap: `Explorer.showRoute` and `minimap.ts` `setRoute` need the same resolved path as the guide, with floor and step associations preserved; otherwise the drawings can disagree with movement.
- Godot: `export-scene.ts` `exportStationScene` exports the scene and `gteki_bridge.gd` invokes the route CLI. A future export would need an explicit navmesh artifact and a compatible query/route bridge, plus parity for coordinate frames, links, and obstacle updates.

## Recommendation

Decision deferred pending further diagnosis. Per-sample detail heights reduce the sampled violations, but missing detail heights, stair fallbacks, unverified joins and collision parity remain unresolved. Implement and measure the actual scene plus greybox, ensure collider and portal geometry agree with the explorer, test vertical links without introducing wall crossings, and audit identical route pairs before deciding whether to adopt fully, partly, or reject.

## Geometry risks identified during investigation

The greybox shell is both walkable and collider and includes floors, ceilings, sides and underside surfaces, so feeding all its triangles to Recast without classifying them can introduce false floors. Scene wall segments also need representation in the bake. The explorer splits wall segments at openings but handles mesh-collider portals separately; the bake must match that behavior. The old step-1 greybox could truncate navigation-relevant geometry; the step-5 generator does not truncate floor or walls. Vertical connections require validated endpoints and directionality, and snapping needs floor and wall-side validation. These are code-review risks, not measured station failures. The current synthetic helper proves none of them.

## Independent review

Review started 2026-10-30 01:42 JST: Oracle's static review raised blockers to treating these measurements as validated navigation. Endpoint snaps can cross walls; the specified search extents do not establish reachability from the graph node. The requested Explorer portal rule exempts all wall-like hits in an opening and can also exempt an unrelated obstruction. Rounded-down clearance is optimistic; zero-cell erosion is now rejected and the effective radius recorded. Bake provenance is now attached and checked, and failure classes include rejection reasons. The gate-off collision audit uses the original scene, as identified above. The sampled wall sections do not establish door clearance; junction patches after simplification also need targeted geometry validation. These limitations remain follow-ups before navigation adoption. Oracle did not independently run the station measurements or review those subsequent fixes.

2026-10-30 00:28 JST: Oracle reviewed the explicitly incomplete synthetic experiment and found no blocking defects in that limited scope. It confirmed that station geometry, floor-aware snapping, links, route comparison and benchmarks remain unfinished; it did not independently execute the tests.

## Step 1 independent review

2026-10-30 00:39 JST: Oracle found blockers to treating this bake as navigation-correct. Shared ground/collider meshes can contain mixed semantics; the bake now rejects such input, and none appeared in this public run. Recast low-hanging-obstacle filtering may disagree with explorer collision even when collider winding is reversed. The vertical query checks do not prove authored floor, wall side, or traversal of the actual connector. Wall extrusion has not been exercised by this public scene or the synthetic test. These remain open validation limitations; the review did not independently run the bake.

## Step 2 independent review

2026-10-30 00:53 JST: Oracle identified misleading treatment of hybrid stair fallbacks, overly long detours and discontinuous joins, and warned that nearest-poly snapping and endpoint reachability do not establish floor identity, wall side, or traversal of the authored edge. The revised audit distinguishes pure queries from stair-fallback routes, reports missing-path versus excessive-detour reasons and join gaps, and checks both path endpoints. It retains the brief's snap extents and audits join segments; these do not establish navigability across those joins. The reviewer did not run the audit.

## Step 3 independent review

2026-10-30 01:18 JST: Oracle found blockers to treating these diagnostics as authoritative collision or root-cause evidence: unverified node snaps and joins, circular scene projection, overlapping or independently reconstructed corridor polygons, and a two-ray rather than swept-body wall checker. The diagnostic now leaves conflicting polygon heights unchanged and counts them; other limitations remain. Variant-b has no reported hits to classify, so its zero counts provide no evidence of obstacle or rasterisation correctness. Oracle did not execute the station run.

## Step 4 independent review

2026-10-30 01:33 JST: Oracle identified three concerns. Its proposed floor-winding reversal was not applied: for a positive-X passage the captured floor's left side is at negative Z, and the synthetic test asserts an upward normal and successful corridor traversal. The audit now probes the separately captured greybox floor rather than the shell ceiling; a ceiling regression test passes. At step 4 the implementation retained the explorer's then-current single-selected-collider behavior. Step 5 updates this to the new rule that exempts every wall-like scene hit inside an opening. The measurements are warm offline Node/WASM queries, not application or phone measurements, and Shinjuku includes incomplete routes as described above. Oracle did not run the station measurements.
