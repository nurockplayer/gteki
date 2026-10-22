# Shinjuku kit swap (Issue #94, Shinjuku half)

Status: prepared, flag OFF. With the flag off the station is byte-identical to `fe8d3b6`
(geometry digest `2b3a94ba...`, appearance digest `3b66b3e1...`, 136 meshes, 13,288,866 bytes).
Nothing here claims a licence for the library: the manifest `license` string is carried through to
`KitSwapReport.license` verbatim, for credit wiring.

Code: `stations/shinjuku/scene/kit/*`, hook in `scene/build.ts` (`BuildOptions.kit`) and
`gteki/scene.ts` (`assembleScene`). Tests: `stations/shinjuku/test/kit-swap.test.ts`.

## 1. Switch and tiers

- `KIT_SWAP_DEFAULT = false` in `scene/kit/config.ts`. QA opts in per page with `?kit=1` (or `on`,
  `mobile`, `full`); `?kit=0` is off.
- If the manifest or the kit bundle fails to load, the swap is skipped, one line is logged, and the
  placeholders stay. A build that ships no kit files is therefore safe with the flag on.
- Tier: both `low` and `high` use the **mobile** tier until the loader decodes KTX2
  (`kitTierFor(quality, {ktx2})`). The full-tier lift portal alone is 854 KB of geometry and JPEG maps
  that upload as RGBA8; a few portals exceed the 8 MB GPU texture budget. The mobile tier has the same
  ids, sockets and params (tested on the real manifests).

## 2. Loading hook

Today the Shinjuku scene loads no GLB. The explorer provides `ctx.loadGlb(uri)` (GLTFLoader + Meshopt,
no KTX2, no Draco) and `ctx.assetUrl`, fenced to files under `stations/shinjuku/gteki/**`. In a
production build every file there must be declared in `station.json` `assets[]` with `sourceIds`
(rights provenance); undeclared files make `publishableAssets` refuse the build.

Smallest hook, **no `apps/web` change needed for the mobile tier**:

