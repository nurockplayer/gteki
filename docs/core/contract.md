# GTEki shared core — contract `gteki.station/0.1`

Status: **proposed with Lane C as sole writer; reviewed in-session by both station leads (Ikebukuro, Shinjuku) on 2026-10-20.** Not accepted until merged by the Owner. Types live in [`packages/schema/src/index.ts`](../../packages/schema/src/index.ts); this page explains intent and rules.

## Ownership

| Path | Writer | Readers |
| --- | --- | --- |
| `packages/**`, `apps/web/**`, root pnpm/ts/vitest config, `docs/core/**` | Lane C (shared core) | everyone |
| `stations/<id>/**` (incl. `stations/<id>/gteki/*`) | that station's Opus lead | Lane C reads only |

Station leads request contract changes via Issue/PR or a message to Lane C; they do not edit `packages/**`. Baseline provenance: the first version was drafted in the Shinjuku lane (Codex gpt-6.1-sol xHigh assisted) and handed to Lane C with credit (commit `76f880a`).

## Files a station ships

```text
stations/<id>/gteki/
  station.json   StationManifestFile  {schema, station, sources, floors, coverage, spawnNodeIds?, assets?}
  graph.json     GraphFile            {schema, stationId, nodes, edges}
  pois.json      PoiFile              {schema, stationId, pois}
  scene.ts       optional — exports buildScene(ctx) (@gteki/scene-api)
  assets/**      optional — GLB/PNG/KTX2 referenced by uri (symlinks allowed if they stay inside stations/<id>)
```

`parseStationFiles(station, graph, pois)` must return `ok: true`. It is **fail-closed**: a structural error (missing field, wrong type, NaN) or any truth-rule error yields no bundle and the explorer refuses the station.

## Frames

- **Station frame:** metres; `x` east, `y` north on the ENU tangent plane at `station.origin`; `z` = source height − `origin.hM` (no curvature term). With `hM: 0` and a TP source, `z` stays a TP orthometric height. `StationFrame.toLocal / toGeodetic` roundtrip < 1 mm (tested).
- **Renderer frame** (glTF, Three.js, Godot — all Y-up, right-handed): `(x, z, -y)`; `ENU_TO_RENDERER_MATRIX` is the column-major form. GLBs are authored in the renderer frame (identity) or carry `assets[].transform`.
- **Unknown heights stay unknown:** `position.z: null`. `Node.renderZ`, `Floor.renderElevationM` and `Edge.geometryZ: "symbolic"` are display-only and never used as surveyed facts.

## Truth rules (validator + router)

