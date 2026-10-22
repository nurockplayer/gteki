# Shinjuku start-up cost (#72): baked street layer, reopen cache, batch contents

Implemented in `stations/shinjuku` only. Measurements are Node (`buildScene`, quality low, `--expose-gc`), median of 3 warm builds plus the first (cold) build, three processes per row; no browser was available, so browser timings are still to be re-measured.

## Result

| | fe8d3b6 | now |
| --- | --- | --- |
| `buildScene` cold (first build in the process) | 1440 ms | 1020 ms |
| reopen (dispose, then `buildScene` again) | 1335 ms | 421 ms |
| triangles / meshes / geometry | 219,349 / 572 / 14.4 MB | unchanged |
| live scene heap after GC (JS, excl. geometry buffers) | 23.2 MB | 14.5 MB |
| + reopen snapshot kept by the cache | none | 7.5 MB |
| + baked table (resident string) | none | 1.2 MB |
| total JS heap after GC, geometry buffers excluded | 44.9 MB | 44.9 MB |

The issue's 261k triangles counts differently from the 219,349 indexed triangles counted here; both are unchanged by this work. The total heap did not fall: what the scene no longer leaks (8.7 MB) is spent on the reopen snapshot and the baked table. The snapshot can be dropped with `clearLayoutCache()` (`scene/build-cache.ts`) when the explorer leaves Shinjuku; calling it needs a hook in `apps/web` (Lane C), see "Requests" below.

Per step, in order (cold / reopen): cache the layout and fences 1490 / 865; release build intermediates from the live scene 1418 / 872 (heap −8.7 MB); compute street derivations once per build 1285 / 748; bake the street derivations 1060 / 535; bake kerbs and lamp rails 905 / 405 with the restricted-input check skipped; with the check kept on (shipped), 957 / 392, and with the layout fingerprint added to the bake key (review fix) 1020 / 421.

## What is baked

`data/surface-baked.ts` holds eight values, each a pure function of `surface.json`, the station bundle and the plan (through the layout):

| Value | Used for | Cost per build, warm |
| --- | --- | --- |
| `surfaceStreets` (asphalt, markings, furniture, pads, holes) | street paving, markings, trees, lamps | ~100 ms |
| `surfacePaving` (ground minus openings minus asphalt) | paving | ~7 ms |
| `surfaceBuildingFootprints` | building masses, and their collision rings | ~50 ms |
| `surfacePadWalls`, `surfaceColumns`, `surfaceCanopyWalls` | guard rails, canopy walls, **collision** (`surfaceWalls`) | ~65 ms |
| `surfaceKerbs`, `surfaceLampRails` | kerb stones, bollard rails | ~95 ms (point-in-polygon tests) |

The Three.js geometry (extruding buildings, ShapeGeometry for paving, merging batches) is still built at load from these polygons. What is drawn is therefore unchanged by construction; only the polygon derivation is skipped. Baking the final vertex buffers as well would save more (earcut for the paving and roofs), but is about 3 MB of data and ties the file to the Three.js version; not done.

## Why a separate step and not `import:surface`

`import:surface` turns raw PLATEAU XML into `surface.json` and needs the raw files outside the repo. The derivations also depend on the station layout, which is built from `gteki/*.json` and `plan.json` (the output of `import:e27`) and the layout code. Folding them into `import:surface` would make its output depend on a second importer and on scene code, and its `--check` would still need the raw data. So the table is its own stage, `bake:surface`, which reads only committed files and can run in CI.

Order after any data change: `import:e27`, `import:surface`, then `bake:surface`.

## Format

`data/surface-baked.ts` (generated, never edited by hand):

```ts
export default { version: 1, inputKey: "<length>:<128-bit hash>", sourceKey: "<hash of the derivation sources>", valuesJson: "<one JSON string>" };
```

- `valuesJson` is one string, not nested objects, on purpose: as module-level objects the same data stays resident at about 4 MB; as a string it is 0.4 MB and the parsed objects die with the build. It is parsed only after the key matches.
- Polygons are `[x, y]` coordinate arrays exactly as polygon-clipping returns them. Kerb and rail edges are `[ax, ay, bx, by]` rows (`packValues` / `unpackValues`).
- Size: 399 KB of source. Kerbs and rails are about a quarter of it; as `{a:{x,y},b:{x,y}}` objects they were 200 KB.
- Numbers survive `JSON.stringify` / `JSON.parse` exactly (shortest round-trip form), including `-0` and key order; `surface-bake.test.ts` asserts `toStrictEqual` against a fresh derivation.

## Determinism and staleness

