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
   - Shinjuku's director ruled that the 90 GSI facility points in `plan.json` are source-backed anchors. A generic piece of the matching category may stand at one once its category and licence fields allow rendering.
   - Codes: F106 is ticket gates and F108 is exits (station README). F001–F003 and F011–F014 are yet to be named by Lane B.
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
| 10 | Floor elements: flat `#9b958c` | finish or dressing per element type; needs the element list | later |
| 11 | Exit portals: sky cap | street-exit canopy (generic) | D4 |
| n/a | Not modelled: gates, lifts, benches, platform, ads | none unless the station adds source-backed geometry | n/a |

### Shinjuku (E27 Ōedo line: concourses, gates, vertical links, B6 platform, street exits)

| Rank | Element today | Kit answer | Facility type | Batch |
| --- | --- | --- | --- | --- |
| 1 | Concourse floors: canvas tile and AO pools | finish: terrazzo (free side), granite (paid side), 600 tile (platform) | n/a | F1 |
| 2 | Walls: zero-thickness, canvas enamel, kick below 1.05 m, magenta stripe at 2.35 m | finish: enamel panel, kick plate, line-colour band (station colour as a parameter, not baked in) | n/a | F1 |
| 3 | Ceilings: canvas grid, heights generic | finish: spandrel, panel grid with slot | n/a | F1 |
| 4 | Linear luminaires every ~3.2 m | luminaire modules, instanced | n/a | D1 |
| 5 | Hanging signs: GTEki canvas atlas (deliberate) | keep; the kit sign frames are optional | n/a | n/a |
| 6 | Stairs: box per step | stair dressing kit, or the kit stair generator at the station's rise and width | stair | D2 |
| 7 | Escalators: box truss and animated steps | escalator dressing (balustrade, handrail, newel, comb), keeping the station's animated steps | escalator | D2 |
| 8 | Ticket gates: boxes, no flaps | **existing** `gate_array` (flaps animate), at the station's generic count | gate (F106) | existing |
| 9 | Fare and access fences, 1.15 m glass | railing and barrier runs | n/a | D2 |
| 10 | Restricted and No-entry panels | keep (fixed wording); optional kit frame | n/a | n/a |
| 11 | Lift portals: ~15 boxes each, 3.78 MB and 49.6k triangles in all | **existing** `lift_portal` (a fraction of the size); the station measures the saving | lift | existing |
| 12 | Tactile ribbons | **existing** `tactile_strip` (bars and dots), or the tactile finish on the station's ribbon | n/a | existing, F1 |
| 13 | B6 platform: screen doors, track, train | platform edge (yellow line, edge tactile, coping); generic platform screen-door module | platform | D3 |
| 15–18 | Street: paving, kerbs, facades, canopies, street furniture | exit canopy; street furniture (bollard, guard rail, lamp, planter) outside the walker footprint | exit (F108) | D4 |
| n/a | Not drawn: columns, shops, benches, vending, bins, toilets | only at facility anchors, or where the station adds source-backed geometry; floor-standing pieces in walkable space are a Lane B decision with a replay rerun | bench, vending, bin, toilet, … | P1 |

## Production order

Each batch is one PR with 5–10 pieces, a contact sheet and both tiers passing validate, Godot import, web load and reproducibility (style.md §9). The AO bake ([#94](https://github.com/nurockplayer/gteki/issues/94) lighting item 5) lands first, in its own PR, because every piece carries it.

| Batch | Pieces | Why now |
| --- | --- | --- |
| **F0** | finish-pack format: tileable texture set (albedo, ORM, normal, repeat in metres) plus a 1×1 m sample GLB per finish, contract section and validator | lets stations use the kit's materials on their own geometry |
| **F1** | finishes: terrazzo, granite tile and border, 600 tile, enamel panel, wainscot blue, kick plate, spandrel ceiling, panel-grid ceiling, line-colour band, tactile | biggest screen area in both stations |
| **D1** | luminaire modules (linear LED 1.2 m, recessed panel, downlight), chair rail and skirting profile runs, column cladding sleeve (only where a column exists) | fixtures and wall trim are on screen everywhere |
| **D2** | escalator dressing set; stair dressing (nosing strip, handrail run, side skirt); railing and barrier runs (glass and steel) | the two stations' vertical links and fences |
| **D3** | platform edge set (Shinjuku B6); shopfront panel modules (Ikebukuro) | platform and shopfronts |
| **D4** | street-exit canopy, street furniture (bollard, guard rail, lamp, planter) | street level outside the walker footprint |
| **P1** | anchor props: bench, bin, vending, locker, toilet entrance surround | only where a facility anchor or station geometry backs them |
| **AI** | 2D art style batch (~10 images): fictional-brand posters, ad lightboxes, shopfront fascia art, each with a provenance sidecar | the Owner sees the batch before any mass run |

**Parametric fit.** Dressing pieces (runs, escalator and stair dressing, cladding) take their length, rise, width and path as catalog params. That way a station gets a piece that fits its geometry rather than a fixed module, while the kit itself stays generic: no station measurements live in the kit catalog.

## Open questions for the station leads

- **Ikebukuro:**
  - the element list behind `floor_elements`;
  - whether kit dressing for stairs and escalators should be merged into your bake GLB, or stay a separate GLB that you bake in.
- **Shinjuku:**
  - names for F001–F003 and F011–F014, so anchor props can be tagged;
  - whether the line-colour band should stay a runtime material colour (proposed) or ship as a kit variant.
