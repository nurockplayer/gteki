# Kit gap list for the #94 look

**Status:** v0.1, 2026-10-22. Built from inventories the two station leads sent to Lane E:
- Ikebukuro: `ikebukuro_b1_lit.glb` and `scene/materials.ts`.
- Shinjuku: candidate `b511263`, the #61 head.

It maps what each station renders today to an existing kit piece or a new one, and orders production by screen time on the main routes. The look rules are in [style.md](style.md).

**Ownership:**
- Lane E builds the pieces.
- Each station lead decides whether, where and how to use them.
- Lighting in the explorer is Lane G and Explorer work.

## Findings that shape the kit

1. **Most screen time is surfaces on source-backed geometry, not props.**
   - In both stations, the walls, floors, ceilings, stairs, escalators and luminaires fill most of the frame.
   - Ikebukuro's geometry is surveyed PLATEAU data; Shinjuku's is GSI CAD.
   - Both stations forbid invented structure. Ikebukuro, for example, has no gate interior or platform modelled.

   So the first batches are **finishes and dressing** fitted to geometry the stations already have; standalone props come later.
2. **Stations need materials, not only objects.** Both stations paint floors, walls and ceilings with runtime canvas textures. A *finish pack* lets them swap a canvas for the kit's material by name: tileable texture sets with the repeat in metres, plus a sample GLB. That is a new kit format (see F0).
3. **Lighting differs by station.**
   - **Ikebukuro is lit only by its bake.** A large static piece must go through the station's Blender bake (`pipeline/blender_bake_lighting.py`) with its own UV2, so kit pieces need clean UV1 and modest triangle counts.
   - **Shinjuku uses real-time light:** hemisphere, RoomEnvironment and point lights. Pieces must look right as plain metal-rough with baked AO, which is the AO PR that runs alongside this list.
4. **Budgets are tight:**
   - Ikebukuro low tier: ≤ 28 draws and 129k triangles.
   - Shinjuku: ≤ +30 draws, +60k triangles, +3 MB geometry and 8 MB of GPU textures, measured on the shipped variant.

   So pieces batch per material or instance, and the mobile tier is the default for phones.
5. **Placement anchors.**
   - Shinjuku's 90 GSI facility points (`plan.json`) are source-backed anchors (director ruling). Their codes, from the GSI 階層別屋内地理空間情報データ仕様書（案）, H30.3:

     | Codes | Meaning |
     | --- | --- |
     | F001 / F002 / F003 | toilet, male / female / unisex |
     | F011 / F012 / F013 / F014 | stairs / lift / escalator / slope |
     | F106 | ticket gate |
     | F108 | exit |

   - Each point is a representative point of a space, not an equipment position or orientation.
   - F011–F014, F106 and F108 duplicate what the station already draws from E27 links, so they tag and cross-check kit pieces rather than place new ones.
   - **F001–F003 are the new anchors:** a toilet entrance and sign kit at the room wall.
   - The code set has no shops, kiosks, benches or vending, so those have no source anchor at Shinjuku.
   - Rendering at these points is covered by the existing PDL 1.0 attribution; the station's public-release HOLD still applies.
   - Every piece below carries a **facility type** so each lead can map its own codes.

## Station inventories mapped to the kit

The rank is screen time on the main routes, as each lead judged it from route walks.

### Ikebukuro (B1 Central, South and North passages, West Exit halls, exit stairs)

| Rank | Element today | Kit answer | Batch |
| --- | --- | --- | --- |
| 1 | Floor: canvas tile, 2.4 m repeat | finish: terrazzo, 600 tile, granite border band | F1 |
| 2 | Walls, columns, cladding: flat `#dedee0` with shader bands | finish: enamel panel, wainscot blue, chair rail and skirting profiles, column cladding | F1, D1 |
| 3 | Ceiling: canvas panel | finish: linear spandrel, panel grid with slot | F1 |
| 4 | 2,616 light fixtures: emissive boxes | luminaire modules (linear LED, recessed), instanced | D1 |
| 5 | Signs: 100 GTEki panels (deliberate) | keep; the kit sign frames are optional | n/a |
| 6 | Shopfronts: one generic emissive texture | shopfront panel modules (door, glazing, fascia, shutter) and fictional-brand fascia art (AI, §AI) | D3, AI |
| 7 | Stairs and ramps: canvas texture | stair dressing: nosing strip, handrail run along a polyline, side skirt | D2 |
| 8 | Escalators: flat slabs | escalator dressing fitted to the station's slab: balustrade, handrails, newels, comb plates, treads | D2 |
| 9 | Barriers and railings: flat `#c6cacf` | railing and barrier runs along a polyline (glass or steel) | D2 |
| 10 | Floor elements: flat `#9b958c` | none yet. One PLATEAU `IntBuildingInstallation` with function EF_30, which the acquired codelist names 屋根、床、舗装エレメント (roof, floor and paving elements): 80 thin raised pieces up to 12 cm, west of the Central Passage. What they are is unknown, so nothing is planned until then | n/a |
| 11 | Exit portals: sky cap | street-exit canopy (generic) | D4 |
| n/a | Not modelled: gates, lifts, benches, platform, ads | none unless the station adds source-backed geometry | n/a |

