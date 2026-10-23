# Ikebukuro: what still renders procedurally, mapped to the Lane E kit (#94 Part A)

Status 2026-10-22, main `dc59b38`, kit 0.1.0 (`assets/library/manifest.json`, 48 pieces). This is the station lead's side of
[docs/assets/gap-list.md](../../../docs/assets/gap-list.md) (Lane E's list, built from an earlier inventory). It adds the
items that list did not have (access-fence stretches, sign housings) and says, for each, whether the station data
already places the object. Rule used: a kit piece goes in only where existing data fixes its position, orientation and
extent. Nothing is invented (G0 audit: PLATEAU has no ticket gates, no paid/unpaid boundary, no shops, no benches).
One exception, by director decision (issue #3, 2026-10-22): a generic gate array at each of the three JR gate nodes
(row 9), which is always shown as 「代表性擺設，通道數與方向未驗證」 / "representative placement; aisle count and
orientation unverified", never as a surveyed layout.

Stairs, escalators and their handrails are out of scope here: PR #155 (per-flight catalog from `scene/dressing_anchors.json`).

Screen time ranks follow the guided routes in `tests/e2e/specs/__goldens__/02-navigation.spec.ts/ikebukuro-routes.json`
(JR Central Gate 2 to Exit 35, 198.6 m; West Exit B1 to Exit 4 stair foot, 186.8 m) and the README walks.

## Today's render, item by item

| # | Rendered today | Where and how many | Data places it? | Kit answer (manifest id) | Status |
|---|---|---|---|---|---|
| 1 | Floor: canvas tile | whole B1 floor mesh (`floor`, 3,391 tris) | surface: yes | finish pack, not a prop (`floor` role in `scene/finishes.json`, Lane E F1, PR #133) | waits for F1 |
| 2 | Walls, column cladding: flat colour plus shader bands | `wall` 12,492 tris, columns inside `barriers` | surface: yes | finish packs (F1); column sleeves D1 | waits for F1 / D1 |
| 3 | Ceiling: canvas panel | `ceiling` 7,042 tris | surface: yes | finish pack (F1) | waits for F1 |
| 4 | Light fixtures: generated emissive boxes on a 2.4 x 3.0 m grid | `light_fixtures` 31,392 tris, 2,616 boxes in the lit GLB (not surveyed) | generated, not data | luminaire modules (D1, PR #145). They live in the bake, so this is a bake change, not a scene change | waits for D1 + re-bake |
| 5 | **Access-fence label stretches**: 1.2 m hazard-striped label boards | **80 stretches, 633 m, every one within 29 m of a verified-edge vertex, 56 of 80 within 8.5 m** (`scene/access_fences.json` `marks`) | **yes** (the data places them) | `gteki_barrier_rail_2400_solid` (desktop 922 tris, mobile 592) | **done in batch 1** for the 62 stretches of 1.8 m or more (259 modules); the 18 shorter ones keep the board |
| 6 | Access-fence collision panels | 92 panels, invisible | yes | none (collision only) | n/a |
| 7 | Sign housings: one plain box per sign | 100 signs (`scene/signage.json`), 0.48 m tall, 1.0 to 4.8 m wide, scale 0.48 to 1.0 | yes (position, facing, size) | **needs new piece**: variable-width hanging-sign frame (housing, two hangers, bevel, blank face quad with full 0-1 UV), params `width`, `height` 0.42, `depth` 0.08, `drop`. The kit's `sign_hanging_*` is fixed 1.8 x 0.9 x 0.12 and 1,054 tris (324 mobile), so 100 of them would be 105k / 32k triangles for housings alone | gap, for Lane E |
| 8 | Sign faces: canvas atlas, 3 draws for 100 signs | same 100 | yes | keep (graph-derived wording; Lane E's own list says keep) | n/a |
| 9 | Ticket gates: the three JR gates (`g_jr_c1`, `g_jr_c2`, `g_jr_s`) are graph nodes at the end of a verified edge, next to a PLATEAU opening into unmodelled space (haze) | 3 gate lines | **node position and the arriving edge only.** Aisle count, line width and orientation are not in the data (the nearest PLATEAU portal triangles to `g_jr_c2` sit 4 to 6 m east of the node) | `gteki_gate_array_2`, the smallest bidirectional array (`_4w1`, `_6w1` and the one-way `_3w1_oneway` exist and are not used) | **placed, representative** (director decision, issue #3, 2026-10-22): one generic array per node, labelled 「代表性擺設，通道數與方向未驗證」 / "representative placement; aisle count and orientation unverified" in `kit.json`, in every placement, in the `station.json` credits and in the asset derivation. Guess rule: aisles along the edge's last segment as it arrives, the first aisle's centre on the node at mid-depth. Visual only (no collider, not in the walk graph). Field data (field-checklist F1) would replace the guess |
| 10 | Other operators' gates (Metro, Tobu, Yurakucho) | 5 search-only gate POIs, no node | no | gate arrays | blocked: `gap-metro-tobu-gates`, `gap-south-west` |
| 11 | Stair and escalator surfaces, railings | 72 flights, 3 escalator banks | landings and nosings: yes | stairs dressing (D2, PR #143) via PR #155 | out of scope |
| 12 | Plain `barriers` mesh (stair side walls, parapets, PLATEAU columns), flat `#c6cacf` | 10,992 tris | surface: yes, as one merged mesh | railing runs (D2) need polylines, which the merged mesh does not give; columns (`gteki_column_*`) need per-column footprints, which are not extracted | needs data (extract column footprints from `build/ubld_enu.json`) |
| 13 | `floor_elements` flat `#9b958c` | 80 thin raised pieces, EF_30 | yes, but what they are is unknown | none | n/a (Lane E list row 10) |
| 14 | Shopfronts: one emissive texture in PLATEAU door/window openings | `doors` 93, `windows` 236 tris, render off (`gteki_render` false) | openings: yes | shopfront modules (D3, PR #152) | waits for D3 |
| 15 | Exit portals: sky cap | exit stair tops | yes | street-exit canopy (D4, PR #153) | waits for D4 |
| 16 | Crowd: procedural capsule avatars | 56 low / 150 high | lanes: yes | not a kit item (avatar pass, explorer lane) | n/a |
| 17 | Benches, bins, vending, ticket kiosk, lift portals, posters, tactile strips | **not rendered**; no source anchor | **no** | `gteki_bench_*`, `gteki_bin_trio`, `gteki_vending_machine*`, `gteki_ticket_kiosk`, `gteki_lift_portal_w1000`, `gteki_poster_lightbox_*`, `gteki_tactile_strip_*` exist | not placed: nothing in PLATEAU or the facts-only maps backs a position. Tactile strips at stair heads would follow the stair anchors (#155) |

## What this means for batch 1

The brief expected existing procedural gates, rails and strips to swap. For Ikebukuro they do not exist: the scene is
PLATEAU geometry with materials, signs, fixtures and a crowd. The one existing data-backed object that a library piece
fits as it is: the access-fence label stretches (row 5). Batch 1 dresses those with `gteki_barrier_rail_2400_solid`;
see `scene/kit.ts`. The label wording, the collision and the walk graph are unchanged.

The same PR then adds the one object the data does not place: a representative gate array at each JR gate node (row 9,
director decision). It uses only the node position and the arriving edge, so the aisle count (a 2-aisle piece is the
smallest), the direction of use, the width and the side the array opens to are all guesses, and the label says so.

## Next batches, in order

1. **Sign housings** (row 7): Lane E adds the variable-width hanging-sign frame; the scene swaps the 100 boxes for
   instanced frames (a single draw per tile, mobile palette material).
2. **Gate arrays** (row 9): **done, representative** (approved with conditions, issue #3, 2026-10-22). One
   `gteki_gate_array_2` at each of the three JR gate nodes, oriented from the verified edge's last segment, labelled
   「代表性擺設，通道數與方向未驗證」 / "representative placement; aisle count and orientation unverified". The three
   arrays are merged per material and instanced, so the phone tier pays one draw (one palette material); Lane E's
   `THREE.BatchedMesh` measurement for the larger array was +1 draw as well (docs/assets/HANDOFF.md). Not measured
   here: the look and the draws need a GPU check. Replace with the surveyed layout when field data exists.
3. **Finish packs** (rows 1 to 3): data-only, `scene/finishes.json` is ready; waits for PR #133.
4. **Luminaires** (row 4): needs a re-bake; do it together with the stair/escalator kit GLB bake (README "Kit integration").
5. **Columns** (row 12): extract the PLATEAU column footprints once, commit them as a data file, then place
   `gteki_column_square_600` / `round_d600` on them.
6. **Shopfronts, canopies** (rows 14, 15) after Lane E D3 / D4.

## Lighting caveat

Ikebukuro is lit by its bake only. A kit mesh has no lightmap in this atlas, so kit instances are lit by the scene's own
PMREM environment (`KIT_ENV_INTENSITY` in `scene/kit.ts`) and will not match the baked surfaces exactly. HANDOFF.md
makes the same point ("kit props render dark until they are baked"). Baking kit pieces needs the Blender bake change
described in README "Kit integration"; until then, the look of every kit instance needs a GPU check.
