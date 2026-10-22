# Ikebukuro inlined data files: declaration proposal for Lane C

Issue #121 item 2 (Ikebukuro side). Written for Lane C, who owns the shared build check (item 1) and `packages/schema`.

## Status: not declarable today

`stations/ikebukuro/gteki/station.json` cannot declare these files with the current schema, so no manifest change was made. Each of the four reasons below is enforced in `packages/schema/src/validate.ts` or `apps/web/stations-plugin.ts`:

1. **Asset shape is GLB-only.** `assets[]` entries must have `format: "glb"` and a `uri` ending `.glb` (`asset.format`, `asset.uri`). A data file cannot be its own asset. It could only ride in another asset's `files[]`.
2. **`files[]` is relative to `gteki/` and cannot leave it.** `isCanonicalAssetPath` rejects `..`. The four files live in `stations/ikebukuro/scene/`, so `../scene/signage.json` is invalid. Moving them under `gteki/` would be a scene-code change, and `publishableAssets` would then also walk them as "asset files".
3. **Assets may not derive from facts-only sources.** `signage.json` and `access_fences.json` derive from graph and POI facts that came from `toshima-underground-guide-2022` and `tokyometro-ikebukuro-yardmap-2026-03` (both `usage: "facts-only"`). `asset.rights` rejects any asset whose `sourceIds` include a facts-only source. Dropping those ids would hide the real provenance, which is the opposite of what this issue wants.
4. **Declaring them as assets would make the explorer treat them as renderable assets.** `assets[]` is the list loaders iterate (web explorer and Godot). A JSON file listed there is not a GLB. The existing `ikebukuro_b1_lit.glb` is deliberately a `files[]` entry rather than a second asset for the same reason (see the `derivation` text of asset `b1`).

The plugin also cannot match an inlined file to a declaration today: `generateBundle` only sees emitted assets, and the code comment at `stations-plugin.ts:169-171` says inlined bytes are left to "station PR review". The check for item 1 has to look at JSON modules in the module graph (`transform`/`moduleParsed`, or `load` for ids ending `.json`), not at `bundle`.

## Files to declare

All four are imported by `stations/ikebukuro/scene/scene.ts` (lines 12-15). A grep of `scene/*.ts` and `gteki/scene.ts` finds no other data imports. The other JSON the scene imports is already covered: `../gteki/graph.json` is a contract file, and `../gteki/assets/ikebukuro_b1_lit.meta.json` is already in asset `b1`'s `files[]`.

Source ids: `P` = `plateau-ubld-13116` (CC BY 4.0, modified), `T` = `toshima-underground-guide-2022` (facts-only), `M` = `tokyometro-ikebukuro-yardmap-2026-03` (facts-only).

| File (relative to `stations/ikebukuro/`) | Size | Source ids | Modified | Derivation | Generator (`pnpm --filter @gteki/station-ikebukuro build:data` runs all) |
|---|---|---|---|---|---|
| `scene/signage.json` | 158 KB | `P`, `T`, `M` | yes | Overhead sign positions, ceiling heights and wall clearance are measured on the PLATEAU-derived walkable surfaces (`P`). Destinations and exit labels are the verified graph's routable POIs and exits, whose names come from the facts-only sources `T` and `M`. No operator sign, layout or pictogram is reproduced. | `pipeline/build_signage.py` (reads `gteki/graph.json`, `gteki/pois.json`, `build/ubld_enu.json`) |
| `scene/crowd_lanes.json` | 21 KB | `P`, `T`, `M` | yes | Per-edge, per-metre left/right walkable-clearance samples from the PLATEAU walkable grid (`P`), keyed by the verified graph's edge ids (graph edges rest on `T` and `M` facts). Display data for the ambient crowd only; it never feeds routing. | `pipeline/build_station.py` (`crowd_lanes()`) |
| `scene/walk_bridges.json` | 27 KB | `P` | yes | Thin invisible walking quads (ENU metres) over hairline gaps between adjacent PLATEAU floor and stair polygons. Pure survey geometry, no facts-only input. | `pipeline/build_walkfix.py` |
| `scene/access_fences.json` | 19 KB | `P`, `T`, `M` | yes | Outline of the routable coverage areas (union), fenced where PLATEAU floor continues outside them. The coverage areas' source ids are `P` for all 8, plus `T` and `M` for 6 of them; the "access unverified" label is GTEki text. | `pipeline/build_access.py` (reads `data/graph.src.json` coverage areas) |

Lane C: the `sourceIds` for `crowd_lanes.json` and `access_fences.json` could be trimmed to `P` only if you judge that the graph's edge ids and area outlines carry no `T`/`M` fact. I listed `T` and `M` because the graph's evidence and coverage `sourceIds` include them, which is the conservative reading.

