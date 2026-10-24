# Shinjuku kit swap (Issue #94, Shinjuku half)

Status: prepared, flag OFF. With the flag off the built station equals main `45250364` (#298 escalator shell) in every mesh byte:
138 meshes, 13,296,864 bytes. Measured with `test/helpers/station-digest.ts` on this merged tree after the unchanged main
`scene-digest.test.ts` passed. All other scene nodes (including lights and `userData`), material texture parameters and the
explorer's lists are covered too. Walkable 433, colliders 2, cameraBlockers 3 and walls 14,479 are unchanged.

| Digest | main `45250364`, flag off |
|---|---|
| Geometry | `04a401299e738f05b134fee6053a71f95965131d5b1837fceddee863391046c4` |
| Appearance | `c45106d83d6500652ae0911b8a037f9020e7a7e38ae05fce61ff495dd0835003` |
| Nodes | `8716cc4d548465dd836e07e69646928ad33791f37d6fc1a1dc02e2519c9e6ed7` |
| Textures | `b799e0f81a0e2ce49682593e2da04738723a9dc414d4a94f41b3e74b3b50d08c` |
| Lists | `ddd5c84df153fb71c2254a20ec8132134ef0aaa6bb4878cb683da4ffc967913f` |

The test builds the scene through the shipping `buildScene` entry point. It does not cover GPU state or anything drawn after the
explorer takes over.
Nothing here claims a licence for the library: the manifest `license` string is carried through to
`KitSwapReport.license` verbatim, for credit wiring.

Code: `stations/shinjuku/scene/kit/*`, hook in `scene/build.ts` (`BuildOptions.kit`) and
`gteki/scene.ts` (`assembleScene`). Tests: `stations/shinjuku/test/kit-swap.test.ts`.

## 1. Switch and tiers

- `KIT_SWAP_DEFAULT = false` in `scene/kit/config.ts`. QA opts in per page with `?kit=1` (or `on`,
  `mobile`, `full`); `?kit=0` is off. In production this opt-in is still gated by
  `publishableAssets` in `apps/web/stations-plugin.ts`: when generating the station asset map it
  refuses invalid station files, publication-rights/source errors (also for synthetic stations), missing
  declared files, and discovered asset files absent from `assets[].uri`, `uriMobile` or `files`.
  Only declared files enter that production map; `ctx.loadGlb` rejects a URI absent from it. Thus
  `?kit=1` cannot bypass publication checks or load an undeclared kit bundle. Development skips
  `publishableAssets` and maps the discovered station assets.
- If the manifest or the kit bundle fails to load, the swap is skipped, one line is logged, and the
  placeholders stay. A build that ships no kit files is therefore safe with the flag on.
- Tier: both `low` and `high` use the **mobile** tier until the loader decodes KTX2
  (`kitTierFor(quality, {ktx2})`). One full-tier `gteki_lift_portal_w1000` requires **53,127,851 estimated
  GPU texture bytes without KTX2**, already over the 8,000,000-byte cap. This is the real-manifest
  `totalsFor` retained-map estimate (RGBA8 + mipmaps, AO excluded), checked in `kit-swap.test.ts`;
  shared textures are counted once across portals. The later 19,573,419-byte figure is for the first
  full-tier gate, a different piece. The mobile tier has the same ids, sockets and params (tested on
  the real manifests).

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
`apps/web` write-up (request for the apps/web lane). **To verify before release:** the dynamic import of
`assets/library[/mobile]/manifest.json` has not been through a real Vite production build (builds were forbidden on this host), so
check that it chunks as a separate lazy JSON file (not folded into the main chunk) and that the library path resolves in the built
output. The coordinator will do this.

## 3. Budget (director ruling, per scene)

+30 draws, +60,000 triangles, +3 MB geometry (decimal), 8 MB GPU textures (meshopt + KTX2).
`planKitPlacements` sorts placements by (role rank, anchor key) and keeps the longest prefix inside every
cap; the rest are dropped, logged as `kit swap: dropped ...`, and listed in `report.dropped`.
Draws are counted as distinct (level, material) batches; material keys strip the `~<asset_id>` suffix of
AO-baked clones (`extras.gteki_name`, falling back to the material name). Runtime batching merges those clones per floor only when their retained texture identities match and clears
`aoMap`; the GPU texture estimate excludes the manifest's `occlusion` maps and counts only retained maps, taking the largest
estimate per shared material across assets and floors. Geometry is estimated at 70 B per triangle. The report also carries `measured`
figures counted from the built meshes; its GPU texture bytes remain a manifest estimate, not a device measurement.

Baseline at main `45250364` (low quality): 130 draws, 223,924 triangles (#298 adds two shell batches and 193 triangles to
`f143f862`); the kit adds at most the caps above. The stub-library run
on the real scene (see section 5 for the arithmetic) places 19 escalator pieces, 24 stair-nosing pieces, 4 gate rows and 5 of the 9 lift
portals within the caps; stub geometry, not real pieces.

### Current real library (main `45250364`)

Both `assets/library/manifest.json` and `assets/library/mobile/manifest.json` declare kit version `0.1.0` and contain 74 assets.
Both tiers select the same Shinjuku candidates: `gteki_lift_portal_w1000`, `gteki_gate_array_1w` (one aisle, 1.02 m clear),
`gteki_stair_nosing_w2400_n18` (nosing only), and `gteki_escalator_dress_s1000_r4000_comb_newel` (comb and newel only).
The other stair/escalator dressings include rails, skirts or balustrades and are refused to avoid doubled geometry. Two exit candidates
also exist: `gteki_street_canopy_w3000_d3000_posts` and `gteki_street_canopy_w4500_d3000_cantilever_curved`. The exit placeholder
hook remains disabled, so neither can be placed by the production planner.

On the actual Shinjuku anchors the mobile manifest plans **4 gate rows and 9 lift portals**, with no budget drops:
4 floor/material batches, 13,226 triangles, 925,820 estimated geometry bytes and 65,536 estimated GPU texture bytes after dropping AO.
The stair candidate (18 steps, 2.88 m rise, 5.4 m run, 2.4 m width) fits none of the 24 stair runs; the escalator candidate
(4 m rise, 9.3282 m comb run, 1 m step width) fits none of the 21 escalator runs. All 45 dressing placements are dropped as
`no piece fits this anchor`, so those placeholders stay. Exits (4) and toilets (3) remain gaps. The full tier without KTX2 places
nothing: the first gate would require 19,573,419 GPU texture bytes, above the 8,000,000 cap, so lower-ranked gates and lifts are dropped too.

The real library offers `gteki_bench_4seat`, `gteki_bench_3seat_slat`, `gteki_vending_machine`, `gteki_vending_machine_sand` and
`gteki_ticket_kiosk`; none is selected or placed, and there is no shop-front asset. Shinjuku has no source anchors for these props.
These are manifest-derived plans, with the apply path checked using stub meshes. No station kit bundle ships here, so ordinary
`?kit=1` still falls back to placeholders; real GLB rendering and device costs have not been verified.

## 4. Placeholder inventory and mapping

Ranked by screen time on the main routes. Measured with `packages/navigation` on this dataset
(exit to platform, ticketed profile, 6 routes; estimated 259 s average: 137 m walking, 51 m escalator
(about 26% of the time), 22 m stairs (about 17%), 6 gate crossings, 9 ramp edges, lift edges on some
routes and on both step-free routes that exist).

| # | Placeholder / procedural visual (scene/build.ts unless noted) | Kit piece | Status |
|---|---|---|---|
| 1 | Escalators: truss, handrails, instanced steps | `escalator_dressing`, parts comb + newel (Lane E PR #143), one station-catalog entry per distinct run | **Prepared.** The generic library dressing fits none; 19 of 21 runs fit the station catalog's 15 to 35 degree range (catalog section below); 2 stay as drawn. Additive: the placeholder draws no comb plates or newels, so nothing is hidden. Truss, steps, balustrade panels, handrails and lamps stay. |
| 2 | Stairs: box per step merged into "walkable", nosing strips | `stair_dressing`, parts nosing (PR #143) | **Prepared.** The station catalog covers all 24 runs; the generic library nosing fits none. Each run's per-step nosing boxes are tagged in `build.ts` and hidden when its piece is placed; side stringers, handrails and walls stay. |
| 3 | Walls, floors, ceilings, platform edge | none (finishes F1 pending) | Wait for F1 finish packs (`assets/library/finishes/`, `gteki-finish/0.1`). Colliders and blockers never change. |
| 4 | Fare gates: bodies/tops/IC readers/OK lamps, two machines per verified row | `gate_array` with aisles 1 (`gteki_gate_array_1w`, PR #143; station entry `gteki_sj_gate_1w_w1020`) | **Planned with the real mobile manifest** (bundle pending). 4 distinct rows (5 gate edges). The selector requires `params.aisles === 1`, so a multi-aisle array is never used; a clear width outside 1.00 to 1.04 m is refused. The machines are hidden when the piece is placed. |
| 5 | Lift boxes: `elevator-portal:finish` meshes, one per portal | `gteki_lift_portal_w1000` | **Planned with the real mobile manifest** (bundle pending). Door plane (`SOCKET_end`, z = -0.26) on the existing wall plane plus 4 mm. About 15 elevator nodes grouped into portals. No status claims. |
| 6 | Street exit canopies (`scene/surface.ts`, `surface-layout.ts`) | Two `gteki_street_canopy_*` pieces exist | **Gap:** the placeholder hook in `surface.ts` is not implemented. All 4 exit tops stay unchanged. |
| 7 | Tactile ribbons (107 polylines) | none | Wait for F1 finish. |
| 8 | Hanging signs: cases, rods, atlas `sign-faces:*` | not replaced | Stay: deliberate GTEki atlas. |
| 9 | Toilets (3 facility points at B3: F001, F002, F003) | none placed | **Gap, deliberately.** The GSI facility point is a representative point of the room, not a door, and the dataset has no door source, so an entrance piece would be invented placement. `ROLE_DISABLED.toilet` reports the 3 anchors as a gap whatever the manifest offers; there is no toilet selector or placement code. Revisit when a door source exists. |
| 10 | Fare fences, platform-edge/PSD | none | Wait for D2 railing runs. |
| 11 | Luminaires | none | Wait for D1. |
| 12 | Train | out of scope | Stay. |

Not placed whatever the manifest offers: shops, kiosks, benches, vending (no source anchor in Shinjuku).
Lifts get no status claims; gate flaps rest open with no stated gate count.

Lift placeholders, measured on the real mobile lift run: hiding the 9 lift boxes removes 1,728 triangles (9 x 192) and the 9 mobile
`gteki_lift_portal_w1000` portals add 9,810 (9 x 1,090), a net of +8,082 triangles. The 49,560 + 6,832 + 672 triangles (about 4.4 MB) seen
in the baseline are the whole merged metal batch (`elevator-portal:finish` shares it with other finishes), not the lift boxes; the swap
hides only the lift boxes' own triangles, so it is not a large saving. Item 5 is a visual replacement, not a budget win.

## 5. Station catalog (`stations/shinjuku/kit/catalog.json`)

Lane E's supplied report on #94 (issuecomment-6356537660, main `2c8489c`) says the rebuilt station catalog has 33 ids in both
tiers, a 5.77 MB mobile AO GPU estimate and 19,914 triangles. None of these `gteki_sj_*` ids or GLBs is in `assets/library` on
this tree; that report is not evidence that a station bundle ships. The runtime drops per-asset AO during batching, so the upstream
AO estimate is not the swap's retained-texture estimate. No catalog GLBs were added here.

Lane E (PR #143) builds the dressing pieces from a catalog in our tree, in the same entry shape as
`tools/blender/catalog/kit_v0_1.json` (`id`, `generator`, `params`, `tags`, plus `dimension_basis` and `notes`, both of which
`build.py` reads). Stair dressings carry `ao_res: 128`; escalator dressings carry `ao_res: 256` so their many parts fit the AO atlas. Every stair and escalator dressing carries `anchor: "linear_run"` as required by contract §10; the gate array carries no anchor. The reported mobile AO GPU estimate above is inside the upstream provisional 12 MiB warning line; this has not been measured on device, and the swap enforces its own 8 MB retained-texture cap. We bundle with `tools/blender/bundle_kit.py` ourselves. Do not run Blender or the bundler from this lane.

- 33 entries: 22 `stair_dressing` (`parts: ["nosing"]`), 10 `escalator_dressing` (`parts: ["comb","newel"]`),
  1 `gate_array` (`aisles 1, wide_aisles [0], wide_w 1.02`). Ids are `gteki_sj_stair_<edge>`, `gteki_sj_escalator_<edge>` and
  `gteki_sj_gate_1w_w1020`, all matching `^gteki_[a-z0-9_]+$` (`<edge>` = first 8 hex characters of the first graph edge of the group).
- Runs with identical (quantised) params share one entry. Stairs barely group (24 runs, 22 ids) because their drawn rises differ;
  escalators group 19 runs into 10 ids. Quantisation: stair riser 2 mm and tread 10 mm; escalator rise 100 mm and run 250 mm.
  The worst error from rounding is written in each entry's `notes` and is inside the fit tolerance (rise 0.1 m, length 0.25 m, width 0.15 m).
- Every param has its derivation in the entry's `notes`: stair `step_count = max(2, round(rise / 0.165))` (the stepping `build.ts` draws),
  `riser_mm = rise / step_count`, `tread_mm = plan length / step_count`, `width_mm` = the scene's MLIT width-class estimate; escalator
  `rise_mm` = drawn rise, `run_mm` = plan length minus 1.6 m (two flat sections; transitions already belong to `run_mm`) so the comb-to-comb run lands both comb lines on the end nodes,
  `width_mm` = 1.25 m scene constant minus the 0.1 m inset `build.ts` takes off the steps, `landing_mm 800` and `flat_steps 2` = kit defaults.
- **Not surveyed.** Shinjuku heights are symbolic (`station.json` `hM` is null). Every rise is the scene's drawn rise between the two
  end nodes, so `dimension_basis` is `synthetic`, never `station-verified`.
- **Gate width is not a fact.** `wide_w 1.02` is the kit default (a visual default); no source in this dataset states a clear width,
  and no gate count is claimed. It matches the +/-0.62 m machine spacing the scene already draws. The entry equals the kit's own
  `gteki_gate_array_1w`; Lane E may alias it instead of building a second copy.
- Two escalators stay as drawn because their drawn incline is outside the kit range 15 to 35 degrees: `e:4bee1c5e...` (rise 7.80 m
  over 9.33 m, implied kit incline 48.3 degrees) and `e:27d3ed49...` (rise 7.54 m over 12.86 m, implied kit incline 35.7 degrees). They are reported as `dropped: no piece fits`.
- Assumed names from Lane E's addendum (#143 at 465a3d5): escalator `parts` values `balustrade|handrail|newel|comb`, stair `parts` values
  `nosing|handrail|skirt`; the escalator's `comb_run_m` is read from the built manifest when present (otherwise computed from
  `run_mm` / `angle_deg` with the kit's flat steps).

Placement does not read the catalog: it reads the built manifest and fits each run to the closest piece by `step_count x riser_mm`,
`step_count x tread_mm` and `width_mm` (stairs) or `rise_mm`, comb-to-comb run and step width (escalators). A manifest piece that also
carries the balustrade, handrail or skirts, or states no `parts`, is never selected, because the scene already draws those and the kit
would double them.

### Regenerating the catalog

`kit/catalog.json` is derived from the scene layout, not hand-edited. After any change to the graph, plan or layout code (an importer
run, `layout.ts`, `fare-fence.ts`, the stair stepping in `build.ts`):

```sh
pnpm --filter @gteki/station-shinjuku kit:catalog            # rewrite stations/shinjuku/kit/catalog.json
pnpm --filter @gteki/station-shinjuku kit:catalog -- --check # exit 1 if the committed file is stale
```

It prints every run left uncovered and fails if the result is invalid (id pattern, kit ranges, parts). `test/kit-catalog.test.ts`
compares the committed file with a fresh derivation, so a stale catalog fails the test run. Then hand the new file to Lane E
(`CATALOG=stations/shinjuku/kit/catalog.json`), rebuild the library output, and rebundle with `bundle_kit.py`; ids that vanish or change are in
the diff, not in code. If the stair stepping rule in `build.ts` changes, update `STAIR_RISER_TARGET_M` in `scene/kit/catalog.ts` too
(the test that counts hidden nosing triangles per step catches a mismatch).

Budget with the stub estimates Lane E gave (escalator 1352 triangles per run, stair nosing 180, gate and lift stubs 1800 and 1090): 19 escalators +
24 stairs + 4 gate rows = 37,208 triangles, which already uses most of the 3 MB geometry cap (70 B per merged triangle = 42,857
triangles). Five of the nine lift portals fit; the other four are dropped, in rank order (escalator, stairs, gate, exit, lift). The real counts will change this; the rule does not. If the director prefers a different order or per-instance sharing
(InstancedMesh costs draws instead of geometry), that is a one-line change in `config.ts`.

## 6. How the swap works

1. `anchors.ts` derives anchors only from data the scene already uses: verified gate edges
   (`protection.gates`), portals recorded by `buildElevatorPortals`, runs, the plan facility points F001 to F003 (counted and reported as a gap, never placed, see item 9), and the
   `surfaceEntrances`.
2. `place.ts` converts an anchor into asset id + position + yaw using manifest sockets and
   placement classes (ENU to renderer: (x, y, z) to (x, z, -y)).
3. `build.ts` records, read-only, which triangles of the merged gate-machine, lift-portal and stair-nosing meshes belong
   to which anchor (`PlaceholderLedger`). With the flag off no ledger exists.
4. `swap.ts` batches the placed pieces into one mesh per (level, material, retained texture identities), using only visible visual nodes
   (`visible=false` subtrees, `COL_`, `SOCKET_`, `LIGHTHINT_`, `-colonly` are never drawn; contract names come from
   `extras.gteki_name`), tints the `line_accent` slot to `OEDO_MAGENTA` (#b6007a) on a cloned material,
   hides exactly the replaced placeholder triangles, and adds a `kit-swap` group before the finish merges.
   A placement hides its placeholder only if it contributes triangles and **all** its batches merge successfully.
   If any batch fails, all pieces contributing to that failed batch are removed from every batch; successful
   shared batches are rebuilt without them, so their placeholders stay with none of their kit geometry drawn.
   A piece with only hidden, collision, socket or hint nodes, or a multi-material mesh without geometry groups,
   is also reported as not drawn and keeps its placeholder; a multi-material mesh with groups is split per material.
   Every batched material and merged geometry is a copy owned by the station build. The retained textures are
   disposed with the station too: `ctx.loadGlb` parses a fresh, uncached GLTF on every call
   (`apps/web/src/explorer/explorer.ts`), so the build is their only user. A future GLB cache would have to take
   over that ownership.
   `apply()` is all-or-nothing: it is wrapped in try/catch; every hide is first prepared without touching a mesh, and the
   commits (plain assignments) run only after the kit meshes were built and added. On any error it logs
   `kit swap off: <message>; placeholders stay`, returns no report and leaves the scene as flag-off (tested).
5. Roles whose placeholder the build does not record (exits) are refused so that geometry is never
   doubled; they are reported as gaps. Escalator dressing is additive (no placeholder to hide).

Colliders, walkable proxies, camera blockers, `walls` and fences are not touched (test: hash-identical on
vs off). Per-asset AO maps are dropped when batching into shared materials. Finish packs are ignored but
nothing hard-coded blocks them.

## 7. Requests to Lane E

1. Land the reported rebuild of `stations/shinjuku/kit/catalog.json` in the library and provide the station bundle; confirm that the
   built manifest echoes the catalog params (and `comb_run_m` for escalators). The measured mobile triangle counts decide how many lift portals fit.
2. Remaining integration: exit canopy placeholder hook (two generic pieces exist), railing runs (D2), luminaires (D1), finishes (F1).
   No toilet piece is requested: there is no door source to place one on.
4. `line_accent` as a slot in the main library (today only in the `claude/lane-e-batch1-finishes` branch as
   `gteki_finish_band_line_accent`).
5. Bundle script output per tier with `userData.gteki_bundle` (or tell us the existing format).

## 8. What Lane F should check visually once the flag is on (`?kit=1`)

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
10. Exit canopies unchanged (a gap today). Gates can change once the existing one-aisle piece is bundled; stairs and escalators
    need the fitting station-catalog pieces bundled:
    gate cabinets centred on the verified row with the flaps open; yellow nosing strips on every step with no doubled strip
    underneath; escalator comb plates flush with the floor at both ends and the newels at the balustrade ends, no gap or overlap
    against the drawn balustrade panels and rubber handrail, nothing floating at the top comb (the rise is the drawn rise).
    The two unfitted escalators and the exit run keep their placeholders.
11. No kit mesh appears in the collider or camera-blocker lists (tested) and the walker is not blocked by
    any kit piece.
