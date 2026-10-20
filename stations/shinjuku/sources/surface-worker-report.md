# W2 street surface handoff — 2026-10-21

**Candidate; visual and performance acceptance is UNVERIFIED.** Work stays on `claude/shinjuku-s2-w2-street`. No push, PR or merge was performed.

## Changed files

- `tools/fetch-surface.sh`, `tools/import-surface.ts`, `sources/surface-manifest.json`, `data/surface.json`: pinned official PLATEAU 2025 Shinjuku CityGML acquisition, hashes/bytes/times, lat/lon axis checks, LOD1 base footprints and measured heights, deterministic `--check` output. Four meshes: 53394525/26/35/36. Raw inputs are outside the repository in `~/Developer/gteki-raw/shinjuku/plateau-bldg/`, overridden by `GTEKI_RAW_SHINJUKU` + `/plateau-bldg`.
- `scene/surface-data.ts`, `scene/surface-layout.ts`, `scene/surface.ts`: render-only ground with cut openings, four labelled canopies, merged building masses/window grids, sky, surface-only directional sunlight/haze, camera-distance detail LOD, shared collision geometry and disposal.
- `scene/build.ts`: imports and one small integration block at the end of `buildStation`; registers all new obstacles in both `world` and `propWalls`, replaces uncut pad boxes and generic top-level floor/ceiling caps with the cut ground/canopies. No `layout.ts`, app, routing JSON or shared-core source edits.
- `tools/vantages.json`: five appended views, including a view looking back from the existing walk footprint at each ground-level exit. Their eye XY coordinates were checked against `WalkWorld` ground z=0.
- `test/surface.test.ts`: 13 added tests covering importer repeatability/axis/CRS rejection, two real source building-corner ENU controls, simplification, budgets/rights fields, all exit openings and elevator tops, obstacle registration/no new walk surface, all graph edge clearance (0.05 m samples), building trimming and resource disposal.
- `package.json`: adds `import:surface`. No new dependencies or lockfile changes.

## Acquisition and rights

Official catalog: https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025

The actual CKAN API and dataset HTML were read and saved. Their licence link points to the PLATEAU site policy, which permits use under CC BY 4.0. Dataset-specific `metadata.zip!metadata/udx_13104_pref_2025_op.xml` explicitly says `Licensed under CC BY 4.0`. Source URLs, metadata evidence, actual hashes, byte counts and acquisition times are pinned in the manifest. The live file-size estimates differ from the downloaded bytes; hashes pin the actual acquired versions. No texture, appearance, business name, operator graphic or third-party asset is imported.

The result is 529 source building parts and **130,695 bytes**. `surface.json` includes attribution, source, licence, modification notice and `note: "render-only context, not routing"`. The lead still owns adding attribution to the footer/coverage dialog.

## Verification

- First command: `pnpm install --frozen-lockfile` — passed, pnpm 12.11.2.
- `pnpm typecheck` — passed, zero errors.
- `pnpm test` — **301 passed, 24 files** (288 baseline + 13 surface tests).
- `pnpm --filter @gteki/station-shinjuku build` — passed.
- `tools/fetch-surface.sh` — all eight pinned inputs verified.
- `pnpm --filter @gteki/station-shinjuku import:surface --check` — byte-identical result.
- Static geometry inspection (fake canvas, no GPU rendering): **17 meshes / 111,153 triangles**, 17 material batches including sky. This is **not** an observed `renderer.info` draw-call result, a shader validation, or proof of the <=60 extra calls criterion.
- The server ran on port 5282 and served HTTP successfully. Ego-lite failed to start (`Failed to start ego lite` / sandbox service errors). The supplied `shoot` harness was attempted before and after implementation; Chrome aborted with SIGABRT and an EPERM cleanup error before a page opened. The after attempt is saved locally at `.qa/shoot-attempt.log`; no after `report.json` or after PNGs were produced.
- Server cleanup was attempted with `kill 37414`; the sandbox returned `operation not permitted`. A subsequent TCP check confirmed **port 5282 closed** before handoff. No other process was targeted.
- The supplied baseline `exit-1-arrive.png` was opened and visually inspected. **No new rendered PNG was available to inspect.** No visual L2 verdict, exit voidFraction verdict, physical-phone result or independent Oracle/Ego-lite review is claimed.

