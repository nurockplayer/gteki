---
area: pkg-godot
owner: gteki-fa
updated: 2026-10-26 JST
---
# pkg-godot: Godot 4.7 HQ client and its TypeScript bridge

## What it does
The Godot client (`packages/godot`, project `project.godot`) loads both stations from snapshots that the TypeScript side exports: a GLB plus gteki.godot-scene/0.1 sidecar, and a gteki.search/0.1 index. It walks, shows search and routes, and runs guided walks and evidence walks. Godot does not rank or route: `packages/godot/addons/gteki/gteki_bridge.gd` runs `packages/godot/src/search-query.ts` and `packages/cli/src/route.ts` through `OS.execute` and parses their JSON. `packages/godot/hq` is the HQ scene; `packages/godot/addons/gteki` holds the GDScript runtime; `packages/godot/tests` holds headless GDScript suites; `packages/godot/tools` holds look comparison scripts. Its README (631 lines) and `packages/godot/docs/g5-handoff.md` are the authoritative status.

## Main files and functions
- `packages/godot/src/export-scene.ts:144-262` — `exportStationScene()`: runs the station's real `buildScene` under Node and writes the GLB and sidecar. `settleScene()` at lines 87-98.
- `packages/godot/src/scene-roles.ts` — role tagging (`tagSceneRoles()` at line 209), lightmap and AO atlas tagging, dynamic-object drop.
- `packages/godot/src/export-search.ts:52-109` — `buildSearchExport()`: the gteki.search/0.1 index for the HUD.
- `packages/godot/src/search-query.ts:11-20` — `runSearch()`: ground-truth search for the bridge.
- `packages/godot/src/export-reference.ts` — test oracle for renderer coordinates (not route computation).
- `packages/godot/addons/gteki/gteki_bridge.gd:38-64` — `run_json()`; `:70-82` — `search()`; `:83-104` — `route()`; `:105-138` — `load_index()`.
- `packages/godot/addons/gteki/gteki_route.gd:11-48` — `load_route()`; the route becomes a Path3D.
- `packages/godot/addons/gteki/gteki_scene.gd:76-122` — `load_snapshot()`; `:289-323` — `_build_walls()`.
- `packages/godot/addons/gteki/gteki_station.gd:36-98` — `load_station()`: station JSON into Godot space.
- `packages/godot/addons/gteki/gteki_walker.gd:225-260` — `resolve_walls()`; `:391-403` — `ride_to()` (lift rides); `:477-512` — `step()`.
- `packages/godot/addons/gteki/gteki_guide.gd:65-109` — `load_doc()`; `:311-321` — `advance()` (guided walk pacing).
- `packages/godot/hq/hq.gd:271-308` — `load_station()`; `:352-376` — `_physics_process()`.
- `packages/godot/hq/hq_guide.gd:222-240` — `do_search()`; `:287-303` — `compute_route()`; `:304-324` — `apply_answer()` (ribbon or failure text).
- `packages/godot/hq/hq_capture.gd:57-136` — `run()`: screenshot and performance captures; `:325-347` — `build_poses()`.
- Scripts: `run-scenes.sh` (export both stations, then scene and look tests), `run-proof.sh` (fixture route proof), `run-guide.sh`, `run-walk.sh`, `run-evidence.sh`, `run-capture.sh`.

## Data flow
- Stations → `exportStationScene` → a gitignored per-station snapshot folder under the Godot package's cache directory (scene.glb plus scene.json) → `load_snapshot` → `hq.gd` → colliders and walker.
- Search: `search-query.ts` through `gteki_bridge.gd` `search()`, or the cached search index file → `hq_guide.gd` `do_search()`.
- Route: `gteki_bridge.gd` `route()` → `packages/cli/src/route.ts` → `hq_guide.gd` `compute_route()` → `apply_answer()` draws a ribbon (`gteki_ribbon.gd`) or shows `reason: message`.
- Imported by: nothing in the TypeScript workspace imports @gteki/godot. Its `packages/godot/src` files import [[pkg-scene-api]], [[pkg-schema]], [[pkg-geo]], [[pkg-search]] and [[pkg-navigation]] (relative paths in `export-search.ts`, `search-query.ts`, `data-bridge.test.ts`).

## Tests CI runs
- Root-test (CI): `pnpm typecheck` then `pnpm vitest run --maxWorkers=2`. That covers only the TypeScript tests in `packages/godot/src/` (`data-bridge.test.ts`, `export-scene-materials.test.ts`, `export-scene-settle.test.ts`, `headless-gltf-textures.test.ts`, `scene-roles.test.ts`), because `vitest.config.ts` includes every package's src folder.
- Not in CI: the GDScript suites in `packages/godot/tests/` (10 files) and the `run-*.sh` scripts. No workflow in `.github/workflows` mentions Godot.
- Local GDScript runs: `bash packages/godot/run-scenes.sh`, `bash packages/godot/run-guide.sh`, `bash packages/godot/run-proof.sh`. GPU work on the host, weekdays 03:00-15:00 JST, uses `orb-test --heavy --host -- bash packages/godot/run-scenes.sh`. The README's older form is `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-guide.sh`.

## Pitfalls
- The bridge needs `pnpm install` first. Each route call blocks for 1 to 3 s.
- Godot binary: /opt/homebrew/bin/godot by default (tested with 4.7.2); override with `GODOT_BIN`. `project.godot` stays `gl_compatibility`; forward_plus is passed on the command line.
- Snapshots are untextured and unlit, so they show geometry and roles, not the look. Interior is still too dark (#401).
- All Shinjuku heights are symbolic. Symbolic polyline segments draw as orange dashed ribbon and the HUD says so.
- The README's G-5 section says the route adapter does not yet consume `polyline`. The G-3 section and `hq_guide.gd` draw it. Trust the code, and fix the README when you touch it.
- Shinjuku snapshots skip a viewer probe with no geometry; the sidecar warns about it instead.

## Related PRs and issues
- #184 G-1 scene snapshot exporter and Godot loader for both stations.
- #169 G-3 search and route data bridge for real stations.
- #251 apply the Ikebukuro baked lightmap (G-4a); #390 close the G-4 showcase look gaps.
- #283 headless evidence walks for five Ikebukuro routes (G-5a).
- #306 G-5b performance table from the first GPU slot; #434 G-5 simplifications and handoff.
- #403 showcase_compare reports per-region luminance; #281 look fingerprints refreshed after #264 and #72.
