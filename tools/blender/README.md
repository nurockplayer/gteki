# GTEki Blender asset factory (Lane E)

Reproducible, parametric generators for a **generic, reusable station kit** (passages, junctions, fare-gate arrays, stairs, escalators, lift portals, wayfinding signs, props, toilet entrances, and dressing fitted to a station's own stairs, escalators and floor plan). Output is contract GLB (`docs/assets/asset-contract.md`) for the Three.js Web client and Godot 4. The kit carries no navigation truth and does not replicate any operator's equipment or any specific Ikebukuro/Shinjuku location; station leads decide placement and art direction.

## Requirements

- Blender 5.2 LTS (`brew install --cask blender`). The committed library is built with 5.2.2, and `build.sh repro` compares against it only on 5.2, because each GLB embeds the exporter version. Blender 4.2–5.1 are untested: the generators may run, but their output bytes will differ.
- Godot 4.x for the import test (tested 4.7.2, `brew install --cask godot`)
- pnpm for the Three.js viewer / load test (`brew install pnpm`) — never npm/npx/yarn
- No pip packages: generators use Blender's bundled numpy; `validate_glb.py` is stdlib only.

## Commands

```bash
tools/blender/build.sh            # generate assets/library from the catalog + validate
tools/blender/build.sh all        # + Godot headless import + Three.js load test
tools/blender/build.sh repro      # two clean builds must be byte-identical to each other and to assets/library
tools/blender/build.sh selftest   # validator, finish validator, texture budget and bundle tool self-tests (stdlib only)
tools/blender/build.sh finishes   # finish pack only: build assets/library/finishes + validate (also build-finishes, validate-finishes, repro-finishes)
ONLY=gteki_gate_array_4w1 tools/blender/build.sh build   # rebuild a subset
TEX_RES=2048 OUT=/tmp/kit_hq tools/blender/build.sh build # high-res textures (Godot HQ)
PROFILE=mobile tools/blender/build.sh all                 # mobile tier into assets/library/mobile (palette, merged VIS_body, UV1); its finishes use half-size textures
python3 tools/blender/validate_glb.py --require-occlusion assets/library/glb/*.glb   # FAIL assets without the baked AO map (default: allowed during rollout)
```

Viewer: `pnpm --dir tools/blender/web_preview install && pnpm --dir tools/blender/web_preview dev`, then open `/?asset=<id>` or `/?mode=gallery`.

Texture budget (`docs/assets/texture-budget.md`): `build.sh validate` also runs
`texture_budget.py assets/library --check tools/blender/catalog/budget.json`. For a before/after report, run
`python3 tools/blender/texture_budget.py assets/library --compare <old_library> --layout tools/blender/showcase/concourse_demo.json`.

Kit bundles (one GLB per scene; textures and materials stored once; clone per placement):
`python3 tools/blender/bundle_kit.py bundle --library assets/library --layout <layout.json> --out kit.glb` (also `--ids`, `--all`, `extract`, `info`).
Load benchmark: run the viewer and open `/bench.html?strategy=per_instance|per_asset|bundle`. Bundles are served from `tools/blender/out/bundles/`, and setting `GTEKI_COMPARE_LIBRARY_DIR` serves a second library as `&lib=compare`.

Godot screenshots: `sh tools/blender/godot_import/run_import_test.sh --screenshot assets/library/glb <out>`.

Blender round-trip renders (re-imports the GLBs, lights them from `LIGHTHINT_*`):
`blender -b --factory-startup -P tools/blender/render_preview.py -- --layout <layout.json> --out shot.png`.

Editable sources: add `--save-blend <dir>` to `build.py` to save a `.blend` per asset (keep outside Git), or change parameters in a catalog and rebuild — the catalog plus code is the source of truth.

## Layout

| Path | Purpose |
| --- | --- |
| `build.py`, `build.sh` | Catalog → GLB batch build, manifest, validation, import tests |
| `catalog/kit_v0_1.json` | Shared kit variants (ids, generator, params) |
| `catalog/finishes_v0_1.json` | Finish pack (`kind: "finish-pack"`): 8 tileable surface materials, built into `<out>/finishes` ([contract §9](../../docs/assets/asset-contract.md#9-finish-packs--gteki-finish01)) |
| `gteki_assets/contract.py` | Contract constants (`gteki-asset/0.1`) |
| `gteki_assets/mesh.py` | bmesh builders (box, prism, extrusions, cylinder, tube sweeps), metric box UVs |
| `gteki_assets/asset.py` | Asset assembly: parts → bevel + weighted normals → joined `VIS_*`, `*-colonly` collision, sockets, light hints, extras, GLB export |
| `gteki_assets/texsynth.py` | Seeded **tileable** numpy textures (terrazzo, tiles, metals, tactile blocks, treads, …) |
| `gteki_assets/materials.py` | Stable `gteki_*` PBR material library |
| `gteki_assets/finishes.py` | Finish materials (`gteki_finish_*`) and the pack writer (maps, `finish.json`) |
| `gteki_assets/ao.py` | Baked ambient occlusion: one Cycles-CPU map per asset (joint `UVLightmap` atlas), deterministic blur/dilate, PNG attached as `occlusionTexture` on `texCoord` 1 |
| `gteki_assets/families/*.py` | Generators by family (`dressing.py`: see below) |
| `render_preview.py` | GLB round-trip renders |
| `validate_glb.py` | Stdlib contract validator (`--self-test` included) |
| `validate_finish.py` | Stdlib finish-pack validator (schema, sha256, sizes, tiling, tint base; includes a baseline JPEG decoder; `--self-test`) |
| `texture_budget.py` | Download / GPU texture report, before-after compare, layout costing, budget check (`catalog/budget.json`) |
| `bundle_kit.py` | `gteki-kit-bundle/0.1`: pack assets into one GLB with shared images/materials; extract; info |
| `godot_import/` | Godot 4 project: headless import report + screenshot mode |
| `web_preview/` | Three.js viewer, load-strategy bench (`bench.html`), Node GLTFLoader load test |

## Facility anchors (`families/facilities.py`)

`toilet_entrance` is a wall-mounted portal surround and sign for a room a station knows only as a point (Shinjuku GSI F001 / F002 / F003, [gap-list](../../docs/assets/gap-list.md) finding 5). It draws no room: no fixtures, door leaf, floor or ceiling.

- **Placement `wall`:** origin on the floor at the wall plane, centred on the opening; the room is toward `-Y` (glTF `+Z`) and the wall thickness recesses toward `+Y`. `SOCKET_wall` is the opening, `SOCKET_sign` the sign face.
- **Params:** `kind` (`male` | `female` | `unisex` | `accessible` | `pair`, mirroring F001 / F002 / F003; `pair` is a combined male | female plate), `opening_w_mm`, `opening_h_mm`, `wall_depth_mm` (reveal lining, 0 = none), `trim` (`aluminium` | `brushed` | `dark` | `accent` | `enamel`), `trim_w_mm`, `trim_proud_mm`, `sign_pos` (`above` | `left` | `right` | `none`), `sign_mm`, `screen` (`none` | `maze`, an optional privacy screen stub behind the wall) and its `screen_*_mm` sizes. Catalog tags: `toilet`, `entrance` and the kind.
- **Pictograms:** the sign face `gteki_sign_face_toilet_<kind>` is one emissive quad drawn from the kit's own circles, capsules, rounded rectangles and polygons (`toilet_pictogram` in `texsynth.GENERATORS`). The shapes follow the general idea of public-information symbols and copy no artwork. No text; swap the material by name for wording.
- **Collision:** the opening is never blocked. Colliders are a thin box per jamb trim (the skin proud of the wall; the station's wall collider owns the wall) and, with `screen: maze`, the screen stub.
- Contact sheet layout: `showcase/facilities_demo.json`.

## Writing a generator

A generator is `fn(asset_id, params, tex_res) -> Asset` registered in its module's `GENERATORS`. Author in Blender Z-up with the entry edge at `y = 0`, travel/rise toward `+Y`, walking surface at `z = 0` (exported as glTF +Y up, entry at z=0 extending to −Z, front +Z). Use:

- `a.part(group, bevel=…)` for visuals; parts in a group are joined into one `VIS_<group>` mesh (fewer draw calls). Small chamfers (2–6 mm) plus weighted normals are what make hard-surface pieces read as finished rather than blockout.
- `a.pivot(group, loc)` to give `VIS_<group>` its own node origin at `loc`. Pivoted groups stay separate nodes in the mobile profile (gate flaps, and the pieces of `sign_frame_9slice` that a station scales or instances on its own); every other group merges into `VIS_body` there.
- `a.col_box` / `a.col_ramp` for simple collision (`COL_*-colonly`); stairs/escalators collide as ramps.
- `a.socket(name, loc, yaw, width=…, height=…)` for snap points (local +Y Blender = outward).
- `a.light_hint(name, loc, kind=…, …)` where a fixture emits light.
- Materials by stable name; add new ones with `materials.register()`. Keep everything original: no brand marks, no copied pictograms, no text in textures.
- Set `repeat_m` to the material's real repeat. Texture size follows from it (`materials.texture_res`), and maps that come out flat are exported as factors (`materials.texture_plan`), so do not pad a generator with invisible noise to "fill" a map. A face with a single 0–1 UV island that is not square (signs) should draw at its physical aspect (see `signage._face_shape`).

Every asset gets one baked AO map in both tiers (`gteki_assets/ao.py`, contract §4); generators need nothing for it. The bake uses Cycles on the CPU (about 30–60 s per asset), so full-library builds and `repro` take correspondingly longer.

Determinism: all randomness is seeded, textures are cached by content hash, UVs are quantized after modifiers; `build.sh repro` guards it.

## Dressing family

`families/dressing.py` makes pieces that go on geometry a station already has. They have no `COL_*` collision nodes, carry `gteki_role` (contract §10; the station runtime treats `barriers` and `transport` as colliders and `stairs_ramps` as walkable) and take every size as a catalog param in millimetres, so the kit holds no station measurements. The escalator and stair generators reuse `vertical.py`.

| Generator | Params (defaults) | Origin |
| --- | --- | --- |
| `escalator_dressing` | `rise_mm` 4000, `width_mm` 1000, `angle_deg` 30 or `run_mm` (horizontal run between the flat sections, eased ends included), `landing_mm` 800 (newel clearance and skirt length, both ends), `flat_steps` 2, `balustrade` glass or panel, `direction`, `parts` of balustrade, handrail, newel, comb (all four; e.g. `["comb", "newel"]` for a station that keeps its own balustrade), `skirts` false, `treads` false (static treads for flat slabs), `indicators` false; `gteki_role` `transport` (catalog override: `null` or another role) | bottom comb plate line |
| `stair_dressing` | `step_count` 18, `riser_mm` 160, `tread_mm` 300, `width_mm` 2400, `parts` of nosing, handrail, skirt, `handrail_sides` / `skirt_sides` both, left, right or none, `rail_mount` post or wall, `post_spacing_mm` 1800 (post or wall-bracket spacing), `rail_segments` 10 (handrail tube sides, 6–16; brackets use at most 8; mobile halves to at least 6), `skirt_mm` 140, `skirt_drop_mm` 200; `gteki_role` `stairs_ramps` for nosing only, `barriers` for rails and skirts, none for a mix (catalog override: `null` or another role) | floor under the bottom nosing |
| `railing_run` | `points` (`[[x_mm, y_mm], ...]`), `height_mm` 1100 (guard; 1150 for a fare fence), `style` glass or steel, `post_spacing_mm` 1200, `mid_rails` 2 (steel); `gteki_role` `barriers` (catalog override: `null` or another role) | plan origin of `points` |

A catalog entry may set `"gteki_role"` to override a generator's default role: `null` drops it, or another of `barriers`, `transport`, `stairs_ramps` (contract §10).

Variants are the `gteki_escalator_dress_*`, `gteki_stair_*`, `gteki_railing_run_*` and `gteki_fare_fence_*` ids in the catalog. Build them with `ONLY=<ids> tools/blender/build.sh build`.

## Platform and shopfront families

`families/platform.py` and `families/shopfront.py` are visual-only pieces for the station's own platform and walls. Every size is a catalog param in millimetres.

| Generator | Params (defaults) | Placement and origin |
| --- | --- | --- |
| `platform_edge` | `length_mm` 6000, `coping_depth_mm` 600, `coping_h_mm` 10, `coping` granite or concrete, `line_offset_mm` 40, `line_w_mm` 100, `tactile` dots or inner_line, `tactile_setback_mm` 200 (the band is one 300 mm block wide), `gap_strip_w_mm` 50, `parts` of coping, line, tactile, gap_strip (default the first three) | `linear`; origin on the platform edge line (x = 0, track −X, platform +X) at floor level; sockets `start`, `end`. The derived layout is `params.strips_mm` |
| `platform_screen_door` | `length_mm` 5600, `height_mm` 2000, `header_h_mm` 400, `inset_mm` 60, `depth_mm` 180, `opening_mm` 2000, `fixed_panels_per_side` 2, `open_mm` 0 | `linear`; origin on the edge line, module along +Y; sockets `start`, `end` |
| `shopfront` | `kind` glazing, door, shutter or fascia; `bay_w_mm` 2400, `height_mm` 2800 (including the fascia), `fascia_h_mm` 600, `mullion_mm` 60, `frame_depth_mm` 90, `sill_mm` 300, `panes` 0 (by width), `door_h_mm` 2100, `shutter_open` 0 to 0.9, `housing_h_mm` 250, `fascia` true, `backing` true, `fascia_u` [0, 1] | `wall`; back plane at y = 0, origin on the floor under the bay centre; sockets `left`, `right` |

The fascia art face of a `shopfront` uses the material `gteki_fascia_art`, which is also the one place a station or a later 2D pass swaps in sign art by name (see `docs/assets/gap-list.md`, D3 status). Variants are the `gteki_platform_*` and `gteki_shopfront_*` ids in the catalog; `showcase/platform_shop_demo.json` places all of them. Build them with `ONLY=<ids> tools/blender/build.sh build`.

## Street family (batch D4)

`families/street.py` holds the street-exit canopy and street furniture, all with `*_mm` catalog params and `dimension_basis` `synthetic`:

| Generator | Pieces | Placement | Collision |
| --- | --- | --- | --- |
| `street_canopy` | glazed roof on a steel frame, blank sign fascia (`SOCKET_fascia`, `SOCKET_opening`), posts or cantilever, optional glass side screens, flat, pitched or curved roof | `linear` (origin at the centre of the opening edge, roof toward +Y) | one box per post and per screen; none for the roof |
| `street_bollard` | fixed, or removable with an aluminium collar | `free` | 12-sided cylinder |
| `street_guard_rail` | posts and two rails along a `points_mm` polyline, `SOCKET_start` / `SOCKET_end` | `linear` | one thin full-height box per segment |
| `street_lamp` | pole, gooseneck arm, luminaire head, `LIGHTHINT_head` | `free` | 12-sided cylinder on the pole |
| `street_planter` | box or round concrete planter with an optional shrub | `free` | box or 12-sided cylinder |

The fascia is a blank `gteki_sign_face_*` quad with a 0..1 UV island for the station's own signage. It carries no wording. Four flat materials (`gteki_street_steel`, `_concrete`, `_soil`, `_foliage`) are new; they add no texture. Status and rationale are in `docs/assets/gap-list.md` (D4 status).

```bash
ONLY=$(python3 -c "import json;print(','.join(a['id'] for a in json.load(open('tools/blender/catalog/kit_v0_1.json'))['assets'] if a['id'].startswith('gteki_street_')))") tools/blender/build.sh build
PROFILE=mobile ONLY=<same ids> tools/blender/build.sh build
blender -b --factory-startup -P tools/blender/render_preview.py -- --layout tools/blender/showcase/street_demo.json --camera hero --out street_hero.png   # also: canopy, furniture
```