### Shinjuku (E27 Ōedo line: concourses, gates, vertical links, B6 platform, street exits)

| Rank | Element today | Kit answer | Facility type | Batch |
| --- | --- | --- | --- | --- |
| 1 | Concourse floors: canvas tile and AO pools | finish: terrazzo (free side), granite (paid side), 600 tile (platform) | n/a | F1 |
| 2 | Walls: zero-thickness, canvas enamel, kick below 1.05 m, magenta stripe at 2.35 m | finish: enamel panel, kick plate, and a separate `line_accent` material slot or mask that the station tints at runtime (Ōedo `#b6007a`). It is not baked into the base texture | n/a | F1 |
| 3 | Ceilings: canvas grid, heights generic | finish: spandrel, panel grid with slot | n/a | F1 |
| 4 | Linear luminaires every ~3.2 m | luminaire modules, instanced | n/a | D1 |
| 5 | Hanging signs: GTEki canvas atlas (deliberate) | keep; the kit sign frames are optional | n/a | n/a |
| 6 | Stairs: box per step | stair dressing kit, or the kit stair generator at the station's rise and width | stair (F011) | D2 |
| 7 | Escalators: box truss and animated steps | escalator dressing (balustrade, handrail, newel, comb), keeping the station's animated steps | escalator (F013) | D2 |
| 8 | Ticket gates: boxes, no flaps | **existing** `gate_array` (two machines straddling each verified gate row). Flaps rest open, stored in the cabinet (the kit default), with no closing animation. IC and OK pad colours stay runtime | gate (F106) | existing |
| 9 | Fare and access fences, 1.15 m glass | railing and barrier runs | n/a | D2 |
| 10 | Restricted and No-entry panels | keep (fixed wording); optional kit frame | n/a | n/a |
| 11 | Lift portals: ~15 boxes each, 3.78 MB and 49.6k triangles in all | **existing** `lift_portal`, instanced (one mesh per material); it must beat 3.78 MB and 49.6k triangles for all portals together. The indicator stays generic: no floor-number, direction or status claims | lift (F012) | existing |
| 12 | Tactile ribbons | **existing** `tactile_strip` (bars and dots), or the tactile finish on the station's ribbon | n/a | existing, F1 |
| 13 | B6 platform: screen doors, track, train | platform edge (yellow line, edge tactile, coping); generic platform screen-door module | platform | D3 |
| 15–18 | Street: paving, kerbs, facades, canopies, street furniture | exit canopy; street furniture (bollard, guard rail, lamp, planter) outside the walker footprint | exit (F108) | D4 |
| n/a | Not drawn: columns, shops, benches, vending, bins, toilets | toilet entrance and sign kit at F001–F003 room walls. No source anchor exists for shops, benches or vending, so those stay unplaced unless the director rules otherwise | toilet (F001–F003) | P1 |

## Production order

