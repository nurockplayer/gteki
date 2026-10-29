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

`--with-greybox` now builds the explorer's low-tier greybox. The optional bake capture records its generated floor triangles separately from its shell obstacles, clips selected scene collider triangles at portal volumes, and includes split wall segments. The audit adds greybox floors and walls and filters portal collider hits using the explorer's opening rule. The binary and audit must be built with matching flag and input. Both scripts use `GTEKI_PRIVATE_DIR` to build an overlay from a temporary copy; the source private directory is not written. No private station data was run or recorded here. A shell-truncated greybox is rejected rather than silently baked.

Both public runs generated **zero greybox passages**. Synthetic tests exercise a non-empty passage, a cut portal and preservation of surrounding wall collision; private overlays and real non-empty station passages have not been validated. Greybox clipping and the winding-based Recast obstacle approximation remain experimental, not a runtime collision guarantee.

Public Shinjuku, with the greybox flag, baked in **1.83 s**, with **341,056 raw / 101,740 gzip bytes**, **111 tiles**, **1,924 polygons** and **589,976 KiB** peak process RSS. It completed within the 3 GB and 20-minute bake limits. Of 238 routable ordered pairs, 36 yielded constructed audit paths and 202 had unresolved non-stair edges; the comparable 36-route scene-height audit reported **0 off-floor / 1 no-floor / 0 wall hits**, as did its graph baseline. There were 19 unique edges without acceptable paths. The 238 route-query timings include partial query sequences for incomplete routes, so they are not complete Shinjuku journey timings.

## Evidence and missing measurements

- `recast-navigation` 0.43.1 is installed only in `@gteki/godot`; its package licence is MIT. It uses WebAssembly and includes the 0.43.1 core and generators packages.
- In the 3 GB OrbStack test container, two synthetic rooms connected by a 1.6 m doorway produced a path; closing the wall produced no complete path. The helper checks the path endpoint because Detour may return a partial path. The agent parameters are radius 0.3 m, height 1.7 m, climb 0.3 m and slope 40°, with 0.1 m voxels.
- The earlier synthetic-only run did not measure a station bake; the public step 1 measurements are above.
- The earlier synthetic-only run did not measure routes; the public step 2 comparison is above.
- The earlier steps did not measure runtime; the public Node measurements and ×4 estimates are in step 4 above.
- The earlier combined bake-and-audit command failed because `navmesh-audit.ts` did not exist. Step 1 now provides the bake CLI; the audit remains future work.

## Integration sketch

- Guide: `apps/web/src/ui/app.ts` creates `routePolyline` and passes it to `Explorer.startGuide`; `Explorer.stepGuide` follows it. Supply per-edge navmesh geometry while preserving step-to-point spans, instructions, floor and lift semantics. Risk: a partial or disconnected path must stop guidance, and snapping can select the wrong floor.
- Free walking: `Explorer.stepWalk`, `bodyCollision.ts` and `walker.ts` `resolveWalls` currently resolve motion. A navmesh nearest-poly and move-along-surface query could constrain motion, but retaining collision checks until geometry parity is demonstrated avoids assuming the bake covers dynamic and authored obstacles.
- Follow camera: `followCamera.ts` `followPose` and `Explorer.placeCamera` can stay collision-based initially. A corridor only describes walking space, not camera clearance.
- Ribbon and minimap: `Explorer.showRoute` and `minimap.ts` `setRoute` need the same resolved path as the guide, with floor and step associations preserved; otherwise the drawings can disagree with movement.
- Godot: `export-scene.ts` `exportStationScene` exports the scene and `gteki_bridge.gd` invokes the route CLI. A future export would need an explicit navmesh artifact and a compatible query/route bridge, plus parity for coordinate frames, links, and obstacle updates.

## Recommendation

Decision deferred pending further diagnosis. Per-sample detail heights reduce the sampled violations, but missing detail heights, stair fallbacks, unverified joins and collision parity remain unresolved. Implement and measure the actual scene plus greybox, ensure collider and portal geometry agree with the explorer, test vertical links without introducing wall crossings, and audit identical route pairs before deciding whether to adopt fully, partly, or reject.

## Geometry risks identified during investigation

The greybox shell is both walkable and collider and includes floors, ceilings, sides and underside surfaces, so feeding all its triangles to Recast without classifying them can introduce false floors. Scene wall segments also need representation in the bake. The explorer splits wall segments at openings but handles mesh-collider portals separately; the bake must match that behavior. Greybox shell truncation (`stats.overBudget`) can remove navigation-relevant geometry. Vertical connections require validated endpoints and directionality, and snapping needs floor and wall-side validation. These are code-review risks, not measured station failures. The current synthetic helper proves none of them.

## Independent review

2026-10-30 00:28 JST: Oracle reviewed the explicitly incomplete synthetic experiment and found no blocking defects in that limited scope. It confirmed that station geometry, floor-aware snapping, links, route comparison and benchmarks remain unfinished; it did not independently execute the tests.

## Step 1 independent review

2026-10-30 00:39 JST: Oracle found blockers to treating this bake as navigation-correct. Shared ground/collider meshes can contain mixed semantics; the bake now rejects such input, and none appeared in this public run. Recast low-hanging-obstacle filtering may disagree with explorer collision even when collider winding is reversed. The vertical query checks do not prove authored floor, wall side, or traversal of the actual connector. Wall extrusion has not been exercised by this public scene or the synthetic test. These remain open validation limitations; the review did not independently run the bake.

## Step 2 independent review

2026-10-30 00:53 JST: Oracle identified misleading treatment of hybrid stair fallbacks, overly long detours and discontinuous joins, and warned that nearest-poly snapping and endpoint reachability do not establish floor identity, wall side, or traversal of the authored edge. The revised audit distinguishes pure queries from stair-fallback routes, reports missing-path versus excessive-detour reasons and join gaps, and checks both path endpoints. It retains the brief's snap extents and audits join segments; these do not establish navigability across those joins. The reviewer did not run the audit.

## Step 3 independent review

2026-10-30 01:18 JST: Oracle found blockers to treating these diagnostics as authoritative collision or root-cause evidence: unverified node snaps and joins, circular scene projection, overlapping or independently reconstructed corridor polygons, and a two-ray rather than swept-body wall checker. The diagnostic now leaves conflicting polygon heights unchanged and counts them; other limitations remain. Variant-b has no reported hits to classify, so its zero counts provide no evidence of obstacle or rasterisation correctness. Oracle did not execute the station run.

## Step 4 independent review

2026-10-30 01:33 JST: Oracle identified three concerns. Its proposed floor-winding reversal was not applied: for a positive-X passage the captured floor's left side is at negative Z, and the synthetic test asserts an upward normal and successful corridor traversal. The audit now probes the separately captured greybox floor rather than the shell ceiling; a ceiling regression test passes. For a portal intersecting multiple colliders, the implementation intentionally retains the explorer's single-selected-collider behavior, so another collider can remain solid; a two-collider audit test demonstrates that limitation. The measurements are warm offline Node/WASM queries, not application or phone measurements, and Shinjuku includes incomplete routes as described above. Oracle did not run the station measurements.
