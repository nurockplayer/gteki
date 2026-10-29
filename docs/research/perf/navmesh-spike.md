# Ikebukuro navmesh spike

2026-10-30 00:25 JST. The initial experiment covered a synthetic scene. The app has not been integrated with this spike.

## Step 1: public scene bake

2026-10-30 00:39 JST. The public Ikebukuro scene was baked in an OrbStack container limited to 3 GB. The `.bin` is local and gitignored at `.qa/navmesh/ikebukuro.bin`; it contains no greybox or off-mesh links.

- Raw size **852,328 bytes**; gzip **234,717 bytes**; Recast generation including WASM initialization **794 ms**.
- **479 non-empty tiles**, **4,809 polygons**; peak process RSS **285,196 KiB** (Node `process.resourceUsage().maxRSS`, Linux high-water mark, includes scene loading and the rest of the process).
- Cell size 0.15 m, cell height 0.1 m; 64-cell tiles (9.6 m wide) bound per-tile work while reducing tile count relative to 32 cells. Radius 0.3 m, height 1.7 m, climb 0.3 m, slope 40°.
- Input: 717 ground meshes, 656 collider meshes, 0 wall segments and 41,819 triangles. Meshes use world transforms and instance transforms. Collider triangles are rasterized using a winding-based obstacle approximation; meshes present in both sets cause the bake to fail because their surface semantics are ambiguous (there were none in this run). Walls, if present, are 5 cm thick boxes across the segment and its vertical range. This approximation and shared mesh handling need collision parity validation.
- The scene loader reported that 68 of 69 decorative stair-nosing strips were skipped due to unavailable or incompatible assets. This bake uses the headless low-quality scene; do not infer full visual asset coverage from it.
- Greybox was not built or measured in this run. The lead reports zero public runs; `--with-greybox` calls `buildGreybox` but intentionally fails if it finds runs, because portal-safe collider cutting is not implemented.

The public graph has **25 stair edges**, **0 escalator edges**, and **0 elevator edges**. Both endpoints of 24 stairs snap within 0.5 m; 21 of those have a complete navmesh path. Of the 21, **20** paths stay within 2 m in plan of the graph edge geometry (sampled every 0.5 m), making them local connector candidates; **5** stairs lack such evidence. This heuristic rejects an obvious detour but does not prove the actual stair is traversed or that each of the five needs a link: missing endpoints, geometry, or alternative routing can also explain a failure. No off-mesh links have been added. Further connector inspection is required to determine the true link count.

## Evidence and missing measurements

- `recast-navigation` 0.43.1 is installed only in `@gteki/godot`; its package licence is MIT. It uses WebAssembly and includes the 0.43.1 core and generators packages.
- In the 3 GB OrbStack test container, two synthetic rooms connected by a 1.6 m doorway produced a path; closing the wall produced no complete path. The helper checks the path endpoint because Detour may return a partial path. The agent parameters are radius 0.3 m, height 1.7 m, climb 0.3 m and slope 40°, with 0.1 m voxels.
- The earlier synthetic-only run did not measure a station bake; the public step 1 measurements are above.
- Route pair counts, off-floor, no-floor and wall-hit totals, graph-polyline baseline, no-path count and worst 20 gaps, snap percentiles, and path-length ratio: **not measured**. There is no no-path list yet. The existing `route-clip-audit.ts --all` iterates edges, not POI pairs, so a like-for-like pairwise baseline must be constructed.
- Node load, per-edge and per-route p50/p95: **not measured**. A phone estimate would be four times measured Node timings; it cannot be calculated yet.
- The earlier combined bake-and-audit command failed because `navmesh-audit.ts` did not exist. Step 1 now provides the bake CLI; the audit remains future work.

## Integration sketch

- Guide: `apps/web/src/ui/app.ts` creates `routePolyline` and passes it to `Explorer.startGuide`; `Explorer.stepGuide` follows it. Supply per-edge navmesh geometry while preserving step-to-point spans, instructions, floor and lift semantics. Risk: a partial or disconnected path must stop guidance, and snapping can select the wrong floor.
- Free walking: `Explorer.stepWalk`, `bodyCollision.ts` and `walker.ts` `resolveWalls` currently resolve motion. A navmesh nearest-poly and move-along-surface query could constrain motion, but retaining collision checks until geometry parity is demonstrated avoids assuming the bake covers dynamic and authored obstacles.
- Follow camera: `followCamera.ts` `followPose` and `Explorer.placeCamera` can stay collision-based initially. A corridor only describes walking space, not camera clearance.
- Ribbon and minimap: `Explorer.showRoute` and `minimap.ts` `setRoute` need the same resolved path as the guide, with floor and step associations preserved; otherwise the drawings can disagree with movement.
- Godot: `export-scene.ts` `exportStationScene` exports the scene and `gteki_bridge.gd` invokes the route CLI. A future export would need an explicit navmesh artifact and a compatible query/route bridge, plus parity for coordinate frames, links, and obstacle updates.

## Recommendation

**Undecided; do not adopt on this evidence.** The synthetic door result and public bake validate only narrow capabilities. Implement and measure the actual scene plus greybox, ensure collider and portal geometry agree with the explorer, test vertical links without introducing wall crossings, and audit identical route pairs before deciding whether to adopt fully, partly, or reject.

## Geometry risks identified during investigation

The greybox shell is both walkable and collider and includes floors, ceilings, sides and underside surfaces, so feeding all its triangles to Recast without classifying them can introduce false floors. Scene wall segments also need representation in the bake. The explorer splits wall segments at openings but handles mesh-collider portals separately; the bake must match that behavior. Greybox shell truncation (`stats.overBudget`) can remove navigation-relevant geometry. Vertical connections require validated endpoints and directionality, and snapping needs floor and wall-side validation. These are code-review risks, not measured station failures. The current synthetic helper proves none of them.

## Independent review

2026-10-30 00:28 JST: Oracle reviewed the explicitly incomplete synthetic experiment and found no blocking defects in that limited scope. It confirmed that station geometry, floor-aware snapping, links, route comparison and benchmarks remain unfinished; it did not independently execute the tests.

## Step 1 independent review

2026-10-30 00:39 JST: Oracle found blockers to treating this bake as navigation-correct. Shared ground/collider meshes can contain mixed semantics; the bake now rejects such input, and none appeared in this public run. Recast low-hanging-obstacle filtering may disagree with explorer collision even when collider winding is reversed. The vertical query checks do not prove authored floor, wall side, or traversal of the actual connector. Wall extrusion has not been exercised by this public scene or the synthetic test. These remain open validation limitations; the review did not independently run the bake.