Each batch is one PR with 5–10 pieces, a contact sheet and both tiers passing validate, Godot import, web load and reproducibility (style.md §9). The AO bake ([#94](https://github.com/nurockplayer/gteki/issues/94) lighting item 5) lands first, in its own PR, because every piece carries it.

| Batch | Pieces | Why now |
| --- | --- | --- |
| **F0** | finish-pack format: tileable texture set (albedo, ORM, normal, repeat in metres) plus a 1×1 m sample GLB per finish, contract section and validator | lets stations use the kit's materials on their own geometry |
| **F1** | finishes: terrazzo, granite tile and border, 600 tile, enamel panel, wainscot blue, kick plate, spandrel ceiling, panel-grid ceiling, line-colour band, tactile | biggest screen area in both stations |
| **D1** | luminaire modules (linear LED 1.2 m, recessed panel, downlight), chair rail and skirting profile runs, column cladding sleeve (only where a column exists) | fixtures and wall trim are on screen everywhere |
| **D2** | escalator dressing set; stair dressing (nosing strip, handrail run, side skirt); railing and barrier runs (glass and steel) | the two stations' vertical links and fences. For Ikebukuro this is a separate GLB that the station's bake takes in, with its origin at the stair nosing or escalator landing. Each piece carries `gteki_role` (`barriers` for railings, `transport` for escalator parts, `stairs_ramps` only on walkable surfaces) and no `COL_*` nodes. The runtime loaders act on the role (`barriers` and `transport` collide, `stairs_ramps` is walkable), so a catalog entry can override or drop it with `gteki_role` (contract §10) |
| **D3** | platform edge set (Shinjuku B6); shopfront panel modules (Ikebukuro) | platform and shopfronts |
| **D4** | street-exit canopy, street furniture (bollard, guard rail, lamp, planter) | street level outside the walker footprint |
| **P1** | anchor props: toilet entrance and sign surround (Shinjuku F001–F003); bench, bin, vending, locker only where station geometry backs them | only where a facility anchor or station geometry backs them |
| **AI** | 2D art style batch (~10 images): fictional-brand posters, ad lightboxes, shopfront fascia art, each with a provenance sidecar | the Owner sees the batch before any mass run |

**Parametric fit.** Dressing pieces (runs, escalator and stair dressing, cladding) take their length, rise, width and path as catalog params. That way a station gets a piece that fits its geometry rather than a fixed module, while the kit itself stays generic: no station measurements live in the kit catalog.

**D2 status.** Generator code and nine default variants are in (`families/dressing.py`, catalog ids `gteki_escalator_dress_*`, `gteki_stair_*`, `gteki_railing_run_*`, `gteki_fare_fence_glass_h1150`); the GLBs are built in a separate GPU slot.
- **Escalator dressing** keeps the balustrade, moving handrail, newels and comb plates of the existing escalator, with side skirts and static treads (for Ikebukuro's flat slabs) as options. Truss, slabs and colliders are left out. Origin on the bottom comb plate line. Params: `rise_mm`, `angle_deg` or `run_mm`, `width_mm`, `landing_mm` (one value for both ends).
- **Stair dressing** is nosing strips (`vertical_safety_yellow`), a two-tier handrail run on the nosing pitch line, and side skirts, chosen with `parts`. Origin under the bottom nosing. Nosing-only pieces carry `stairs_ramps`; rails and skirts carry `barriers`.
- **Railing runs** follow a `points` polyline (glass or steel) with posts, a top rail and a base channel. Guard height 1100 mm, fare fence 1150 mm. Origin at the plan origin of `points`.
- `gteki_role` is on the root and every `VIS_*` node (contract §10) and is read by the station runtime: `barriers` and `transport` collide, `stairs_ramps` is walkable. A catalog entry sets `"gteki_role": null` to drop it (visual-only use, Shinjuku) or another allowed value. No piece has `COL_*` nodes.
- **Open:** asymmetric top and bottom landings and closed-loop runs wait for a station that needs them. Once a station lead sends the dimensions to fit, more variants are catalog entries only.

**D3 status.** Generator code and nine default variants are in (`families/platform.py`, `families/shopfront.py`, catalog ids `gteki_platform_*` and `gteki_shopfront_*`, one synthetic layout in `showcase/platform_shop_demo.json`); the GLBs are built in a separate GPU slot.
- **Platform edge** (`platform_edge`, Shinjuku B6 item 13) is a run along the edge with the edge line at x = 0, the track on the −X side and the platform on +X. `parts` picks any of `coping` (granite or concrete), `line` (yellow, 100 mm), `tactile` (300 mm band of JIS T 9251 style dot blocks, optionally `tactile: "inner_line"` for a continuous raised line on the platform side) and `gap_strip` (rubber lip over the train gap). Params are `length_mm`, `coping_depth_mm`, `coping_h_mm`, `tactile_setback_mm` and `line_offset_mm`; the resulting layout is recorded in `params.strips_mm`. Everything is one flush inlay 10 mm above the station's floor (nothing below it) and visual only. Shinjuku already draws its screen doors but not the edge line or edge tactile, so it takes the edge set and its own floor stays under the inlay.
- **Platform screen door** (`platform_screen_door`) is the optional generic module: 5.6 m, fixed panels, a pair of sliding leaves (`open_mm` slides them apart) and a header box. It has no lamps, text or status. A station that draws its own doors does not need it.
- **Shopfront bays** (`shopfront`, Ikebukuro rank 6) have `kind` of `glazing`, `door`, `shutter` (closed, or raised by `shutter_open`) or `fascia` (the sign band alone, any width). Wall placement with `left` and `right` sockets, half a mullion on each side so bays chain. Params are `bay_w_mm`, `height_mm`, `fascia_h_mm` and `mullion_mm`, plus `sill_mm`, `door_h_mm` and `housing_h_mm` for the kinds that use them.
- **Fascia art slot:** every fascia carries one quad with the material `gteki_fascia_art` (blank warm white, lit from within) and its own 0..1 UV island. The kit puts no brand or text on it; the AI batch's fictional-brand fascia art replaces the material or its texture by name, drawn at `params.fascia_aspect`. `fascia_u` splits one wide sign across chained bays.
- No piece has colliders (the station's wall and platform block), so the validator reports "no collision node" as a WARN for each new GLB, as it does for the tactile strips.
- **Open:** the inner-line block is a generic approximation, not a dimensioned copy of the published edge block. Screen-door leaves are static poses. Shop interiors are a dark backing plane (`backing: false` turns it off), because no station geometry backs a shop.

## D1 status

**Status:** generators and catalog entries written 2026-10-22; not built yet. The Blender slot builds both tiers, then the batch PR carries the contact sheet. Generic defaults only: the catalog holds no station measurement, and stations pass their own `*_mm` params.

| Piece | Catalog id | Default params | Fit |
| --- | --- | --- | --- |
| Linear LED 1.2 m | `gteki_luminaire_linear_1200` | 1200 × 130 mm, 40 mm deep, mounting plane at 2800 mm | Shinjuku linear luminaires (~3.2 m pitch), Ikebukuro fixtures. Instanced; `start`/`end` sockets chain rows |
| Recessed panel 600 × 600 | `gteki_luminaire_panel_600` | 600 × 600 mm, 12 mm lip | panel-grid ceiling (F1) |
| Round downlight | `gteki_luminaire_downlight_d150` | Ø150 mm trim, Ø100 mm aperture, 12 mm lip | small recessed fixtures (Ikebukuro's 2,616 emissive boxes) |
| Chair rail | `gteki_trim_chair_rail_3000_steel` | 3000 mm run, 40 × 20 mm bullnose, `steel_brushed`, lower edge at 1100 mm | wainscot change in the enamel wall (F1) |
| Skirting | `gteki_trim_skirting_3000_steel`, `gteki_trim_skirting_3000_granite` | 3000 mm run, 120 mm high; 12 mm flat in steel, 16 mm stepped in granite | wall foot |
| Column sleeve | `gteki_column_sleeve_600x600_h2800`, `gteki_column_sleeve_900x600_h3200_accent` | 600 × 600 × 2800 mm with stainless corner guards; 900 × 600 × 3200 mm in accent panel, no guards | only where the station has a column |

- **Ceiling mounting.** Luminaires use the contract's `ceiling` placement. Each has a `SOCKET_ceiling` on the mounting plane, and the origin is on the floor under the fixture. A station with a different ceiling height lifts the instance by the difference, so one mesh serves every fixture of a kind. A flush lip of 12 mm means the station's ceiling needs no opening.
- **Lighting.** Every luminaire has one `LIGHTHINT_*` (`linear_led`, `panel`, `downlight`) that `render_preview.py` turns into a matching light; the diffuser is the palette's `light_diffuser`. Ikebukuro bakes those lights itself; Shinjuku adds its own point lights.
- **Collision.** None. Luminaires hang overhead, trim is a few centimetres proud of the wall, and a column sleeve dresses a column that already has the station's collider. This keeps Shinjuku's kit pieces visual-only and adds no walker blocker at Ikebukuro. Each piece therefore shows the validator's "no collision node" WARN.
- **Materials and budgets.** Palette materials only (`steel_brushed`, `wall_panel_enamel`, `wall_panel_accent`, `floor_granite_dark`, `aluminium_anodised`, `stainless_polished`, `reveal_dark`, `plastic_dark`, `light_diffuser`), so the mobile palette and its 64 × 64 atlas do not change. The three luminaires carry no textures; the others reuse existing images.
- **Not done in D1.** Mitred ends exist as params (`miter_start`, `miter_end`) but no catalog entry uses them. Trim has no inside or outside corner pieces. Light distribution (IES) is not modelled.

## Station answers that bind the batches

**Ikebukuro:**
- Kit dressing ships as a separate GLB that the station bake takes in. It is not merged into the PLATEAU-derived base, so the kit stays separately attributable.
- Finish packs are named by role and give their repeat in metres; they slot into `scene/materials.ts`.

**Shinjuku:**
- Budgets are measured on the shipped meshopt + KTX2 variant.
- Kit pieces are visual-only.
- The line band is a runtime-tinted `line_accent` slot.
- The station sends placement mapping after #61 and #72, once it has the piece list with dimensions.

## P1 status

**Built (generator code, batch `claude/lane-e-p1-toilet-anchor`):** `toilet_entrance` in `tools/blender/gteki_assets/families/facilities.py`, six catalog variants (`gteki_toilet_entrance_` + `male`, `female`, `unisex`, `accessible`, `pair`, `male_maze`) and `tools/blender/showcase/facilities_demo.json`.
- **What it is:** jamb and lintel trim around an opening the station already has, a reveal lining, a pictogram sign above or beside the opening, and an optional privacy screen stub behind the wall. Placement `wall`; sockets `SOCKET_wall` and `SOCKET_sign`; tags `toilet`, `entrance` and the kind.
- **Facility kind:** `params.kind` mirrors the GSI codes (F001 `male`, F002 `female`, F003 `unisex`). `accessible` and `pair` are extra kinds: a multi-purpose room at F003 can use `unisex` or `accessible` (the station lead chooses), and `pair` is for a shared entrance to a male and a female room.
- **Anchors:** place the piece only where the source gives the entrance or door position. A GSI point is a representative point of a space and gives no door, so it is not enough on its own: the piece would imply a door the source does not give. **Shinjuku decision (B lead, 2026-10-22):** Shinjuku does not place it, because its F001–F003 data has no door location, and toilets stay a gap there. Ikebukuro is to be asked. The kit holds no station measurement; opening sizes are generic-typical (1.0 and 1.2 m wide, 2.1 m high) and are parameters.
- **Not modelled:** toilets, sinks, door leaves, floors and ceilings. The kit does not invent the room.
- **Collision:** jamb trims and, for `screen: maze`, the screen; the opening is clear. A kit piece for Shinjuku is visual-only in practice, so those colliders can be dropped there.
- **Style exception:** [style.md](style.md) §6 says signs carry no pictograms. These sign faces are the one exception, as requested for P1: own geometric figures in the spirit of ISO 7001 / JIS Z8210 symbols, no traced artwork, no text, no operator marks. §6 now records this narrow exception; the Owner can still revert it.
- **Still open in P1:** bench, bin, vending and locker stay with the existing props; no new piece is added without station geometry that backs it.
- **Checks to run with Blender (not run yet):** `build.sh` for both tiers, `repro`, `godot`, `web`, and the contact sheet.

## D4 status: street exit and street furniture

**Status:** generator code, catalog entries and a contact-sheet layout are in; nothing is built or rendered yet. Code is `tools/blender/gteki_assets/families/street.py`, the layout `tools/blender/showcase/street_demo.json`.

Covers Shinjuku inventory items 15–18 and Ikebukuro item 11 (exit portals), as generic pieces: no real-world specifics, no station names, no operator graphics. Every piece is tagged `street`, plus `exit` (F108) for the canopies or `furniture`.

| Piece | Catalog ids | Params (mm) |
| --- | --- | --- |
| Street-exit canopy (`street_canopy`) | `gteki_street_canopy_w3000_d3000_posts`, `gteki_street_canopy_w4500_d3000_cantilever_curved` | `width_mm`, `depth_mm`, `height_mm` (clear height under the fascia), `roof` (`flat`, `pitched`, `curved`), `pitch_deg`, `rise_mm`, `support` (`posts`, `cantilever`), `fascia_mm`, `fascia_theme`, `screens` (`none`, `left`, `right`, `both`) |
| Bollard (`street_bollard`) | `gteki_street_bollard_fixed_d114_h900`, `gteki_street_bollard_removable_d114_h900` | `diameter_mm`, `height_mm`, `kind` (`fixed`, `removable` with an aluminium collar and lock plate), `band_mm` |
| Guard rail (`street_guard_rail`) | `gteki_street_guard_rail_3000`, `gteki_street_guard_rail_l_3000x2000_stainless` | `points_mm` (plan polyline from the first point), `height_mm`, `post_spacing_mm`, `coating` (`painted`, `stainless`) |
| Street lamp (`street_lamp`) | `gteki_street_lamp_h5000_arm900` | `height_mm` (diffuser underside), `arm_mm` |
| Planter (`street_planter`) | `gteki_street_planter_box_1200x600_h600`, `gteki_street_planter_round_d800_h500` | `shape` (`box`, `round`), `width_mm`, `depth_mm`, `diameter_mm`, `height_mm`, `planting` (`shrub`, `none`) |

**How the pieces fit:**
- **Canopy frame.** The origin is on the ground at the centre of the opening edge. The roof runs toward +Y (glTF −Z) for `depth_mm`. Placement is `linear`.
- **Canopy sockets.** `SOCKET_opening` sits at the origin and faces back toward the stair or escalator; its width is the clear gap between the posts. `SOCKET_fascia` sits on the sign face at the far edge and faces +Y.
- **Fascia.** It is a blank sign panel: an aluminium frame around a `gteki_sign_face_*` quad with a 0..1 UV island, and no wording. The station swaps the material or puts a canvas on it. It carries a `LIGHTHINT_fascia`, because the face is a backlit light box.
- **Roof.** The frame sits just under the fascia top at the far edge. A pitched roof rises toward the opening edge, and a curved roof arches between the two edges. Glass cells sit in aluminium ribs.
- **Posts.** `posts` puts square posts at all four corners; `cantilever` keeps only the rear pair, with knee gussets. Posts stand beside the opening, so `width_mm` minus two post widths (100 mm, 140 mm for a cantilever) is the clear opening.
- **Guard rail.** `points_mm` are offsets from the first point, which is the origin, with mitred corners. `SOCKET_start` and `SOCKET_end` chain runs. Posts sit at every vertex and at most `post_spacing_mm` apart.
- **Lamp.** The arm and head reach toward −Y (glTF +Z). `LIGHTHINT_head` sits on the diffuser (`kind` `street_lamp`, 60 W, 4000 K).

**Collision** (contract §2). All of it is street level, outside any station interior's walker footprint, and the colliders block a walker:
- bollard, lamp pole, planter: one box or 12-sided cylinder over the visual footprint (planter shrubs do not collide)
- canopy: one box per post and one thin box per glass screen. The roof, frame and fascia have none, because they are overhead
- guard rail: one full-height thin box per segment, so a walker cannot slip between the rails

This follows the Ikebukuro rule (a solid prop needs a walker collider). Shinjuku keeps kit pieces visual-only and ignores the `COL_*` nodes.

**Materials.** All come from style.md §2 except four new flat factor colours, with no texture and so no download or GPU cost:
- `gteki_street_steel`: painted graphite steel
- `gteki_street_concrete`: precast planter body
- `gteki_street_soil`
- `gteki_street_foliage`: one flat green for the generic shrub

The fascia face uses `gteki_sign_face_white_none_a<aspect×100>` through `signage.face_material`, with the aspect rounded to 0.5. Adding four materials moves the sorted mobile palette, so all mobile GLBs are rebuilt.

**Dimensions.** `dimension_basis` is `synthetic` for every piece: look-dev proportions in a typical street range, with no published source claimed. The catalog stays generic, and a station passes its own `*_mm` values.

**Not done here:** a Blender build, the Godot and web import tests, `repro`, the contact sheet, and budget numbers for the new GLBs. Triangle counts so far come from a pure-Python stub (mobile exact; full is an estimate of the bevel growth), and the GPU and byte budgets (`budget.json`, `budget_mobile.json`) have headroom to confirm after the first build.