- `inputKey = contentKey("surface-bake", SURFACE_BAKE_VERSION, surface, bundle, plan, layoutFingerprintInput(layout))`. The baked values include **colliders** (pad, column, canopy and building walls reach `world.addWalls`, `propWalls` and `scene.walls`), so the layout the derivations read is part of the key: every layout field except the per-level `walls` that `buildStation` appends later (and `nodeZ`, a Map, spelled out). Over-inclusive on purpose. `contentKey` (`scene/content-key.ts`) is four 32-bit integer hashes of the JSON text plus its length, identical in every JS engine; it is not cryptographic.
- Runtime: `buildStation` computes that key (about 30 ms with the layout) and uses the table only if it matches. Otherwise the same functions run as before. A table made from different inputs, including a moved pad, run, room or node height, is never used (`surface-bake.test.ts` reproduces the stale-pad case: 69 versus 73 pad walls in the reviewer's repro).
- The **derivation code** cannot be hashed at load: the browser build has no file access and minified function text differs from the source. So `sourceKey`, a hash of `layout.ts`, `fare-fence.ts`, `surface-layout.ts`, `surface-street.ts`, `surface-bake.ts`, `content-key.ts` and the polygon-clipping version, is written by `bake:surface` and checked only by `surface-bake.test.ts` and `bake:surface --check`. They fail when any of those sources changes without a rebake, locally today and in CI once the root suite runs (pending root CI). Until then, after touching those files, run `bake:surface`; a table baked from old code and unchanged inputs would still be accepted at load.
- polygon-clipping and the derivation code are deterministic for the same input. The bake, the test's fresh derivation and the whole-scene digest (with and without the table) all produce the same values.

## Proof that nothing else changed

`test/scene-digest.test.ts` against `test/fixtures/scene-digest.json` (captured from the unmodified code at fe8d3b6):

- byte for byte: every `walkable`, `colliders`, `cameraBlockers` buffer, the `walls` and `spawnPoints` arrays, `protectFareAndAccess` output (fences, gates, removed access, restricted conflicts, cache-hit flag), the layout after the protect step and after the build, and `propWalls`;
- semantic meshes (`gteki_role` holders, lift-portal carriers, `sign-*`, `Restricted area`, `No entry`, `surface-ground`, `surface-stone`): role, name, material, triangle count and portal data. Batch names are deliberately not compared: they were renamed on purpose;
- as sets, per material, visibility and render order: every drawn triangle (position, normal, uv). 60 groups, 219k triangles. Names and batching may change; a changed, added or missing triangle fails.
- both quality levels; a cold build (cache miss), a reopen (cache hit), three cached builds in a row (the build mutates level walls on its own copy), with and without the baked table.

`test/geometry-lifetime.test.ts` (final geometry bytes, 13,288,866, pinned hash) still passes; its hash changed once, for the batch renaming below, and the digest above shows only names moved.

## What `elevator-portal:finish` contains

The 3.78 MB batch is the merged **steel** batch of the whole station, 49,560 triangles. It inherited the name of its first member. Before the merge:

| Source | Triangles |
| --- | --- |
| stair handrails and brackets (562 cylinders, 8 and 6 sides, end caps included) | 15,736 |
| fare/access fence rails and posts (773 rails of 8, 843 posts of 12) | 16,300 |
| escalator trusses and thin handrail boxes (1,145 boxes) | 13,740 |
| escalator skirt and balustrade quads | 2,248 |
| lift portal door finishes | 648 |
| level trim | ~900 |

The same merge of dark steel (6,184 fence base, 648 portal), glass (3,942) and lamps follows the pattern. Batches are now `static-steel-finishes`, `static-glass-finishes`, `static-dark-steel-finishes`, `static-gate-ok-finishes`, `static-accent-finishes`; the lift portal list still rides in `userData.portals` of the batch that holds the portal parts (`enclosure.test.ts` looks it up that way).

### Proposals (not applied; each changes drawn triangles)

All are non-collider visuals. None is applied because "look unchanged" needs a browser check that was not possible here.

| Proposal | Triangle delta | Risk |
| --- | --- | --- |
| Drop the end caps of the 562 handrail/bracket cylinders | −7,868 (281 × 16 + 281 × 12) | Visible at the free ends of a rail; keep caps only on the last segment of a run |
| Drop the bottom face of the 843 fence posts (they float 5 cm above the floor) | −1,686 | Seen only from below the post; none in normal views |
| Drop the all-zero `uv` attribute on untextured materials (`merged()` adds it to every geometry) | 0 triangles, **−2.3 MB** of 14.4 MB | None expected: no map, bump map or normal map samples it. The surface materials (`daylight`) use uv; check before including them. Changes the pinned geometry hash. |

The total triangle proposals are 9.6k of 219k (4%). The batch is not wasteful geometry; it is many small real parts. The larger cost was never the batch but where the time went (street derivations, layout), which this change addresses.

## Requests for other lanes

- `apps/web` (Lane C): call `releaseShinjukuCaches()` (exported from `stations/shinjuku/gteki/scene.ts` next to `buildScene`) when the explorer leaves Shinjuku for good. It clears the 7.5 MB reopen snapshot. **Until apps/web calls it, the net heap goal of #72 is not met**: total heap after GC is unchanged from fe8d3b6 (the snapshot offsets what the live scene no longer holds). The baked street table (a 0.4 MB module-level string) cannot be released, because it is a static ESM import; dropping it would also make the next open slower.
- `apps/web` registry keeps one parsed bundle per station, so reopening passes the same object; the cache keys on content anyway, so a re-parsed equal bundle also hits.

## Restricted-input check stays on at load

The generated fence table (`scene/fare-restricted.generated.json`) is used only if its `inputKey` matches the current inputs. `protectFareAndAccess` can skip computing that key (`verifyGeneratedInput: false`, about 90 ms cold), and the output is identical (`scene-digest.test.ts`). We do **not** skip it in shipped code: the root test suite is not run in CI yet (pending root CI), so the load-time check is the only thing that would notice a stale table. `buildScene` passes `verifyRestrictedInput: true`; the option stays so tests can exercise both paths. Revisit once root CI runs `restricted-access.test.ts` and `scene-digest.test.ts`.
