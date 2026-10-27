# Vertical transport: Blender reference vs. the live game

Date 2026-10-28 03:10 JST, base `origin/main` `9e1c1d37`. Step 1 of the vertical transport art pass: what separates `vertical_hero` ([style.md](../assets/style.md), `tools/blender/showcase/vertical_demo.json`, camera `hero`) from the escalators and stairs a player actually walks in the web game, ranked by visual gain per effort, and the spot chosen for the Golden Slice.

The 2026-10-22 look-gap report ([#94 part B](../qa/reports/2026-10-22-art-94-look-gap.md)) compared the kit pieces in a studio harness. Most of its explorer-side proposals (AgX, environment light, bloom threshold, walker shadows, baked kit AO) have shipped since. This report compares real station spots instead.

## Evidence

Reference: ![vertical_hero](../assets/img/vertical_hero.jpg)

Live game, Shinjuku, desktop (1280×800, high tier): the m1–m3 escalator bank from its foot (wide and close), the Exit 1 stair flight, and the play view climbing the bank:

![before desktop](evidence/vertical-before-desktop.jpg)

Phone (390×844, low tier: no composer, no GTAO, no shadows), the same three spots:

![before phone](evidence/vertical-before-phone.jpg)

Captured with `tests/e2e/specs/21-vertical-shots.spec.ts` (fixed node, fixed camera, both tiers, plus a walk down and back up the bank). Numbers from the same run:

| Spot | Desktop draws / tris | Phone draws / tris |
| --- | --- | --- |
| bank foot (wide) | 231 / 341k | 100 / 159k |
| bank foot (close) | 220 / 337k | 80 / 158k |
| bank head | 207 / 341k | 80 / 159k |
| Exit 1 stair foot | 171 / 319k | 68 / 150k |

Walk: down the 30 m bank (the before run walked back up the same escalator; the spec now climbs the up escalator `2692fe`) in quarters on both tiers, `done` every time, never `stuck`, height linear from −7.85 m to −23.53 m (the ramp walk proxy). Frame time is pinned at the 60 Hz vsync (16.7 ms) on the dev Mac at every spot, so it's no use for comparison here. Draws and triangles are the cost measure.

## Where vertical transport comes from today

| | Shinjuku (real-time) | Ikebukuro (baked) |
| --- | --- | --- |
| Geometry | Procedural boxes per graph edge (`stations/shinjuku/scene/build.ts` 740–850): stair = one solid box per step plus a 75 mm nosing box; escalator = truss box, flat 0.384 m step slabs (instanced, animated), glass panel, box handrail, steel skirt, two indicator lamps | PLATEAU ubld mesh (`EF_35` → `stairs_ramps`, `EF_80` → `transport`), plus Lane E catalog dressing on surveyed anchors: 5 escalators (desktop), 21 stair rails (desktop), 61 nosings (both tiers) |
| Run truth | 24 stair and 21 escalator runs from verified MLIT E27 edges. Plan position is surveyed, heights are symbolic (30°) | Surveyed mesh. The graph has **no escalator edges**: escalators are colliders, not walkable |
| Walk | Every run is walkable (invisible ramp proxy). Both guided walks ride the m1–m3 and m3–m6 banks | Stairs walkable. Escalators not |
| Materials | Untextured `MeshStandardMaterial`: stair `#8d887d`, step slab `#6d7177` metal 0.7. `escStepEdge` (yellow) is defined and never used | Lightmapped canvas and normal maps on `stairs_ramps`; plain grey `transport`. Kit pieces have PBR maps and an AO atlas |
| Light | Hemisphere 0.85 + RoomEnvironment 0.55 + ≤ 8 points; no shadows on any run; no AO on runs (floor light-pool aoMap only) | Cycles lightmap 4k/2k on both tiers; kit dressing gets env only (no lightmap) |
| Kit | Kit swap off by default (`KIT_SWAP_DEFAULT=false`) and not loadable: `stations/shinjuku/gteki/assets/` doesn't exist, so the fitted catalog (`stations/shinjuku/kit/catalog.json`, 10 escalator / 22 stair / 1 gate entries) has never been built. Even when on, it only adds comb plates and newels | Live |

## Gaps, ranked by visual gain per effort

Gain is judged at the play view. "Phone" says whether the fix reaches the low tier.

| # | Gap (Shinjuku unless noted) | Reference | Game today | Fix (reuse first) | Gain | Effort | Phone |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Escalator steps read as a ramp** | Dark cleated treads, yellow demarcation on three sides, risers, two or three flat steps and a comb plate at each end | Flush grey slabs on a straight incline, no riser, no landing steps, no comb | Restyle the procedural steps in `build.ts`: cleat texture (canvas, like the existing tactile map), yellow edge with the unused `escStepEdge`, a riser face, flat steps at both ends | high | S | yes |
| 2 | **Escalator body has no form** | Glass balustrade on a steel shoe, black handrail running in a loop round rounded newels, skirt, comb plates, newel lamps | Glass panel and box handrail end square at the floor; no newel, no comb; truss reads as a grey slab | Build the Shinjuku catalog's escalator entries with `parts` balustrade + handrail + newel + comb (the generator behind `vertical_hero` and Ikebukuro batch A) and place them through the kit swap; drop the procedural balustrade, handrail and skirt on dressed runs. Collision stays the station's run walls | high | M | yes (mobile tier) |
| 3 | **No contact darkening** | Strong AO under handrails, at skirts, at every step edge; sun shadow | Runs get neither shadows nor AO; the high tier only has screen-space GTAO; phones get nothing | Kit AO atlas on UV1 (already produced by the catalog build at `ao_res` 256) for the dressing; a baked gradient on the procedural truss, sides and step risers (vertex colour, no extra draw) | high on phone, medium on desktop | M | yes |
| 4 | **Stairs are monochrome blocks** | White treads, dark nosing with a highlight, stringers, rails on both sides with posts and extensions | Warm grey solid blocks, one wall rail, stringer is a dark band | Lighter tread finish from the palette (terrazzo `#C7C2B8` family), separate riser shade, nosing strip from the catalog (`stair_dressing` nosing), and post-mounted rails where a side has no wall | medium-high | S–M | yes |
| 5 | **Flat, sourceless light along the incline** | Light from ceiling fixtures; highlights run along bevels and the handrail | Even ambient; the escalator soffit is a blank plane | Linear luminaires from the kit (`fixtures.py` linear module) along the soffit over each dressed bank (a ceiling finish on drawn geometry, so no new structure), emissive only on phones; on desktop one or two of the existing ≤ 8 point lights moved to the bank | medium | M | partly (emissive) |
| 6 | Steel and glass read grey | Brushed steel, glass picks up the environment | Station-wide envMap at 0.55 overrides the authored 0.22 / 0.18 | Comes with #2 (kit materials keep their own `envMapIntensity`) | medium | — | yes |
| 7 | Signage at the vertical | Hanging exit sign over the bank | None at the bank | Only where the station's sign data has a sign there; the truth rules forbid inventing one. Out of the slice | low | — | — |
| 8 | Ikebukuro escalators | — | Dressed, but not walkable and on no guided walk | Not a slice candidate; the expansion plan reuses #1–#5 where they apply | — | — | — |

Post-processing is not a top gap: AgX, environment light, bloom threshold and GTAO already match the reference's intent on desktop. What's left is the phone tier's lack of AO, which #3 covers without a new pass.

## Golden Slice: Shinjuku m1–m3 escalator bank and the Exit 1 stairs

- **Spot.** The three parallel 30 m escalators on edges `e1fa65`, `2692fe` and `fd3365` (catalog entry `gteki_sj_escalator_2692fe08`), between the B1 gate level (m1) and m3. Then the three short Exit 1 stair flights (`b503c7`, `cebac0`, `03bd24`) at the start of the same walk.
- **Why this one.**
  - The runs are verified MLIT E27 edges with surveyed plan positions.
  - It's walkable today, and both guided walks use it: Exit 1 → Oedo platform rides `e1fa65` down, platform → Exit 2 rides `2692fe` up. So the slice is what players and the e2e walks see.
  - It's real-time. Kit pieces drop in as plain glTF metal-rough, which is the Shinjuku contract, with no rebake.
  - A bank of three escalators is the same composition as `vertical_hero`.
- **Known limit.** Heights are symbolic (30° from plan length), so the rise is the scene's, not surveyed. The catalog already records `dimension_basis: synthetic`.
- **Order.**
  1. Step restyle (#1) and stair finish (#4). These are procedural and land on all 45 runs at once.
  2. Catalog escalator dressing for the bank (#2, with its AO, #3).
  3. Luminaires over the bank (#5).
  4. Measure, then widen to the other 9 escalator entries and the stair entries within the kit budget (≤ +30 draws, ≤ +60k triangles, ≤ +3 MB geometry on phone).
- **Evidence for each batch.** Spec 21 rerun against the same spots on both tiers (draws and triangles against the before table), the walk down and up with no `stuck` and the same heights, the guided walk specs 03 and 12, and the route-clip audit.

## Two-station expansion (outline; full plan after the slice)

- **Shinjuku.** The slice code is per run, so #1 and #4 already cover every run. #2 and #5 widen entry by entry against the phone budget.
- **Ikebukuro.** Batch A already gives escalator dressing on desktop. Bring the escalator treatment to the low tier as a mobile bundle. Apply the stair finish to the PLATEAU `stairs_ramps` through its existing `patchLit("stairs")` shader (no rebake). Escalators stay non-walkable until the station lead adds verified escalator edges; that call belongs to the station lead.

## Plugins (none needed to proceed)

| Plugin | Concrete use here | Benefit |
| --- | --- | --- |
| Hard Ops / Boxcutter | Faster bevelled newel caps, comb plates and step cleats in `vertical.py` prototypes before porting to code | Iteration speed only; output stays generator code |
| Conform Object | Wrap tactile strips and nosings onto non-planar landings | Minor; our landings are planar |
| Cablerator | Handrail and cable runs along curves for prototyping the escalator handrail loop | Prototyping only |
| Realtime Materials | Quick PBR look-dev of tread, cleat and brushed-steel finishes before baking to the palette | Look-dev speed; shipped textures stay CC0/self-made |