| Rule | Where |
| --- | --- |
| `null` = UNKNOWN for every tri-state; a missing field is an error, never a default. Nested records (hours union, texts, labels, evidence, coverage) are checked too: `hours: {}` is an error, not "open" | parse |
| Only `verified` edges route in real bundles; `synthetic` edges only in `station.synthetic` bundles, and results are stamped `synthetic` | validate, router |
| `closed: true` / query closures never route | router |
| Step-free requires `wheelchair === true` and `steps !== true` (unknown excluded) | router |
| `unpaid_only` excludes edges whose paid/crossing state isn't `false` | router |
| `unpaid_only` also rejects origin/destination POIs whose `paid` isn't `false` (`routeBetween`) | navigation |
| Unknown hours: default `warn_unknown` (routes, reported as `unknowns: hours`, UI shows “hours unverified”); `require_known` excludes. Known windows are evaluated at `profile.at` (station-local) | router |
| Floor change on a walk/gate edge: ERROR for same-operator non-adjacent/unordered floors; WARNING at landings (intermediate), adjacent ordinals or inter-operator transfers | validate |
| Fare crossing outside a `gate` edge, bidirectional escalators → warnings | validate |
| Operator floors are never equated by label (`B1` ≠ `B1`); optional `Floor.displayNames` (ja/en, station-authored) are display-only and `sourceLabels` stay exact | schema, tests |
| `Source.usage: "facts-only"`: may evidence facts; may not feed edge geometry, node positions or assets | validate |
| Assets, edge geometry and node positions (`sourceRefs`) derived from non-`REUSABLE_WITH_CONDITIONS` or `facts-only` sources are rejected for public bundles | validate |
| Every evidence record (edge geometry/access/hours, POI) names at least one source | validate |
| Station origin datum is `JGD2011` | validate |
| Real-station floors cite at least one source label; routes count the traversed floors' sources in provenance and freshness | validate + router |
| Polyline endpoints take their node's height for measurement, as drawn (unknown node height = no climb measured) | router |
| Coverage area `status` is routable / visual_only / unverified / excluded | validate |
| Step-free never uses stairs or escalators; stairs with `steps:false`, or stairs/escalators with `wheelchair:true`, are errors | router + validate |
| With `at`, known hours are checked for the whole time the route spends on each edge (entering, leaving and every whole clock minute in between, rolling over midnight and weekdays), not only at departure; an edge left more than a year after the departure day fails closed | router |
| Production builds apply every publication rights rule (node positions, edge geometry, floor elevations, POI display positions, coverage polygons, assets) to every station, synthetic or not | web build |
| `station.origin` latitude is within −90…90, longitude within −180…180, and a known height is finite | validate |
| A known floor `elevationM` needs a REUSABLE_WITH_CONDITIONS data source among its `sourceLabels` (real stations) and equals `renderElevationM` | validate |
| Credits and route provenance disclose `Source.modified` (加工して作成 / modified) and list asset `derivation` notices | web |
| Every source of a real (and every published) station has a non-empty attribution and an http(s) landing URL; every data source a licence name and an http(s) licence link | validate + web build |
| Every source (including ones cited only by assets or coverage) is credited with its link, licence name and licence link; only http(s) URLs become links | web |
| With clock-dependent hours (`at` given, some window edge) a closed edge is waited for: the route waits at its start until the first whole minute it stays open for the whole traversal (within a week, else unusable). The wait is a step fact (`waitSeconds`, `waitUntil` weekday/minute/dayOffset), counted in `estimatedSeconds` and `waitSeconds`, and narrated (「翌日05:00まで待つ」 / "Wait until 05:00 tomorrow"). The search is a complete FIFO Pareto search over cost and arrival: waiting costs 0.75/s, no more than any mode, so an earlier label that is no dearer than waiting would make it dominates and loops end. Its work is budgeted (comparisons plus hour samples); past it the answer is `search_limit` (route UNKNOWN), never `no_path`. Without `at` it is plain Dijkstra | router, UI |
| The station clock keeps seconds (fractional minutes) when checking hours | web |
| "Go straight" / 直進 only when every heading along the walked plan polyline lies within one 35° range; otherwise "Continue" / 進む | navigation |
| Real-station nodes cite position sources; POI `displayPosition` and coverage polygons need ≥1 reusable data source | validate |
| `elevationSource` is one of measured / source-derived / symbolic / unknown; symbolic and unknown keep `elevationM` null | validate |
| Without `accessEvidence`, an edge's paid / fare-boundary / wheelchair / steps flags are UNKNOWN to the router | router |
| A production build refuses any discovered station that fails `parseStationFiles` | web build |
| `Asset.files` declares an asset's further runtime files (lightmaps, sidecar metadata, buffers); they share its sources and rights. A production build publishes only declared files and refuses undeclared, missing, or `?`/`#`-resolving ones | validate + web build |
| Every emitted file that isn't code or a stylesheet (images of any type, models, audio, fonts, JSON) must be a declared station file or app-owned; Vite-emitted files of unknown origin are refused. Bytes a scene module embeds in code (inlined imports, `?raw`) are station code, reviewed in station PRs | web build |
| Asset `uri` must be relative, inside the station folder; symlinks are followed only inside it; a GLB's external buffers/images must resolve through the station's asset map (web) or are refused (Godot) | validate, plugin, explorer, godot |
| Symbolic polyline z (`geometryZ: "symbolic"`) never affects length or cost | router |
| `Source.validUntil` is the end of the source's declared *data* validity: once passed, dependent routes are stale and list it in `expiredSourceIds`. A provider's publication/availability period or licence term is not `validUntil`; it goes in source `notes` and coverage gaps | router |
| `route(starts, goals)` takes one or many starts (a POI's connectors) and ranks them by the router's own cost in one multi-source query; any start that is already a goal yields `start_equals_goal`. Callers never compare routes by `totalLengthM` | router |
| Profile `at`/`today` are station-local (Asia/Tokyo), read from `Intl` parts, never reparsed in the host zone | web |
| Routes report `oldestSourceDate`, `undatedSourceIds`, `stale` (default > 730 days; `null` while any dependency is undated unless dated evidence already proves staleness), tri-state `crossesFareBoundary` (unknown → `unknowns.fare_boundary`), `sourceIds`, `timeRestricted`, `operatorIds`, and the `profile` they were computed under | router |

## Renderer-neutral presentation

`routePolyline(bundle, route)` and `describeRoute(bundle, route, "ja" | "en")` give every client the same polyline and turn-by-turn text. Up/down is said only when evidenced (known z, known elevation, or same-operator ordinals), and a chain with a known direction never absorbs a segment whose direction is unknown. Floors are named via `floorDisplayName(floor, lang)`: `displayNames` in that language, then ja, then the exact source label. A walk merged across a choice point (a pass-through node where another branch of the station's traversable graph leaves — closed, unverified and arrive-only one-way edges, and edges that repeat the route's own passage — same two nodes, leaving along the same line — do not count; the query closures and strict-hours setting recorded on `route.profile` apply, and a branch with known hours is dropped only when it is shut at every minute from departure to arrival (it may open by the time the traveller reaches the junction), while traveller preferences such as step-free, avoided modes or fare never hide a visible branch) carries a `junctions` hint: `straight` when the chosen branch is clearly the straightest (no other branch within 30° of its bend) or the straightest middle of a fork, `keep_left` / `keep_right` when every other branch ahead (within 90° of arrival, inclusive) lies on the other side; a lift door counts as a choice but has no direction. The hint is appended to the walk text ("After ~40 m, keep right at the junction.") and names a junction only by the display name of a POI reached from that node; otherwise it says "the junction". When the choice cannot be stated without guessing (no heading in or out, a non-lift branch too short to have a heading, two branches on the same line, or a fork where the route is neither straightest nor to one side), no hint is given. Walking legs under 5 m (without a junction hint) are not read out alone: a straight step off a flight, lift, gate or walkway is added to it; other short legs fold into the next instruction, their turns listed in walking order in `leadTurns` before its own turn ("Turn left, then right, ~16 m", "Turn left, then left again, then take the stairs up to B1"); short legs right before arrival end the instruction before them via `trailTurns` ("…, then turn right"). The opening leg, which every later turn is measured from, is folded only into a flight, lift, gate or walkway it leads straight onto without a turn of its own. Each turn is still named once, at the junction where it happens: `distanceM` / `stepIndexes` cover the folded legs (every step belongs to exactly one instruction), but the spoken distance and junction `atM` are those of the instruction's own walk, counted from its last turn ("Go straight ~20 m, then turn back" turns back after 20 m; a walkway says its own length). Contiguous lift links (cab ↔ door, one link per floor passed) are one ride, "Take the elevator to B2": up/down only when the floors where it is boarded and left evidence it and no link of the ride says otherwise. A stair or ramp flight that directly follows another (only short legs between) is a continuation ("Continue on the stairs", "引き続き階段を進む"; "Continue up the stairs" only when both flights are evidenced in that sense); a flight that is known to reverse the last one is never called a continuation.

## Scene hook (`gteki.scene/0.1`)

`buildScene(ctx) → { root, walkable, colliders?, walls?, spawnPoints?, environment?, update?, dispose }`. Use `ctx.THREE` (one Three instance), `ctx.loadGlb`, `ctx.loadTexture` (keeps `uv1` for lightmaps; geometry is never merged). Without a scene module the explorer loads `assets[]` and classifies by `gteki_role` (`floor`/`stairs_ramps` → walkable; `wall`/`barriers`/`transport` → colliders). If the scene throws, the explorer shows the L0 graph view; routing is unaffected.

`environment: { background?, fog?, exposure?, lighting? }`. `lighting: "scene"` turns off the explorer's hemisphere + sun (for baked lightmaps / underground stations); the explorer then lights only its own avatar through a per-material environment map, never `scene.environment`. `WALKER_BODY` (radius 0.3 m, body band feet+0.2 … feet+1.7 m, eye 1.62 m, step up 0.45 / down 0.9 m) is part of the contract: a `WallSegment` blocks only when its `zMin…zMax` overlaps the body band, so scenes can author railings above stair runs without blocking them. Changing it requires both leads' check. Scene modules may import `three`, `three/addons/*` or `three/examples/jsm/*`; all resolve to the explorer's single copy through three's `exports` map.

## Web explorer

`pnpm dev` (or `GTEKI_STATION_ROOTS=<other worktree>/stations pnpm dev` for read-only cross-worktree integration). QA hooks on `window.__gteki`: `stations, openStation, setOrigin, setDestination, setProfile, route, instructions, mode, startGuide, quality, avatar, walkFromNode, simulate(seconds, keys), sceneInfo, phase`.

## Godot

See [`packages/godot/README.md`](../../packages/godot/README.md): Godot consumes the same station JSON and the TypeScript router's output (`pnpm tsx packages/cli/src/route.ts <stationDir> <from> <goals>` → `gteki.route/0.1` JSON with `result`, node `path`, edge `polyline` and `instructions.{ja,en}`, all with renderer coordinates); it does not reimplement routing truth. `bash packages/godot/run-proof.sh` runs the headless Godot 4 proof (station load, renderer frame, route transport, runtime GLB role classification).

## Versioning

Breaking changes bump `gteki.station/<major.minor>` and require both station leads' compatibility check before merge. Additive optional fields keep `0.1`.
