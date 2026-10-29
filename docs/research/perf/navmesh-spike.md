# Ikebukuro navmesh spike — incomplete

2026-10-30 00:25 JST. This branch contains an initial synthetic Recast experiment, not a station bake or an adoption decision. The app has not been integrated with it.

## Evidence and missing measurements

- `recast-navigation` 0.43.1 is installed only in `@gteki/godot`; its package licence is MIT. It uses WebAssembly and includes the 0.43.1 core and generators packages.
- In the 3 GB OrbStack test container, two synthetic rooms connected by a 1.6 m doorway produced a path; closing the wall produced no complete path. The helper checks the path endpoint because Detour may return a partial path. The agent parameters are radius 0.3 m, height 1.7 m, climb 0.3 m and slope 40°, with 0.1 m voxels.
- Station bake time, raw and gzip size, polygon and tile counts, stair and escalator slope results, and off-mesh link count: **not measured**. No station `.bin` was produced.
- Route pair counts, off-floor, no-floor and wall-hit totals, graph-polyline baseline, no-path count and worst 20 gaps, snap percentiles, and path-length ratio: **not measured**. There is no no-path list yet. The existing `route-clip-audit.ts --all` iterates edges, not POI pairs, so a like-for-like pairwise baseline must be constructed.
- Node load, per-edge and per-route p50/p95: **not measured**. A phone estimate would be four times measured Node timings; it cannot be calculated yet.
- The requested real-run command failed because `navmesh-audit.ts` does not exist; the initial helper had no station CLI and wrote no output. The current helper explicitly fails when run as a CLI.

## Integration sketch

- Guide: `apps/web/src/ui/app.ts` creates `routePolyline` and passes it to `Explorer.startGuide`; `Explorer.stepGuide` follows it. Supply per-edge navmesh geometry while preserving step-to-point spans, instructions, floor and lift semantics. Risk: a partial or disconnected path must stop guidance, and snapping can select the wrong floor.
- Free walking: `Explorer.stepWalk`, `bodyCollision.ts` and `walker.ts` `resolveWalls` currently resolve motion. A navmesh nearest-poly and move-along-surface query could constrain motion, but retaining collision checks until geometry parity is demonstrated avoids assuming the bake covers dynamic and authored obstacles.
- Follow camera: `followCamera.ts` `followPose` and `Explorer.placeCamera` can stay collision-based initially. A corridor only describes walking space, not camera clearance.
- Ribbon and minimap: `Explorer.showRoute` and `minimap.ts` `setRoute` need the same resolved path as the guide, with floor and step associations preserved; otherwise the drawings can disagree with movement.
- Godot: `export-scene.ts` `exportStationScene` exports the scene and `gteki_bridge.gd` invokes the route CLI. A future export would need an explicit navmesh artifact and a compatible query/route bridge, plus parity for coordinate frames, links, and obstacle updates.

## Recommendation

**Undecided; do not adopt on this evidence.** The synthetic door result validates only a narrow library capability. Implement and measure the actual scene plus greybox, ensure collider and portal geometry agree with the explorer, test vertical links without introducing wall crossings, and audit identical route pairs before deciding whether to adopt fully, partly, or reject.

## Geometry risks identified during investigation

The greybox shell is both walkable and collider and includes floors, ceilings, sides and underside surfaces, so feeding all its triangles to Recast without classifying them can introduce false floors. Scene wall segments also need representation in the bake. The explorer splits wall segments at openings but handles mesh-collider portals separately; the bake must match that behavior. Greybox shell truncation (`stats.overBudget`) can remove navigation-relevant geometry. Vertical connections require validated endpoints and directionality, and snapping needs floor and wall-side validation. These are code-review risks, not measured station failures. The current synthetic helper proves none of them.

## Independent review

2026-10-30 00:28 JST: Oracle reviewed the explicitly incomplete synthetic experiment and found no blocking defects in that limited scope. It confirmed that station geometry, floor-aware snapping, links, route comparison and benchmarks remain unfinished; it did not independently execute the tests.
