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
| **D2** | escalator dressing set; stair dressing (nosing strip, handrail run, side skirt); railing and barrier runs (glass and steel) | the two stations' vertical links and fences. For Ikebukuro this is a separate GLB that the station's bake takes in, with its origin at the stair nosing or escalator landing. Each piece carries `gteki_role` (`barriers` for railings, `transport` for escalator parts, `stairs_ramps` only on walkable surfaces) and no colliders |
| **D3** | platform edge set (Shinjuku B6); shopfront panel modules (Ikebukuro) | platform and shopfronts |
| **D4** | street-exit canopy, street furniture (bollard, guard rail, lamp, planter) | street level outside the walker footprint |
| **P1** | anchor props: toilet entrance and sign surround (Shinjuku F001–F003); bench, bin, vending, locker only where station geometry backs them | only where a facility anchor or station geometry backs them |
| **AI** | 2D art style batch (~10 images): fictional-brand posters, ad lightboxes, shopfront fascia art, each with a provenance sidecar | the Owner sees the batch before any mass run |

**Parametric fit.** Dressing pieces (runs, escalator and stair dressing, cladding) take their length, rise, width and path as catalog params. That way a station gets a piece that fits its geometry rather than a fixed module, while the kit itself stays generic: no station measurements live in the kit catalog.

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