1. Lane E's `tools/blender/bundle_kit.py` (or equivalent) produces one derived bundle per tier,
   `stations/shinjuku/gteki/assets/kit/<tier>.glb`, whose root carries `userData.gteki_bundle`
   and one child per asset id (the adapter's `bundleProvider` clones those roots).
2. The importer (`stations/shinjuku/tools/import-e27.ts`) declares the bundle in `assets[]` once the
   library is cleared. Generated data is not hand-edited.
3. `prepareKitSwap(ctx)` reads `assets/library[/mobile]/manifest.json` (dynamic JSON import; vite
   `fs.allow` already covers `../../..`), loads the bundle through `ctx.loadGlb`, and passes the
   ready-made `KitSwap` into `buildStation`.

Only if the **full** tier or KTX2 textures ship: `apps/web/src/.../explorer.ts` `loadGlb` needs
`loader.setKTX2Loader(...)` and the basis transcoder served as a static file. That is the only
`apps/web` write-up (request for the apps/web lane). Not verified: the production-build behaviour of the
dynamic manifest import (vite build was forbidden on this host).

## 3. Budget (director ruling, per scene)

+30 draws, +60,000 triangles, +3 MB geometry (decimal), 8 MB GPU textures (meshopt + KTX2).
`planKitPlacements` sorts placements by (role rank, anchor key) and keeps the longest prefix inside every
cap; the rest are dropped, logged as `kit swap: dropped ...`, and listed in `report.dropped`.
Draws are counted as distinct (level, material) batches; material keys strip the `~<asset_id>` suffix of
AO-baked clones (`extras.gteki_name`, falling back to the material name). Geometry is estimated at 70 B
per triangle. The report also carries `measured` figures counted from the built meshes.

Measured baseline at `fe8d3b6` (low quality): 128 draws, 223,791 triangles; the kit adds at most the
caps above. The stub-library run on the real scene placed 4 gate rows, 9 lift portals and 3 toilets for
8 draws (stub geometry, not real pieces).

## 4. Placeholder inventory and mapping

Ranked by screen time on the main routes. Measured with `packages/navigation` on this dataset
(exit to platform, ticketed profile, 6 routes; estimated 259 s average: 137 m walking, 51 m escalator
(about 26% of the time), 22 m stairs (about 17%), 6 gate crossings, 9 ramp edges, lift edges on some
routes and on both step-free routes that exist).

| # | Placeholder / procedural visual (scene/build.ts unless noted) | Kit 0.1.0 piece | Status |
|---|---|---|---|
| 1 | Escalators: truss, handrails, instanced steps | none (fixed `escalator_*` rises 5.0/3.5 m do not fit any of 21 runs) | Gap: parametric escalator (Lane E D2). Placement code ready; blocked on a piece plus a build hook that records the placeholder. |
| 2 | Stairs: box per step merged into "walkable", nosing | none (stairs rise 3.0/4.0 m, fixed) | Gap: parametric stairs (D2). Same blocker, 24 runs. |
| 3 | Walls, floors, ceilings, platform edge | none (finishes F1 pending) | Wait for F1 finish packs (`assets/library/finishes/`, `gteki-finish/0.1`). Colliders and blockers never change. |
| 4 | Fare gates: bodies/tops/IC readers/OK lamps, two machines per verified row | `gate_array_2/_3w1_oneway/_4w1/_6w1` only (2 to 6 aisles) | Gap: request a single-aisle variant (`gate_array_1`, aisles=1, clear aisle about 1.0 to 1.04 m). A multi-aisle array would invent aisles or put a cabinet on the verified path, so the selector requires `params.aisles === 1`. 4 distinct rows (5 gate edges). |
| 5 | Lift boxes: `elevator-portal:finish` meshes, one per portal | `gteki_lift_portal_w1000` | **Placed** (flag on). Door plane (`SOCKET_end`, z = -0.26) on the existing wall plane plus 4 mm. About 15 elevator nodes grouped into portals. No status claims. |
| 6 | Street exit canopies (`scene/surface.ts`, `surface-layout.ts`) | none | Gap: canopy piece (D4) plus a hook in `surface.ts`. 4 exit tops. |
| 7 | Tactile ribbons (107 polylines) | none | Wait for F1 finish. |
| 8 | Hanging signs: cases, rods, atlas `sign-faces:*` | not replaced | Stay: deliberate GTEki atlas. |
| 9 | Toilets (3 points at B3: F001, F002, F003) | none (no toilet piece) | Additive only: selector is tag or family "toilet". Gap: P1 toilet-entrance piece; tag name to confirm with Lane E. |
| 10 | Fare fences, platform-edge/PSD | none | Wait for D2 railing runs. |
| 11 | Luminaires | none | Wait for D1. |
| 12 | Train | out of scope | Stay. |

Not placed whatever the manifest offers: shops, kiosks, benches, vending (no source anchor in Shinjuku).
Lifts get no status claims; gate flaps rest open with no stated gate count.

The heaviest placeholder is the lift box (49,560 + 6,832 + 672 triangles, about 4.4 MB geometry), so item 5
is also the largest triangle saving when the flag is on.

## 5. How the swap works

1. `anchors.ts` derives anchors only from data the scene already uses: verified gate edges
   (`protection.gates`), portals recorded by `buildElevatorPortals`, runs, plan facilities F001 to F003
   (nearest toilet-room wall chained across jagged CAD segments, at most 12 degrees of bend), and the
   `surfaceEntrances`.
2. `place.ts` converts an anchor into asset id + position + yaw using manifest sockets and
   placement classes (ENU to renderer: (x, y, z) to (x, z, -y)).
3. `build.ts` records, read-only, which triangles of the merged gate-machine and lift-portal meshes belong
   to which anchor (`PlaceholderLedger`). With the flag off no ledger exists.
4. `swap.ts` batches the placed pieces into one mesh per (level, material), using only visual nodes
   (`COL_`, `SOCKET_`, `LIGHTHINT_`, `-colonly` are never drawn; contract names come from
   `extras.gteki_name`), tints the `line_accent` slot to `OEDO_MAGENTA` (#b6007a) on a cloned material,
   hides exactly the replaced placeholder triangles, and adds a `kit-swap` group before the finish merges.
5. Roles whose placeholder the build does not record (stairs, escalators, exits) are refused so that
   geometry is never doubled; they are reported as gaps.

Colliders, walkable proxies, camera blockers, `walls` and fences are not touched (test: hash-identical on
vs off). Per-asset AO maps are dropped when batching into shared materials. Finish packs are ignored but
nothing hard-coded blocks them.

## 6. Requests to Lane E

1. `gate_array_1` (aisles=1, clear aisle about 1.0 to 1.04 m, flaps resting open).
2. Parametric stairs and escalator dressing with `params.rise/width/length` (D2); the fit check is
   rise within 0.1 m, width 0.15 m, length 0.25 m.
3. Exit canopy (D4), toilet entrance (P1, tag `toilet`), railing runs (D2), luminaires (D1), finishes (F1).
4. `line_accent` as a slot in the main library (today only in the `claude/lane-e-batch1-finishes` branch as
   `gteki_finish_band_line_accent`).
5. Bundle script output per tier with `userData.gteki_bundle` (or tell us the existing format).

## 7. What Lane F should check visually once the flag is on (`?kit=1`)

I could not render anything. Please check:

1. Lift portal door plane flush with the wall; no z-fighting at the surround or the floor approach plate.
2. The surround stands 0.26 m proud of the wall: does the walker clip it in corridors and landings?
3. Door faces into the room (normal points to the walkable side) at every portal, including the cab-only
   landing sleeve wall.
4. No double geometry where lift boxes were hidden, and no holes in the remaining
   `static-metal-finishes` merge.
5. Mobile palette colours against the station lighting: no near-black large surfaces; environment map
   applied to kit materials (hemisphere + RoomEnvironment 0.55 + at most 8 point lights, ACES 0.92).
6. Kit batches cull correctly (the `installTightCulling` wrapper).
7. `line_accent` reads as #b6007a once a piece carries that slot.
8. Draw and triangle counts: kit adds at most 30 draws and 60k triangles; check frame rate on a phone.
9. `?kit=1` falls back cleanly (placeholders intact, one log line) when no bundle ships.
10. Gate rows, stairs, escalators, exit canopies unchanged (they are gaps today).
11. No kit mesh appears in the collider or camera-blocker lists (tested) and the walker is not blocked by
    any kit piece.