## Every vantage: before / after

Before metrics come from the lead-supplied `baseline-399914d/report.json`, not a new local capture. Each metrics cell is **voidFraction / calls / tris**. After is unavailable for every vantage because browser launch failed; it is not zero.

| Vantage | Before (399914d) | After |
| --- | --- | --- |
| b1-gate-1 | 0.005 / 966 / 383875 | unavailable |
| b1-gate-1-reverse | 0 / 496 / 337165 | unavailable |
| b1-concourse | 0.166 / 190 / 144465 | unavailable |
| exit-1-street | 0.465 / 1299 / 578581 | unavailable |
| exit-1-arrive | 0.675 / 116 / 109678 | unavailable |
| exit-2-street | 0.439 / 1373 / 860836 | unavailable |
| b2-stairs | 0.535 / 295 / 192223 | unavailable |
| b3-hall | 0.016 / 424 / 212545 | unavailable |
| b45-escalators | 0.333 / 242 / 181528 | unavailable |
| b6-platform-train | 0 / 361 / 256957 | unavailable |
| b6-platform-empty | 0.007 / 571 / 398161 | unavailable |
| elevator-b1 | 0.491 / 932 / 244372 | unavailable |
| exit-1-canopy-back | not in baseline | unavailable |
| exit-2-canopy-back | not in baseline | unavailable |
| exit-3-canopy-back | not in baseline | unavailable |
| exit-4-canopy-back | not in baseline | unavailable |
| exit-street-oblique | not in baseline | unavailable |

## Deliberate simplifications added

1. Uniform paved plaza/sidewalk context, without claims about actual road alignments, crossings, kerbs or traffic. PLATEAU roads were not imported.
2. All building bases are flattened to symbolic street z=0. Source orthometric `groundHeight` is retained as evidence, and source measuredHeight (or LOD1 height difference) is preserved. No datum registration to symbolic underground floors is asserted.
3. LOD1 footprints are simplified by <=0.12 m then quantised to 0.1 m (combined displacement <=0.191 m). Roof shape is a flat extrusion; parapets, shopfront bands, window grids, light variation and material palette are original visual fill. They do not establish real shops, occupancy, equipment or current building appearance.
4. Source masses are trimmed clear of the existing walk footprint and nearby graph corridors where independent source geometry conflicts. This is a render/collision clearance, not a surveyed building modification.
5. Four original glass/steel canopies and their supports, clerestory glazing, dimensions and orientation. Only ground-level exit POIs 1–4 get canopies; B1 exit POIs 5–6 stay underground. Entrance labels reuse app POI text verbatim, with no official exit numbers. Signs state “大江戸線 新宿駅 / Oedo Line Shinjuku (E27)” and identify the GTEki design.
6. Continuous guard rails/low kerbs mark existing walkable street surfaces, including existing boundary-node landings; they add no navigable context. Generic elevator openings use CAD shafts when present, otherwise 2.2 m graph-centred clearances.
7. Procedural daylight sky, fixed directional sun evaluated only in surface materials (Three WebGL lacks per-group light linking), distance haze, and distant-detail LOD. No weather/time-of-day fact is implied.

## Remaining gates and limits

- Exit voidFraction <=0.03, coherent street appearance, actual calls/tris delta, shader correctness, lighting/glazing/overlap quality and independent Oracle/Ego-lite visual review **require a browser-capable run**. The 17 static meshes alone do not pass these gates.
- No real-player walkthrough or phone browser interaction was verified for this candidate.
- ENU controls are two real CityGML building corners checked using an independent GRS80 Cartesian calculation; no GSI survey/datum comparison or real-world field control was performed.
- Existing source-limited pads/landing/slab surfaces remain the only walkable street area; no additional routes, outdoor navigation, road access or B1-to-street continuation is implied.
- Re-entry: start the station server on 5282, run `shoot --url http://localhost:5282 --out <worktree>/.qa/shots`, inspect all 17 images, compare all report metrics, iterate, and obtain the required independent review before claiming acceptance.
