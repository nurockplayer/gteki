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
| `Source.usage: "facts-only"`: may evidence facts; may not feed edge geometry or assets | validate |
| Assets and edge geometry derived from non-`REUSABLE_WITH_CONDITIONS` sources are rejected for public bundles | validate |
| Asset `uri` must be relative, inside the station folder; symlinks are followed only inside it; a GLB's external buffers/images must resolve through the station's asset map (web) or are refused (Godot) | validate, plugin, explorer, godot |
| Symbolic polyline z (`geometryZ: "symbolic"`) never affects length or cost | router |
| `Source.validUntil` is the end of the source's declared *data* validity: once passed, dependent routes are stale and list it in `expiredSourceIds`. A provider's publication/availability period or licence term is not `validUntil`; it goes in source `notes` and coverage gaps | router |
| `route(starts, goals)` takes one or many starts (a POI's connectors) and ranks them by the router's own cost in one multi-source query; any start that is already a goal yields `start_equals_goal`. Callers never compare routes by `totalLengthM` | router |
| Profile `at`/`today` are station-local (Asia/Tokyo), read from `Intl` parts, never reparsed in the host zone | web |
| Routes report `oldestSourceDate`, `undatedSourceIds`, `stale` (default > 730 days; `null` while any dependency is undated unless dated evidence already proves staleness), tri-state `crossesFareBoundary` (unknown → `unknowns.fare_boundary`), `sourceIds`, `timeRestricted`, `operatorIds` | router |

## Renderer-neutral presentation

`routePolyline(bundle, route)` and `describeRoute(bundle, route, "ja" | "en")` give every client the same polyline and turn-by-turn text. Up/down is said only when evidenced (known z, known elevation, or same-operator ordinals), and a chain with a known direction never absorbs a segment whose direction is unknown. Floors are named via `floorDisplayName(floor, lang)`: `displayNames` in that language, then ja, then the exact source label.

## Scene hook (`gteki.scene/0.1`)

`buildScene(ctx) → { root, walkable, colliders?, walls?, spawnPoints?, environment?, update?, dispose }`. Use `ctx.THREE` (one Three instance), `ctx.loadGlb`, `ctx.loadTexture` (keeps `uv1` for lightmaps; geometry is never merged). Without a scene module the explorer loads `assets[]` and classifies by `gteki_role` (`floor`/`stairs_ramps` → walkable; `wall`/`barriers`/`transport` → colliders). If the scene throws, the explorer shows the L0 graph view; routing is unaffected.

`environment: { background?, fog?, exposure?, lighting? }`. `lighting: "scene"` turns off the explorer's hemisphere + sun (for baked lightmaps / underground stations); the explorer then lights only its own avatar through a per-material environment map, never `scene.environment`. `WALKER_BODY` (radius 0.3 m, body band feet+0.2 … feet+1.7 m, eye 1.62 m, step up 0.45 / down 0.9 m) is part of the contract: a `WallSegment` blocks only when its `zMin…zMax` overlaps the body band, so scenes can author railings above stair runs without blocking them. Changing it requires both leads' check. Scene modules may import `three`, `three/addons/*` or `three/examples/jsm/*`; all resolve to the explorer's single copy through three's `exports` map.

## Web explorer

`pnpm dev` (or `GTEKI_STATION_ROOTS=<other worktree>/stations pnpm dev` for read-only cross-worktree integration). QA hooks on `window.__gteki`: `stations, openStation, setOrigin, setDestination, setProfile, route, instructions, mode, startGuide, quality, avatar, walkFromNode, simulate(seconds, keys), sceneInfo, phase`.

## Godot

See [`packages/godot/README.md`](../../packages/godot/README.md): Godot consumes the same station JSON and the TypeScript router's output (`pnpm tsx packages/cli/src/route.ts <stationDir> <from> <goals>` → `gteki.route/0.1` JSON with `result`, node `path`, edge `polyline` and `instructions.{ja,en}`, all with renderer coordinates); it does not reimplement routing truth. `bash packages/godot/run-proof.sh` runs the headless Godot 4 proof (station load, renderer frame, route transport, runtime GLB role classification).

## Versioning

Breaking changes bump `gteki.station/<major.minor>` and require both station leads' compatibility check before merge. Additive optional fields keep `0.1`.