## Schema shape needed

Add an optional manifest field, separate from `assets[]` so loaders never see it:

```ts
/** Station data that scene code imports directly and a build inlines into JS. Not renderable assets. */
export interface DataFile {
  id: string;
  /** Path relative to stations/<id>/ (not gteki/); canonical, slash-separated, no "..". e.g. "scene/signage.json". */
  path: string;
  /** Sources the file derives from. Non-empty. May include facts-only sources (the data states facts, it does not reproduce them). */
  sourceIds: string[];
  /** True when GTEki generated or modified the data. */
  modified: boolean;
  /** How it was made, naming the generating script. Required when `modified` is true. */
  derivation: string;
}

interface StationManifest { /* ... */ dataFiles?: DataFile[]; }
```

Proposed rules in `validateBundle`, mirroring `asset.*`:

- `dataFile.dup`: duplicate id or path.
- `dataFile.path`: canonical path, extension in `.json` (extend later for other non-code data), not a contract file (`station.json`, `graph.json`, `pois.json`), not also listed in an asset's `uri` or `files`.
- `dataFile.source`: `sourceIds` non-empty (unless `station.synthetic`) and every id known.
- `dataFile.rights`: every source is `REUSABLE_WITH_CONDITIONS` or has `usage: "facts-only"` (the asset rule rejects the latter; this rule allows it). Any other `REFERENCE_ONLY` or restricted source is an error, as for assets.
- `dataFile.derivation`: required and non-empty when `modified` is true.
- Add the new codes to `PUBLICATION_RULES` so `publishableAssets` enforces them in a production build.

`parse.ts` needs a `dataFile` entry in `SPECS` (`{ id: "string", path: "string", sourceIds: "array", modified: "boolean", derivation: "string" }`) and `checkShape` must walk `manifest.dataFiles`. `buildBundle` must carry it through. The Coverage dialog can list `dataFiles` next to assets.

## Build check (item 1) to match

In `gtekiStations`, for every module the build includes whose real path is under a station folder and is not code (`.json`, or any non-`CODE_EXT` extension, including `?raw`/`?url`):

- allowed: the station's contract files, the station's declared asset `uri`/`files`, and its `dataFiles[].path`;
- otherwise fail with a message naming the file and telling the author to declare it in `dataFiles`.

Tests per item 1: one inlined JSON declared in `dataFiles` passes, one undeclared inline fails.

## Ikebukuro entries to add once the schema lands

In `data/graph.src.json` under `dataFiles` (`pipeline/build_station.py` builds `gteki/station.json` and today copies only `src.get("assets", [])` at line 399, so it needs one more line for `dataFiles`; `graph.json` must stay byte-identical):

```json
"dataFiles": [
  { "id": "signage", "path": "scene/signage.json",
    "sourceIds": ["plateau-ubld-13116", "toshima-underground-guide-2022", "tokyometro-ikebukuro-yardmap-2026-03"],
    "modified": true,
    "derivation": "pipeline/build_signage.py: sign positions and clearances measured on the PLATEAU-derived walkable surfaces; destinations and exit labels from the verified graph and POIs (facts from the two facts-only sources). No operator sign, layout or pictogram is reproduced." },
  { "id": "crowd-lanes", "path": "scene/crowd_lanes.json",
    "sourceIds": ["plateau-ubld-13116", "toshima-underground-guide-2022", "tokyometro-ikebukuro-yardmap-2026-03"],
    "modified": true,
    "derivation": "pipeline/build_station.py crowd_lanes(): per-edge walkable clearance sampled on the PLATEAU walkable grid, keyed by verified graph edge ids. Ambient-crowd display data; never used for routing." },
  { "id": "walk-bridges", "path": "scene/walk_bridges.json",
    "sourceIds": ["plateau-ubld-13116"],
    "modified": true,
    "derivation": "pipeline/build_walkfix.py: invisible walking quads over hairline gaps between adjacent PLATEAU floor and stair polygons. Survey geometry only." },
  { "id": "access-fences", "path": "scene/access_fences.json",
    "sourceIds": ["plateau-ubld-13116", "toshima-underground-guide-2022", "tokyometro-ikebukuro-yardmap-2026-03"],
    "modified": true,
    "derivation": "pipeline/build_access.py: outline of the routable coverage areas fenced where PLATEAU floor continues outside them; the 'access unverified' label is GTEki text." }
]
```

Ikebukuro's `build_station.py` has to emit the new field into `station.json`; that is a small follow-up in the station folder once `packages/schema` accepts it.
